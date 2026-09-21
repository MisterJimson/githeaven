import type { Commit } from "./types";
export const GRAPH_ROW_HEIGHT = 28;
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
/** Lane state crosses row/page boundaries. Commit order must be topological. */
export function layoutGraph(commits: Commit[]): GraphRow[] {
  let lanes: { oid: string; color: number }[] = [];
  let nextColor = 0;
  return commits.map((commit) => {
    let lane = lanes.findIndex((l) => l.oid === commit.oid);
    const previous = [...lanes];
    if (lane < 0) {
      // Keep newly encountered branch tips beside the active history instead
      // of placing them beyond every long-running connection. Keep WIP's
      // pending HEAD in the first lane until it is reached.
      lane =
        commits[0]?.oid === "worktree" &&
        lanes[0]?.oid === commits[0].parents[0]
          ? 1
          : 0;
      lane = Math.min(lane, lanes.length);
      lanes.splice(lane, 0, { oid: commit.oid, color: nextColor++ % 6 });
    }
    const currentLane = new Map(
      lanes.map((entry, index) => [entry.oid, index]),
    );
    const above: Edge[] = previous.map((entry, index) => ({
      from: index,
      to: currentLane.get(entry.oid)!,
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

/** Fit every lane inside the column without scaling avatars or row heights. */
export function graphLaneX(lane: number, lanes: number, width: number): number {
  const step = Math.min(16, Math.max(0, width - 44) / Math.max(1, lanes - 1));
  return 22 + lane * step;
}
