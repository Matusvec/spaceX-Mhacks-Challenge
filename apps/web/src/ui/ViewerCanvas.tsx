import { useEffect, useRef } from "react";
import { SceneRoot, type HoverInfo } from "../scene/SceneRoot";
import type { LoadedBundle } from "../scene/loadBundle";

type Props = {
  bundle: LoadedBundle | null;
  onHover: (info: HoverInfo) => void;
};

export function ViewerCanvas({ bundle, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<SceneRoot | null>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    const sceneRoot = new SceneRoot(containerRef.current!, (info) => onHoverRef.current(info));
    sceneRef.current = sceneRoot;
    return () => {
      sceneRoot.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (bundle) sceneRef.current?.setBundle(bundle);
  }, [bundle]);

  return <div className="viewer" ref={containerRef} />;
}
