export interface Commit {
  oid: string;
  parents: string[];
  author: string;
  timestamp: number;
  subject: string;
}
export interface Reference {
  name: string;
  oid: string;
  kind: "local" | "remote" | "tag";
}
export interface Change {
  path: string;
  original_path: string | null;
  index: string;
  worktree: string;
}
export interface Snapshot {
  root: string;
  name: string;
  branch: string;
  head: string | null;
  files: string[];
  changes: Change[];
  commits: Commit[] | null;
  refs: Reference[] | null;
  has_more: boolean;
  elapsed_ms: number;
  watch_warning: string | null;
}
export interface Details {
  message: string;
  paths: string[];
  parent: string | null;
  elapsed_ms: number;
}
export interface Versions {
  old: string | null;
  new: string | null;
  elapsed_ms: number;
}
export type Mode = "history" | "files";
export interface Selection {
  source: "commit" | "worktree" | "index";
  path: string;
  oid?: string;
  parent?: string | null;
  oldPath?: string | null;
}
