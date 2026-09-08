import { countEvent, recordDuration } from "./performance";
import { startForegroundTiming } from "./timing";

// Measure destination visibility, not just the first frame after a key press.
// Only runs during an explicit document-boundary command; never an idle loop.
export function measureEditorNavigation(
  host: HTMLElement,
  line: number,
  boundary: "start" | "end",
) {
  const name = `ui.editor-jump.${boundary}`;
  const started = performance.now();
  const finish = startForegroundTiming(name);
  let frame = 0;
  let active = true;
  let previousTop: number | undefined;
  let previousBottom: number | undefined;
  const cleanup = () => {
    active = false;
    cancelAnimationFrame(frame);
    window.removeEventListener("blur", cancel);
    document.removeEventListener("visibilitychange", cancel);
    host.removeEventListener("pointerdown", cancel, true);
    host.removeEventListener("wheel", cancel, true);
  };
  const cancel = () => {
    if (!active) return;
    cleanup();
    countEvent("editor.jump-cancelled");
  };
  const tick = () => {
    if (!active) return;
    if (!document.hasFocus() || document.hidden || !host.isConnected) {
      cancel();
      return;
    }
    const bounds = host.getBoundingClientRect();
    const row = host
      .querySelector("diffs-container")
      ?.shadowRoot?.querySelector(`[data-content] [data-line="${line}"]`);
    const rect = row?.getBoundingClientRect();
    const visible =
      rect != null &&
      rect.height > 0 &&
      bounds.height > 0 &&
      rect.bottom > bounds.top &&
      rect.top < bounds.bottom;
    if (visible && previousTop === rect.top && previousBottom === rect.bottom) {
      cleanup();
      finish();
      return;
    }
    previousTop = visible ? rect.top : undefined;
    previousBottom = visible ? rect.bottom : undefined;
    if (performance.now() - started >= 15_000) {
      cleanup();
      recordDuration(name, started, performance.now() - started, "error");
      return;
    }
    frame = requestAnimationFrame(tick);
  };
  window.addEventListener("blur", cancel);
  document.addEventListener("visibilitychange", cancel);
  host.addEventListener("pointerdown", cancel, true);
  host.addEventListener("wheel", cancel, { capture: true, passive: true });
  frame = requestAnimationFrame(tick);
  return cancel;
}
