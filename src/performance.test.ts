import { afterEach, expect, it, vi } from "vitest";
import {
  startSpan,
  countEvent,
  registerGauge,
  recordDuration,
  performanceReport,
  clearPerformanceSamples,
} from "./performance";
afterEach(() => {
  clearPerformanceSamples();
  vi.restoreAllMocks();
});
it("records elapsed time and failures once, with bounded snapshots", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(10);
  clearPerformanceSamples();
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
  expect(performanceReport().window.discardedSamples).toBe(101);
  expect(performanceReport().summary.some((s) => s.name === "ipc.test")).toBe(
    false,
  );
});

it("resets the whole measurement window while preserving live gauges", () => {
  const now = vi.spyOn(performance, "now").mockReturnValue(100);
  clearPerformanceSamples();
  const finish = startSpan("old.request");
  countEvent("cache.hit");
  const remove = registerGauge("test.cache", () => ({ entries: 4 }));
  now.mockReturnValue(200);
  clearPerformanceSamples();
  finish();
  recordDuration("old.paint", 150, 60);
  now.mockReturnValue(230);
  startSpan("new.request")();
  countEvent("cache.miss");
  const report = performanceReport();
  expect(report.samples.map((s) => s.name)).toEqual(["new.request"]);
  expect(report.counters).toEqual({ "cache.miss": 1 });
  expect(report.gauges["test.cache"]).toEqual({ entries: 4 });
  expect(report.window).toMatchObject({
    start: 200,
    duration: 30,
    discardedSamples: 0,
  });
  expect(report.window.startedAt).toBe(
    new Date(performance.timeOrigin + 200).toISOString(),
  );
  remove();
});
