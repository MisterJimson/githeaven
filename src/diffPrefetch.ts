import type { Selection } from "./types";

// Source strings use two bytes per character, across both versions. A 2 MiB
// lockfile needs an 8 MiB allowance even when its actual diff is small.
const fileBudget = 8 * 1024 * 1024;
export const diffPrefetchBudget = 12 * 1024 * 1024;

// Keep speculative work close to navigation, prioritizing the next file over
// the previous one at equal distance. Never return more than eight candidates.
export function nearbyDiffs(
  candidates: Selection[],
  selection?: Selection | null,
): { selection: Selection; maxBytes: number }[] {
  const selected = candidates.findIndex(
    (item) =>
      item.path === selection?.path &&
      item.source === selection?.source &&
      item.oid === selection?.oid &&
      item.parent === selection?.parent,
  );
  if (selected < 0)
    return candidates
      .slice(0, 8)
      .map((selection) => ({ selection, maxBytes: fileBudget }));
  const result = [candidates[selected]];
  for (
    let distance = 1;
    result.length < Math.min(8, candidates.length);
    distance++
  ) {
    if (selected + distance < candidates.length)
      result.push(candidates[selected + distance]);
    if (result.length < 8 && selected - distance >= 0)
      result.push(candidates[selected - distance]);
  }
  return result.map((selection) => ({
    selection,
    maxBytes: fileBudget,
  }));
}
