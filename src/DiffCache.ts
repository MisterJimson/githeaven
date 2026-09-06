import type { FileDiffMetadata } from "@pierre/diffs";
import { call } from "./api";
import type { Selection, Versions } from "./types";
export interface HighlightPool {
  primeDiffHighlightCache(diff: FileDiffMetadata): Promise<void>;
  getDiffResultCache?(diff: FileDiffMetadata): unknown;
}
export interface PreparedDiff {
  versions: Versions;
  diff: FileDiffMetadata;
  refresh: number;
  bytes: number;
  cacheless: boolean;
}
let serial = 0;
export const diffKey = (root: string, s: Selection) =>
  JSON.stringify([root, s.path, s.source, s.oid, s.parent, s.oldPath]);

// Matches the bounded Pierre AST cache; large diffs remain usable but are not retained.
export class DiffCache {
  private entries = new Map<string, PreparedDiff>();
  private pending = new Map<
    string,
    { refresh: number; result: Promise<PreparedDiff> }
  >();
  private running = 0;
  private jobs: {
    key: string;
    run: () => void;
    reject: (error: Error) => void;
  }[] = [];
  private schedule<T>(
    key: string,
    work: () => Promise<T>,
    foreground: boolean,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const job = {
        key,
        reject,
        run: () => {
          this.running++;
          void work()
            .then(resolve, reject)
            .finally(() => {
              this.running--;
              this.jobs.shift()?.run();
            });
        },
      };
      if (this.running < 2) job.run();
      else {
        if (foreground) this.jobs.unshift(job);
        else this.jobs.push(job);
        if (this.jobs.length > 24)
          this.jobs.pop()!.reject(new Error("Diff preparation superseded."));
      }
    });
  }
  constructor(private pool: HighlightPool) {}
  peek(root: string, selection: Selection) {
    const key = diffKey(root, selection);
    const value = this.entries.get(key);
    if (!value) return;
    // A metadata hit without its matching syntax AST must be primed again.
    if (
      !value.cacheless &&
      this.pool.getDiffResultCache &&
      !this.pool.getDiffResultCache(value.diff)
    )
      return;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }
  async prepare(
    root: string,
    selection: Selection,
    refresh: number,
    foreground = true,
  ): Promise<PreparedDiff> {
    const key = diffKey(root, selection);
    const ready = this.peek(root, selection);
    if (ready?.refresh === refresh) return ready;
    const pending = this.pending.get(key);
    if (pending?.refresh === refresh) {
      const queued = this.jobs.findIndex((job) => job.key === key);
      if (foreground && queued > 0)
        this.jobs.unshift(...this.jobs.splice(queued, 1));
      return pending.result;
    }
    const task = { refresh, result: null as unknown as Promise<PreparedDiff> };
    task.result = this.schedule(
      key,
      async () => {
        const data = await call<Versions>("file_versions", {
          root,
          path: selection.path,
          source: selection.source,
          oid: selection.oid ?? null,
          parent: selection.parent ?? null,
          oldPath: selection.oldPath ?? null,
        });
        if (data.old === null && data.new === null)
          throw new Error("This file no longer exists in this comparison.");
        const previous = this.entries.get(key);
        let diff: FileDiffMetadata;
        if (
          previous &&
          previous.versions.old === data.old &&
          previous.versions.new === data.new
        )
          diff = previous.diff;
        else
          diff = await new Promise<FileDiffMetadata>((resolve, reject) => {
            const worker = new Worker(
              new URL("./diff.worker.ts", import.meta.url),
              { type: "module" },
            );
            worker.onmessage = (
              event: MessageEvent<{
                result?: FileDiffMetadata;
                error?: string;
              }>,
            ) => {
              worker.terminate();
              if (event.data.result)
                resolve({
                  ...event.data.result,
                  cacheKey: `githeaven-ready-diff-${++serial}`,
                });
              else reject(new Error(event.data.error || "Diff parsing failed"));
            };
            worker.onerror = (event) => {
              worker.terminate();
              reject(new Error(event.message || "Diff worker failed"));
            };
            worker.postMessage({
              path: selection.path,
              old: data.old,
              new: data.new,
            });
          });
        await this.pool.primeDiffHighlightCache(diff);
        const value = {
          versions: data,
          diff,
          refresh,
          cacheless:
            !!this.pool.getDiffResultCache &&
            !this.pool.getDiffResultCache(diff),
          bytes: 2 * ((data.old?.length ?? 0) + (data.new?.length ?? 0)),
        };
        if (this.pending.get(key) === task && value.bytes <= 6 * 1024 * 1024) {
          this.entries.delete(key);
          this.entries.set(key, value);
          let bytes = [...this.entries.values()].reduce(
            (sum, v) => sum + v.bytes,
            0,
          );
          while (this.entries.size > 24 || bytes > 6 * 1024 * 1024) {
            const oldest = this.entries.keys().next().value!;
            bytes -= this.entries.get(oldest)!.bytes;
            this.entries.delete(oldest);
          }
        }
        return value;
      },
      foreground,
    ).finally(() => {
      if (this.pending.get(key) === task) this.pending.delete(key);
    });
    this.pending.set(key, task);
    return task.result;
  }
}
