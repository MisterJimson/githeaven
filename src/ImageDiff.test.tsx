// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ImageDiff } from "./ImageDiff";
import { call } from "./api";
vi.mock("./api", () => ({ call: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const props = {
  root: "/repo",
  selection: { path: "image.png", source: "worktree" as const },
  refresh: 1,
  split: true,
  onTiming: vi.fn(),
};
it("renders both versions and retains them until the replacement is decoded", async () => {
  const decode = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = decode;
    },
  );
  vi.mocked(call).mockResolvedValue({
    old: "data:old",
    new: "data:new",
    elapsed_ms: 1,
  });
  const { rerender } = render(<ImageDiff {...props} />);
  expect(
    (await screen.findByAltText("Before version")).getAttribute("src"),
  ).toBe("data:old");
  expect(screen.getByAltText("After version").getAttribute("src")).toBe(
    "data:new",
  );
  let ready!: () => void;
  decode.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
  );
  vi.mocked(call).mockResolvedValue({
    old: null,
    new: "data:updated",
    elapsed_ms: 1,
  });
  rerender(<ImageDiff {...props} refresh={2} />);
  await waitFor(() => expect(decode).toHaveBeenCalledTimes(3));
  expect(screen.getByAltText("After version").getAttribute("src")).toBe(
    "data:new",
  );
  await act(async () => ready());
  expect(screen.getByText("File added — no previous image")).toBeTruthy();
  expect(screen.getByAltText("After version").getAttribute("src")).toBe(
    "data:updated",
  );
  decode.mockResolvedValue(undefined);
  vi.mocked(call).mockResolvedValue({
    old: "data:updated",
    new: null,
    elapsed_ms: 1,
  });
  rerender(<ImageDiff {...props} refresh={3} split={false} />);
  expect(await screen.findByText("File deleted — no new image")).toBeTruthy();
});
it("ignores stale responses when switching files and reports decode failures", async () => {
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return Promise.reject(new Error("Invalid image"));
      }
    },
  );
  let stale!: (value: unknown) => void;
  vi.mocked(call)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          stale = resolve;
        }),
    )
    .mockResolvedValue({ old: null, new: "data:bad", elapsed_ms: 1 });
  const { rerender } = render(<ImageDiff {...props} />);
  rerender(
    <ImageDiff {...props} selection={{ path: "other.png", source: "index" }} />,
  );
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "Image preview unavailable. Error: Invalid image",
  );
  await act(async () => stale({ old: "stale", new: "stale", elapsed_ms: 1 }));
  expect(screen.queryByRole("img")).toBeNull();
});
