import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ConversationKind, PlaygroundState, SendRequest } from "../shared/types.ts";
import { toSummary, type LoadedConfig } from "./config.ts";
import { inject, type FetchLike } from "./injector.ts";
import { createMockLineApi } from "./mockLineApi.ts";
import { Store } from "./store.ts";

export interface AppOptions {
  loadConfig: () => Promise<LoadedConfig>;
  fetchImpl?: FetchLike;
  store?: Store;
}

const KINDS: ConversationKind[] = ["group", "room", "user"];

/**
 * One server for both sides: `/api/*` for the web UI, everything else is the
 * mock LINE API that bots in mock mode point their base URL at.
 */
export async function createApp(options: AppOptions) {
  const store = options.store ?? new Store();
  let config = await options.loadConfig();
  const findBot = (id: unknown) => config.bots.find((b) => b.id === id);

  const state = (): PlaygroundState => ({
    bots: config.bots.map(toSummary),
    configError: config.error,
    users: store.users,
    conversations: store.conversations,
    timeline: store.timeline,
  });

  const ui = new Hono();

  ui.get("/state", (c) => c.json(state()));

  ui.get("/stream", (c) =>
    streamSSE(c, async (stream) => {
      let pending = false;
      // Coalesce bursts of changes (a bot replying several times) into one push.
      const onChange = () => {
        if (pending) return;
        pending = true;
        setTimeout(() => {
          pending = false;
          void stream.writeSSE({ event: "state", data: JSON.stringify(state()) });
        }, 30);
      };
      store.on("change", onChange);
      stream.onAbort(() => {
        store.off("change", onChange);
      });
      await stream.writeSSE({ event: "state", data: JSON.stringify(state()) });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        await stream.writeSSE({ event: "ping", data: "" });
      }
    }),
  );

  ui.post("/reload", async (c) => {
    config = await options.loadConfig();
    store.emit("change");
    return c.json(state());
  });

  ui.post("/reset", (c) => {
    store.reset();
    return c.json(state());
  });

  ui.post("/users", async (c) => {
    const { name } = await c.req.json<{ name?: unknown }>();
    if (typeof name !== "string" || !name.trim()) return c.json({ error: "name is required" }, 400);
    return c.json(store.addUser(name.trim()));
  });

  ui.patch("/users/:id", async (c) => {
    const { name } = await c.req.json<{ name?: unknown }>();
    if (typeof name !== "string" || !name.trim()) return c.json({ error: "name is required" }, 400);
    const user = store.renameUser(c.req.param("id"), name.trim());
    return user ? c.json(user) : c.json({ error: "not found" }, 404);
  });

  ui.post("/conversations", async (c) => {
    const body = await c.req.json<{ botId?: unknown; kind?: unknown; name?: unknown; userId?: unknown }>();
    if (!findBot(body.botId)) return c.json({ error: "unknown bot" }, 400);
    if (!KINDS.includes(body.kind as ConversationKind)) return c.json({ error: "unknown kind" }, 400);
    const kind = body.kind as ConversationKind;
    const userId = typeof body.userId === "string" ? body.userId : undefined;
    if (kind === "user" && !store.findUser(userId ?? "")) return c.json({ error: "unknown user" }, 400);
    const fallbackName =
      kind === "user"
        ? `${store.findUser(userId!)!.name}（1:1）`
        : `${kind === "group" ? "グループ" : "トークルーム"}${store.conversations.length + 1}`;
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : fallbackName;
    return c.json(store.addConversation(body.botId as string, kind, name, userId));
  });

  ui.post("/send", async (c) => {
    const body = await c.req.json<SendRequest & { botId?: string }>();
    const bot = findBot(body.botId);
    if (!bot) return c.json({ error: "unknown bot" }, 400);
    try {
      await inject(store, bot, body, options.fetchImpl);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    return c.json({ ok: true });
  });

  ui.get("/content/:messageId", (c) => {
    const content = store.getContent(c.req.param("messageId"));
    if (!content) return c.notFound();
    return c.body(new Uint8Array(content.data), 200, { "content-type": content.contentType });
  });

  const app = new Hono();
  app.route("/api", ui);
  app.route("/", createMockLineApi(store, () => config.bots));
  return { app, store };
}
