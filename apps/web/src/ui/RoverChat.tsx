import { useEffect, useRef, useState, type FormEvent } from "react";
import { executeIntent, HELP_TEXT, type ChatReply, type ExecuteContext } from "../rover/executeIntent";
import { interpret } from "../rover/interpret";
import { TeamCodeField } from "../rover/TeamCodeField";
import { GROK_STATUS_TEXT, useGrokStatus } from "../rover/useGrokStatus";
import { useVoice } from "../voice/useVoice";

// `via` says who read the message: Grok (through the backend) or the local keyword reader, and `why` Grok did not.
type Message = {
  id: number;
  from: "you" | "rover";
  text: string;
  sources?: ChatReply["sources"];
  tag?: string;
  via?: "grok" | "local";
  why?: string;
};

// Longer replies start folded, so one answer does not fill the whole chat.
const FOLD_OVER_LINES = 8;
const FOLDED_LINES = 5;

const SUGGESTIONS = ["Where should we build?", "Is site 2 reachable?", "Drive to site 1", "What minerals are here?"];

export function RoverChat({ context }: { context: ExecuteContext | null }) {
  // On a laptop-sized window the open chat covers half the view, so it starts minimized there.
  const [open, setOpen] = useState(() => window.innerWidth >= 1500);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ id: 0, from: "rover", text: HELP_TEXT }]);
  const contextRef = useRef(context);
  contextRef.current = context;
  const listRef = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const grokStatus = useGrokStatus();

  // `spoken`: the text came from the microphone (Grok Voice), so the reply is read aloud too.
  const send = async (text: string, spoken = false) => {
    const ctx = contextRef.current;
    if (!text.trim() || !ctx || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { id: nextId.current++, from: "you", text, tag: spoken ? "heard by Grok Voice" : undefined }]);
    try {
      const pinNames = ctx.pins.map((p) => p.name);
      const { intent, via, why } = await interpret(text, ctx.manifest.scene_id, pinNames);
      // Read the context again: the scene may have changed while waiting for the backend.
      const reply = executeIntent(intent, text, contextRef.current ?? ctx);
      setMessages((m) => [...m, { id: nextId.current++, from: "rover", ...reply, tag: intent?.intent, via, why }]);
      if (spoken) void voice.speak(reply.text);
    } finally {
      setBusy(false);
    }
  };

  const voice = useVoice((text) => void send(text, true));

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
        <span>
          <strong>Rover assistant</strong>
          <span className={`grok-status ${grokStatus}`}>{GROK_STATUS_TEXT[grokStatus]}</span>
        </span>
        <button onClick={() => setOpen(false)} aria-label="Minimize chat">
          –
        </button>
      </div>
      <TeamCodeField />
      <div className="chat-messages" ref={listRef}>
        {messages.map((message) => {
          const lines = message.text.split("\n");
          const folded = lines.length > FOLD_OVER_LINES && !expanded.has(message.id);
          return (
            <div key={message.id} className={`chat-message from-${message.from}`}>
              <div className="chat-text">{folded ? lines.slice(0, FOLDED_LINES).join("\n") : message.text}</div>
              {folded && (
                <button className="chat-more" onClick={() => setExpanded((ids) => new Set(ids).add(message.id))}>
                  Show all ({lines.length - FOLDED_LINES} more)
                </button>
              )}
              {message.sources && message.sources.length > 0 && (
                <div className="chat-sources">
                  Sources:{" "}
                  {message.sources.map((source, i) => (
                    <a key={i} href={source.url} target="_blank" rel="noreferrer" title={`${source.label}: ${source.url}`}>
                      [{i + 1}]
                    </a>
                  ))}
                </div>
              )}
              {(message.tag || message.via) && (
                <div className="chat-tag">
                  {message.via === "grok" && <span className="via via-grok">read by Grok</span>}
                  {message.via === "local" && (
                    <span className="via via-local" title={message.why}>
                      local reader, not Grok
                    </span>
                  )}{" "}
                  {message.tag}
                  {message.via === "local" && message.why && ` · ${message.why}`}
                </div>
              )}
            </div>
          );
        })}
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
        {voice.available && (
          <button
            type="button"
            className={`mic ${voice.state}`}
            onClick={() => void voice.toggle()}
            disabled={busy || !context || voice.state === "transcribing"}
            title="Speak to the rover (Grok Voice)"
            aria-label={voice.state === "recording" ? "Stop recording" : "Speak to the rover"}
          >
            {voice.state === "recording" ? "■ Stop" : voice.state === "transcribing" ? "…" : "🎙"}
          </button>
        )}
        <button type="submit" disabled={busy || !input.trim() || !context}>
          Send
        </button>
      </form>
      {voice.state === "recording" && <div className="chat-voice-error muted">Listening… press Stop when done.</div>}
      {voice.error && (
        <div className="chat-voice-error error" role="alert">
          {voice.error}
        </div>
      )}
    </div>
  );
}
