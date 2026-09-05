// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { startForegroundTiming } from "./timing";

afterEach(() => vi.restoreAllMocks());

it("measures elapsed time while the window remains in the foreground", () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  const finish = startForegroundTiming();
  now.mockReturnValue(125);
  expect(finish()).toBe(25);
});

it("discards background starts and samples interrupted by loss of focus", () => {
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const background = startForegroundTiming();
  focus.mockReturnValue(true);
  expect(background()).toBeNull();
  const interrupted = startForegroundTiming();
  window.dispatchEvent(new Event("blur"));
  expect(interrupted()).toBeNull();
});
