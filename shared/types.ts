// Types shared by the server and the web UI. The UI only ever sees these shapes
// (never channel secrets), so keep secrets out of anything defined here.

export type BotMode = "production" | "mock";

export interface BotSummary {
  id: string;
  name: string;
  mode: BotMode;
  webhookUrl: string;
}

export interface VirtualUser {
  /** A LINE-shaped user ID ("U" + 32 chars) starting with "Uplayground". */
  id: string;
  name: string;
}

export type ConversationKind = "group" | "room" | "user";

export interface Conversation {
  /**
   * The LINE source ID the bot sees: a group ID ("Cplayground…"), a room ID
   * ("Rplayground…"), or the user's ID for a 1:1 chat.
   */
  id: string;
  botId: string;
  kind: ConversationKind;
  name: string;
}

/** A LINE message object as the bot sent it (text, image, flex, template, …). */
export type LineMessage = Record<string, unknown> & { type: string };

export type UserAction =
  | { type: "text"; text: string }
  | { type: "image"; dataUrl: string }
  | {
      type: "postback";
      data: string;
      /** Shown in the chat as the user's message, as LINE does for postback actions. */
      displayText?: string;
      params?: Record<string, string>;
    }
  | { type: "join" }
  | { type: "memberJoined" }
  | { type: "follow" };

interface EntryBase {
  id: string;
  at: number;
  botId: string;
  conversationId: string;
}

export type TimelineEntry =
  | (EntryBase & { kind: "user"; userId: string; action: UserAction; imageUrl?: string })
  | (EntryBase & {
      kind: "bot";
      via: "reply" | "push" | "multicast";
      /** For a reply, the user whose event it answers. */
      replyTo?: string;
      messages: LineMessage[];
    })
  | (EntryBase & { kind: "system"; level: "info" | "warn" | "error"; text: string });

export interface PlaygroundState {
  bots: BotSummary[];
  configError: string | null;
  users: VirtualUser[];
  conversations: Conversation[];
  timeline: TimelineEntry[];
}

export interface SendRequest {
  conversationId: string;
  userId: string;
  action: UserAction;
}
