import type { Selection } from "./types";

// Keep speculative work close to navigation, prioritizing the next file over
// the previous one at equal distance. Never return more than eight candidates.
export function nearbyDiffs(
  candidates: Selection[],
  selection?: Selection | null,
): Selection[] {
  const selected = candidates.findIndex(
    (item) =>
      item.path === selection?.path &&
      item.source === selection?.source &&
      item.oid === selection?.oid &&
      item.parent === selection?.parent,
  );
  if (selected < 0) return candidates.slice(0, 8);
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
  return result;
}
