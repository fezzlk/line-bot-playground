import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { BotSummary } from "../shared/types.ts";

export interface BotConfig extends BotSummary {
  /** The bot's PLAYGROUND_TOKEN. Never sent to the browser. */
  token: string;
}

export interface LoadedConfig {
  bots: BotConfig[];
  error: string | null;
}

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
 * Parses bots.local.yaml. A token can be written inline (`token`) or read from
 * an environment variable (`tokenEnv`), so the file can stay free of secrets.
 */
export function parseConfig(text: string, env: NodeJS.ProcessEnv = process.env): BotConfig[] {
  const doc = parse(text) as unknown;
  if (!doc || typeof doc !== "object" || !Array.isArray((doc as { bots?: unknown }).bots)) {
    fail('the file must have a top-level "bots" list');
  }
  const seen = new Set<string>();
  return (doc as { bots: unknown[] }).bots.map((entry, index) => {
    if (!entry || typeof entry !== "object") fail(`bots[${index}] must be a mapping`);
    const raw = entry as Record<string, unknown>;
    const where = `bots[${index}]`;
    const id = readString(raw, "id", where) ?? fail(`${where}: "id" is required`);
    if (seen.has(id)) fail(`${where}: duplicate id "${id}"`);
    seen.add(id);
    const baseUrl = (readString(raw, "baseUrl", where) ?? fail(`${where}: "baseUrl" is required`)).replace(/\/+$/, "");
    const tokenEnv = readString(raw, "tokenEnv", where);
    const token =
      readString(raw, "token", where) ??
      (tokenEnv ? env[tokenEnv] : undefined) ??
      fail(`${where}: set "token", or "tokenEnv" naming a set environment variable`);
    return { id, name: readString(raw, "name", where) ?? id, baseUrl, token };
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
  return { id: bot.id, name: bot.name, baseUrl: bot.baseUrl };
}
