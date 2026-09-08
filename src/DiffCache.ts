import type { FileDiffMetadata } from "@pierre/diffs";
import { measureAsync, startSpan, countEvent } from "./performance";
import { call } from "./api";
import type { Selection, Versions } from "./types";
export class DiffPreparationSuperseded extends Error {
  constructor() {
    super("Diff preparation superseded.");
  }
}
function superseded(phase = "queue") {
  countEvent("diff.prepare.superseded");
  countEvent(`diff.superseded.${phase}`);
  return new DiffPreparationSuperseded();
}
export interface HighlightPool {
  primeDiffHighlightCache(diff: FileDiffMetadata): Promise<void>;
  getDiffResultCache?(diff: FileDiffMetadata): unknown;
  evictDiffFromCache?(cacheKey: string): boolean;
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
  private deferred = new Map<string, { refresh: number; bytes: number }>();
  private pending = new Map<
    string,
    {
      refresh: number;
      foreground: boolean;
      maxBytes: number;
      result: Promise<PreparedDiff>;
      cancelParser?: () => void;
    }
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
    const finishWait = startSpan(
      foreground ? "diff.queue.foreground" : "diff.queue.background",
    );
    return new Promise((resolve, reject) => {
      const job = {
        key,
        reject: (error: Error) => {
          finishWait("error");
          reject(error);
        },
        run: () => {
          finishWait();
          this.running++;
          void Promise.resolve()
            .then(work)
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
        if (this.jobs.length > 24) this.jobs.pop()!.reject(superseded());
      }
    });
  }
  constructor(private pool: HighlightPool) {}
  stats() {
    return {
      entries: this.entries.size,
      deferred: this.deferred.size,
      sourceBytes: [...this.entries.values()].reduce(
        (sum, item) => sum + item.bytes,
        0,
      ),
      pending: this.pending.size,
      running: this.running,
      queued: this.jobs.length,
    };
  }
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
    maxBytes = 128 * 1024,
  ): Promise<PreparedDiff> {
    const key = diffKey(root, selection);
    const ready = this.peek(root, selection);
    if (ready?.refresh === refresh) {
      countEvent("diff.prepare.cache-hit");
      return ready;
    }
    const pending = this.pending.get(key);
    if (pending?.refresh === refresh) {
      countEvent("diff.prepare.shared-request");
      if (foreground) pending.foreground = true;
      pending.maxBytes = Math.max(pending.maxBytes, maxBytes);
      const queued = this.jobs.findIndex((job) => job.key === key);
      if (foreground && queued > 0)
        this.jobs.unshift(...this.jobs.splice(queued, 1));
      return pending.result;
    }
    const deferred = this.deferred.get(key);
    if (
      !foreground &&
      deferred?.refresh === refresh &&
      deferred.bytes > maxBytes
    ) {
      countEvent("diff.prepare.deferred-hit");
      throw new Error("Large diff deferred until selected.");
    }
    // Keep only the newest queued revision for this comparison. In-flight
    // Git reads finish naturally; parsing/highlighting checks ownership below.
    pending?.cancelParser?.();
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (this.jobs[i].key === key)
        this.jobs.splice(i, 1)[0].reject(superseded());
    }
    countEvent("diff.prepare.cache-miss");
    const task = {
      refresh,
      foreground,
      maxBytes,
      result: null as unknown as Promise<PreparedDiff>,
      cancelParser: undefined as (() => void) | undefined,
    };
    const assertCurrent = (phase: string) => {
      if (this.pending.get(key) !== task) throw superseded(phase);
    };
    task.result = this.schedule(
      key,
      async () => {
        assertCurrent("queue");
        const previous = this.entries.get(key);
        const currentSource = previous?.refresh === refresh;
        if (currentSource) countEvent("diff.prepare.source-cache-hit");
        const data = currentSource
          ? previous.versions
          : await call<Versions>("file_versions", {
              root,
              path: selection.path,
              source: selection.source,
              oid: selection.oid ?? null,
              parent: selection.parent ?? null,
              oldPath: selection.oldPath ?? null,
            });
        assertCurrent("read");
        // Keep speculative work small enough that nearby files remain resident.
        // A click can promote an in-flight request and bypass this background budget.
        const sourceBytes =
          2 * ((data.old?.length ?? 0) + (data.new?.length ?? 0));
        if (!task.foreground && sourceBytes > task.maxBytes) {
          if (this.pending.get(key) === task) {
            this.deferred.delete(key);
            this.deferred.set(key, { refresh, bytes: sourceBytes });
            if (this.deferred.size > 64)
              this.deferred.delete(this.deferred.keys().next().value!);
          }
          countEvent("diff.prepare.skipped-large-prefetch");
          throw new Error("Large diff deferred until selected.");
        }
        if (data.old === null && data.new === null)
          throw new Error("This file no longer exists in this comparison.");
        let diff: FileDiffMetadata;
        let created = false;
        if (
          previous &&
          previous.versions.old === data.old &&
          previous.versions.new === data.new
        )
          diff = previous.diff;
        else {
          created = true;
          diff = await measureAsync(
            "diff.parse-worker",
            () =>
              new Promise<FileDiffMetadata>((resolve, reject) => {
                const worker = new Worker(
                  new URL("./diff.worker.ts", import.meta.url),
                  { type: "module" },
                );
                task.cancelParser = () => {
                  worker.terminate();
                  task.cancelParser = undefined;
                  reject(superseded("parse"));
                };
                worker.onmessage = (
                  event: MessageEvent<{
                    result?: FileDiffMetadata;
                    error?: string;
                  }>,
                ) => {
                  worker.terminate();
                  task.cancelParser = undefined;
                  if (event.data.result)
                    resolve({
                      ...event.data.result,
                      cacheKey: `githeaven-ready-diff-${++serial}`,
                    });
                  else
                    reject(
                      new Error(event.data.error || "Diff parsing failed"),
                    );
                };
                worker.onerror = (event) => {
                  worker.terminate();
                  task.cancelParser = undefined;
                  reject(new Error(event.message || "Diff worker failed"));
                };
                worker.postMessage({
                  path: selection.path,
                  old: data.old,
                  new: data.new,
                });
              }),
          );
        }
        assertCurrent("parse");
        await measureAsync("diff.highlight", () =>
          this.pool.primeDiffHighlightCache(diff),
        );
        if (this.pending.get(key) !== task) {
          // Only a newly allocated key belongs exclusively to this task. A
          // reused key can be shared with the current revision.
          if (created && diff.cacheKey)
            this.pool.evictDiffFromCache?.(diff.cacheKey);
          throw superseded("highlight");
        }
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
          // The replacement is fully highlighted. Retire only the old syntax
          // version now, preserving it while reads/highlighting were in flight.
          const retired = this.entries.get(key)?.diff.cacheKey;
          if (
            retired &&
            retired !== diff.cacheKey &&
            this.pool.evictDiffFromCache?.(retired)
          )
            countEvent("diff.cache.retired-highlight");
          this.deferred.delete(key);
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
