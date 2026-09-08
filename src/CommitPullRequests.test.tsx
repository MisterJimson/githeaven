// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CommitPullRequests } from "./CommitPullRequests";
import { call } from "./api";
vi.mock("./api", () => ({ call: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("opens associated PRs and reuses the lookup on reselection", async () => {
  const url = "https://github.com/owner/repo/pull/42";
  vi.mocked(call).mockResolvedValue([{ number: 42, url }]);
  const { rerender } = render(
    <CommitPullRequests root="/prs" oid="a" active />,
  );
  const button = await screen.findByRole("button", {
    name: "Open PR #42 on GitHub",
  });
  fireEvent.click(button);
  expect(call).toHaveBeenCalledWith("open_pull_request", { url });
  rerender(<CommitPullRequests root="/prs" oid="a" active={false} />);
  rerender(<CommitPullRequests root="/prs" oid="a" active />);
  await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([cmd]) => cmd === "commit_pull_requests"),
  ).toHaveLength(1);
});
it("does not show a button without a match or fetch while hidden", async () => {
  vi.mocked(call).mockResolvedValue([]);
  const { rerender } = render(
    <CommitPullRequests root="/no-pr" oid="b" active={false} />,
  );
  expect(call).not.toHaveBeenCalled();
  rerender(<CommitPullRequests root="/no-pr" oid="b" active />);
  await waitFor(() => expect(call).toHaveBeenCalledOnce());
  expect(screen.queryByRole("button")).toBeNull();
});
