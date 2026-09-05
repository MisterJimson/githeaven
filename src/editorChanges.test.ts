import { describe, expect, it } from "vitest";
import { editorChanges } from "./editorChanges";
describe("editor changes against main", () => {
  it("leaves unchanged files clear", () =>
    expect(editorChanges("a\nb\n", "a\nb\n")).toEqual([]));
  it("marks inserted and replaced lines at their current positions", () => {
    expect(editorChanges("a\nb\nc\nd\n", "a\nB\nc\nd\ne\n")).toEqual([
      { start: 2, end: 2, kind: "modified" },
      { start: 5, end: 5, kind: "added" },
    ]);
  });
  it("anchors deletions above the first line or below the preceding line", () => {
    expect(editorChanges("a\nb\nc\n", "b\nc\n")).toEqual([
      { start: 1, end: 1, kind: "deleted", top: true },
    ]);
    expect(editorChanges("a\nb\nc\n", "a\nc\n")).toEqual([
      { start: 1, end: 1, kind: "deleted", top: false },
    ]);
    expect(editorChanges("a\nb\nc\n", "a\nb\n")).toEqual([
      { start: 2, end: 2, kind: "deleted", top: false },
    ]);
  });
  it("marks files absent from main as added", () =>
    expect(editorChanges(null, "a\nb\n")).toEqual([
      { start: 1, end: 2, kind: "added" },
    ]));
  it("clears markers when edits are undone", () =>
    expect(editorChanges("a\n", "a\n")).toEqual([]));
});
