import type { SendRequest } from "../shared/types.ts";
import type { BotConfig } from "./config.ts";
import { buildEvent, webhookBody } from "./events.ts";
import { signBody } from "./signature.ts";
import type { Store } from "./store.ts";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const DATA_URL = /^data:([^;,]+);base64,(.*)$/s;

/**
 * Turns one UI action into a signed webhook call to the bot, recording the
 * user's side in the timeline first so the order reads naturally.
 */
export async function inject(
  store: Store,
  bot: BotConfig,
  request: SendRequest,
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  const conversation = store.findConversation(bot.id, request.conversationId);
  if (!conversation) throw new Error("unknown conversation");
  if (!store.findUser(request.userId)) throw new Error("unknown user");

  const built = buildEvent(conversation, request.userId, request.action);
  let imageUrl: string | undefined;
  if (request.action.type === "image") {
    const match = DATA_URL.exec(request.action.dataUrl);
    if (!match || !built.messageId) throw new Error("image must be a base64 data URL");
    store.saveContent(built.messageId, { contentType: match[1]!, data: Buffer.from(match[2]!, "base64") });
    imageUrl = `/api/content/${built.messageId}`;
  }

  store.rememberReplyToken(built.replyToken, {
    botId: bot.id,
    conversationId: conversation.id,
    userId: request.action.type === "join" ? undefined : request.userId,
  });
  store.append({
    kind: "user",
    botId: bot.id,
    conversationId: conversation.id,
    userId: request.userId,
    action: request.action.type === "image" ? { type: "image", dataUrl: "" } : request.action,
    imageUrl,
  });

  const body = webhookBody(bot.botUserId, [built.event]);
  try {
    const response = await fetchImpl(bot.webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-line-signature": signBody(bot.channelSecret, body) },
      body,
    });
    if (!response.ok) {
      const text = (await response.text()).slice(0, 300);
      const hint = response.status === 401 ? "（チャネルシークレットが bot と一致していない可能性があります）" : "";
      store.append({
        kind: "system",
        botId: bot.id,
        conversationId: conversation.id,
        level: "error",
        text: `bot が ${response.status} を返しました${hint}: ${text}`,
      });
    } else if (bot.mode === "production") {
      store.append({
        kind: "system",
        botId: bot.id,
        conversationId: conversation.id,
        level: "info",
        text: `bot が ${response.status} を返しました。本番モードのため、返信はここには表示されません。`,
      });
    }
  } catch (error) {
    store.append({
      kind: "system",
      botId: bot.id,
      conversationId: conversation.id,
      level: "error",
      text: `bot の webhook（${bot.webhookUrl}）に届きませんでした: ${(error as Error).message}`,
    });
  }
}
