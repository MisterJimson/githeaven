import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TextDocument } from "@pierre/diffs/edit";
import {
  getSharedHighlighter,
  disposeHighlighter,
  renderFileWithHighlighter,
} from "@pierre/diffs";

const initializationStart = performance.now();
const highlighter = await getSharedHighlighter({
  themes: ["pierre-dark"],
  langs: ["typescript"],
  preferredHighlighter: "shiki-wasm",
});
const initializationMs = performance.now() - initializationStart;
const results = [];
try {
  for (const lines of [1000, 10000, 30000]) {
    const contents =
      Array.from(
        { length: lines },
        (_, i) =>
          `export const value${i} = ${i};${i % 20 === 0 ? " // edited" : ""}`,
      ).join("\n") + "\n";
    const file = { name: "fixture.ts", contents };
    const operations = {
      document: () => {
        const doc = new TextDocument(file.name, contents, "typescript");
        return {
          lineCount: doc.lineCount,
          last: doc.positionAt(contents.length),
        };
      },
      tokens: () =>
        highlighter.codeToTokens(contents, {
          lang: "typescript",
          theme: "pierre-dark",
          tokenizeMaxLineLength: 2000,
          tokenizeTimeLimit: 0,
        }),
      editorAST: () =>
        renderFileWithHighlighter(file, highlighter, {
          theme: "pierre-dark",
          tokenizeMaxLineLength: 2000,
          useTokenTransformer: true,
        }),
    };
    for (const [operation, run] of Object.entries(operations)) {
      const firstStart = performance.now();
      let output = run();
      const firstMs = performance.now() - firstStart;
      for (let i = 0; i < 3; i++) run();
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        output = run();
        samples.push(performance.now() - start);
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const row = {
        lines,
        inputChars: contents.length,
        operation,
        firstMs,
        p50: sorted[9],
        p95: sorted[18],
        samples,
        outputHash: createHash("sha256")
          .update(JSON.stringify(output))
          .digest("hex"),
      };
      results.push(row);
      console.log(
        `${lines} ${operation}: median ${row.p50.toFixed(2)}ms, p95 ${row.p95.toFixed(2)}ms`,
      );
    }
  }
} finally {
  disposeHighlighter();
}
if (process.argv[2])
  writeFileSync(
    process.argv[2],
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        initializationMs,
        results,
      },
      null,
      2,
    ) + "\n",
  );
