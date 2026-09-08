import { expect, it } from "vitest";
import { nearbyDiffs as withBudgets } from "./diffPrefetch";
const nearbyDiffs = (...args: Parameters<typeof withBudgets>) =>
  withBudgets(...args).map((item) => item.selection);
import type { Selection } from "./types";

const files: Selection[] = Array.from({ length: 40 }, (_, i) => ({
  path: `${i}.ts`,
  source: "worktree",
}));
it("warms both navigation directions near the selected file, including list edges", () => {
  expect(nearbyDiffs(files, files[20]).map((s) => s.path)).toEqual(
    [20, 21, 19, 22, 18, 23, 17, 24].map((i) => `${i}.ts`),
  );
  expect(nearbyDiffs(files, files[39])).toEqual(files.slice(32).reverse());
  expect(nearbyDiffs(files, files[0])).toEqual(files.slice(0, 8));
  expect(nearbyDiffs([], files[0])).toEqual([]);
  expect(nearbyDiffs(files.slice(0, 2), files[1])).toEqual([
    files[1],
    files[0],
  ]);
});
it("distinguishes staged and commit identities and handles missing selection", () => {
  const staged: Selection = { ...files[20], source: "index" };
  const commit: Selection = { ...files[20], source: "commit", oid: "abc" };
  const candidates = [...files, staged, commit];
  expect(nearbyDiffs(candidates, staged)[0]).toBe(staged);
  expect(nearbyDiffs(candidates, commit)[0]).toBe(commit);
  expect(nearbyDiffs(candidates, { ...commit, oid: "other" })).toEqual(
    files.slice(0, 8),
  );
  expect(nearbyDiffs(files)).toEqual(files.slice(0, 8));
});

it("gives only immediate neighbors the larger speculative budget", () => {
  for (const selected of [files[0], files[20], files[39], undefined]) {
    const result = withBudgets(files, selected);
    const index = selected ? files.indexOf(selected) : -1;
    const larger = result.filter((item) => item.maxBytes === 512 * 1024);
    expect(larger.map((item) => item.selection)).toEqual(
      index < 0 ? [] : [files[index + 1], files[index - 1]].filter(Boolean),
    );
    expect(
      result.reduce((total, item) => total + item.maxBytes, 0),
    ).toBeLessThanOrEqual(1792 * 1024);
  }
});
