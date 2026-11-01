// Types shared by the controller server and web UI. The plugin-facing shapes
// mirror docs/protocol.md; tokens never appear in anything defined here.

export interface BotSummary {
  id: string;
  name: string;
  baseUrl: string;
}

export interface BotsResponse {
  bots: BotSummary[];
  configError: string | null;
}

export interface PlaygroundGroup {
  groupId: string;
  name: string | null;
  realUserIds: string[];
  lastSeenAt: number;
  allowed: boolean;
}

export interface PlaygroundUser {
  /** Always starts with "Uplayground". */
  userId: string;
  groupId: string;
  name: string;
}

/** A LINE message object as the bot sent it (text, image, flex, template, …). */
export type LineMessage = Record<string, unknown> & { type: string };

export type PlaygroundLogEntry =
  | { at: number; kind: "real"; userId: string; text: string }
  | { at: number; kind: "fictional"; userId: string; name: string; text: string }
  | { at: number; kind: "bot"; replyTo: string; messages: LineMessage[] };

export type PlaygroundAction =
  | { type: "text"; text: string }
  | { type: "image"; base64: string }
  | { type: "postback"; data: string; displayText?: string; params?: Record<string, string> }
  | { type: "memberJoined" };

export interface SendResponse {
  replies: LineMessage[];
  pushes: number;
}
