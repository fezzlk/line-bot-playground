import type {
  BotsResponse,
  PlaygroundAction,
  PlaygroundGroup,
  PlaygroundLogEntry,
  PlaygroundUser,
  SendResponse,
} from "../../shared/types.ts";

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

const bot = (botId: string) => `/bots/${encodeURIComponent(botId)}`;
const group = (botId: string, groupId: string) => `${bot(botId)}/groups/${encodeURIComponent(groupId)}`;

export const api = {
  bots: () => call<BotsResponse>("GET", "/bots"),
  reload: () => call<BotsResponse>("POST", "/reload"),
  groups: async (botId: string) => (await call<{ groups: PlaygroundGroup[] }>("GET", `${bot(botId)}/groups`)).groups,
  users: async (botId: string, groupId: string) =>
    (await call<{ users: PlaygroundUser[] }>("GET", `${group(botId, groupId)}/users`)).users,
  addUser: (botId: string, groupId: string, name: string) =>
    call<PlaygroundUser>("POST", `${group(botId, groupId)}/users`, { name }),
  renameUser: (botId: string, groupId: string, userId: string, name: string) =>
    call<PlaygroundUser>("PATCH", `${group(botId, groupId)}/users/${encodeURIComponent(userId)}`, { name }),
  log: async (botId: string, groupId: string) =>
    (await call<{ messages: PlaygroundLogEntry[] }>("GET", `${group(botId, groupId)}/messages?limit=50`)).messages,
  send: (botId: string, groupId: string, userId: string, action: PlaygroundAction) =>
    call<SendResponse>("POST", `${bot(botId)}/send`, { groupId, userId, action }),
};
