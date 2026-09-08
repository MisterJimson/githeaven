import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DiffCache } from "./DiffCache";
import { call } from "./api";
vi.mock("./api", () => ({ call: vi.fn() }));
class Parser {
  onmessage?: (event: { data: unknown }) => void;
  postMessage = () =>
    queueMicrotask(() =>
      this.onmessage?.({ data: { result: { name: "file.ts" } } }),
    );
  terminate() {}
}
beforeEach(() => {
  vi.stubGlobal("Worker", Parser);
  vi.mocked(call).mockResolvedValue({ old: "old", new: "new", elapsed_ms: 1 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const selection = { path: "file.ts", source: "worktree" as const };
it("does not let a newer speculative refresh supersede visible highlighting", async () => {
  let release!: () => void;
  const pool = {
    primeDiffHighlightCache: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      )
      .mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  const visible = cache.prepare("repo", selection, 1);
  await vi.waitFor(() =>
    expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1),
  );
  const speculative = cache.prepare("repo", selection, 2, false);
  expect(call).toHaveBeenCalledTimes(1);
  release();
  expect(await speculative).toBe(await visible);
  expect(cache.peek("repo", selection)?.refresh).toBe(1);
  await cache.prepare("repo", selection, 2);
  expect(call).toHaveBeenCalledTimes(2);
  expect(cache.peek("repo", selection)?.refresh).toBe(2);
});
it("deduplicates preparation and returns a synchronously ready diff on revisit", async () => {
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  const [first, second] = await Promise.all([
    cache.prepare("repo", selection, 1),
    cache.prepare("repo", selection, 1),
  ]);
  expect(second).toBe(first);
  expect(cache.peek("repo", selection)).toBe(first);
  await cache.prepare("repo", selection, 1);
  expect(call).toHaveBeenCalledTimes(1);
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
  await cache.prepare("repo", selection, 2);
  expect(call).toHaveBeenCalledTimes(2);
});
it("never treats an evicted syntax AST as a ready cache hit", async () => {
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
    getDiffResultCache: vi.fn().mockReturnValue({}),
  };
  const cache = new DiffCache(pool);
  await cache.prepare("repo", selection, 1);
  pool.getDiffResultCache.mockReturnValue(undefined);
  expect(cache.peek("repo", selection)).toBeUndefined();
  await cache.prepare("repo", selection, 1);
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(2);
  expect(call).toHaveBeenCalledTimes(1);
  await cache.prepare("repo", selection, 2);
  expect(call).toHaveBeenCalledTimes(2);
});
it("bounds retained diffs and isolates staged and working content", async () => {
  const cache = new DiffCache({
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  });
  for (let i = 0; i < 25; i++)
    await cache.prepare("repo", { ...selection, path: `${i}.ts` }, 1);
  expect(cache.peek("repo", { ...selection, path: "0.ts" })).toBeUndefined();
  expect(cache.peek("repo", { ...selection, path: "24.ts" })).toBeDefined();
  expect(
    cache.peek("repo", { path: "24.ts", source: "index" }),
  ).toBeUndefined();
});
it("defers large speculative diffs but always prepares explicit selections", async () => {
  vi.mocked(call).mockResolvedValue({
    old: "x".repeat(128 * 1024),
    new: "new",
    elapsed_ms: 1,
  });
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  await expect(cache.prepare("repo", selection, 1, false)).rejects.toThrow(
    "deferred",
  );
  expect(pool.primeDiffHighlightCache).not.toHaveBeenCalled();
  await expect(cache.prepare("repo", selection, 1, false)).rejects.toThrow(
    "deferred",
  );
  expect(call).toHaveBeenCalledTimes(1);
  await expect(cache.prepare("repo", selection, 2, false)).rejects.toThrow(
    "deferred",
  );
  expect(call).toHaveBeenCalledTimes(2);
  await cache.prepare("repo", selection, 1, true);
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
});
it("promotes an in-flight large prefetch when clicked", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(call).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  const background = cache.prepare("repo", selection, 1, false);
  const selected = cache.prepare("repo", selection, 1, true);
  finish({ old: "x".repeat(128 * 1024), new: "new", elapsed_ms: 1 });
  expect(await selected).toBe(await background);
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
});

it("retries a deferred file when it becomes an immediate neighbor, keeping the byte cap", async () => {
  vi.mocked(call).mockResolvedValue({
    old: "x".repeat(100 * 1024),
    new: "new",
    elapsed_ms: 1,
  });
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  await expect(cache.prepare("repo", selection, 1, false)).rejects.toThrow(
    "deferred",
  );
  await cache.prepare("repo", selection, 1, false, 512 * 1024);
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
  vi.mocked(call).mockResolvedValue({
    old: "x".repeat(300 * 1024),
    new: "new",
    elapsed_ms: 1,
  });
  await expect(
    cache.prepare("repo", selection, 2, false, 512 * 1024),
  ).rejects.toThrow("deferred");
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
});

it("retires obsolete syntax versions only after the replacement is ready", async () => {
  const syntax = new Map();
  const pool = {
    primeDiffHighlightCache: vi.fn(async (diff) => {
      syntax.set(diff.cacheKey, {});
    }),
    getDiffResultCache: (diff: { cacheKey?: string }) =>
      syntax.get(diff.cacheKey),
    evictDiffFromCache: vi.fn((key: string) => syntax.delete(key)),
  };
  const cache = new DiffCache(pool);
  const first = await cache.prepare("repo", selection, 1);
  let complete!: () => void;
  pool.primeDiffHighlightCache.mockImplementationOnce(
    (diff) =>
      new Promise<void>((resolve) => {
        complete = () => {
          syntax.set(diff.cacheKey, {});
          resolve();
        };
      }),
  );
  vi.mocked(call).mockResolvedValue({
    old: "old",
    new: "updated",
    elapsed_ms: 1,
  });
  const next = cache.prepare("repo", selection, 2);
  await vi.waitFor(() => expect(complete).toBeDefined());
  expect(cache.peek("repo", selection)).toBe(first);
  expect(syntax.has(first.diff.cacheKey)).toBe(true);
  complete();
  const second = await next;
  expect(syntax.has(first.diff.cacheKey)).toBe(false);
  expect(syntax.has(second.diff.cacheKey)).toBe(true);
  await cache.prepare("repo", selection, 3);
  expect(pool.evictDiffFromCache).toHaveBeenCalledTimes(1);
  for (let refresh = 4; refresh < 30; refresh++) {
    vi.mocked(call).mockResolvedValue({
      old: "old",
      new: `version-${refresh}`,
      elapsed_ms: 1,
    });
    await cache.prepare("repo", selection, refresh);
  }
  expect(syntax.size).toBe(1);
});

it("preserves the previous syntax cache when replacement highlighting fails", async () => {
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
    evictDiffFromCache: vi.fn(),
  };
  const cache = new DiffCache(pool);
  const first = await cache.prepare("repo", selection, 1);
  vi.mocked(call).mockResolvedValue({
    old: "old",
    new: "updated",
    elapsed_ms: 1,
  });
  pool.primeDiffHighlightCache.mockRejectedValueOnce(
    new Error("worker failed"),
  );
  await expect(cache.prepare("repo", selection, 2)).rejects.toThrow(
    "worker failed",
  );
  expect(pool.evictDiffFromCache).not.toHaveBeenCalled();
  expect(cache.peek("repo", selection)).toBe(first);
});

