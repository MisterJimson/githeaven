import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";

// Reproducible, local-only workload. Never resets an existing directory.
const root = resolve(".stress");
if (existsSync(root)) {
  console.log(`Stress repository already exists:\n${root}`);
  process.exit(0);
}
mkdirSync(root);
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" });
git("init", "-q", "-b", "main");
const data = (text) => `data ${Buffer.byteLength(text)}\n${text}\n`;
let stream = "";
const start = Math.floor(Date.now() / 1000) - 6000 * 60;
for (let i = 1; i <= 6000; i++) {
  stream += `commit refs/heads/main\nmark :${i}\ncommitter Githeaven Fixture <fixture@example.com> ${start + i * 60} +0000\n`;
  stream += data(`Update repository sample ${i}`);
  if (i > 1) stream += `from :${i - 1}\n`;
  if (i === 1) {
    for (let f = 0; f < 10000; f++)
      stream +=
        `M 100644 inline packages/package-${Math.floor(f / 100)}/src/file-${f}.ts\n` +
        data(`export const sample${f} = ${f};\n`);
  }
  stream +=
    "M 100644 inline sequence.ts\n" +
    data(`// Synthetic performance workload\nexport const sequence = ${i};\n`) +
    "\n";
}
execFileSync("git", ["fast-import", "--quiet"], {
  cwd: root,
  input: stream,
  stdio: ["pipe", "pipe", "pipe"],
});
// Populate a newly created fixture's worktree only.
git("reset", "--hard", "HEAD");
for (let i = 1; i <= 12; i++)
  git(
    "update-ref",
    `refs/remotes/origin/sample-${i}`,
    git("rev-parse", `HEAD~${i * 100}`).trim(),
  );
console.log(`Created 6,000 commits and 10,001 files:\n${root}`);
