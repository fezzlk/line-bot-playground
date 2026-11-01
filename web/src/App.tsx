import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ConversationKind, PlaygroundState, UserAction } from "../../shared/types.ts";
import { api, subscribe } from "./api.ts";
import { actionOutcome, type Tappable } from "./lineMessages.ts";
import { loadPrefs, savePrefs } from "./storage.ts";
import { Timeline } from "./Timeline.tsx";

const EMPTY: PlaygroundState = { bots: [], configError: null, users: [], conversations: [], timeline: [] };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function App() {
  const [state, setState] = useState<PlaygroundState>(EMPTY);
  const [connected, setConnected] = useState(false);
  const [prefs, setPrefs] = useState(loadPrefs);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => subscribe(setState, setConnected), []);
  useEffect(() => savePrefs(prefs), [prefs]);

  const bot = state.bots.find((b) => b.id === prefs.botId) ?? state.bots[0];
  const conversations = state.conversations.filter((c) => c.botId === bot?.id);
  const conversation = conversations.find((c) => c.id === prefs.conversationId) ?? conversations[0];
  const actor = state.users.find((u) => u.id === prefs.userId) ?? state.users[0];

  const entries = useMemo(
    () =>
      state.timeline.filter(
        (e) => (e.botId === bot?.id || e.botId === "") && (e.conversationId === conversation?.id || e.conversationId === ""),
      ),
    [state.timeline, bot?.id, conversation?.id],
  );

  const run = async (task: () => Promise<unknown>) => {
    setError(null);
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const send = (action: UserAction) =>
    run(async () => {
      if (!bot || !conversation || !actor) throw new Error("bot・トーク・ユーザーを選んでください");
      await api.send(bot.id, conversation.id, actor.id, action);
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
    await send({ type: "image", dataUrl: await readAsDataUrl(file) });
    if (fileInput.current) fileInput.current.value = "";
  };

  const newConversation = (kind: ConversationKind) =>
    run(async () => {
      if (!bot) throw new Error("bot を選んでください");
      const created = await api.addConversation(bot.id, kind, kind === "user" ? actor?.id : undefined);
      setPrefs((p) => ({ ...p, conversationId: created.id }));
    });

  const renameActor = () => {
    if (!actor) return;
    const name = window.prompt("表示名", actor.name);
    if (name?.trim()) void run(() => api.renameUser(actor.id, name));
  };

  const addUser = () => {
    const name = window.prompt("追加するユーザーの表示名", `ユーザー${String.fromCharCode(65 + state.users.length)}`);
    if (name?.trim()) void run(() => api.addUser(name));
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
            onChange={(e) => setPrefs((p) => ({ ...p, botId: e.target.value, conversationId: undefined }))}
          >
            {state.bots.length === 0 && <option value="">bot がありません</option>}
            {state.bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}（{b.mode === "mock" ? "検証" : "本番"}）
              </option>
            ))}
          </select>
          <select
            aria-label="トーク"
            value={conversation?.id ?? ""}
            onChange={(e) => setPrefs((p) => ({ ...p, conversationId: e.target.value }))}
          >
            {conversations.length === 0 && <option value="">トークがありません</option>}
            {conversations.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="icon" aria-label="メニュー" onClick={() => setMenuOpen((o) => !o)}>
            …
          </button>
        </div>
        <span className={`status ${connected ? "on" : "off"}`} title={connected ? "接続中" : "切断"} />
        {menuOpen && (
          <div className="menu" role="menu">
            <button type="button" onClick={() => menuAction(() => newConversation("group"))}>新しいグループ</button>
            <button type="button" onClick={() => menuAction(() => newConversation("room"))}>新しいトークルーム</button>
            <button type="button" onClick={() => menuAction(() => newConversation("user"))}>
              {actor?.name ?? "ユーザー"}と bot の 1:1 トーク
            </button>
            <hr />
            <button type="button" disabled={!conversation || conversation.kind === "user"} onClick={() => menuAction(() => send({ type: "join" }))}>
              bot をこのトークに追加（join）
            </button>
            <button type="button" disabled={!conversation || conversation.kind === "user"} onClick={() => menuAction(() => send({ type: "memberJoined" }))}>
              {actor?.name ?? "ユーザー"}が参加（memberJoined）
            </button>
            <button type="button" disabled={conversation?.kind !== "user"} onClick={() => menuAction(() => send({ type: "follow" }))}>
              {actor?.name ?? "ユーザー"}が友だち追加（follow）
            </button>
            <hr />
            <button type="button" onClick={() => menuAction(() => run(api.reload))}>bots.local.yaml を再読み込み</button>
            <button
              type="button"
              className="danger"
              onClick={() => menuAction(() => window.confirm("ユーザー・トーク・履歴をすべて消します。よいですか？") && run(api.reset))}
            >
              すべてリセット
            </button>
          </div>
        )}
      </header>

      {state.configError && <div className="banner error">{state.configError}</div>}
      {bot?.mode === "production" && (
        <div className="banner warn">本番モード: 架空のユーザーのイベントを送るだけです。bot の返信はここに表示されません。</div>
      )}
      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {conversation ? (
        <Timeline entries={entries} users={state.users} onTap={onTap} />
      ) : (
        <div className="timeline empty">
          <p>{bot ? "「…」メニューからグループか 1:1 トークを作ってください。" : "bots.local.yaml に bot を登録してください。"}</p>
        </div>
      )}

      <footer>
        <div className="chips actors" role="radiogroup" aria-label="送信するユーザー">
          {state.users.map((u) => (
            <button
              key={u.id}
              type="button"
              role="radio"
              aria-checked={u.id === actor?.id}
              className={`chip${u.id === actor?.id ? " selected" : ""}`}
              onClick={() => (u.id === actor?.id ? renameActor() : setPrefs((p) => ({ ...p, userId: u.id })))}
              title={u.id === actor?.id ? "タップで名前を変更" : "このユーザーとして操作"}
            >
              {u.name}
            </button>
          ))}
          <button type="button" className="chip add" onClick={addUser} aria-label="ユーザーを追加">
            ＋
          </button>
        </div>
        <form onSubmit={onSubmit}>
          <button type="button" className="icon" aria-label="画像を送る" onClick={() => fileInput.current?.click()}>
            🖼
          </button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void onPickImage(e.target.files?.[0])} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={actor ? `${actor.name}として送信` : "メッセージ"}
            enterKeyHint="send"
          />
          <button type="submit" disabled={!text.trim()}>
            送信
          </button>
        </form>
      </footer>
    </div>
  );
}
