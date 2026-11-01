import type { Conversation, UserAction } from "../shared/types.ts";
import { messageId, replyToken, webhookEventId } from "./ids.ts";

export interface BuiltEvent {
  event: Record<string, unknown>;
  replyToken: string;
  /** Set for message events, so image content can be served under this ID. */
  messageId?: string;
}

function source(conversation: Conversation, userId: string | undefined): Record<string, unknown> {
  switch (conversation.kind) {
    case "group":
      return { type: "group", groupId: conversation.id, ...(userId ? { userId } : {}) };
    case "room":
      return { type: "room", roomId: conversation.id, ...(userId ? { userId } : {}) };
    case "user":
      return { type: "user", userId: conversation.id };
  }
}

/**
 * Builds one webhook event in the shape LINE sends it. "join" is the bot being
 * added to the group, so it has no user; the others come from `userId`.
 */
export function buildEvent(
  conversation: Conversation,
  userId: string,
  action: UserAction,
  now: number = Date.now(),
): BuiltEvent {
  const token = replyToken();
  const base = {
    mode: "active",
    timestamp: now,
    webhookEventId: webhookEventId(),
    deliveryContext: { isRedelivery: false },
    replyToken: token,
  };

  switch (action.type) {
    case "text": {
      const id = messageId();
      return {
        replyToken: token,
        messageId: id,
        event: {
          ...base,
          type: "message",
          source: source(conversation, userId),
          message: { id, type: "text", text: action.text, quoteToken: `q${id}` },
        },
      };
    }
    case "image": {
      const id = messageId();
      return {
        replyToken: token,
        messageId: id,
        event: {
          ...base,
          type: "message",
          source: source(conversation, userId),
          message: { id, type: "image", contentProvider: { type: "line" }, quoteToken: `q${id}` },
        },
      };
    }
    case "postback":
      return {
        replyToken: token,
        event: {
          ...base,
          type: "postback",
          source: source(conversation, userId),
          postback: { data: action.data, ...(action.params ? { params: action.params } : {}) },
        },
      };
    case "join":
      return { replyToken: token, event: { ...base, type: "join", source: source(conversation, undefined) } };
    case "memberJoined":
      return {
        replyToken: token,
        event: {
          ...base,
          type: "memberJoined",
          source: source(conversation, undefined),
          joined: { members: [{ type: "user", userId }] },
        },
      };
    case "follow":
      return {
        replyToken: token,
        event: { ...base, type: "follow", source: source(conversation, userId), follow: { isUnblocked: false } },
      };
  }
}

export function webhookBody(destination: string, events: Record<string, unknown>[]): string {
  return JSON.stringify({ destination, events });
}
