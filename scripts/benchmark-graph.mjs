import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { layoutGraph } from "../src/graph.ts";

// Independent branch chains interleaved in topological order.
function fixture(branches, depth) {
  return Array.from({ length: depth }, (_, level) =>
    Array.from({ length: branches }, (_, branch) => ({
      oid: `${branch}:${level}`,
      parents: level + 1 < depth ? [`${branch}:${level + 1}`] : [],
    })),
  ).flat();
}
const results = [];
const scenarios = [
  [1, 6000],
  [32, 32],
  [128, 16],
  [256, 8],
].map(([branches, depth]) => ({
  name: `synthetic-${branches}-lanes`,
  branches,
  commits: fixture(branches, depth),
}));
if (process.argv[3]) {
  for (const limit of [500, 2000, 6000]) {
    const output = execFileSync(
      "git",
      [
        "-C",
        process.argv[3],
        "log",
        "--all",
        "--topo-order",
        `-n${limit}`,
        "--format=%H %P",
      ],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const commits = output.trim()
      ? output
          .trim()
          .split("\n")
          .map((line) => {
            const [oid, ...parents] = line.split(" ");
            return { oid, parents };
          })
      : [];
    scenarios.push({ name: `repository-${limit}`, branches: null, commits });
  }
}
for (const { name, branches, commits } of scenarios) {
  for (let i = 0; i < 3; i++) layoutGraph(commits);
  const samples = [];
  for (let i = 0; i < 15; i++) {
    const start = performance.now();
    const rows = layoutGraph(commits);
    samples.push(performance.now() - start);
    if (rows.length !== commits.length) throw new Error("Missing graph rows");
  }
  samples.sort((a, b) => a - b);
  results.push({
    name,
    branches,
    commits: commits.length,
    p50: samples[7],
    p95: samples[14],
    samples,
  });
}
const report = {
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  results,
};
console.table(
  results.map(({ name, branches, commits, p50, p95 }) => ({
    name,
    branches,
    commits,
    p50,
    p95,
  })),
);
if (process.argv[2])
  writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
