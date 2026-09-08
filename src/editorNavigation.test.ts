// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { measureEditorNavigation } from "./editorNavigation";
import { clearPerformanceSamples, performanceReport } from "./performance";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  clearPerformanceSamples();
});
function setup() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  let time = performance.now();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => {
    callbacks.delete(key);
  });
  const host = document.createElement("div");
  const container = document.createElement("diffs-container");
  const shadow = container.attachShadow({ mode: "open" });
  shadow.innerHTML = '<div data-content><div data-line="30000"></div></div>';
  const row = shadow.querySelector<HTMLElement>("[data-line]")!;
  host.append(container);
  document.body.append(host);
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 500, 400),
  );
  const rect = vi
    .spyOn(row, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 600, 500, 20));
  const advance = (ms = 16) => {
    time += ms;
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => callback(time));
  };
  return { host, rect, callbacks, advance };
}
it("waits for the target to enter the viewport and stop moving across two frames", () => {
  const { host, rect, callbacks, advance } = setup();
  const cancel = measureEditorNavigation(host, 30000, "end");
  advance();
  advance();
  expect(performanceReport().samples).toHaveLength(0);
  rect.mockReturnValue(new DOMRect(0, 400, 500, 20));
  advance();
  rect.mockReturnValue(new DOMRect(0, 420, 500, 20));
  advance();
  expect(performanceReport().samples).toHaveLength(0);
  advance();
  expect(performanceReport().samples).toEqual([
    expect.objectContaining({
      name: "ui.editor-jump.end",
      duration: 80,
      outcome: "ok",
    }),
  ]);
  expect(callbacks.size).toBe(0);
  cancel();
  expect(performanceReport().counters["editor.jump-cancelled"]).toBeUndefined();
});
it.each(["cancel", "blur", "detach", "wheel", "outside-click"])(
  "excludes interrupted navigation: %s",
  (kind) => {
    const { host, callbacks, advance } = setup();
    const abort = vi.fn();
    const cancel = measureEditorNavigation(host, 30000, "end", abort);
    if (kind === "cancel") cancel();
    if (kind === "blur") window.dispatchEvent(new Event("blur"));
    if (kind === "detach") host.remove();
    if (kind === "wheel") host.dispatchEvent(new WheelEvent("wheel"));
    if (kind === "outside-click")
      document.body.dispatchEvent(new Event("pointerdown"));
    advance();
    expect(callbacks.size).toBe(0);
    expect(performanceReport().samples).toHaveLength(0);
    expect(performanceReport().counters["editor.jump-cancelled"]).toBe(1);
    expect(abort).toHaveBeenCalledTimes(1);
  },
);
it("records a missing destination as an error instead of a successful latency", () => {
  const { host, callbacks, advance } = setup();
  measureEditorNavigation(host, 1, "start");
  advance(15_000);
  expect(callbacks.size).toBe(0);
  expect(performanceReport().samples).toEqual([
    expect.objectContaining({
      name: "ui.editor-jump.start",
      duration: 15_000,
      outcome: "error",
    }),
  ]);
});
