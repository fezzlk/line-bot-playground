import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  BotsResponse,
  PlaygroundAction,
  PlaygroundGroup,
  PlaygroundLogEntry,
  PlaygroundUser,
} from "../../shared/types.ts";
import { api } from "./api.ts";
import { actionOutcome, type Tappable } from "./lineMessages.ts";
import { loadPrefs, savePrefs } from "./storage.ts";
import { Timeline } from "./Timeline.tsx";

const POLL_MS = 3000;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function groupLabel(g: PlaygroundGroup): string {
  const name = g.name ?? `${g.groupId.slice(0, 10)}…`;
  return g.allowed ? name : `${name}（未許可）`;
}

export function App() {
  const [bots, setBots] = useState<BotsResponse>({ bots: [], configError: null });
  const [groups, setGroups] = useState<PlaygroundGroup[]>([]);
  const [users, setUsers] = useState<PlaygroundUser[]>([]);
  const [log, setLog] = useState<PlaygroundLogEntry[]>([]);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const bot = bots.bots.find((b) => b.id === prefs.botId) ?? bots.bots[0];
  const group = groups.find((g) => g.groupId === prefs.groupId) ?? groups.find((g) => g.allowed);
  const actor = users.find((u) => u.userId === prefs.userId) ?? users[0];

  const run = useCallback(async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => savePrefs(prefs), [prefs]);
  useEffect(() => void run(async () => setBots(await api.bots())), [run]);

  const loadGroups = useCallback(
    () =>
      run(async () => {
        setGroups([]);
        if (bot) setGroups(await api.groups(bot.id));
      }),
    [bot, run],
  );
  useEffect(() => void loadGroups(), [loadGroups]);

  const groupId = group?.allowed ? group.groupId : undefined;
  useEffect(() => {
    setUsers([]);
    setLog([]);
    if (!bot || !groupId) return;
    void run(async () => setUsers(await api.users(bot.id, groupId)));
  }, [bot, groupId, run]);

  // Poll the log so what happens in the LINE app (the real user's turns) shows up here too.
  const refreshLog = useCallback(async () => {
    if (!bot || !groupId || document.hidden) return;
    try {
      setLog(await api.log(bot.id, groupId));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [bot, groupId]);
  useEffect(() => {
    void refreshLog();
    const timer = setInterval(() => void refreshLog(), POLL_MS);
    return () => clearInterval(timer);
  }, [refreshLog]);

  const send = (action: PlaygroundAction) =>
    run(async () => {
      if (!bot || !groupId || !actor) throw new Error("bot・グループ・架空のユーザーを選んでください");
      setSending(true);
      try {
        await api.send(bot.id, groupId, actor.userId, action);
      } finally {
        setSending(false);
        await refreshLog();
      }
    });

  const onTap = (tappable: Tappable) => {
    const outcome = actionOutcome(tappable.action);
    if (outcome.kind === "send") void send(outcome.action);
    else if (outcome.kind === "open") window.open(outcome.url, "_blank", "noopener");
    else if (outcome.kind === "needsInput") {
      const value = window.prompt(outcome.prompt);
      if (value) void send(outcome.complete(value));
    } else setError(outcome.reason);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    void send({ type: "text", text });
    setText("");
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    await send({ type: "image", base64: await readAsBase64(file) });
    if (fileInput.current) fileInput.current.value = "";
  };

  const addUser = () => {
    if (!bot || !groupId) return;
    const name = window.prompt("追加する架空のユーザーの名前", `ユーザー${String.fromCharCode(65 + users.length)}`);
    if (!name?.trim()) return;
    void run(async () => {
      const user = await api.addUser(bot.id, groupId, name.trim());
      setUsers((u) => [...u, user]);
      setPrefs((p) => ({ ...p, userId: user.userId }));
    });
  };

  const renameActor = () => {
    if (!bot || !groupId || !actor) return;
    const name = window.prompt("名前", actor.name);
    if (!name?.trim()) return;
    void run(async () => {
      const renamed = await api.renameUser(bot.id, groupId, actor.userId, name.trim());
      setUsers((u) => u.map((x) => (x.userId === renamed.userId ? renamed : x)));
    });
  };

  const menuAction = (task: () => unknown) => {
    setMenuOpen(false);
    void task();
  };

  return (
    <div className="app">
      <header>
        <div className="selectors">
          <select
            aria-label="bot"
            value={bot?.id ?? ""}
            onChange={(e) => setPrefs((p) => ({ ...p, botId: e.target.value, groupId: undefined }))}
          >
            {bots.bots.length === 0 && <option value="">bot がありません</option>}
            {bots.bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            aria-label="グループ"
            value={group?.groupId ?? ""}
            onChange={(e) => setPrefs((p) => ({ ...p, groupId: e.target.value }))}
          >
            {groups.length === 0 && <option value="">グループがありません</option>}
            {groups.map((g) => (
              <option key={g.groupId} value={g.groupId}>
                {groupLabel(g)}
              </option>
            ))}
          </select>
          <button type="button" className="icon" aria-label="メニュー" onClick={() => setMenuOpen((o) => !o)}>
            …
          </button>
        </div>
        {menuOpen && (
          <div className="menu" role="menu">
            <button type="button" onClick={() => menuAction(loadGroups)}>グループ一覧を更新</button>
            <button
              type="button"
              disabled={!actor}
              onClick={() => menuAction(() => send({ type: "memberJoined" }))}
            >
              {actor?.name ?? "架空のユーザー"}がグループに参加（memberJoined）
            </button>
            <hr />
            <button type="button" onClick={() => menuAction(() => run(async () => setBots(await api.reload())))}>
              bots.local.yaml を再読み込み
            </button>
          </div>
        )}
      </header>

      {bots.configError && <div className="banner error">{bots.configError}</div>}
      {group && !group.allowed && (
        <div className="banner warn">
          このグループは許可されていません。bot の PLAYGROUND_ALLOWED_GROUPS に <code>{group.groupId}</code> を追加してください。本物の参加者がいるグループは追加しないでください。
        </div>
      )}
      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {groupId ? (
        <Timeline entries={log} users={users} onTap={onTap} />
      ) : (
        <div className="timeline empty">
          <p>
            {bot
              ? "テスト用グループを選んでください。一覧にないときは、LINE アプリでそのグループに何か送ってから「グループ一覧を更新」を押してください。"
              : "bots.local.yaml に bot を登録してください。"}
          </p>
        </div>
      )}

      <footer>
        <div className="chips actors" role="radiogroup" aria-label="送信する架空のユーザー">
          {users.map((u) => (
            <button
              key={u.userId}
              type="button"
              role="radio"
              aria-checked={u.userId === actor?.userId}
              className={`chip${u.userId === actor?.userId ? " selected" : ""}`}
              onClick={() => (u.userId === actor?.userId ? renameActor() : setPrefs((p) => ({ ...p, userId: u.userId })))}
              title={u.userId === actor?.userId ? "タップで名前を変更" : "このユーザーとして操作"}
            >
              🧪{u.name}
            </button>
          ))}
          <button type="button" className="chip add" onClick={addUser} disabled={!groupId} aria-label="架空のユーザーを追加">
            ＋
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <button
            type="button"
            className="icon"
            aria-label="画像を送る"
            disabled={!actor || sending}
            onClick={() => fileInput.current?.click()}
          >
            🖼
          </button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void onPickImage(e.target.files?.[0])} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={actor ? `${actor.name}として送信` : "先に＋で架空のユーザーを追加"}
            disabled={!actor}
            enterKeyHint="send"
          />
          <button type="submit" disabled={!actor || !text.trim() || sending}>
            {sending ? "送信中" : "送信"}
          </button>
        </form>
      </footer>
    </div>
  );
}
