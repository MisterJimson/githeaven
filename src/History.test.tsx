// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { History } from "./History";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("puts WIP in the graph above newer remote commits and connects it to HEAD's lane", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const onSelect = vi.fn();
  const onSelectWorking = vi.fn();
  const props = {
    commits: [
      {
        oid: "remote",
        parents: ["head"],
        subject: "Remote tip",
        author: "A",
        timestamp: 2,
      },
      {
        oid: "head",
        parents: [],
        subject: "Local HEAD",
        author: "A",
        timestamp: 1,
      },
    ],
    refs: [],
    head: "head",
    branch: "main",
    workingCount: 2,
    workingSelected: true,
    onSelect,
    onSelectWorking,
  };
  const { rerender } = render(<History {...props} />);
  const rows = screen.getAllByRole("option");
  expect(rows[0].getAttribute("aria-label")).toBe(
    "Working changes, 2 changed files",
  );
  const lane = (row: HTMLElement) =>
    row.querySelector("circle")!.getAttribute("cx");
  expect(lane(rows[0])).toBe(lane(rows[2]));
  expect(lane(rows[0])).not.toBe(lane(rows[1]));
  expect(
    rows[0].querySelector("circle")!.getAttribute("stroke-dasharray"),
  ).toBe("2 2");
  fireEvent.click(rows[0]);
  expect(onSelectWorking).toHaveBeenCalledOnce();
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(rows[1]);
  expect(onSelect).toHaveBeenCalledWith(props.commits[0]);
  rerender(<History {...props} workingCount={0} />);
  expect(screen.getAllByRole("option")).toHaveLength(2);
  expect(screen.queryByText("Working changes")).toBeNull();
  const first = screen.getAllByRole("option")[0];
  expect(first).toBe(rows[1]);
  expect(
    first.querySelector("circle")!.getAttribute("stroke-dasharray"),
  ).toBeNull();
  fireEvent.click(first);
  expect(onSelect).toHaveBeenLastCalledWith(props.commits[0]);
  rerender(<History {...props} workingCount={1} />);
  expect(
    screen.getByRole("option", { name: "Working changes, 1 changed file" }),
  ).toBeTruthy();
  rerender(<History {...props} commits={[]} head={null} workingCount={0} />);
  expect(screen.queryAllByRole("option")).toHaveLength(0);
});

it("requests older commits near the bottom only while history is visible and has more", () => {
  const onLoadMore = vi.fn();
  const props = {
    commits: [],
    refs: [],
    head: null,
    branch: "main",
    workingCount: 0,
    workingSelected: true,
    onSelect: vi.fn(),
    onSelectWorking: vi.fn(),
    onLoadMore,
    hasMore: true,
  };
  const { rerender } = render(<History {...props} />);
  const viewport = screen.getByRole("listbox", { name: "Commit history" });
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 10000 },
    scrollTop: { configurable: true, writable: true, value: 100 },
  });
  fireEvent.scroll(viewport);
  expect(onLoadMore).not.toHaveBeenCalled();
  viewport.scrollTop = 9000;
  fireEvent.scroll(viewport);
  expect(onLoadMore).toHaveBeenCalledOnce();
  onLoadMore.mockClear();
  rerender(<History {...props} active={false} />);
  fireEvent.scroll(viewport);
  expect(onLoadMore).not.toHaveBeenCalled();
  rerender(<History {...props} hasMore={false} />);
  fireEvent.scroll(viewport);
  expect(onLoadMore).not.toHaveBeenCalled();
});

it("handles branch badges independently of commit rows", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const onSelect = vi.fn(),
    onSelectRef = vi.fn(),
    onCheckoutRef = vi.fn();
  const local = { name: "main", kind: "local" as const, oid: "head" };
  const remote = { name: "origin/main", kind: "remote" as const, oid: "head" };
  render(
    <History
      commits={[
        {
          oid: "head",
          parents: [],
          subject: "Head",
          author: "A",
          timestamp: 1,
        },
      ]}
      refs={[local, remote]}
      head="head"
      branch="main"
      workingCount={0}
      workingSelected
      onSelect={onSelect}
      onSelectWorking={vi.fn()}
      onSelectRef={onSelectRef}
      onCheckoutRef={onCheckoutRef}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "remote origin/main" }));
  expect(onSelectRef).toHaveBeenCalledWith(remote);
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.doubleClick(screen.getByRole("button", { name: "local main" }));
  expect(onCheckoutRef).toHaveBeenCalledWith(local);
  expect(onSelect).not.toHaveBeenCalled();
});
