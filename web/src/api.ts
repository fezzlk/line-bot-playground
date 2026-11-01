import type { ConversationKind, PlaygroundState, UserAction } from "../../shared/types.ts";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `${res.status}`);
  return json;
}

export const api = {
  reload: () => call<PlaygroundState>("POST", "/reload"),
  reset: () => call<PlaygroundState>("POST", "/reset"),
  addUser: (name: string) => call("POST", "/users", { name }),
  renameUser: (id: string, name: string) => call("PATCH", `/users/${id}`, { name }),
  addConversation: (botId: string, kind: ConversationKind, userId?: string) =>
    call<{ id: string }>("POST", "/conversations", { botId, kind, userId }),
  send: (botId: string, conversationId: string, userId: string, action: UserAction) =>
    call("POST", "/send", { botId, conversationId, userId, action }),
};

/** Live state over SSE; EventSource reconnects on its own if the server restarts. */
export function subscribe(onState: (state: PlaygroundState) => void, onStatus: (connected: boolean) => void) {
  const source = new EventSource("/api/stream");
  source.addEventListener("state", (e) => onState(JSON.parse((e as MessageEvent<string>).data) as PlaygroundState));
  source.onopen = () => onStatus(true);
  source.onerror = () => onStatus(false);
  return () => source.close();
}
