import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SharedScene } from "../multiplayer/useSharedScene";

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** Team chat: the people in this scene talking to each other through SpacetimeDB. Not the rover assistant. */
export function TeamChat({ shared }: { shared: SharedScene }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLOListElement>(null);
  const live = shared.status === "live";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [shared.chat.length]);

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    shared.actions.sendChat(text);
    setText("");
  };

  return (
    <section className="team-chat">
      <h2>Team chat</h2>
      <p className="muted small team-chat-note">
        {live ? "Between the people in this scene, live." : "Offline: your messages stay on this computer, not shared."}
      </p>
      <ol className="team-chat-messages" ref={listRef}>
        {shared.chat.map((line) => (
          <li key={String(line.id)} className={line.mine ? "team-chat-line mine" : "team-chat-line"}>
            <span className="team-chat-author" style={{ color: line.color }}>
              {line.mine ? "you" : line.name}
            </span>{" "}
            <span className="team-chat-time muted small">{time(line.sentAtMs)}</span>
            <div className="team-chat-text">{line.text}</div>
          </li>
        ))}
      </ol>
      {shared.chat.length === 0 && <p className="muted small">No messages yet.</p>}
      <form className="team-chat-input" onSubmit={send}>
        <input name="team-chat" value={text} maxLength={500} placeholder="Message your team…" onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
