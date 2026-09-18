import { call } from "./api";
import { measureAsync } from "./performance";
import type { Details } from "./types";
const cache = new Map<string, Details>();
const pending = new Map<string, Promise<Details>>();
const keyFor = (root: string, oid: string) => JSON.stringify([root, oid]);
export function cachedStashDetails(root: string, oid: string) {
  return cache.get(keyFor(root, oid));
}
export function loadStashDetails(root: string, oid: string): Promise<Details> {
  const key = keyFor(root, oid);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const existing = pending.get(key);
  if (existing) return existing;
  const request = measureAsync("stash.details", () =>
    call<Details>("commit_details", { root, oid, parent: null, stash: true }),
  )
    .then((details) => {
      cache.set(key, details);
      if (cache.size > 64) cache.delete(cache.keys().next().value!);
      return details;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
