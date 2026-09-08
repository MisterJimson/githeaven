import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, relative, extname, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import {
  getSharedHighlighter,
  disposeHighlighter,
  parseDiffFromFile,
  renderDiffWithHighlighter,
  getFiletypeFromFileName,
} from "@pierre/diffs";

// This calls Pierre's production renderer in Node. It excludes WebKit, worker
// transfer, scheduling and display; use native traces for end-to-end latency.
const [output, root, ...paths] = process.argv.slice(2);
if (!output || !!root !== paths.length > 0)
  throw new Error(
    "Usage: pnpm perf:highlight report.json [repository relative-file ...]",
  );
const fixtures = [100, 1000].map((lines) => {
  const old = Array.from(
    { length: lines },
    (_, i) =>
      `export const value${i}: { id: number; label: string } = { id: ${i}, label: 'item' };`,
  ).join("\n");
  return {
    name: `typescript-${lines}`,
    path: "fixture.ts",
    old,
    next: old.replace("label: 'item'", "label: 'updated'"),
  };
});
for (const [index, path] of paths.entries()) {
  const resolved = resolve(root, path);
  const local = relative(resolve(root), resolved);
  if (!local || local.startsWith("..") || isAbsolute(local))
    throw new Error("Benchmark files must be inside the repository.");
  if (statSync(resolved).size > 2 * 1024 * 1024)
    throw new Error("Benchmark files must be at most 2 MiB.");
  fixtures.push({
    name: `repository-${index + 1}`,
    path: `fixture${extname(path)}`,
    old: execFileSync("git", ["-C", root, "show", `HEAD:${local}`], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_OPTIONAL_LOCKS: "0",
        GIT_TERMINAL_PROMPT: "0",
      },
    }),
    next: readFileSync(resolved, "utf8"),
  });
}
const results = [];
const hashes = new Map();
for (const engine of ["shiki-wasm", "shiki-js"]) {
  const started = performance.now();
  const highlighter = await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: [...new Set(fixtures.map((f) => getFiletypeFromFileName(f.path)))],
    preferredHighlighter: engine,
  });
  const initializationMs = performance.now() - started;
  try {
    for (const fixture of fixtures) {
      const parseStart = performance.now();
      const diff = parseDiffFromFile(
        { name: fixture.path, contents: fixture.old },
        { name: fixture.path, contents: fixture.next },
        { context: 5 },
      );
      const parseMs = performance.now() - parseStart;
      const samples = [];
      let firstMs, ast;
      for (let i = 0; i < 21; i++) {
        const start = performance.now();
        ast = renderDiffWithHighlighter(diff, highlighter, {
          theme: "pierre-dark",
          lineDiffType: "word-alt",
          maxLineDiffLength: 2000,
          tokenizeMaxLineLength: 2000,
          useTokenTransformer: false,
        });
        const elapsed = performance.now() - start;
        if (i === 0) firstMs = elapsed;
        else samples.push(elapsed);
      }
      const hash = createHash("sha256")
        .update(JSON.stringify(ast))
        .digest("hex");
      if (engine === "shiki-wasm") hashes.set(fixture.name, hash);
      const sorted = [...samples].sort((a, b) => a - b);
      results.push({
        name: fixture.name,
        engine,
        initializationMs,
        parseMs,
        firstMs,
        sourceBytes: 2 * (fixture.old.length + fixture.next.length),
        outputMatchesWasm: hashes.get(fixture.name) === hash,
        p50: sorted[9],
        p95: sorted[18],
        samples,
      });
    }
  } finally {
    await disposeHighlighter();
  }
}
writeFileSync(
  output,
  JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      methodology:
        "One first call then 20 warm full-diff renders per fixture/engine; engine initialized once per group; no worker or UI latency.",
      results,
    },
    null,
    2,
  ) + "\n",
);
console.table(results.map(({ samples: _samples, ...row }) => row));
