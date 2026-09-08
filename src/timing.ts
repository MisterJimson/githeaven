import { recordDuration } from "./performance";
// WebKit can suspend animation frames while its window is occluded or unfocused.
// Discard measurements spanning that state instead of reporting time spent away.
let foregroundGeneration = 0;
window.addEventListener("blur", () => foregroundGeneration++);
document.addEventListener("visibilitychange", () => foregroundGeneration++);

export function startForegroundTiming(name = "ui.paint"): () => number | null {
  const generation = foregroundGeneration;
  const foreground = document.hasFocus() && !document.hidden;
  const started = performance.now();
  let recorded = false;
  return () => {
    if (recorded) return null;
    recorded = true;
    const valid =
      foreground &&
      document.hasFocus() &&
      !document.hidden &&
      generation === foregroundGeneration;
    const duration = valid ? performance.now() - started : null;
    if (duration !== null) recordDuration(name, started, duration);
    return duration;
  };
}
