import { Hono } from "hono";
import type { BotsResponse } from "../shared/types.ts";
import { toSummary, type LoadedConfig } from "./config.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AppOptions {
  loadConfig: () => Promise<LoadedConfig>;
  fetchImpl?: FetchLike;
}

/**
 * The browser never holds a bot's token: it calls `/api/bots/:botId/...` here,
 * and this server forwards the call to that bot's `/playground/...` plugin
 * endpoint with the token attached.
 */
export async function createApp(options: AppOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let config = await options.loadConfig();
  const bots = (): BotsResponse => ({ bots: config.bots.map(toSummary), configError: config.error });

  const api = new Hono();

  api.get("/bots", (c) => c.json(bots()));

  api.post("/reload", async (c) => {
    config = await options.loadConfig();
    return c.json(bots());
  });

  api.all("/bots/:botId/*", async (c) => {
    const bot = config.bots.find((b) => b.id === c.req.param("botId"));
    if (!bot) return c.json({ error: "unknown bot" }, 404);
    const url = new URL(c.req.url);
    const rest = url.pathname.slice(`/api/bots/${bot.id}`.length);
    const hasBody = c.req.method !== "GET" && c.req.method !== "HEAD";
    let response: Response;
    try {
      response = await fetchImpl(`${bot.baseUrl}/playground${rest}${url.search}`, {
        method: c.req.method,
        headers: { authorization: `Bearer ${bot.token}`, "content-type": "application/json" },
        body: hasBody ? await c.req.text() : undefined,
      });
    } catch (error) {
      return c.json({ error: `bot（${bot.baseUrl}）に届きませんでした: ${(error as Error).message}` }, 502);
    }
    const text = await response.text();
    if (response.status === 404 && rest === "/info") {
      return c.json({ error: "プラグインが無効です（PLAYGROUND_ENABLED と PLAYGROUND_TOKEN を確認してください）" }, 404);
    }
    return new Response(text, {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
    });
  });

  const app = new Hono();
  app.route("/api", api);
  return app;
}
