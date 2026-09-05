import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const root = resolve(".demo");
if (existsSync(root)) {
  console.log(`Demo already exists; leaving it untouched.\n${root}`);
  process.exit(0);
}
mkdirSync(root, { recursive: true });
let step = 0;
const git = (...args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: new Date(
        Date.now() - (30 - step) * 3600000,
      ).toISOString(),
      GIT_COMMITTER_DATE: new Date(
        Date.now() - (30 - step) * 3600000,
      ).toISOString(),
    },
  }).trim();
const write = (path, content) => {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), content);
};
const commit = (message) => {
  step++;
  git("add", "-A");
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-m",
    message,
  );
};
git("init", "-b", "main");
git("config", "user.name", "Alex Morgan");
git("config", "user.email", "alex@example.com");
git("config", "commit.gpgsign", "false");
write(
  "README.md",
  "# Observatory\n\nA fictional repository for exploring Githeaven.\n\nThis is disposable demo data. No remote network is used.\n",
);
write(
  "package.json",
  JSON.stringify(
    { name: "observatory", version: "0.1.0", private: true },
    null,
    2,
  ) + "\n",
);
write(".gitignore", "node_modules/\ndist/\n");
commit("Start a quieter place to build");
const cache = `export interface CacheEntry<T> {\n  value: T;\n  expiresAt: number;\n}\n\nexport class RepositoryCache<T> {\n  private entries = new Map<string, CacheEntry<T>>();\n\n  constructor(private ttl = 30_000) {}\n\n  get(key: string): T | undefined {\n    const entry = this.entries.get(key);\n    if (!entry || entry.expiresAt < Date.now()) {\n      this.entries.delete(key);\n      return undefined;\n    }\n    return entry.value;\n  }\n\n  set(key: string, value: T): void {\n    this.entries.set(key, {\n      value,\n      expiresAt: Date.now() + this.ttl,\n    });\n  }\n\n  clear(): void {\n    this.entries.clear();\n  }\n}\n`;
write("src/core/cache.ts", cache);
commit("Add repository cache with time-based expiry");
write(
  "src/core/repository.ts",
  "export interface Repository {\n  root: string;\n  branch: string;\n  changedFiles: number;\n}\n\nexport const isClean = (repo: Repository) => repo.changedFiles === 0;\n",
);
commit("Describe the repository workspace");
git("checkout", "-b", "feature/live-refresh");
write(
  "src/core/watcher.ts",
  "export const refreshDelay = 120;\n\nexport function coalesce(callback: () => void) {\n  let timer: ReturnType<typeof setTimeout>;\n  return () => {\n    clearTimeout(timer);\n    timer = setTimeout(callback, refreshDelay);\n  };\n}\n",
);
commit("Coalesce filesystem changes into one refresh");
write(
  "src/core/events.ts",
  "export type RepositoryEvent =\n  | { kind: 'worktree'; paths: string[] }\n  | { kind: 'history'; head: string };\n",
);
commit("Separate working tree and history invalidation");
git("checkout", "main");
write(
  "src/ui/theme.ts",
  "export const theme = {\n  background: '#141a17',\n  foreground: '#dbe9de',\n  accent: '#a3e5cc',\n  border: '#29392e',\n};\n",
);
commit("Settle on a softer dark palette");
git("checkout", "-b", "feature/commit-graph");
write(
  "src/core/graph.ts",
  "export interface GraphNode {\n  oid: string;\n  parents: string[];\n  lane: number;\n}\n\nexport const laneWidth = 16;\nexport const rowHeight = 37;\n",
);
commit("Lay out commit lanes in topological order");
write(
  "src/ui/History.tsx",
  'export function HistoryRow({ message }: { message: string }) {\n  return <div className="history-row">{message}</div>;\n}\n',
);
commit("Render only the visible history rows");
git("checkout", "main");
git(
  "merge",
  "--no-ff",
  "feature/live-refresh",
  "-m",
  "Merge live repository refresh",
);
write(
  "docs/performance.md",
  "# Performance notes\n\nMeasure a packaged build. Include WebKit helper processes in memory totals.\n",
);
commit("Document how to measure the whole application");
git(
  "merge",
  "--no-ff",
  "feature/commit-graph",
  "-m",
  "Merge the interactive commit graph",
);
git("checkout", "-b", "feature/editor");
write(
  "src/ui/Editor.tsx",
  "export function EditorHint() {\n  return <p>Open a file, make a change, save it.</p>;\n}\n",
);
commit("Make room for an editable workspace");
git("checkout", "main");
write(
  "src/core/cache.ts",
  cache
    .replace("private ttl = 30_000", "private ttl = 60_000")
    .replace(
      "  clear(): void {",
      "  get size(): number {\n    return this.entries.size;\n  }\n\n  clear(): void {",
    ),
);
commit("Expose cache size and extend the default lifetime");
git("tag", "v0.1.0");
for (const branch of ["main", "feature/live-refresh", "feature/commit-graph"])
  git("update-ref", `refs/remotes/origin/${branch}`, git("rev-parse", branch));
write(
  "src/core/cache.ts",
  cache
    .replace(
      "constructor(private ttl = 30_000) {}",
      "constructor(\n    private ttl = 60_000,\n    private capacity = 200,\n  ) {}",
    )
    .replace(
      "  set(key: string, value: T): void {",
      "  set(key: string, value: T): void {\n    // Keep the working set bounded as repositories change.\n    if (this.entries.size >= this.capacity) {\n      const oldest = this.entries.keys().next().value;\n      if (oldest !== undefined) this.entries.delete(oldest);\n    }",
    )
    .replace(
      "  clear(): void {",
      "  get size(): number {\n    return this.entries.size;\n  }\n\n  clear(): void {",
    ),
);
write(
  "docs/roadmap.md",
  "# Next up\n\n- Benchmark a large repository\n- Add hunk staging\n- Preserve editor state across tabs\n",
);
write(
  "src/ui/StatusBar.tsx",
  "export function StatusBar({ branch }: { branch: string }) {\n  return <footer>Watching for changes on {branch}</footer>;\n}\n",
);
git("add", "docs/roadmap.md");
console.log(
  `Created a real Git repository with branches, merges, and working changes:\n${root}`,
);