it("coalesces queued refreshes and skips parsing reads superseded by newer revisions", async () => {
  const readers: ((value: unknown) => void)[] = [];
  vi.mocked(call).mockImplementation(
    () => new Promise((resolve) => readers.push(resolve)),
  );
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  const results = [cache.prepare("repo", selection, 1).catch((e) => e)];
  await vi.waitFor(() => expect(readers).toHaveLength(1));
  results.push(cache.prepare("repo", selection, 2).catch((e) => e));
  await vi.waitFor(() => expect(readers).toHaveLength(2));
  for (let revision = 3; revision <= 20; revision++)
    results.push(cache.prepare("repo", selection, revision).catch((e) => e));
  expect(cache.stats().queued).toBe(1);
  readers[0]({ old: "old", new: "stale-1", elapsed_ms: 1 });
  readers[1]({ old: "old", new: "stale-2", elapsed_ms: 1 });
  await vi.waitFor(() => expect(readers).toHaveLength(3));
  readers[2]({ old: "old", new: "latest", elapsed_ms: 1 });
  const completed = await Promise.all(results);
  expect(
    completed
      .slice(0, -1)
      .every(
        (value) =>
          value instanceof Error && value.message.includes("superseded"),
      ),
  ).toBe(true);
  expect(completed.at(-1).versions.new).toBe("latest");
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledTimes(3);
  expect(cache.peek("repo", selection)?.refresh).toBe(20);
});

