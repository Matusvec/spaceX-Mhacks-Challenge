import { useCallback, useRef, useState } from "react";
import type { SceneRoot, SplatInfo } from "../scene/SceneRoot";
import { splatSourceName, type SplatSource } from "../scene/splat";

export type SplatState =
  | { status: "none" }
  | { status: "loading"; name: string; progress: number | null }
  | { status: "ready"; name: string; origin: SplatSource["kind"]; info: SplatInfo }
  | { status: "error"; name: string; message: string };

export function useSplatLoader(sceneRoot: SceneRoot | null) {
  const [state, setState] = useState<SplatState>({ status: "none" });
  const requestId = useRef(0);

  const load = useCallback(
    async (source: SplatSource) => {
      if (!sceneRoot) return;
      const id = ++requestId.current;
      const name = splatSourceName(source);
      const isCurrent = () => id === requestId.current;
      setState({ status: "loading", name, progress: null });
      try {
        const info = await sceneRoot.showSplat(source, (progress) => {
          if (isCurrent()) setState({ status: "loading", name, progress });
        });
        if (!info || !isCurrent()) return;
        setState({ status: "ready", name, origin: source.kind, info });
        if (source.kind === "file") sceneRoot.frameSplat();
      } catch (err) {
        if (isCurrent()) setState({ status: "error", name, message: err instanceof Error ? err.message : String(err) });
      }
    },
    [sceneRoot],
  );

  const fail = useCallback((name: string, message: string) => {
    requestId.current++;
    setState({ status: "error", name, message });
  }, []);

  const clear = useCallback(() => {
    requestId.current++;
    sceneRoot?.clearSplat();
    setState({ status: "none" });
  }, [sceneRoot]);

  return { state, load, fail, clear };
}
