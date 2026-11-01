import { randomBytes, randomInt } from "node:crypto";

// Every ID the playground makes contains "playground", so test data the bot
// stores (e.g. in a production database) is easy to find and delete later.

function hex(length: number): string {
  return randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
}

/** A LINE-shaped source ID: prefix letter + 32 characters. */
export function sourceId(prefix: "U" | "C" | "R"): string {
  return `${prefix}playground${hex(22)}`;
}

export function replyToken(): string {
  return hex(32);
}

/** LINE message IDs are numeric strings. */
export function messageId(): string {
  return `${randomInt(1, 10)}${Array.from({ length: 17 }, () => randomInt(0, 10)).join("")}`;
}

export function entryId(): string {
  return hex(16);
}

export function webhookEventId(): string {
  return `01PLAYGROUND${hex(14).toUpperCase()}`;
}
