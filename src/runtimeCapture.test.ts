// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startRuntimeCapture } from "./runtimeCapture";
import { clearPerformanceSamples, performanceReport } from "./performance";
afterEach(() => {
  clearPerformanceSamples();
  vi.restoreAllMocks();
});
it("captures foreground stalls, excludes blur gaps, and stops every frame callback", () => {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const advance = (now: number) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(now));
  };
  const stop = startRuntimeCapture();
  advance(0);
  advance(16);
  advance(100);
  expect(performanceReport().counters["frames.observed"]).toBe(2);
  expect(
    performanceReport().samples.find((sample) => sample.name === "ui.frame-gap")
      ?.duration,
  ).toBe(84);
  window.dispatchEvent(new Event("blur"));
  advance(5000);
  expect(performanceReport().counters["frames.over-50ms"]).toBe(1);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  expect(callbacks.size).toBe(2);
  stop();
  expect(callbacks.size).toBe(0);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
  expect(callbacks.size).toBe(0);
});
