import { countEvent } from "./performance";

// Count batches containing a category, not raw filesystem events. Only fixed
// labels may enter exports, even if an event payload contains unexpected data.
export function recordWatchBatch(history: boolean, categories?: string[]) {
  countEvent(history ? "watch.batch.history" : "watch.batch.working");
  if (!Array.isArray(categories)) return;
  for (const category of [
    "worktree",
    "index",
    "head",
    "refs",
    "objects",
    "metadata",
  ])
    if (categories.includes(category)) countEvent(`watch.category.${category}`);
}
