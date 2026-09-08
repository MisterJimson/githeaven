import type { LineMark } from "./editorChanges";

// editorChanges emits ranges in file order with nondecreasing ends. Find the
// first containing range, preserving precedence for deletion anchors that overlap.
export function findLineMark(marks: readonly LineMark[], line: number) {
  let low = 0;
  let high = marks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (marks[middle].end < line) low = middle + 1;
    else high = middle;
  }
  const mark = marks[low];
  return mark && line >= mark.start && line <= mark.end ? mark : undefined;
}
