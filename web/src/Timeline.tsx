import { useEffect, useRef } from "react";
import type { TimelineEntry, UserAction, VirtualUser } from "../../shared/types.ts";
import { renderMessage, type Tappable } from "./lineMessages.ts";

interface Props {
  entries: TimelineEntry[];
  users: VirtualUser[];
  onTap: (tappable: Tappable) => void;
}

function userActionText(action: UserAction): string {
  switch (action.type) {
    case "text":
      return action.text;
    case "image":
      return "";
    case "postback":
      return action.displayText ?? `［postback］${action.data}`;
    case "join":
      return "［bot をこのグループに追加］";
    case "memberJoined":
      return "［グループに参加］";
    case "follow":
      return "［bot を友だち追加］";
  }
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function Timeline({ entries, users, onTap }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const nameOf = (id?: string) => users.find((u) => u.id === id)?.name ?? "（不明なユーザー）";

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="timeline empty">
        <p>まだ何もありません。下の入力欄から、選んだユーザーとしてメッセージを送ってください。</p>
        <p>グループに bot がいる前提の bot なら、まず「…」メニューの「bot を追加（join）」を送ると自然です。</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {entries.map((entry) => {
        if (entry.kind === "system") {
          return (
            <div key={entry.id} className={`system ${entry.level}`}>
              <span className="time">{time(entry.at)}</span> {entry.text}
            </div>
          );
        }
        if (entry.kind === "user") {
          const isEvent = ["join", "memberJoined", "follow"].includes(entry.action.type);
          return (
            <div key={entry.id} className={`row user${isEvent ? " event" : ""}`}>
              <div className="meta">
                {nameOf(entry.userId)} <span className="time">{time(entry.at)}</span>
              </div>
              <div className={`bubble${entry.action.type === "postback" ? " postback" : ""}`}>
                {entry.imageUrl ? <img src={entry.imageUrl} alt="送った画像" /> : userActionText(entry.action)}
              </div>
            </div>
          );
        }
        const via = entry.via === "reply" ? `${nameOf(entry.replyTo)}への返信` : entry.via;
        return (
          <div key={entry.id} className="row bot">
            <div className="meta">
              bot <span className="via">{via}</span> <span className="time">{time(entry.at)}</span>
            </div>
            {entry.messages.map((message, i) => {
              const r = renderMessage(message);
              return (
                <div key={i} className="bubble">
                  {r.texts.map((t, j) => (
                    <p key={j}>{t}</p>
                  ))}
                  {r.images.map((src, j) => (
                    <a key={j} href={src} target="_blank" rel="noreferrer">
                      <img src={src} alt="bot の画像" />
                    </a>
                  ))}
                  {r.buttons.length > 0 && (
                    <div className="buttons">
                      {r.buttons.map((b, j) => (
                        <button key={j} type="button" onClick={() => onTap(b)}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {r.quickReplies.length > 0 && (
                    <div className="chips inline">
                      {r.quickReplies.map((b, j) => (
                        <button key={j} type="button" className="chip" onClick={() => onTap(b)}>
                          {b.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {r.lossy && (
                    <details>
                      <summary>JSON</summary>
                      <pre>{JSON.stringify(message, null, 2)}</pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}
