import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildQuickIndex, searchQuickIndex } from "../src/quickSearch.ts";

const results = [];
for (const count of [10000, 100000]) {
  const items = Array.from({ length: count }, (_, i) => ({
    id: String(i),
    label: `file-${i}.tsx`,
    detail: `packages/package-${Math.floor(i / 100)}/src/components/file-${i}.tsx`,
    kind: "file",
    value: String(i),
  }));
  items.splice(20, 0, {
    id: "command",
    label: "Find file",
    kind: "command",
    value: "find",
  });
  const start = performance.now();
  const index = buildQuickIndex(items);
  const indexMs = performance.now() - start;
  for (const query of ["", "f", "file-99", "srccomp", "no-match-zz"]) {
    for (let i = 0; i < 3; i++) searchQuickIndex(index, query, "commands");
    const samples = [];
    let matches;
    for (let i = 0; i < 20; i++) {
      const started = performance.now();
      matches = searchQuickIndex(index, query, "commands");
      samples.push(performance.now() - started);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      count,
      query,
      indexMs,
      matches: matches.length,
      rankingHash: createHash("sha256")
        .update(matches.map((item) => item.id).join(","))
        .digest("hex"),
      p50: sorted[9],
      p95: sorted[18],
      samples,
    });
  }
}
console.table(
  results.map(({ rankingHash: _hash, samples: _samples, ...row }) => row),
);
if (process.argv[2])
  writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        results,
      },
      null,
      2,
    ) + "\n",
  );
