import { Hono, type Context } from "hono";
import type { LineMessage } from "../shared/types.ts";
import type { BotConfig } from "./config.ts";
import type { Store } from "./store.ts";

// The subset of the LINE Messaging API a bot in mock mode calls. Paths match
// api.line.me and api-data.line.me, so a bot only needs its base URL changed.
// Error bodies follow LINE's `{ message }` shape so SDK error handling behaves
// the same as against the real API.

type Env = { Variables: { bot: BotConfig } };

function lineError(c: Context, status: 400 | 401 | 404, message: string) {
  return c.json({ message }, status);
}

function asMessages(value: unknown): LineMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 5) return null;
  if (!value.every((m) => m && typeof m === "object" && typeof (m as { type?: unknown }).type === "string")) {
    return null;
  }
  return value as LineMessage[];
}

export function createMockLineApi(store: Store, getBots: () => BotConfig[]): Hono<Env> {
  const api = new Hono<Env>();

  api.use("*", async (c, next) => {
    const token = c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
    const bot = getBots().find((b) => b.mode === "mock" && b.mockAccessToken === token);
    if (!bot) {
      store.append({
        kind: "system",
        botId: "",
        conversationId: "",
        level: "error",
        text: `モック API への呼び出し（${c.req.method} ${c.req.path}）を拒否しました。アクセストークンが、検証モードのどの bot の mockAccessToken とも一致しません。`,
      });
      return lineError(c, 401, "Authentication failed. Confirm that the access token in the authorization header is valid.");
    }
    c.set("bot", bot);
    await next();
  });

  api.post("/v2/bot/message/reply", async (c) => {
    const bot = c.get("bot");
    const body = (await c.req.json().catch(() => null)) as { replyToken?: unknown; messages?: unknown } | null;
    const messages = asMessages(body?.messages);
    if (!body || typeof body.replyToken !== "string" || !messages) {
      return lineError(c, 400, "The request body has 1 error(s)");
    }
    const target = store.consumeReplyToken(body.replyToken, bot.id);
    if (typeof target === "string") {
      store.append({ kind: "system", botId: bot.id, conversationId: "", level: "warn", text: `返信を拒否しました: ${target}` });
      return lineError(c, 400, target);
    }
    store.append({
      kind: "bot",
      botId: bot.id,
      conversationId: target.conversationId,
      via: "reply",
      replyTo: target.userId,
      messages,
    });
    return c.json({ sentMessages: messages.map((_, i) => ({ id: `${Date.now()}${i}`, quoteToken: "" })) });
  });

  api.post("/v2/bot/message/push", async (c) => {
    const bot = c.get("bot");
    const body = (await c.req.json().catch(() => null)) as { to?: unknown; messages?: unknown } | null;
    const messages = asMessages(body?.messages);
    if (!body || typeof body.to !== "string" || !messages) {
      return lineError(c, 400, "The request body has 1 error(s)");
    }
    if (!store.findConversation(bot.id, body.to) && !store.findUser(body.to)) {
      return lineError(c, 400, "The property, 'to', in the request body is invalid");
    }
    // Pushing to a user the bot has no 1:1 chat with yet opens one, as LINE would.
    const user = store.findUser(body.to);
    const conversation =
      store.findConversation(bot.id, body.to) ?? store.addConversation(bot.id, "user", `${user!.name}（1:1）`, body.to);
    store.append({ kind: "bot", botId: bot.id, conversationId: conversation.id, via: "push", messages });
    return c.json({ sentMessages: [] });
  });

  api.post("/v2/bot/message/multicast", async (c) => {
    const bot = c.get("bot");
    const body = (await c.req.json().catch(() => null)) as { to?: unknown; messages?: unknown } | null;
    const messages = asMessages(body?.messages);
    if (!body || !Array.isArray(body.to) || !messages) {
      return lineError(c, 400, "The request body has 1 error(s)");
    }
    for (const to of body.to) {
      const user = typeof to === "string" ? store.findUser(to) : undefined;
      if (!user) continue;
      const conversation = store.addConversation(bot.id, "user", `${user.name}（1:1）`, user.id);
      store.append({ kind: "bot", botId: bot.id, conversationId: conversation.id, via: "multicast", messages });
    }
    return c.json({});
  });

  const profile = (c: Context<Env>, userId: string) => {
    const user = store.findUser(userId);
    if (!user) return lineError(c, 404, "Not found");
    return c.json({ userId: user.id, displayName: user.name, language: "ja" });
  };
  api.get("/v2/bot/profile/:userId", (c) => profile(c, c.req.param("userId")));
  api.get("/v2/bot/group/:groupId/member/:userId", (c) => profile(c, c.req.param("userId")));
  api.get("/v2/bot/room/:roomId/member/:userId", (c) => profile(c, c.req.param("userId")));

  api.get("/v2/bot/message/:messageId/content", (c) => {
    const content = store.getContent(c.req.param("messageId"));
    if (!content) return lineError(c, 404, "Not found");
    return c.body(new Uint8Array(content.data), 200, { "content-type": content.contentType });
  });

  // The loading animation has no visible effect here; accept it quietly.
  api.post("/v2/bot/chat/loading/start", (c) => c.body(null, 202));

  api.all("*", async (c) => {
    store.append({
      kind: "system",
      botId: c.get("bot").id,
      conversationId: "",
      level: "warn",
      text: `未対応の LINE API が呼ばれました: ${c.req.method} ${c.req.path}（200 と空の応答を返しました）`,
    });
    return c.json({});
  });

  return api;
}
