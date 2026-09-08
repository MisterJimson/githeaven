import { expect, it } from "vitest";
import { analyzeTrace, compareTraces } from "./analyze-trace.mjs";

const trace = (samples) => ({
  version: 3,
  window: { discardedSamples: 0 },
  samples,
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
