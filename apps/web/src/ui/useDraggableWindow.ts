import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

type Position = { x: number; y: number };

const key = (name: string) => `pss-window:${name}`;

function load(name: string): Position | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key(name)) ?? "null") as Position | null;
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : null;
  } catch {
    return null;
  }
}

/**
 * A window over the 3D stage that is dragged by its title bar, stays inside the stage and remembers
 * where it was left (localStorage). Until it is first moved it sits where its CSS docks it.
 * `sizeKey` is anything that changes the window's size (open or minimized), so it is kept in bounds.
 */
export function useDraggableWindow(name: string, sizeKey: unknown) {
  const element = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState<Position | null>(() => load(name));
  const latest = useRef(position);
  latest.current = position;
  const grab = useRef<Position | null>(null);

  const clamp = ({ x, y }: Position): Position => {
    const el = element.current;
    const stage = el?.offsetParent as HTMLElement | null;
    if (!el || !stage) return { x, y };
    return {
      x: Math.min(Math.max(0, x), Math.max(0, stage.clientWidth - el.offsetWidth)),
      y: Math.min(Math.max(0, y), Math.max(0, stage.clientHeight - el.offsetHeight)),
    };
  };
  const reclamp = () => setPosition((p) => (p ? clamp(p) : p));

  useLayoutEffect(reclamp, [sizeKey]);
  useEffect(() => {
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
  }, []);

  const bar = {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      const el = element.current;
      if (!el || (event.target as HTMLElement).closest("button, input, a, select")) return; // controls stay clickable
      try {
        event.currentTarget.setPointerCapture(event.pointerId); // keeps the drag when the pointer leaves the bar
      } catch {
        // no such pointer (a synthetic event): drag still works while the pointer stays on the bar
      }
      grab.current = { x: event.clientX - el.offsetLeft, y: event.clientY - el.offsetTop };
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (grab.current) setPosition(clamp({ x: event.clientX - grab.current.x, y: event.clientY - grab.current.y }));
    },
    onPointerUp: () => {
      if (!grab.current) return;
      grab.current = null;
      try {
        window.localStorage.setItem(key(name), JSON.stringify(latest.current));
      } catch {
        // not remembered across reloads
      }
    },
  };

  const style: CSSProperties | undefined = position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined;
  return { ref: (el: HTMLElement | null) => void (element.current = el), style, bar };
}
