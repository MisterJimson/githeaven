import { parseDiffFromFile } from "@pierre/diffs";

export interface LineMark {
  start: number;
  end: number;
  kind: "added" | "modified" | "deleted";
  top?: boolean;
}
export function editorChanges(
  old: string | null,
  contents: string,
): LineMark[] {
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