it("evicts newly highlighted results that finished after being superseded", async () => {
  const syntax = new Map();
  let finish!: () => void;
  const pool = {
    primeDiffHighlightCache: vi.fn(async (diff) => {
      syntax.set(diff.cacheKey, {});
    }),
    getDiffResultCache: (diff: { cacheKey?: string }) =>
      syntax.get(diff.cacheKey),
    evictDiffFromCache: vi.fn((key: string) => syntax.delete(key)),
  };
  pool.primeDiffHighlightCache.mockImplementationOnce(
    (diff) =>
      new Promise<void>((resolve) => {
        finish = () => {
          syntax.set(diff.cacheKey, {});
          resolve();
        };
      }),
  );
  const cache = new DiffCache(pool);
  const stale = cache.prepare("repo", selection, 1).catch((e) => e);
  await vi.waitFor(() => expect(finish).toBeDefined());
  vi.mocked(call).mockResolvedValue({
    old: "old",
    new: "latest",
    elapsed_ms: 1,
  });
  const latest = await cache.prepare("repo", selection, 2);
  finish();
  expect(await stale).toBeInstanceOf(Error);
  expect(syntax.size).toBe(1);
  expect(syntax.has(latest.diff.cacheKey)).toBe(true);
  expect(cache.peek("repo", selection)).toBe(latest);
});

it("terminates an obsolete parser without highlighting its result", async () => {
  const parsers: {
    deliver: () => void;
    terminate: ReturnType<typeof vi.fn>;
  }[] = [];
  class ControlledParser {
    onmessage?: (event: { data: unknown }) => void;
    terminate = vi.fn();
    deliver = () => this.onmessage?.({ data: { result: { name: "file.ts" } } });
    postMessage = () => parsers.push(this);
  }
  vi.stubGlobal("Worker", ControlledParser);
  const pool = {
    primeDiffHighlightCache: vi.fn().mockResolvedValue(undefined),
  };
  const cache = new DiffCache(pool);
  const old = cache.prepare("repo", selection, 1).catch((e) => e);
  await vi.waitFor(() => expect(parsers).toHaveLength(1));
  const latest = cache.prepare("repo", selection, 2);
  expect(parsers[0].terminate).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(parsers).toHaveLength(2));
  parsers[1].deliver();
  await latest;
  expect(await old).toBeInstanceOf(Error);
  expect(pool.primeDiffHighlightCache).toHaveBeenCalledTimes(1);
});

it("does not evict a reused syntax key shared with a newer refresh", async () => {
  const syntax = new Map();
  let finish!: () => void;
  const pool = {
    primeDiffHighlightCache: vi.fn(async (diff) => {
      syntax.set(diff.cacheKey, {});
    }),
    getDiffResultCache: (diff: { cacheKey?: string }) =>
      syntax.get(diff.cacheKey),
    evictDiffFromCache: vi.fn((key: string) => syntax.delete(key)),
  };
  const cache = new DiffCache(pool);
  const first = await cache.prepare("repo", selection, 1);
  syntax.clear();
  pool.primeDiffHighlightCache.mockImplementationOnce(
    (diff) =>
      new Promise<void>((resolve) => {
        finish = () => {
          syntax.set(diff.cacheKey, {});
          resolve();
        };
      }),
  );
  const stale = cache.prepare("repo", selection, 2).catch((e) => e);
  await vi.waitFor(() => expect(finish).toBeDefined());
  const latest = await cache.prepare("repo", selection, 3);
  finish();
  await stale;
  expect(latest.diff.cacheKey).toBe(first.diff.cacheKey);
  expect(syntax.has(latest.diff.cacheKey)).toBe(true);
  expect(pool.evictDiffFromCache).not.toHaveBeenCalled();
});
