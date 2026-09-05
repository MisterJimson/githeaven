import { describe, it, expect } from "vitest";
import { layoutGraph, reachable } from "./graph";
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
