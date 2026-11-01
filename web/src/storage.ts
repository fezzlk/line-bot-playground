// Remembers per-browser UI choices (selected bot, chat, acting user). Storage
// can be unavailable (private mode, blocked site data), so every access is
// best-effort and the UI works without it.

const KEY = "line-bot-playground:ui";

export interface UiPrefs {
  botId?: string;
  conversationId?: string;
  userId?: string;
}

export function loadPrefs(): UiPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as UiPrefs;
  } catch {
    return {};
  }
}

export function savePrefs(prefs: UiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // Ignore: preferences are a convenience only.
  }
}
