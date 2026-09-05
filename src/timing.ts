// WebKit can suspend animation frames while its window is occluded or unfocused.
// Discard measurements spanning that state instead of reporting time spent away.
let foregroundGeneration = 0;
window.addEventListener("blur", () => foregroundGeneration++);
document.addEventListener("visibilitychange", () => foregroundGeneration++);

export function startForegroundTiming(): () => number | null {
  const generation = foregroundGeneration;
  const foreground = document.hasFocus() && !document.hidden;
  const started = performance.now();
  return () =>
    foreground &&
    document.hasFocus() &&
    !document.hidden &&
    generation === foregroundGeneration
      ? performance.now() - started
      : null;
}
