import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { getSharedHighlighter, disposeHighlighter } from "@pierre/diffs";
import { TextDocument } from "@pierre/diffs/edit";
import { EditorTokenizer } from "../node_modules/@pierre/diffs/dist/editor/tokenizer.js";

// The pinned tokenizer only needs matchMedia with an explicitly pinned theme.
// No DOM, scrolling, background prebuild, or native IPC runs in this CPU benchmark.
globalThis.window = { matchMedia: () => ({ matches: false }) };
const started = performance.now();
const highlighter = await getSharedHighlighter({
  themes: ["pierre-dark"],
  langs: ["typescript"],
  preferredHighlighter: "shiki-wasm",
});
const initializationMs = performance.now() - started;
const viewportLines = 60;
const yielding = process.argv.includes("--yield");
const outputPath = process.argv.slice(2).find((arg) => arg !== "--yield");
const results = [];
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
try {
  for (const lines of [1000, 10000, 30000]) {
    const contents = Array.from({ length: lines }, (_, i) =>
      i % 100 === 0
        ? "/* multiline comment"
        : i % 100 === 2
          ? "*/"
          : `export const value${i} = ${i};`,
    ).join("\n");
    const full = highlighter.codeToTokens(contents, {
      lang: "typescript",
      theme: "pierre-dark",
    }).tokens;
    const ranges = [
      ["initial", 0],
      ["cold-end", lines - viewportLines],
      ["cached-end", lines - viewportLines],
      ["return-top", 0],
    ];
    const samples = Object.fromEntries(ranges.map(([name]) => [name, []]));
    const gaps = Object.fromEntries(ranges.map(([name]) => [name, []]));
    const outputHashes = {};
    // Each iteration has a fresh document/tokenizer. Grammar/JIT remain warm.
    for (let iteration = -3; iteration < 20; iteration++) {
      const doc = new TextDocument("fixture.ts", contents, "typescript");
      const tokenizer = new EditorTokenizer({
        highlighter,
        textDocument: doc,
        codeOptions: { theme: "pierre-dark", tokenizeMaxLineLength: 2000 },
        setStyle() {},
        onDeferTokenize() {},
      });
      try {
        for (const [operation, startingLine] of ranges) {
          const start = performance.now();
          let previousTask = start;
          let maxTaskGap = 0;
          const tick = () => {
            const now = performance.now();
            maxTaskGap = Math.max(maxTaskGap, now - previousTask);
            previousTask = now;
          };
          const heartbeat = setInterval(tick, 1);
          let tokens;
          try {
            if (yielding)
              await tokenizer.prepareViewportState(
                startingLine,
                new AbortController().signal,
              );
            tokens = tokenizer.tokenizeViewport({
              startingLine,
              totalLines: viewportLines,
              bufferBefore: 0,
              bufferAfter: 0,
            });
          } finally {
            clearInterval(heartbeat);
          }
          const duration = performance.now() - start;
          tick();
          if (iteration >= 0) {
            samples[operation].push(duration);
            gaps[operation].push(maxTaskGap);
          }
          // Validate outside timing; normalize to per-character colors so token
          // grouping differences cannot hide a language-state mismatch.
          const actual = [...tokens.values()].map((row) =>
            row.flatMap(([, color, text]) =>
              [...text].map((char) => [char, color?.toLowerCase()]),
            ),
          );
          const expected = full
            .slice(startingLine, startingLine + viewportLines)
            .map((row) =>
              row.flatMap(({ content, color }) =>
                [...content].map((char) => [char, color?.toLowerCase()]),
              ),
            );
          const outputHash = hash(actual);
          if (outputHash !== hash(expected))
            throw new Error(`Highlight mismatch: ${lines} ${operation}`);
          outputHashes[operation] = outputHash;
        }
      } finally {
        tokenizer.cleanUp();
      }
    }
    for (const [operation, values] of Object.entries(samples)) {
      const sorted = [...values].sort((a, b) => a - b);
      const result = {
        lines,
        operation,
        p50: sorted[9],
        p95: sorted[18],
        samples: values,
        maxTaskGapSamples: gaps[operation],
        outputHash: outputHashes[operation],
      };
      results.push(result);
      console.log(
        `${lines} ${operation}: median ${result.p50.toFixed(2)}ms, p95 ${result.p95.toFixed(2)}ms`,
      );
    }
  }
} finally {
  disposeHighlighter();
  delete globalThis.window;
}
if (outputPath)
  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        initializationMs,
        viewportLines,
        yielding,
        results,
      },
      null,
      2,
    ) + "\n",
  );
