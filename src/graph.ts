import type { Commit, Reference, Snapshot, Stash } from "./types";
export const GRAPH_ROW_HEIGHT = 24;
export const GRAPH_ROW_CENTER = GRAPH_ROW_HEIGHT / 2;

export interface Edge {
  from: number;
  to: number;
  color: number;
}
export interface GraphRow {
  lane: number;
  color: number;
  above: Edge[];
  below: Edge[];
}
/** Keep commit topology intact while placing saved work by its creation time. */
export function withStashes(commits: Commit[], stashes: Stash[]): Commit[] {
  const unique = new Map(stashes.map((stash) => [stash.oid, stash]));
  const history = commits.filter((commit) => !unique.has(commit.oid));
  const positions = new Map(
    history.map((commit, index) => [commit.oid, index]),
  );
  const insertions = new Map<number, Commit[]>();
  for (const stash of [...unique.values()].sort(
    (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0),
  )) {
    const baseIndex = positions.get(stash.base ?? "") ?? history.length;
    const dateIndex = history.findIndex(
      (commit) => commit.timestamp <= (stash.timestamp ?? 0),
    );
    // Clock skew must never put a stash below its parent. Missing parents are
    // normal with paginated history; keep the stash and its outgoing edge.
    const index = Math.min(
      baseIndex,
      dateIndex < 0 ? history.length : dateIndex,
    );
    const entry: Commit = {
      oid: stash.oid,
      parents: stash.base ? [stash.base] : [],
      subject: stash.message,
      author: stash.author ?? "",
      author_email: stash.author_email,
      timestamp: stash.timestamp ?? 0,
    };
    insertions.set(index, [...(insertions.get(index) ?? []), entry]);
  }
  return history
    .flatMap((commit, index) => [...(insertions.get(index) ?? []), commit])
    .concat(insertions.get(history.length) ?? []);
}

/** Lane state crosses row/page boundaries. Commit order must be topological. */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  let lanes: { oid: string; color: number }[] = [];
  let nextColor = 0;
  return commits.map((commit) => {
    let lane = lanes.findIndex((l) => l.oid === commit.oid);
    const previous = [...lanes];
    if (lane < 0) {
      // A pending ancestor owns its lane until reached. New tips must sit
      // beside those paths, never displace them and appear to continue them.
      lane = lanes.length;
      lanes.push({ oid: commit.oid, color: nextColor++ % 6 });
    }
    const above: Edge[] = previous.map((entry, index) => ({
      from: index,
      to: index,
      color: entry.color,
    }));
    const color = lanes[lane].color;
    const before = [...lanes];
    lanes.splice(lane, 1);
    commit.parents.forEach((oid, i) => {
      if (!lanes.some((l) => l.oid === oid))
        lanes.splice(Math.min(lane + i, lanes.length), 0, {
          oid,
          color: i === 0 ? color : nextColor++ % 6,
        });
    });
    const laneByOid = new Map(lanes.map((entry, index) => [entry.oid, index]));
    const below = before.flatMap((l, i) => {
      if (i === lane)
        return commit.parents.map((oid) => ({
          from: lane,
          to: laneByOid.get(oid)!,
          color: lanes[laneByOid.get(oid)!].color,
        }));
      return [
        {
          from: i,
          to: laneByOid.get(l.oid)!,
          color: l.color,
        },
      ];
    });
    return { lane, color, above, below };
  });
}
export function reachable(commits: Commit[], head: string): Set<string> {
  const byId = new Map(commits.map((c) => [c.oid, c]));
  const seen = new Set<string>();
  const todo = [head];
  while (todo.length) {
    const id = todo.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(...(byId.get(id)?.parents ?? []));
  }
  return seen;
}

/** Compress lanes gently, but keep crowded graphs readable at narrow widths. */
export function graphLaneX(lane: number, lanes: number, width: number): number {
  const step = Math.max(
    12,
    Math.min(16, (width - 44) / Math.max(1, lanes - 1)),
  );
  return 22 + lane * step;
}

/** Resolve selection by ref identity so new commits never leave a stale filter. */
export function resolveBranchTip(
  repo: Pick<Snapshot, "refs" | "head" | "branch"> | null,
  selected: Reference | null,
  fallback: string,
): string {
  if (!selected || !repo) return fallback;
  if (selected.kind === "local" && selected.name === repo.branch)
    return repo.head ?? "";
  return (
    repo.refs?.find(
      (ref) => ref.kind === selected.kind && ref.name === selected.name,
    )?.oid ?? ""
  );
}
