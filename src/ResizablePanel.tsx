import { useRef, useState, type ReactNode } from "react";

/** Own resize state here so dragging doesn't rerender the workspace or diff. */
export function ResizablePanel({
  children,
  className,
  label,
  side,
  initialWidth,
  minWidth,
  storageKey,
}: {
  children: ReactNode;
  className: string;
  label: string;
  side: "left" | "right";
  initialWidth: number;
  minWidth: number;
  storageKey: string;
}) {
  const maxWidth = () =>
    Math.max(minWidth, Math.min(520, window.innerWidth * 0.33));
  const clamp = (value: number) =>
    Math.round(Math.max(minWidth, Math.min(maxWidth(), value)));
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return clamp(Number.isFinite(saved) && saved > 0 ? saved : initialWidth);
    } catch {
      return initialWidth;
    }
  });
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const direction = side === "left" ? 1 : -1;
  function resize(value: number, persist = true) {
    const next = clamp(value);
    setWidth(next);
    try {
      if (persist) localStorage.setItem(storageKey, String(next));
    } catch {
      /* Optional preference. */
    }
  }
  return (
    <aside
      ref={panel}
      className={`${className} resizable-panel`}
      style={{ width, minWidth }}
    >
      {children}
      <div
        className={`panel-resizer ${side}`}
        role="separator"
        aria-label={`Resize ${label}`}
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth()}
        aria-valuenow={width}
        tabIndex={0}
        title={`Drag to resize ${label}. Double-click to reset.`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = {
            x: event.clientX,
            width: panel.current!.getBoundingClientRect().width,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current)
            resize(
              drag.current.width + direction * (event.clientX - drag.current.x),
              false,
            );
        }}
        onPointerUp={(event) => {
          if (drag.current)
            resize(panel.current!.getBoundingClientRect().width);
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onDoubleClick={() => resize(initialWidth)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 50 : 10;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            resize(
              (panel.current?.getBoundingClientRect().width || width) +
                direction * (event.key === "ArrowRight" ? step : -step),
            );
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault();
            resize(event.key === "Home" ? minWidth : maxWidth());
          }
        }}
      />
    </aside>
  );
}
