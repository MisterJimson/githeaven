export interface QuickItem {
  id: string;
  label: string;
  detail?: string;
  kind: "command" | "file" | "branch" | "commit" | "worktree" | "index";
  value: string;
}

const normalizeQuery = (query: string) =>
  query.toLowerCase().replace(/\s+/g, "");
// Consecutive characters, filename matches and word boundaries rank highest.
function scoreText(
  haystack: string,
  needle: string,
  basename: number,
  length: number,
): number {
  if (!needle) return 0;
  let cursor = 0,
    previous = -2,
    score = 0;
  for (const char of needle) {
    const index = haystack.indexOf(char, cursor);
    if (index < 0) return -Infinity;
    score += 10 + (index === previous + 1 ? 16 : 0);
    if (index === 0 || /[\s/._-]/.test(haystack[index - 1])) score += 14;
    if (index >= basename) score += 4;
    score -= (index - cursor) * 0.15;
    previous = index;
    cursor = index + 1;
  }
  return score - length * 0.01;
}
export function fuzzyScore(text: string, query: string): number {
  const normalized = text.toLowerCase();
  return scoreText(
    normalized,
    normalizeQuery(query),
    normalized.lastIndexOf("/") + 1,
    text.length,
  );
}
export function buildQuickIndex(items: QuickItem[]) {
  const all = [...items];
  const commands: QuickItem[] = [],
    others: QuickItem[] = [];
  const entries = items.map((item) => {
    (item.kind === "command" ? commands : others).push(item);
    const label = item.label.toLowerCase();
    const detail =
      item.kind === "file"
        ? (item.detail ?? item.label)
        : `${item.detail ?? ""} ${item.label}`;
    const normalizedDetail = detail.toLowerCase();
    return {
      item,
      label,
      detail: normalizedDetail,
      labelBase: label.lastIndexOf("/") + 1,
      detailBase: normalizedDetail.lastIndexOf("/") + 1,
      detailLength: detail.length,
    };
  });
  return { all, commandFirst: [...commands, ...others], entries };
}
export function searchQuickIndex(
  index: ReturnType<typeof buildQuickIndex>,
  query: string,
  mode: "commands" | "files",
): QuickItem[] {
  const needle = normalizeQuery(query);
  if (!needle) return mode === "commands" ? index.commandFirst : index.all;
  const commands: { item: QuickItem; score: number }[] = [];
  const matches: { item: QuickItem; score: number }[] = [];
  for (const entry of index.entries) {
    const score = Math.max(
      scoreText(entry.label, needle, entry.labelBase, entry.item.label.length),
      scoreText(entry.detail, needle, entry.detailBase, entry.detailLength) - 8,
    );
    if (!Number.isFinite(score)) continue;
    const group =
      mode === "commands" && entry.item.kind === "command" ? commands : matches;
    group.push({ item: entry.item, score });
  }
  const descending = (a: { score: number }, b: { score: number }) =>
    b.score - a.score;
  commands.sort(descending);
  matches.sort(descending);
  return [
    ...commands.map(({ item }) => item),
    ...matches.map(({ item }) => item),
  ];
}
