// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { call } from "./api";
import { performanceReport } from "./performance";

vi.mock("./api", () => ({ native: true, call: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

it("waits for mounted content and two frame opportunities, cancels unmounted probes, and records the first ready outcome only", async () => {
  const { StartupReady, markStartup } = await import("./startup");
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((fn) => {
    pending.set(++id, fn);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => {
    pending.delete(key);
  });
  const advance = () => {
    const callbacks = [...pending.values()];
    pending.clear();
    callbacks.forEach((fn) => fn(0));
  };
  vi.mocked(call).mockResolvedValue({
    setup: 100,
    frontend: 200,
    repository: 450,
  });
  const abandoned = render(<StartupReady phase="repository" />);
  act(advance);
  expect(call).not.toHaveBeenCalled();
  abandoned.unmount();
  act(advance);
  expect(call).not.toHaveBeenCalled();
  render(<StartupReady phase="repository" />);
  act(advance);
  expect(call).not.toHaveBeenCalled();
  await act(async () => advance());
  markStartup("repository");
  markStartup("welcome");
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("startup_milestone", {
    phase: "repository",
  });
  expect(performanceReport().gauges.startup.native_entry_to_repository_ms).toBe(
    450,
  );
});
