import { expect, it } from "vitest";
import { editorChanges, type LineMark } from "./editorChanges";
import { findLineMark } from "./lineMark";

it("preserves first-match precedence at overlapping deletion anchors and range boundaries", () => {
  const marks: LineMark[] = [
    { start: 1, end: 1, kind: "deleted", top: true },
    { start: 1, end: 3, kind: "modified" },
    { start: 5, end: 7, kind: "added" },
    { start: 7, end: 7, kind: "deleted" },
  ];
  for (let line = 0; line < 10; line++)
    expect(findLineMark(marks, line)).toBe(
      marks.find((mark) => line >= mark.start && line <= mark.end),
    );
  expect(findLineMark([], 1)).toBeUndefined();
});

it("matches linear lookup across generated insertion, deletion and replacement diffs", () => {
  let seed = 42;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 100; trial++) {
    const before = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const after: string[] = [];
    for (const line of before) {
      if (random() < 0.2) after.push(`insert ${after.length}`);
      if (random() < 0.2) continue;
      after.push(random() < 0.2 ? `replace ${after.length}` : line);
    }
    const marks = editorChanges(before.join("\n"), after.join("\n"));
    for (let i = 1; i < marks.length; i++) {
      expect(marks[i].start).toBeGreaterThanOrEqual(marks[i - 1].start);
      expect(marks[i].end).toBeGreaterThanOrEqual(marks[i - 1].end);
    }
    for (let line = 0; line <= after.length + 1; line++)
      expect(findLineMark(marks, line)).toBe(
        marks.find((mark) => line >= mark.start && line <= mark.end),
      );
  }
});
