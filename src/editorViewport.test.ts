// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import {
  getSharedHighlighter,
  disposeHighlighter,
  type DiffsHighlighter,
} from "@pierre/diffs";
import { TextDocument } from "@pierre/diffs/edit";
// Exercise the pinned dependency patch itself, not a copy of its implementation.
import { EditorTokenizer } from "../node_modules/@pierre/diffs/dist/editor/tokenizer.js";

let highlighter: DiffsHighlighter;
beforeAll(async () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal("postMessage", vi.fn());
  highlighter = await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: ["typescript"],
    preferredHighlighter: "shiki-wasm",
  });
});
afterAll(() => {
  disposeHighlighter();
  vi.unstubAllGlobals();
});
const source = [
  "/* comment",
  "still comment",
  "*/",
  "const text = `first",
  "template ${1 + 2}",
  "last`;",
  ...Array.from({ length: 40 }, (_, i) => `export const value${i} = ${i};`),
].join("\n");
function setup() {
  const doc = new TextDocument("fixture.ts", source, "typescript");
  const tokenizer = new EditorTokenizer({
    highlighter,
    textDocument: doc,
    codeOptions: { theme: "pierre-dark", tokenizeMaxLineLength: 2000 },
    setStyle() {},
    onDeferTokenize() {},
  });
  return { doc, tokenizer };
}
function check(
  doc: TextDocument,
  tokenizer: EditorTokenizer,
  start: number,
  count: number,
) {
  const full = highlighter.codeToTokens(doc.getText(), {
    lang: "typescript",
    theme: "pierre-dark",
  }).tokens;
  const actual = tokenizer.tokenizeViewport({
    startingLine: start,
    totalLines: count,
    bufferBefore: 0,
    bufferAfter: 0,
  });
  expect([...actual.keys()]).toEqual(
    Array.from(
      { length: Math.min(count, doc.lineCount - start) },
      (_, i) => start + i,
    ),
  );
  for (const [line, tokens] of actual) {
    const colors = tokens.flatMap(([, color, text]) =>
      [...text].map((char) => [char, color?.toLowerCase()]),
    );
    const expected = full[line].flatMap((token) =>
      [...token.content].map((char) => [char, token.color?.toLowerCase()]),
    );
    expect(colors).toEqual(expected);
  }
}
it("matches full highlighting for initial, distant and overlapping viewports without changing the document", () => {
  const { doc, tokenizer } = setup();
  try {
    for (const [start, count] of [
      [3, 4],
      [30, 10],
      [0, 8],
      [45, 5],
    ])
      check(doc, tokenizer, start, count);
    expect(doc.getText()).toBe(source);
    expect(doc.version).toBe(0);
    expect(doc.canUndo).toBe(false);
  } finally {
    tokenizer.cleanUp();
  }
});
it.each([
  {
    range: { start: { line: 2, character: 0 }, end: { line: 2, character: 2 } },
    newText: "",
  },
  {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: "/*\n",
  },
  {
    range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } },
    newText: "",
  },
])(
  "preserves language state after replacement, insertion or deletion before a viewport jump: %j",
  (edit) => {
    const { doc, tokenizer } = setup();
    try {
      check(doc, tokenizer, 0, 40);
      const change = doc.applyEdits([edit])!;
      tokenizer.tokenize(
        change,
        { startingLine: 0, totalLines: 5, bufferBefore: 0, bufferAfter: 0 },
        true,
      );
      check(doc, tokenizer, 30, 10);
      check(doc, tokenizer, 0, 10);
    } finally {
      tokenizer.cleanUp();
    }
  },
);
