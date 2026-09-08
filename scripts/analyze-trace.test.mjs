import { expect, it } from "vitest";
import {
  analyzeStartup,
  analyzeTrace,
  compareTraces,
  parseTraceArgs,
} from "./analyze-trace.mjs";

it("selects span starts without clipping durations or attributing whole-window counters", () => {
  const report = analyzeTrace(
    {
      version: 3,
      samples: [
        { name: "cross-before", start: 5, duration: 10, outcome: "ok" },
        { name: "inside", start: 10, duration: 2, outcome: "ok" },
        { name: "cross-after", start: 19, duration: 8, outcome: "ok" },
        { name: "at-end", start: 20, duration: 1, outcome: "ok" },
      ],
      counters: { "watch.batch.working": 5 },
      gauges: { startup: { native_entry_to_setup_ms: 100 } },
    },
    { start: 10, end: 20 },
  );
  expect(report.range).toEqual({
    start: 10,
    end: 20,
    overlappingFromBefore: 1,
    endingAfterRange: 1,
  });
  expect(report.operations.map((row) => [row.name, row.n, row.p50])).toEqual([
    ["cross-after", 1, 8],
    ["inside", 1, 2],
  ]);
  expect(report.watcher).toEqual([]);
  expect(report.startup).toBeNull();
  expect(report.warnings.join(" ")).toContain("not clipped");
  for (const range of [
    { start: -1, end: 5 },
    { start: 1, end: 1 },
    { start: 0, end: Infinity },
  ])
    expect(() => analyzeTrace({ version: 3, samples: [] }, range)).toThrow();
});

it("requires explicit ranges for both traces in an interval comparison", () => {
  expect(
    parseTraceArgs([
      "before.json",
      "after.json",
      "--range",
      "10:20",
      "--after-range",
      "100:110",
    ]),
  ).toEqual([
    { path: "before.json", range: { start: 10, end: 20 } },
    { path: "after.json", range: { start: 100, end: 110 } },
  ]);
  expect(parseTraceArgs(["one.json"])).toEqual([
    { path: "one.json", range: undefined },
  ]);
  for (const args of [
    ["one", "--range"],
    ["one", "--range", "1:1"],
    ["one", "--after-range", "1:2"],
    ["one", "two", "--range", "1:2"],
    ["one", "--range", "1:2", "--range", "2:3"],
    ["one", "--invalid"],
  ])
    expect(() => parseTraceArgs(args)).toThrow();
});

it("reports native startup independently of reset-window frontend timings", () => {
  const report = analyzeTrace({
    ...trace([sample(5)]),
    gauges: {
      startup: {
        native_entry_to_setup_ms: 200,
        native_entry_to_repository_watch_ms: 600,
        native_entry_to_repository_ms: 740,
        ready_in_foreground: false,
      },
    },
  });
  expect(report.startup).toEqual({
    readyInForeground: false,
    milestones: [
      {
        name: "setup",
        nativeEntryMs: 200,
        since: "native_entry",
        intervalMs: 200,
      },
      {
        name: "repository_watch",
        nativeEntryMs: 600,
        since: "setup",
        intervalMs: 400,
      },
      {
        name: "repository",
        nativeEntryMs: 740,
        since: "repository_watch",
        intervalMs: 140,
      },
    ],
  });
  expect(analyzeTrace(trace([])).startup).toBeNull();
  expect(analyzeStartup({ native_entry_to_welcome_ms: 100 })).toEqual({
    readyInForeground: null,
    milestones: [
      {
        name: "welcome",
        nativeEntryMs: 100,
        since: "native_entry",
        intervalMs: 100,
      },
    ],
  });
});

it("rejects malformed startup metadata rather than coercing measurements", () => {
  for (const gauge of [
    [],
    "bad",
    { ready_in_foreground: "false" },
    ...[-1, NaN, Infinity, "100", null].map((value) => ({
      native_entry_to_setup_ms: value,
    })),
  ])
    expect(() => analyzeStartup(gauge)).toThrow();
});

const trace = (samples) => ({
  version: 3,
  window: { discardedSamples: 0 },
  samples,
});
it("exposes fixed watcher counters without adding overlapping categories or inventing missing values", () => {
  const report = analyzeTrace({
    ...trace([]),
    counters: {
      "watch.batch.history": 5,
      "watch.batch.working": 5,
      "watch.category.index": 10,
      "watch.category.objects": 5,
      "watch.category.private-path": 123,
    },
  });
  expect(report.watcher).toEqual([
    { name: "watch.batch.history", batches: 5 },
    { name: "watch.batch.working", batches: 5 },
    { name: "watch.category.index", batches: 10 },
    { name: "watch.category.objects", batches: 5 },
  ]);
  expect(analyzeTrace(trace([])).watcher).toEqual([]);
  for (const value of [-1, 0.5, "5", NaN, Infinity])
    expect(() =>
      analyzeTrace({
        ...trace([]),
        counters: { "watch.batch.history": value },
      }),
    ).toThrow();
});
const sample = (duration, outcome = "ok", name = "ui.diff-ready") => ({
  name,
  start: 0,
  duration,
  outcome,
});

it("calculates successful timing distributions and exposes incomplete/failed data", () => {
  const report = analyzeTrace(
    trace([
      ...Array.from({ length: 20 }, (_, i) => sample(i + 1)),
      sample(999, "error"),
      sample(50, "ok", "small"),
      sample(7, "error", "failed"),
    ]),
  );
  expect(report.operations).toEqual([
    { name: "failed", n: 0, errors: 1, p50: null, p95: null, max: null },
    { name: "small", n: 1, errors: 0, p50: 50, p95: null, max: 50 },
    { name: "ui.diff-ready", n: 20, errors: 1, p50: 10, p95: 19, max: 20 },
  ]);
  expect(
    analyzeTrace({
      ...trace([]),
      window: { discardedSamples: 5 },
    }).warnings.join(" "),
  ).toContain("5 earlier samples");
  expect(
    analyzeTrace({ version: 2, samples: [] }).warnings.join(" "),
  ).toContain("Schema 2");
});
it("keeps unmatched operations and insufficient sample counts out of p95 comparisons", () => {
  const before = analyzeTrace(trace([sample(10)]));
  const after = analyzeTrace(trace([sample(20, "ok", "other")]));
  expect(compareTraces(before, after)).toEqual([
    {
      name: "other",
      beforeN: 0,
      afterN: 1,
      beforeErrors: 0,
      afterErrors: 0,
      beforeP50: null,
      afterP50: 20,
      beforeP95: null,
      afterP95: null,
      p95DeltaMs: null,
    },
    {
      name: "ui.diff-ready",
      beforeN: 1,
      afterN: 0,
      beforeErrors: 0,
      afterErrors: 0,
      beforeP50: 10,
      afterP50: null,
      beforeP95: null,
      afterP95: null,
      p95DeltaMs: null,
    },
  ]);
});
it("rejects invalid inputs instead of producing misleading numbers", () => {
  for (const report of [
    null,
    { version: 1, samples: [] },
    trace([sample(-1)]),
    trace([sample(NaN)]),
    trace([sample(1, "cancelled")]),
  ])
    expect(() => analyzeTrace(report)).toThrow();
});
