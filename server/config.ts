import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { BotMode, BotSummary } from "../shared/types.ts";

export interface BotConfig extends BotSummary {
  channelSecret: string;
  /** The token the bot sends to the mock API, used to tell bots apart. Mock mode only. */
  mockAccessToken?: string;
  /** The `destination` field of webhook bodies (the bot's own user ID). */
  botUserId: string;
}

export interface LoadedConfig {
  bots: BotConfig[];
  error: string | null;
}

const MODES: BotMode[] = ["production", "mock"];

function fail(message: string): never {
  throw new Error(message);
}

function readString(raw: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value === "") fail(`${where}: "${key}" must be a non-empty string`);
  return value;
}

/**
 * Parses bots.local.yaml. A secret can be written inline (`channelSecret`) or
 * read from an environment variable (`channelSecretEnv`), so the file itself
 * can stay free of secrets if preferred.
 */
export function parseConfig(text: string, env: NodeJS.ProcessEnv = process.env): BotConfig[] {
  const doc = parse(text) as unknown;
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as { bots?: unknown }).bots)) {
    fail('the file must have a top-level "bots" list');
  }
  const seen = new Set<string>();
  return ((doc as { bots: unknown[] }).bots).map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`bots[${index}] must be a mapping`);
    const raw = entry as Record<string, unknown>;
    const where = `bots[${index}]`;
    const id = readString(raw, "id", where) ?? fail(`${where}: "id" is required`);
    if (seen.has(id)) fail(`${where}: duplicate id "${id}"`);
    seen.add(id);
    const mode = (readString(raw, "mode", where) ?? "mock") as BotMode;
    if (!MODES.includes(mode)) fail(`${where}: "mode" must be one of ${MODES.join(", ")}`);
    const webhookUrl = readString(raw, "webhookUrl", where) ?? fail(`${where}: "webhookUrl" is required`);
    const secretEnv = readString(raw, "channelSecretEnv", where);
    const channelSecret =
      readString(raw, "channelSecret", where) ??
      (secretEnv ? env[secretEnv] : undefined) ??
      fail(`${where}: set "channelSecret", or "channelSecretEnv" naming a set environment variable`);
    const mockAccessToken = readString(raw, "mockAccessToken", where);
    if (mode === "mock" && !mockAccessToken) fail(`${where}: "mockAccessToken" is required in mock mode`);
    return {
      id,
      name: readString(raw, "name", where) ?? id,
      mode,
      webhookUrl,
      channelSecret,
      mockAccessToken,
      botUserId: readString(raw, "botUserId", where) ?? "Uplaygroundbot0000000000000000000",
    };
  });
}

export async function loadConfig(path: string): Promise<LoadedConfig> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return { bots: [], error: `${path} が見つかりません。bots.example.yaml をコピーして作成してください。` };
  }
  try {
    return { bots: parseConfig(text), error: null };
  } catch (error) {
    return { bots: [], error: `${path} の読み込みに失敗しました: ${(error as Error).message}` };
  }
}

export function toSummary(bot: BotConfig): BotSummary {
  return { id: bot.id, name: bot.name, mode: bot.mode, webhookUrl: bot.webhookUrl };
}
