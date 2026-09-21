import { describe, it, expect } from "vitest";
import { layoutGraph, reachable, graphLaneX, resolveBranchTip } from "./graph";
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

it("keeps independent tips beside reserved history lanes and preserves row connections", () => {
  const commits = [c("a", "base"), c("b", "base"), c("c", "base"), c("base")];
  const rows = layoutGraph(commits);
  expect(rows.map((row) => row.lane)).toEqual([0, 1, 1, 0]);
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

it("follows an advancing branch and includes shared ancestry across interleaved branches", () => {
  const selected = { name: "feature", kind: "local" as const, oid: "old" };
  const commits = [
    c("new", "old"),
    c("old", "main"),
    c("other", "base"),
    c("main", "base"),
    c("base"),
  ];
  const tip = resolveBranchTip(
    { branch: "feature", head: "new", refs: [selected] },
    selected,
    "old",
  );
  expect([...reachable(commits, tip)]).toEqual(["new", "old", "main", "base"]);
});

it("tracks remote refs by name and kind and clears deleted branch filters", () => {
  const selected = {
    name: "origin/feature",
    kind: "remote" as const,
    oid: "old",
  };
  const repo = {
    branch: "main",
    head: "main",
    refs: [{ ...selected, oid: "new" }],
  };
  expect(resolveBranchTip(repo, selected, "old")).toBe("new");
  expect(resolveBranchTip({ ...repo, refs: [] }, selected, "old")).toBe("");
  expect(resolveBranchTip(repo, null, "")).toBe("");
});

it("keeps main straight while an unrelated branch runs beside its pending ancestors", () => {
  const rows = layoutGraph([
    c("head", "main"),
    c("main", "base"),
    c("other", "other-parent"),
    c("other-parent", "base"),
    c("base"),
  ]);
  expect(rows.map((row) => row.lane)).toEqual([0, 0, 1, 1, 0]);
  expect(rows[2].above).toEqual([{ from: 0, to: 0, color: rows[1].color }]);
  expect(rows[2].below).toContainEqual({
    from: 0,
    to: 0,
    color: rows[1].color,
  });
  expect(rows[3].below).toContainEqual({
    from: 1,
    to: 0,
    color: rows[4].color,
  });
});
