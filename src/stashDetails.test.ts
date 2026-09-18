import { expect, it, vi } from "vitest";
import { call } from "./api";
import { cachedStashDetails, loadStashDetails } from "./stashDetails";
vi.mock("./api", () => ({ call: vi.fn() }));
it("shares in-flight requests and reuses immutable stash details per repository", async () => {
  const details = {
    paths: ["new.ts"],
    message: "Saved",
    parent: null,
    elapsed_ms: 1,
  };
  vi.mocked(call).mockResolvedValue(details);
  const first = loadStashDetails("/one", "saved");
  expect(loadStashDetails("/one", "saved")).toBe(first);
  await first;
  expect(cachedStashDetails("/one", "saved")).toBe(details);
  await loadStashDetails("/one", "saved");
  expect(call).toHaveBeenCalledTimes(1);
  await loadStashDetails("/two", "saved");
  expect(call).toHaveBeenCalledTimes(2);
});
it("retries a failed request", async () => {
  vi.mocked(call)
    .mockRejectedValueOnce(new Error("failed"))
    .mockResolvedValueOnce({ paths: [] });
  await expect(loadStashDetails("/retry", "saved")).rejects.toThrow("failed");
  await expect(loadStashDetails("/retry", "saved")).resolves.toEqual({
    paths: [],
  });
});
