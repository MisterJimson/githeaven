// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BranchSidebar } from "./BranchSidebar";
import type { Reference } from "./types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps large ref lists bounded while allowing scrolling to remote branches", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(223);
  const refs: Reference[] = ["local", "remote"].flatMap((kind) =>
    Array.from({ length: 1000 }, (_, i) => ({
      kind: kind as "local" | "remote",
      name: `${kind === "remote" ? "origin/" : ""}branch-${i}`,
      oid: `${kind}-${i}`,
    })),
  );
  const onFilter = vi.fn();
  render(
    <BranchSidebar
      refs={refs}
      branch="main"
      branchFilter=""
      onFilter={onFilter}
    />,
  );
  expect(screen.getAllByRole("button").length).toBeLessThan(80);
  fireEvent.click(screen.getByRole("button", { name: "branch-0" }));
  expect(onFilter).toHaveBeenLastCalledWith(
    "local-0",
    expect.objectContaining({ oid: "local-0" }),
  );
  const list = screen.getByLabelText("LOCAL BRANCHES list");
  list.scrollTop = 900;
  fireEvent.scroll(list);
  fireEvent.click(
    await screen.findByRole("button", { name: "origin/branch-0" }),
  );
  expect(onFilter).toHaveBeenLastCalledWith(
    "remote-0",
    expect.objectContaining({ oid: "remote-0" }),
  );
  expect(screen.getAllByRole("button").length).toBeLessThan(80);
});

it("filters and collapses branches and only checks out on double click", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(223);
  const refs: Reference[] = [
    { name: "main", oid: "one", kind: "local" },
    { name: "feature", oid: "two", kind: "local" },
    { name: "origin/feature", oid: "three", kind: "remote" },
  ];
  const onFilter = vi.fn();
  const onCheckout = vi.fn();
  render(
    <BranchSidebar
      refs={refs}
      branch="main"
      branchFilter=""
      onFilter={onFilter}
      onCheckout={onCheckout}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Filter branches" }), {
    target: { value: "feature" },
  });
  expect(screen.queryByRole("button", { name: "main" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "feature" }));
  expect(onFilter).toHaveBeenLastCalledWith(
    "two",
    expect.objectContaining({ oid: "two" }),
  );
  expect(onCheckout).not.toHaveBeenCalled();
  fireEvent.doubleClick(screen.getByRole("button", { name: "feature" }));
  expect(onCheckout).toHaveBeenLastCalledWith(refs[1]);
  fireEvent.click(screen.getByRole("button", { name: /LOCAL BRANCHES/ }));
  expect(screen.queryByRole("button", { name: "feature" })).toBeNull();
  expect(screen.getByRole("button", { name: "origin/feature" })).toBeTruthy();
});

it("opens delete as the first context action without selecting the branch", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(223);
  const onFilter = vi.fn();
  render(
    <BranchSidebar
      refs={[{ name: "feature", kind: "local", oid: "abc" }]}
      branch="main"
      branchFilter=""
      onFilter={onFilter}
      onDelete={vi.fn()}
    />,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "feature" }), {
    clientX: 80,
    clientY: 120,
  });
  expect(screen.getAllByRole("menuitem")[0].textContent).toContain(
    "Delete branch",
  );
  expect(onFilter).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});

it("keeps section headers mounted and pins them while scrolling", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(223);
  render(
    <BranchSidebar
      refs={Array.from({ length: 100 }, (_, i) => ({
        name: `branch-${i}`,
        oid: `${i}`,
        kind: "local" as const,
      }))}
      branch="main"
      branchFilter=""
      onFilter={vi.fn()}
    />,
  );
  const scroller = screen.getByLabelText("LOCAL BRANCHES list");
  fireEvent.scroll(scroller, { target: { scrollTop: 900 } });
  const header = screen.getByRole("button", { name: /LOCAL BRANCHES/ });
  expect(scroller.contains(header)).toBe(false);
  fireEvent.click(header);
  expect(header.getAttribute("aria-expanded")).toBe("false");
});

it("offers stash operations and confirms deletion", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(223);
  const action = vi.fn().mockResolvedValue(undefined);
  render(
    <BranchSidebar
      refs={[]}
      stashes={[
        {
          oid: "a".repeat(40),
          name: "stash@{0}",
          message: "On main: Saved work",
        },
      ]}
      onStashAction={action}
      branch="main"
      branchFilter=""
      onFilter={vi.fn()}
    />,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: /stash@\{0\}/ }));
  expect(
    screen.getByRole("menuitem", { name: "Pop to working tree" }),
  ).toBeTruthy();
  expect(
    screen.getByRole("menuitem", { name: "Apply to working tree" }),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete stash…" }));
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delete stash" }));
  expect(action).toHaveBeenCalledWith(
    expect.objectContaining({ oid: "a".repeat(40) }),
    "delete",
  );
});

it("resizes docked sections and remembers their proportions", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    height: 200,
  } as DOMRect);
  const props = {
    refs: [
      { name: "main", kind: "local" as const, oid: "a" },
      { name: "origin/main", kind: "remote" as const, oid: "a" },
    ],
    branch: "main",
    branchFilter: "",
    onFilter: vi.fn(),
  };
  const { unmount } = render(<BranchSidebar {...props} />);
  const splitter = screen.getByRole("separator", {
    name: "Resize LOCAL BRANCHES and REMOTES",
  });
  fireEvent.keyDown(splitter, { key: "ArrowDown" });
  const saved = JSON.parse(
    localStorage.getItem("githeaven.sidebar-section-heights")!,
  );
  expect(saved.local).toBeGreaterThan(saved.remote);
  unmount();
  render(<BranchSidebar {...props} />);
  const local = screen.getByRole("button", { name: /LOCAL BRANCHES/ });
  expect(local.parentElement?.style.flex).toBe(`${saved.local} 1 0px`);
  fireEvent.click(local);
  expect(screen.queryByLabelText("LOCAL BRANCHES list")).toBeNull();
  expect(screen.getByLabelText("REMOTES list")).toBeTruthy();
  localStorage.removeItem("githeaven.sidebar-section-heights");
});
