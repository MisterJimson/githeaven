import { describe, expect, it } from "vitest";
import { editorChanges, type LineMark } from "./editorChanges";
import { parseDiffFromFile } from "@pierre/diffs";
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

// Compatibility oracle: the previous marker extraction from Pierre patch metadata.
function pierreLineMarks(old: string | null, contents: string): LineMark[] {
  const diff = parseDiffFromFile(
    old === null ? null : { name: "file", contents: old },
    { name: "file", contents },
    { context: 0 },
  );
  const marks: LineMark[] = [];
  for (const hunk of diff.hunks) {
    let line = hunk.additionStart;
    for (const block of hunk.hunkContent) {
      if (block.type === "context") {
        line += block.lines;
        continue;
      }
      if (block.additions) {
        marks.push({
          start: line,
          end: line + block.additions - 1,
          kind: block.deletions ? "modified" : "added",
        });
        line += block.additions;
      } else if (block.deletions) {
        // A zero-length hunk starts at the preceding line; mixed hunks point at the next line.
        const preceding = hunk.additionCount === 0 ? line : line - 1;
        marks.push({
          start: Math.max(1, preceding),
          end: Math.max(1, preceding),
          kind: "deleted",
          top: preceding === 0,
        });
      }
    }
  }
  return marks;
}

it("preserves Pierre marker semantics for mixed edits, line endings and empty files", () => {
  const cases: Array<[string | null, string]> = [
    [null, ""],
    [null, "a"],
    [null, "a\n"],
    ["", ""],
    ["a", ""],
    ["a\n", "a"],
    ["a", "a\n"],
    ["a\r\n", "a\n"],
    ["\n\n", "\n"],
    ["a\nb\nc", "b\nC"],
  ];
  let seed = 97;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const alphabet = ["", "a", "a", "b", "🚀", " ", "\t", "β"];
  for (let trial = 0; trial < 500; trial++) {
    const make = () =>
      Array.from(
        { length: Math.floor(random() * 20) },
        () => alphabet[Math.floor(random() * alphabet.length)],
      ).join(random() < 0.3 ? "\r\n" : "\n");
    cases.push([random() < 0.1 ? null : make(), make()]);
  }
  for (const [old, contents] of cases)
    expect(
      editorChanges(old, contents),
      JSON.stringify([old, contents]),
    ).toEqual(pierreLineMarks(old, contents));
});
