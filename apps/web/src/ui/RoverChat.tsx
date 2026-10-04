import { useEffect, useRef, useState, type FormEvent } from "react";
import { executeIntent, HELP_TEXT, type ChatReply, type ExecuteContext } from "../rover/executeIntent";
import { interpret } from "../rover/interpret";

type Message = { id: number; from: "you" | "rover"; text: string; sources?: ChatReply["sources"]; tag?: string };

const SUGGESTIONS = ["Where should we build?", "Is site 2 reachable?", "Drive to site 1", "What minerals are here?"];

export function RoverChat({ context }: { context: ExecuteContext | null }) {
  const [open, setOpen] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 0, from: "rover", text: HELP_TEXT }]);
  const contextRef = useRef(context);
  contextRef.current = context;
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const send = async (text: string) => {
    const ctx = contextRef.current;
    if (!text.trim() || !ctx || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: nextId.current++, from: "you", text }]);
    try {
      const pinNames = ctx.pins.map((p) => p.name);
      const { intent, via } = await interpret(text, ctx.manifest.scene_id, pinNames);
      // Read the context again: the scene may have changed while waiting for the backend.
      const reply = executeIntent(intent, text, contextRef.current ?? ctx);
      const tag = intent ? `${intent.intent} · ${via === "grok" ? "Grok" : "local reader"}` : undefined;
      setMessages((m) => [...m, { id: nextId.current++, from: "rover", ...reply, tag }]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(input);
  };

  if (!open) {
    return (
      <button className="chat-toggle" onClick={() => setOpen(true)}>
        Rover chat
      </button>
    );
  }

  return (
    <div className="chat">
      <div className="chat-header">
        <strong>Rover assistant</strong>
        <button onClick={() => setOpen(false)} aria-label="Minimize chat">
          –
        </button>
      </div>
      <div className="chat-messages" ref={listRef}>
        {messages.map((message) => (
          <div key={message.id} className={`chat-message from-${message.from}`}>
            <div className="chat-text">{message.text}</div>
            {message.sources && message.sources.length > 0 && (
              <div className="chat-sources">
                Sources:{" "}
                {message.sources.map((source, i) => (
                  <a key={i} href={source.url} target="_blank" rel="noreferrer">
                    [{i + 1}]
                  </a>
                ))}
              </div>
            )}
            {message.tag && <div className="chat-tag">{message.tag}</div>}
          </div>
        ))}
        {busy && <div className="chat-message from-rover muted">Thinking…</div>}
      </div>
      <div className="chat-suggestions">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => void send(s)} disabled={busy || !context}>
            {s}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={context ? "Ask the rover…" : "Loading scene…"}
          disabled={!context}
        />
        <button type="submit" disabled={busy || !input.trim() || !context}>
          Send
        </button>
      </form>
    </div>
  );
}
