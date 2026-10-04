import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SharedScene } from "../multiplayer/useSharedScene";
import { useDraggableWindow } from "./useDraggableWindow";

const OPEN_KEY = "pss-window:team-chat:open";
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function loadOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Team chat: the people in this scene talking to each other through SpacetimeDB. Not the rover assistant.
 * A window over the 3D view: dragged by its title bar, minimized to that bar (where it starts).
 */
export function TeamChat({ shared }: { shared: SharedScene }) {
  const [text, setText] = useState("");
  const [open, setOpenState] = useState(loadOpen);
  const [seen, setSeen] = useState(shared.chat.length); // lines already read
  const listRef = useRef<HTMLOListElement>(null);
  const live = shared.status === "live";
  const win = useDraggableWindow("team-chat", open);
  const unread = open ? 0 : shared.chat.slice(seen).filter((line) => !line.mine).length;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    if (open) setSeen(shared.chat.length);
  }, [shared.chat.length, open]);

  const setOpen = (next: boolean) => {
    setOpenState(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // not remembered across reloads
    }
  };

  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    shared.actions.sendChat(text);
    setText("");
  };

  return (
    <section className={open ? "team-chat" : "team-chat minimized"} ref={win.ref} style={win.style}>
      <div className="window-bar" {...win.bar}>
        <span>
          <strong>Team chat</strong>
          <span className="window-status">{live ? `live ${shared.people.length}` : "offline"}</span>
          {unread > 0 && <span className="team-chat-unread">{unread} new</span>}
        </span>
        <button onClick={() => setOpen(!open)} aria-label={open ? "Minimize team chat" : "Open team chat"}>
          {open ? "–" : "+"}
        </button>
      </div>
      {/* The body stays in the page when minimized (hidden), so nothing typed is lost. */}
      <div className="team-chat-body">
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
      </div>
    </section>
  );
}
