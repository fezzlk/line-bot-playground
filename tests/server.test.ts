import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve, type ServerType } from "@hono/node-server";
import { validateSignature } from "@line/bot-sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { TimelineEntry } from "../shared/types.ts";
import { createApp } from "../server/app.ts";
import { parseConfig, type BotConfig } from "../server/config.ts";
import { buildEvent } from "../server/events.ts";
import { signBody } from "../server/signature.ts";
import { Store } from "../server/store.ts";

const SECRET = "test-channel-secret";
const TOKEN = "playground-test-token";

function mockBot(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    id: "bot1",
    name: "テスト bot",
    mode: "mock",
    webhookUrl: "http://bot.invalid/callback",
    channelSecret: SECRET,
    mockAccessToken: TOKEN,
    botUserId: "Ubot",
    ...overrides,
  };
}

async function setup(bot = mockBot(), fetchImpl?: typeof fetch) {
  const store = new Store();
  const { app } = await createApp({ loadConfig: async () => ({ bots: [bot], error: null }), fetchImpl, store });
  const group = store.addConversation(bot.id, "group", "グループ");
  return { app, store, group, users: store.users };
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

describe("signature", () => {
  it("matches what @line/bot-sdk accepts", () => {
    const body = JSON.stringify({ destination: "U", events: [{ type: "message", text: "日本語" }] });
    expect(validateSignature(body, SECRET, signBody(SECRET, body))).toBe(true);
    expect(validateSignature(body, "other-secret", signBody(SECRET, body))).toBe(false);
  });
});

describe("config", () => {
  it("reads inline and env secrets and requires a mock token in mock mode", () => {
    const bots = parseConfig(
      `bots:
  - id: a
    webhookUrl: http://a/callback
    channelSecret: s1
    mockAccessToken: t1
  - id: b
    mode: production
    webhookUrl: https://b/callback
    channelSecretEnv: B_SECRET
`,
      { B_SECRET: "s2" },
    );
    expect(bots.map((b) => [b.id, b.mode, b.channelSecret])).toEqual([
      ["a", "mock", "s1"],
      ["b", "production", "s2"],
    ]);
    expect(() => parseConfig("bots:\n  - id: a\n    webhookUrl: x\n    channelSecret: s\n")).toThrow(/mockAccessToken/);
    expect(() =>
      parseConfig("bots:\n  - id: a\n    mode: production\n    webhookUrl: x\n    channelSecretEnv: MISSING\n", {}),
    ).toThrow(/channelSecret/);
  });
});

describe("events", () => {
  it("builds group events with the acting user and playground IDs", async () => {
    const { group, users } = await setup();
    const text = buildEvent(group, users[0]!.id, { type: "text", text: "参加" }).event;
    expect(text).toMatchObject({
      type: "message",
      source: { type: "group", groupId: group.id, userId: users[0]!.id },
      message: { type: "text", text: "参加" },
    });
    expect(group.id).toMatch(/^Cplayground[0-9a-f]{22}$/);
    expect(users[0]!.id).toMatch(/^Uplayground[0-9a-f]{22}$/);

    const postback = buildEvent(group, users[1]!.id, { type: "postback", data: "action=join" }).event;
    expect(postback).toMatchObject({ type: "postback", postback: { data: "action=join" } });

    const join = buildEvent(group, users[0]!.id, { type: "join" }).event;
    expect(join.source).toEqual({ type: "group", groupId: group.id });
  });
});

describe("mock LINE API", () => {
  it("routes a reply to the conversation and user whose event it answers, once", async () => {
    const { app, store, group, users } = await setup();
    store.rememberReplyToken("tok", { botId: "bot1", conversationId: group.id, userId: users[1]!.id });
    const send = () =>
      app.request("/v2/bot/message/reply", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ replyToken: "tok", messages: [{ type: "text", text: "ok" }] }),
      });
    expect((await send()).status).toBe(200);
    expect(store.timeline.at(-1)).toMatchObject({
      kind: "bot",
      via: "reply",
      conversationId: group.id,
      replyTo: users[1]!.id,
    });
    const again = await send();
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ message: "Invalid reply token (already used)" });
  });

  it("rejects calls whose token matches no mock-mode bot", async () => {
    const { app } = await setup();
    const res = await app.request("/v2/bot/profile/U1", { headers: { authorization: "Bearer wrong" } });
    expect(res.status).toBe(401);
  });

  it("returns virtual users' names as profiles", async () => {
    const { app, group, users } = await setup();
    for (const path of [`/v2/bot/profile/${users[0]!.id}`, `/v2/bot/group/${group.id}/member/${users[0]!.id}`]) {
      const res = await app.request(path, { headers: auth });
      expect(await res.json()).toMatchObject({ userId: users[0]!.id, displayName: "ユーザーA" });
    }
    expect((await app.request("/v2/bot/profile/Unknown", { headers: auth })).status).toBe(404);
  });

  it("records pushes to a group and opens a 1:1 chat for pushes to a user", async () => {
    const { app, store, group, users } = await setup();
    for (const to of [group.id, users[2]!.id]) {
      const res = await app.request("/v2/bot/message/push", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ to, messages: [{ type: "text", text: "お知らせ" }] }),
      });
      expect(res.status).toBe(200);
    }
    const pushes = store.timeline.filter((e) => e.kind === "bot");
    expect(pushes.map((e) => e.conversationId)).toEqual([group.id, users[2]!.id]);
    expect(store.findConversation("bot1", users[2]!.id)?.kind).toBe("user");
  });

  it("records unsupported endpoints instead of failing", async () => {
    const { app, store } = await setup();
    const res = await app.request("/v2/bot/richmenu/list", { headers: auth });
    expect(res.status).toBe(200);
    expect(store.timeline.at(-1)).toMatchObject({ kind: "system", level: "warn" });
  });
});

