import { expect, it } from "vitest";
import { analyzeCPU } from "./analyze-cpu.mjs";
const node = (id, name, children = []) => ({
  id,
  callFrame: { functionName: name, url: "fixture.js", lineNumber: 0 },
  children,
});
const fixture = () => ({
  nodes: [
    node(1, "root", [2, 5]),
    node(2, "target", [3]),
    node(3, "target", [4]),
    node(4, "leaf"),
    node(5, "other"),
  ],
  samples: [2, 4, 5, 4],
  timeDeltas: [1000, 2000, 4000, 3000],
});
it("weights samples by time and counts overlapping matching ancestors only once", () => {
  const report = analyzeCPU(fixture(), "target");
  expect(report.totalMs).toBe(10);
  expect(report.selectedMs).toBe(6);
  expect(report.selectedSamples).toBe(3);
  expect(report.frames.map((row) => [row.function, row.selfMs])).toEqual([
    ["leaf", 5],
    ["target", 1],
  ]);
  expect(analyzeCPU(fixture()).selectedMs).toBe(10);
  expect(analyzeCPU(fixture(), "missing").frames).toEqual([]);
});
it("rejects corrupt sample attribution and cyclic call trees", () => {
  const badSample = fixture();
  badSample.samples[0] = 99;
  const cycle = fixture();
  cycle.nodes[3].children = [2];
  expect(() => analyzeCPU(badSample)).toThrow();
  expect(() => analyzeCPU(cycle)).toThrow();
  expect(() => analyzeCPU({ ...fixture(), timeDeltas: [] })).toThrow();
  expect(() =>
    analyzeCPU({ ...fixture(), timeDeltas: [1, 2, -3, 4] }),
  ).toThrow();
});
