import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { editorChanges } from "../src/editorChanges.ts";

const results = [];
for (const lines of [1000, 10000, 30000]) {
  const source = Array.from(
    { length: lines },
    (_, i) => `export const value${i} = ${i};`,
  );
  const before = source.join("\n") + "\n";
  for (const scenario of ["clean", "one-line", "scattered", "new-file"]) {
    const afterLines = [...source];
    if (scenario === "one-line")
      afterLines[Math.floor(lines / 2)] += " // edited";
    if (scenario === "scattered")
      for (let i = 0; i < lines; i += 20) afterLines[i] += " // edited";
    // Reconstruct clean input too, avoiding reliance on string object identity.
    const contents = afterLines.join("\n") + "\n";
    const old = scenario === "new-file" ? null : before;
    const run = () => editorChanges(old, contents);
    const firstStart = performance.now();
    let marks = run();
    const firstMs = performance.now() - firstStart;
    for (let i = 0; i < 3; i++) run();
    const samples = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      marks = run();
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    results.push({
      lines,
      scenario,
      inputChars: (old?.length ?? 0) + contents.length,
      firstMs,
      p50: sorted[9],
      p95: sorted[18],
      samples,
      ranges: marks.length,
      outputHash: createHash("sha256")
        .update(JSON.stringify(marks))
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
