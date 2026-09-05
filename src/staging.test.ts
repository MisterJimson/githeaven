import { expect, it } from "vitest";
import { projectStaging } from "./staging";
import type { Change } from "./types";
const change = (
  index: string,
  worktree: string,
  path = "file.txt",
): Change => ({ path, index, worktree, original_path: null });

it("moves modified, partial, added, and deleted files into the index", () => {
  expect(projectStaging([change(" ", "M")], { unstage: false })).toEqual([
    change("M", " "),
  ]);
  expect(projectStaging([change("M", "M")], { unstage: false })).toEqual([
    change("M", " "),
  ]);
  expect(projectStaging([change("?", "?")], { unstage: false })).toEqual([
    change("A", " "),
  ]);
  expect(projectStaging([change("A", "M")], { unstage: false })).toEqual([
    change("A", " "),
  ]);
  expect(projectStaging([change(" ", "D")], { unstage: false })).toEqual([
    change("D", " "),
  ]);
  expect(projectStaging([change("A", "D")], { unstage: false })).toEqual([]);
});
it("unstages additions, modifications, deletions, and renames", () => {
  expect(projectStaging([change("A", " ")], { unstage: true })).toEqual([
    change("?", "?"),
  ]);
  expect(projectStaging([change("M", "M")], { unstage: true })).toEqual([
    change(" ", "M"),
  ]);
  expect(projectStaging([change("D", " ")], { unstage: true })).toEqual([
    change(" ", "D"),
  ]);
  expect(
    projectStaging(
      [{ ...change("R", " ", "new.txt"), original_path: "old.txt" }],
      { unstage: true },
    ),
  ).toEqual([change(" ", "D", "old.txt"), change("?", "?", "new.txt")]);
});
it("projects rapid reversals without modifying unrelated paths or the confirmed snapshot", () => {
  const base = [change(" ", "M"), change("?", "?", "new.txt")];
  const staged = projectStaging(base, { path: "file.txt", unstage: false });
  expect(staged[1]).toBe(base[1]);
  expect(projectStaging(staged, { path: "file.txt", unstage: true })).toEqual(
    base,
  );
  expect(base[0].index).toBe(" ");
});
