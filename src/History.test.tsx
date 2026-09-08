// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { History } from "./History";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
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

it("selects adjacent commits with arrows, including WIP, without scrolling the page", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  const scrollTo = vi.fn();
  const commits = Array.from({ length: 100 }, (_, index) => ({
    oid: `commit-${index}`,
    parents: index < 99 ? [`commit-${index + 1}`] : [],
    subject: `Commit ${index}`,
    author: "A",
    timestamp: 100 - index,
  }));
  const onSelect = vi.fn();
  const onSelectWorking = vi.fn();
  const props = {
    commits,
    refs: [],
    head: commits[0].oid,
    branch: "main",
    workingCount: 1,
    workingSelected: true,
    onSelect,
    onSelectWorking,
  };
  const { rerender } = render(<History {...props} />);
  const viewport = screen.getByRole("listbox", { name: "Commit history" });
  viewport.scrollTo = scrollTo;
  expect(fireEvent.keyDown(viewport, { key: "ArrowDown" })).toBe(false);
  expect(onSelect).toHaveBeenLastCalledWith(commits[0]);
  expect(document.activeElement).toBe(viewport);
  rerender(
    <History {...props} workingSelected={false} selected={commits[0].oid} />,
  );
  fireEvent.keyDown(screen.getAllByRole("option")[1], { key: "ArrowDown" });
  expect(onSelect).toHaveBeenLastCalledWith(commits[1]);
  fireEvent.keyDown(viewport, { key: "ArrowUp" });
  expect(onSelectWorking).toHaveBeenCalledOnce();
  // Navigation uses the complete history, not just currently mounted rows.
  rerender(
    <History {...props} workingSelected={false} selected={commits[70].oid} />,
  );
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(onSelect).toHaveBeenLastCalledWith(commits[71]);
  expect(scrollTo).toHaveBeenCalled();
  rerender(
    <History
      {...props}
      workingCount={0}
      workingSelected={false}
      selected={commits[99].oid}
    />,
  );
  onSelect.mockClear();
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.keyDown(viewport, { key: "ArrowUp", metaKey: true });
  expect(onSelect).not.toHaveBeenCalled();
  rerender(<History {...props} active={false} />);
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(onSelect).not.toHaveBeenCalled();
});

it("resizes graph columns together with rows and remembers widths without changing lanes", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId = 1;
    },
  );
  const props = {
    commits: [
      { oid: "head", parents: [], subject: "Head", author: "A", timestamp: 1 },
    ],
    refs: [],
    head: "head",
    branch: "main",
    workingCount: 0,
    workingSelected: false,
    onSelect: vi.fn(),
    onSelectWorking: vi.fn(),
  };
  const { container } = render(<History {...props} />);
  const branch = screen.getByRole("separator", {
    name: "Resize branch / tag column",
  });
  branch.setPointerCapture = vi.fn();
  branch.releasePointerCapture = vi.fn();
  const row = screen.getByRole("option");
  const nodeX = row.querySelector("circle")!.getAttribute("cx");
  fireEvent.pointerDown(branch, { button: 0, clientX: 160 });
  fireEvent.pointerMove(branch, { clientX: 260 });
  expect(branch.getAttribute("aria-valuenow")).toBe("260");
  expect(localStorage.getItem("githeaven.column.branch")).toBeNull();
  fireEvent.pointerUp(branch, { clientX: 260 });
  expect(localStorage.getItem("githeaven.column.branch")).toBe("260");
  const graph = screen.getByRole("separator", { name: "Resize graph column" });
  fireEvent.keyDown(graph, { key: "ArrowRight", shiftKey: true });
  expect(graph.getAttribute("aria-valuenow")).toBe("128");
  const heading = container.querySelector<HTMLElement>(".history-columns")!;
  expect(heading.style.gridTemplateColumns).toBe(
    "260px 128px minmax(180px, 1fr)",
  );
  expect(row.style.gridTemplateColumns).toBe(heading.style.gridTemplateColumns);
  expect(row.querySelector("circle")!.getAttribute("cx")).toBe(nodeX);
  expect(screen.getByRole("option")).toBe(row);
  expect(props.onSelect).not.toHaveBeenCalled();
  cleanup();
  render(<History {...props} />);
  const restored = screen.getByRole("separator", {
    name: "Resize branch / tag column",
  });
  expect(restored.getAttribute("aria-valuenow")).toBe("260");
  fireEvent.keyDown(restored, { key: "Home" });
  expect(restored.getAttribute("aria-valuenow")).toBe("100");
  fireEvent.doubleClick(restored);
  expect(restored.getAttribute("aria-valuenow")).toBe("160");
  expect(localStorage.getItem("githeaven.column.branch")).toBeNull();
  fireEvent.doubleClick(
    screen.getByRole("separator", { name: "Resize graph column" }),
  );
  expect(
    screen
      .getByRole("separator", { name: "Resize graph column" })
      .getAttribute("aria-valuenow"),
  ).toBe("78");
});

it("dims unrelated commits without changing graph geometry and only reveals branches absent from the viewport", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(56);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(56);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(336);
  const scrollTo = vi.fn();
  HTMLElement.prototype.scrollTo = scrollTo;
  const commits = Array.from({ length: 12 }, (_, i) => ({
    oid: `c${i}`,
    parents: i < 11 && i !== 3 ? [`c${i + 1}`] : [],
    subject: `Commit ${i}`,
    author: "A",
    timestamp: 12 - i,
  }));
  const props = {
    commits,
    refs: [],
    head: "c0",
    branch: "main",
    workingCount: 0,
    workingSelected: false,
    onSelect: vi.fn(),
    onSelectWorking: vi.fn(),
  };
  const { container, rerender } = render(<History {...props} />);
  const rows = [...container.querySelectorAll(".commit-row")];
  const geometry = rows.map((row) => row.querySelector("svg")!.innerHTML);
  scrollTo.mockClear();
  rerender(<History {...props} branchTip="c0" />);
  expect(container.querySelectorAll(".commit-row")).toHaveLength(rows.length);
  expect(rows.map((row) => row.querySelector("svg")!.innerHTML)).toEqual(
    geometry,
  );
  expect(rows[0].classList.contains("search-dimmed")).toBe(false);
  expect(rows[4].classList.contains("search-dimmed")).toBe(true);
  expect(scrollTo).not.toHaveBeenCalled();
  rerender(<History {...props} branchTip="c8" />);
  expect(scrollTo).toHaveBeenCalledWith(
    expect.objectContaining({ top: 8 * 28 }),
  );
  scrollTo.mockClear();
  rerender(<History {...props} branchTip="c8" search="unmatched" />);
  expect(scrollTo).not.toHaveBeenCalled();
  const viewport = screen.getByRole("listbox", { name: "Commit history" });
  viewport.scrollTop = 9 * 28;
  rerender(<History {...props} branchTip="c6" />);
  expect(scrollTo).not.toHaveBeenCalled();
  rerender(<History {...props} />);
  expect(container.querySelector(".search-dimmed")).toBeNull();
});
