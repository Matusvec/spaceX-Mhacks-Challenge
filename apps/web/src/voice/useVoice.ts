import { useCallback, useEffect, useRef, useState } from "react";
import { backendError, hasBackend } from "../concept/api";
import { apiFetch } from "../config/backend";

const MAX_RECORDING_MS = 15000;
const MAX_SPOKEN_CHARS = 500;

export type VoiceState = "idle" | "recording" | "transcribing";

/**
 * Grok Voice through the backend: records one utterance, has /voice/transcribe turn it into text (xAI
 * speech-to-text) and hands the text to `onText`; `speak` reads a reply aloud (xAI text-to-speech).
 */
export function useVoice(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => recorder.current?.stream.getTracks().forEach((track) => track.stop()), []);

  const transcribe = async (audio: Blob) => {
    setState("transcribing");
    try {
      const response = await apiFetch("/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": audio.type || "audio/webm" },
        body: audio,
      });
      if (!response.ok) throw new Error(await backendError(response));
      const { text } = (await response.json()) as { text: string };
      if (text) onTextRef.current(text);
      else setError("Grok Voice heard nothing. Try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setState("idle");
    }
  };

  const toggle = async () => {
    if (state === "recording") return recorder.current?.stop();
    if (state !== "idle") return;
    setError(null);
    player.current?.pause();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const active = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const timeout = window.setTimeout(() => active.state === "recording" && active.stop(), MAX_RECORDING_MS);
      active.ondataavailable = (event) => chunks.push(event.data);
      active.onstop = () => {
        window.clearTimeout(timeout);
        stream.getTracks().forEach((track) => track.stop());
        void transcribe(new Blob(chunks, { type: active.mimeType }));
      };
      recorder.current = active;
      active.start();
      setState("recording");
    } catch (err) {
      setError(`Microphone unavailable: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const speak = useCallback(async (text: string) => {
    try {
      const response = await apiFetch("/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.replace(/[•*]/g, "").slice(0, MAX_SPOKEN_CHARS) }),
      });
      if (!response.ok) throw new Error(await backendError(response));
      player.current?.pause();
      player.current = new Audio(URL.createObjectURL(await response.blob()));
      await player.current.play();
    } catch (err) {
      setError(`Could not speak the reply: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  return { available: hasBackend && "MediaRecorder" in window, state, error, toggle, speak };
}
