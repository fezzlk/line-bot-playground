import { describe, expect, it } from "vitest";
import { createApp, type FetchLike } from "../server/app.ts";
import { parseConfig, type BotConfig } from "../server/config.ts";

const bot: BotConfig = { id: "qk", name: "qk-jenga", baseUrl: "https://bot.example", token: "secret-token" };

function recordingFetch(response: Response = Response.json({ ok: true })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  return { calls, fetchImpl };
}

describe("config", () => {
  it("reads inline and env tokens and trims trailing slashes", () => {
    const bots = parseConfig(
      `bots:
  - id: a
    baseUrl: https://a.example/
    token: t1
  - id: b
    baseUrl: http://localhost:8080
    tokenEnv: B_TOKEN
`,
      { B_TOKEN: "t2" },
    );
    expect(bots.map((b) => [b.id, b.baseUrl, b.token])).toEqual([
      ["a", "https://a.example", "t1"],
      ["b", "http://localhost:8080", "t2"],
    ]);
    expect(() => parseConfig("bots:\n  - id: a\n    baseUrl: x\n    tokenEnv: MISSING\n", {})).toThrow(/token/);
  });
});

describe("controller proxy", () => {
  it("lists bots without their tokens", async () => {
    const app = await createApp({ loadConfig: async () => ({ bots: [bot], error: null }) });
    const body = await (await app.request("/api/bots")).text();
    expect(JSON.parse(body)).toEqual({ bots: [{ id: "qk", name: "qk-jenga", baseUrl: "https://bot.example" }], configError: null });
    expect(body).not.toContain("secret-token");
  });

  it("forwards calls to the bot's plugin with the token, keeping method, body and query", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const app = await createApp({ loadConfig: async () => ({ bots: [bot], error: null }), fetchImpl });
    const res = await app.request("/api/bots/qk/send", { method: "POST", body: '{"groupId":"C1"}' });
    expect(res.status).toBe(200);
    await app.request("/api/bots/qk/groups/C1/messages?limit=5");
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", "https://bot.example/playground/send"],
      ["GET", "https://bot.example/playground/groups/C1/messages?limit=5"],
    ]);
    expect(calls[0]!.init.body).toBe('{"groupId":"C1"}');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer secret-token");
  });

  it("passes the plugin's errors through and reports unreachable bots", async () => {
    const { fetchImpl } = recordingFetch(Response.json({ error: "This group is not in PLAYGROUND_ALLOWED_GROUPS" }, { status: 403 }));
    const app = await createApp({ loadConfig: async () => ({ bots: [bot], error: null }), fetchImpl });
    const res = await app.request("/api/bots/qk/send", { method: "POST", body: "{}" });
    expect(res.status).toBe(403);

    const down = await createApp({
      loadConfig: async () => ({ bots: [bot], error: null }),
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect((await down.request("/api/bots/qk/info")).status).toBe(502);
    expect((await down.request("/api/bots/nope/info")).status).toBe(404);
  });
});
