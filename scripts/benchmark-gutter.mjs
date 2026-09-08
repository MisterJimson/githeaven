import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { findLineMark } from "../src/lineMark.ts";

const results = [];
for (const count of [0, 100, 1000, 10000]) {
  const marks = Array.from({ length: count }, (_, i) => ({
    start: i * 4 + 1,
    end: i * 4 + 2,
    kind: i % 2 ? "added" : "modified",
  }));
  for (const position of ["top", "middle", "bottom"]) {
    const first =
      position === "top" ? 1 : position === "middle" ? count * 2 : count * 4;
    const lines = Array.from({ length: 200 }, (_, i) => first + i);
    const run = () => lines.map((line) => findLineMark(marks, line) ?? null);
    for (let i = 0; i < 5; i++) run();
    const samples = [];
    let output;
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      output = run();
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      count,
      position,
      visibleLines: lines.length,
      p50: sorted[14],
      p95: sorted[28],
      samples,
      outputHash: createHash("sha256")
        .update(JSON.stringify(output))
        .digest("hex"),
    });
  }
}
console.table(
  results.map(({ samples: _samples, outputHash: _hash, ...row }) => row),
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
