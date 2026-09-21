import { describe, it, expect } from "vitest";
import { layoutGraph, reachable, graphLaneX } from "./graph";
import type { Commit } from "./types";
const c = (oid: string, ...parents: string[]): Commit => ({
  oid,
  parents,
  subject: oid,
  author: "",
  timestamp: 0,
});
describe("history lanes", () => {
  it("joins both sides of a merge without dangling lanes", () => {
    const rows = layoutGraph([
      c("m", "a", "b"),
      c("b", "r"),
      c("a", "r"),
      c("r"),
    ]);
    expect(rows[0].below).toHaveLength(2);
    expect(rows.flatMap((r) => r.below).every((e) => e.to >= 0)).toBe(true);
    expect(rows[3].below).toEqual([]);
  });
  it("does not change prior lanes when a page is appended", () => {
    const first = [c("m", "a", "b"), c("b", "r")];
    expect(layoutGraph([...first, c("a", "r"), c("r")]).slice(0, 2)).toEqual(
      layoutGraph(first),
    );
  });
  it("filters to ancestry rather than arbitrary branch labels", () => {
    expect([...reachable([c("a", "r"), c("b", "r"), c("r")], "a")]).toEqual([
      "a",
      "r",
    ]);
  });
});

it("keeps new tips on the left and preserves connections at every row boundary", () => {
  const commits = [c("a", "base"), c("b", "base"), c("c", "base"), c("base")];
  const rows = layoutGraph(commits);
  expect(rows.map((row) => row.lane)).toEqual([0, 0, 0, 0]);
  for (let i = 1; i < rows.length; i++) {
    expect(
      [...new Set(rows[i - 1].below.map((edge) => edge.to))].sort(),
    ).toEqual(rows[i].above.map((edge) => edge.from).sort());
  }
  expect(rows.at(-1)?.below).toEqual([]);
  expect(rows[1].below[0].to).toBe(rows[1].below[1].to);
});

it("keeps at least 12 pixels between lanes in narrow graph columns", () => {
  for (const width of [60, 140, 280]) {
    const xs = Array.from({ length: 64 }, (_, lane) =>
      graphLaneX(lane, 64, width),
    );
    expect(xs[0]).toBe(22);
    expect(xs[1] - xs[0]).toBe(12);
    expect(new Set(xs).size).toBe(64);
  }
});

it("caps lane spacing at 16 pixels and scales between the bounds", () => {
  expect(graphLaneX(1, 10, 1000) - graphLaneX(0, 10, 1000)).toBe(16);
  expect(graphLaneX(1, 10, 170) - graphLaneX(0, 10, 170)).toBe(14);
});
