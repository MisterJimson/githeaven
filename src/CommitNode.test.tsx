// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommitNode, authorDetails } from "./CommitNode";
import { call } from "./api";
vi.mock("./api", () => ({ call: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const commit = {
  oid: "a".repeat(40),
  author: "Ada",
  author_email: "ada@example.com",
  coauthors: ["Grace <grace@example.com>"],
  parents: [],
  timestamp: 1,
  subject: "Example",
};
it("includes local author and co-author details without requiring a network match", () => {
  const text = authorDetails(commit);
  expect(text).toContain("Ada <ada@example.com>");
  expect(text).toContain("Co-author: Grace <grace@example.com>");
  expect(text).toContain("aaaaaaaaaaaa");
});
it("replaces the circle with an avatar, shares successful author matches and falls back on image failure", async () => {
  vi.mocked(call).mockResolvedValue({
    login: "ada",
    url: "https://avatars.githubusercontent.com/u/1?s=48",
  });
  const { container, rerender } = render(
    <svg>
      <CommitNode root="/avatar-test" commit={commit} x={22} color="blue" />
    </svg>,
  );
  expect(container.querySelector("circle")?.getAttribute("r")).toBe("9");
  await waitFor(() => expect(container.querySelector("image")).not.toBeNull());
  expect(container.querySelector("circle")?.getAttribute("r")).toBe("9");
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
    "(@ada)",
  );
  fireEvent.error(container.querySelector("image")!);
  expect(container.querySelector("image")).toBeNull();
  expect(container.querySelector("circle")?.getAttribute("r")).toBe("9");
  rerender(
    <svg>
      <CommitNode
        root="/avatar-test"
        commit={{ ...commit, oid: "b".repeat(40) }}
        x={22}
        color="blue"
      />
    </svg>,
  );
  await waitFor(() => expect(container.querySelector("image")).not.toBeNull());
  expect(call).toHaveBeenCalledTimes(1);
});
it("does not let an unpublished commit prevent another commit matching the same author", async () => {
  vi.mocked(call).mockResolvedValueOnce(null).mockResolvedValueOnce({
    login: "ada",
    url: "https://avatars.githubusercontent.com/u/1",
  });
  const { container, rerender } = render(
    <svg>
      <CommitNode
        root="/unpublished-test"
        commit={commit}
        x={22}
        color="blue"
      />
    </svg>,
  );
  await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
  rerender(
    <svg>
      <CommitNode
        root="/unpublished-test"
        commit={{ ...commit, oid: "c".repeat(40) }}
        x={22}
        color="blue"
      />
    </svg>,
  );
  await waitFor(() => expect(container.querySelector("image")).not.toBeNull());
  expect(call).toHaveBeenCalledTimes(2);
});
