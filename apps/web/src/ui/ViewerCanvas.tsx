import { useEffect, useRef } from "react";
import { SceneRoot, type HoverInfo } from "../scene/SceneRoot";

type Props = {
  onReady: (sceneRoot: SceneRoot | null) => void;
  onHover: (info: HoverInfo) => void;
};

export function ViewerCanvas({ onReady, onHover }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;

  useEffect(() => {
    const sceneRoot = new SceneRoot(containerRef.current!, (info) => onHoverRef.current(info));
    onReady(sceneRoot);
    return () => {
      onReady(null);
      sceneRoot.dispose();
    };
  }, [onReady]);

  return <div className="viewer" ref={containerRef} />;
}
