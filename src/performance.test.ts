import { afterEach, expect, it, vi } from "vitest";
import {
  startSpan,
  performanceReport,
  clearPerformanceSamples,
} from "./performance";
afterEach(() => {
  clearPerformanceSamples();
  vi.restoreAllMocks();
});
it("records elapsed time and failures once, with bounded snapshots", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(10);
  const finish = startSpan("ipc.test");
  now.mockReturnValue(35);
  finish("error");
  finish();
  const report = performanceReport();
  expect(report.summary).toEqual([
    { name: "ipc.test", count: 1, errors: 1, p50: 25, p95: 25, max: 25 },
  ]);
  report.samples[0].name = "changed";
  expect(performanceReport().samples[0].name).toBe("ipc.test");
  for (let i = 0; i < 2100; i++) startSpan("test")();
  expect(performanceReport().samples).toHaveLength(2000);
  expect(performanceReport().summary.some((s) => s.name === "ipc.test")).toBe(
    false,
  );
});
