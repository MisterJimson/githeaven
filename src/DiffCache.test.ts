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