describe("end to end with a fake bot", () => {
  let playground: ServerType | undefined;
  let bot: Server | undefined;
  afterEach(() => {
    playground?.close();
    bot?.close();
  });

  it("injects a signed event, the bot echoes it, and the reply shows up", async () => {
    let mockBase = "";
    // A tiny bot: checks the signature, then fetches the sender's name and replies.
    bot = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString();
      if (!validateSignature(body, SECRET, String(req.headers["x-line-signature"]))) {
        res.writeHead(401).end();
        return;
      }
      const event = JSON.parse(body).events[0];
      const profile = await fetch(`${mockBase}/v2/bot/group/${event.source.groupId}/member/${event.source.userId}`, {
        headers: auth,
      }).then((r) => r.json());
      await fetch(`${mockBase}/v2/bot/message/reply`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          replyToken: event.replyToken,
          messages: [{ type: "text", text: `${profile.displayName}: ${event.message.text}` }],
        }),
      });
      res.writeHead(200).end();
    });
    await new Promise<void>((r) => bot!.listen(0, "127.0.0.1", r));
    const botPort = (bot.address() as AddressInfo).port;

    const store = new Store();
    const { app } = await createApp({
      loadConfig: async () => ({ bots: [mockBot({ webhookUrl: `http://127.0.0.1:${botPort}/callback` })], error: null }),
      store,
    });
    const port = await new Promise<number>((r) => {
      playground = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => r(info.port));
    });
    mockBase = `http://127.0.0.1:${port}`;
    const group = store.addConversation("bot1", "group", "グループ");

    const res = await fetch(`${mockBase}/api/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot1",
        conversationId: group.id,
        userId: store.users[1]!.id,
        action: { type: "text", text: "こんにちは" },
      }),
    });
    expect(res.status).toBe(200);
    const kinds = store.timeline.map((e: TimelineEntry) => e.kind);
    expect(kinds).toEqual(["user", "bot"]);
    expect(store.timeline[1]).toMatchObject({ messages: [{ type: "text", text: "ユーザーB: こんにちは" }] });
  });

  it("reports a signature mismatch from the bot", async () => {
    const fetchImpl = (async () => new Response("bad signature", { status: 401 })) as typeof fetch;
    const { app, store, group, users } = await setup(mockBot(), fetchImpl);
    await app.request("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ botId: "bot1", conversationId: group.id, userId: users[0]!.id, action: { type: "text", text: "x" } }),
    });
    const last = store.timeline.at(-1);
    expect(last).toMatchObject({ kind: "system", level: "error" });
    expect(last?.kind === "system" && last.text).toContain("チャネルシークレット");
  });

  it("serves an image the user sent to the bot's content download", async () => {
    const fetchImpl = (async () => new Response(null, { status: 200 })) as typeof fetch;
    const { app, store, group, users } = await setup(mockBot(), fetchImpl);
    const png = Buffer.from("fake-png").toString("base64");
    await app.request("/api/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        botId: "bot1",
        conversationId: group.id,
        userId: users[0]!.id,
        action: { type: "image", dataUrl: `data:image/png;base64,${png}` },
      }),
    });
    const entry = store.timeline.find((e) => e.kind === "user");
    const id = entry?.kind === "user" ? entry.imageUrl?.split("/").pop() : undefined;
    const res = await app.request(`/v2/bot/message/${id}/content`, { headers: auth });
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("fake-png");
  });
});
