import { countEvent, recordDuration } from "./performance";
import { startForegroundTiming } from "./timing";

// Opt-in capture: no animation-frame loop runs when capture is off.
export function startRuntimeCapture() {
  let active = true;
  let frame = 0;
  let previous: number | null = null;
  const pendingFrames = new Set<number>();
  const foreground = () => document.hasFocus() && !document.hidden;
  const reset = () => {
    previous = null;
  };
  const tick = (now: number) => {
    if (!active) return;
    if (foreground()) {
      if (previous !== null) {
        countEvent("frames.observed");
        if (now - previous > 50) {
          countEvent("frames.over-50ms");
          recordDuration("ui.frame-gap", previous, now - previous);
        }
      }
      previous = now;
    } else previous = null;
    frame = requestAnimationFrame(tick);
  };
  const nextFrame = (callback: () => void) => {
    const id = requestAnimationFrame(() => {
      pendingFrames.delete(id);
      if (active) callback();
    });
    pendingFrames.add(id);
  };
  const input = (event: Event) => {
    if (!foreground()) return;
    const finish = startForegroundTiming(`ui.input.${event.type}`);
    nextFrame(() =>
      nextFrame(() => {
        finish();
      }),
    );
  };
  window.addEventListener("blur", reset);
  document.addEventListener("visibilitychange", reset);
  window.addEventListener("pointerdown", input, true);
  window.addEventListener("keydown", input, true);
  frame = requestAnimationFrame(tick);
  return () => {
    active = false;
    cancelAnimationFrame(frame);
    for (const id of pendingFrames) cancelAnimationFrame(id);
    window.removeEventListener("blur", reset);
    document.removeEventListener("visibilitychange", reset);
    window.removeEventListener("pointerdown", input, true);
    window.removeEventListener("keydown", input, true);
  };
}
