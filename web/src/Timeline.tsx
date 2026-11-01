import { useEffect, useRef } from "react";
import type { PlaygroundLogEntry, PlaygroundUser } from "../../shared/types.ts";
import { renderMessage, type Tappable } from "./lineMessages.ts";

interface Props {
  entries: PlaygroundLogEntry[];
  users: PlaygroundUser[];
  onTap: (tappable: Tappable) => void;
}

function time(at: number): string {
  return new Date(at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * The allowed group's recent conversation as the plugin logged it. Deliberately
 * plain: the real check happens in the LINE app; this view is for tapping the
 * bot's buttons as a fictional user.
 */
export function Timeline({ entries, users, onTap }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const nameOf = (id: string) => users.find((u) => u.userId === id)?.name ?? "LINE のユーザー";

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries.length]);

  if (entries.length === 0) {
    return (
      <div className="timeline empty">
        <p>まだ記録がありません。LINE アプリでグループに話しかけるか、下から架空のユーザーとして送ってください。</p>
      </div>
    );
  }

  return (
    <div className="timeline">
      {entries.map((entry, index) => {
        const key = `${entry.at}-${index}`;
        if (entry.kind === "real" || entry.kind === "fictional") {
          return (
            <div key={key} className={`row user ${entry.kind}`}>
              <div className="meta">
                {entry.kind === "fictional" ? `🧪${entry.name}` : "LINE のユーザー（本物）"}{" "}
                <span className="time">{time(entry.at)}</span>
              </div>
              <div className="bubble">{entry.text}</div>
            </div>
          );
        }
        return (
          <div key={key} className="row bot">
            <div className="meta">
              bot <span className="via">{nameOf(entry.replyTo)}への返信</span> <span className="time">{time(entry.at)}</span>
            </div>
            {entry.messages.map((message, i) => {
              const r = renderMessage(message);
              const tappables = [...r.buttons, ...r.quickReplies];
              return (
                <div key={i} className="bubble">
                  {r.texts.map((t, j) => (
                    <p key={j}>{t}</p>
                  ))}
                  {r.images.length > 0 && <p className="note">［画像 {r.images.length} 枚。LINE アプリで確認してください］</p>}
                  {tappables.length > 0 && (
                    <div className="chips inline">
                      {tappables.map((b, j) => (
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
