import type { Change } from "./types";

export interface StagingOperation {
  path?: string;
  unstage: boolean;
}

// A temporary projection, replaced by Git's status after each index write.
// Git remains authoritative for content equality, rename detection, and conflicts.
export function projectStaging(
  changes: Change[],
  operation: StagingOperation,
): Change[] {
  const result: Change[] = [];
  for (const change of changes) {
    if (operation.path !== undefined && change.path !== operation.path) {
      result.push(change);
      continue;
    }
    const { index, worktree, original_path } = change;
    if (operation.unstage) {
      if (index === " " || index === "?") {
        result.push(change);
        continue;
      }
      if (index === "R" && original_path) {
        result.push({
          path: original_path,
          original_path: null,
          index: " ",
          worktree: "D",
        });
      }
      if (index === "A" || index === "R" || index === "C") {
        if (worktree !== "D")
          result.push({
            ...change,
            original_path: null,
            index: "?",
            worktree: "?",
          });
      } else {
        result.push({
          ...change,
          original_path: null,
          index: " ",
          worktree:
            worktree === "D" || (index === "D" && worktree === " ") ? "D" : "M",
        });
      }
    } else {
      if (worktree === " ") {
        result.push(change);
        continue;
      }
      if (index === "A" && worktree === "D") continue;
      result.push({
        ...change,
        index:
          worktree === "?"
            ? "A"
            : worktree === "D"
              ? "D"
              : ["A", "R", "C"].includes(index)
                ? index
                : "M",
        worktree: " ",
      });
    }
  }
  return [...new Map(result.map((change) => [change.path, change])).values()];
}
