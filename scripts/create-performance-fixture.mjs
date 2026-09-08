import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Always create a new disposable repository. No user repository is modified,
// no remotes are configured, and no hooks or signing configuration are used.
const editor = process.argv[2] === "--editor";
if (process.argv.length > 3 || (process.argv[2] && !editor))
  throw new Error("Usage: pnpm perf:fixture [--editor]");
const root = mkdtempSync(join(tmpdir(), "githeaven-performance-"));
execFileSync("git", ["init", "-q", "-b", "main", root]);
const files = Array.from({ length: editor ? 3 : 32 }, (_, i) => {
  const lines = editor ? [1000, 10000, 30000][i] : i % 4 === 0 ? 60 : 600;
  const path = `src/file-${String(i).padStart(2, "0")}.ts`;
  const before =
    Array.from({ length: lines }, (_, line) =>
      editor
        ? `export const value${line} = ${line};`
        : `export const value${line}: { id: number; label: string } = { id: ${line}, label: 'item-${i}' };`,
    ).join("\n") + "\n";
  const after = editor
    ? before
        .split("\n")
        .map((line, index) =>
          line && index % 20 === 0 ? line + " // edited" : line,
        )
        .join("\n")
    : before.replace(`label: 'item-${i}'`, `label: 'updated-${i}'`);
  return { path, before, after };
});
const data = (text) => `data ${Buffer.byteLength(text)}\n${text}\n`;
let stream =
  "commit refs/heads/main\ncommitter Performance Fixture <fixture@example.invalid> 1700000000 +0000\n";
stream += data("Deterministic highlighting workload");
for (const file of files)
  stream += `M 100644 inline ${file.path}\n${data(file.before)}`;
execFileSync("git", ["-C", root, "fast-import", "--quiet"], {
  input: stream + "\n",
  stdio: ["pipe", "pipe", "pipe"],
});
execFileSync("git", ["-C", root, "reset", "--hard", "HEAD"], {
  stdio: "ignore",
});
mkdirSync(join(root, "src"), { recursive: true });
for (const file of files) writeFileSync(join(root, file.path), file.after);
const manifest = {
  version: 1,
  files: files.map(({ path, before, after }) => ({
    path,
    beforeBytes: Buffer.byteLength(before),
    afterBytes: Buffer.byteLength(after),
    beforeHash: createHash("sha256").update(before).digest("hex"),
    afterHash: createHash("sha256").update(after).digest("hex"),
  })),
  scenario: editor
    ? "Open file-00, file-01 and file-02 in Edit for 1,000/10,000/30,000-line scattered-change workloads. Capture real input, worker and gutter timings; undo or discard edits before closing. This profile is not compatible with perf:pulse."
    : "Fresh launch; open only this repository; capture graph idle, select file-00, Down 23 times and Up 23 times with UI observation after each key, then graph idle. Record latency and resource snapshots at each phase. Repeat with the same build/machine and no background edits.",
};
writeFileSync(
  join(root, ".git", "githeaven-performance-fixture.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(root);
