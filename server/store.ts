import { EventEmitter } from "node:events";
import type {
  Conversation,
  ConversationKind,
  TimelineEntry,
  VirtualUser,
} from "../shared/types.ts";
import { entryId, sourceId } from "./ids.ts";

type NewEntry = TimelineEntry extends infer E
  ? E extends TimelineEntry
    ? Omit<E, "id" | "at">
    : never
  : never;

export interface ReplyTarget {
  botId: string;
  conversationId: string;
  userId: string | undefined;
  used: boolean;
}

export interface StoredContent {
  contentType: string;
  data: Buffer;
}

// Plain names: bots often add their own honorific (e.g. "〇〇さん").
const DEFAULT_USER_NAMES = ["ユーザーA", "ユーザーB", "ユーザーC"];
const MAX_TIMELINE = 2000;

/**
 * Everything the playground remembers, in memory only. A restart or "reset"
 * starts over; nothing here is meant to outlive a test session.
 */
export class Store extends EventEmitter {
  users: VirtualUser[] = [];
  conversations: Conversation[] = [];
  timeline: TimelineEntry[] = [];
  private replyTokens = new Map<string, ReplyTarget>();
  private contents = new Map<string, StoredContent>();

  constructor() {
    super();
    this.reset();
  }

  reset(): void {
    this.users = DEFAULT_USER_NAMES.map((name) => ({ id: sourceId("U"), name }));
    this.conversations = [];
    this.timeline = [];
    this.replyTokens.clear();
    this.contents.clear();
    this.changed();
  }

  addUser(name: string): VirtualUser {
    const user = { id: sourceId("U"), name };
    this.users.push(user);
    this.changed();
    return user;
  }

  renameUser(userId: string, name: string): VirtualUser | undefined {
    const user = this.findUser(userId);
    if (user) {
      user.name = name;
      this.changed();
    }
    return user;
  }

  findUser(userId: string): VirtualUser | undefined {
    return this.users.find((u) => u.id === userId);
  }

  addConversation(botId: string, kind: ConversationKind, name: string, userId?: string): Conversation {
    if (kind === "user") {
      if (!userId) throw new Error("a 1:1 conversation needs a user");
      const existing = this.conversations.find((c) => c.botId === botId && c.id === userId);
      if (existing) return existing;
    }
    const id = kind === "user" ? userId! : sourceId(kind === "group" ? "C" : "R");
    const conversation = { id, botId, kind, name };
    this.conversations.push(conversation);
    this.changed();
    return conversation;
  }

  findConversation(botId: string, id: string): Conversation | undefined {
    return this.conversations.find((c) => c.botId === botId && c.id === id);
  }

  append(entry: NewEntry): TimelineEntry {
    const full = { ...entry, id: entryId(), at: Date.now() } as TimelineEntry;
    this.timeline.push(full);
    if (this.timeline.length > MAX_TIMELINE) this.timeline.splice(0, this.timeline.length - MAX_TIMELINE);
    this.changed();
    return full;
  }

  rememberReplyToken(token: string, target: Omit<ReplyTarget, "used">): void {
    this.replyTokens.set(token, { ...target, used: false });
  }

  /** Returns the target and marks the token used, or explains why it can't be used. */
  consumeReplyToken(token: string, botId: string): ReplyTarget | string {
    const target = this.replyTokens.get(token);
    if (!target || target.botId !== botId) return "Invalid reply token";
    if (target.used) return "Invalid reply token (already used)";
    target.used = true;
    return target;
  }

  saveContent(messageId: string, content: StoredContent): void {
    this.contents.set(messageId, content);
  }

  getContent(messageId: string): StoredContent | undefined {
    return this.contents.get(messageId);
  }

  private changed(): void {
    this.emit("change");
  }
}
