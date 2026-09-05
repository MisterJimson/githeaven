import type { Commit } from "./types";
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
    const above: Edge[] = lanes.map((l, i) => ({
      from: i,
      to: i,
      color: l.color,
    }));
    if (lane < 0) {
      lane = lanes.length;
      lanes.push({ oid: commit.oid, color: nextColor++ % 6 });
    }
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
    const below = before.flatMap((l, i) => {
      if (i === lane)
        return commit.parents.map((oid) => ({
          from: lane,
          to: lanes.findIndex((l) => l.oid === oid),
          color: lanes.find((l) => l.oid === oid)!.color,
        }));
      return [
        {
          from: i,
          to: lanes.findIndex((n) => n.oid === l.oid),
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
