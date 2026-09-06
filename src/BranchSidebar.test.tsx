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
      commitCount={500}
      branch="main"
      branchFilter=""
      onFilter={onFilter}
    />,
  );
  expect(screen.getAllByRole("button").length).toBeLessThan(50);
  fireEvent.click(screen.getByRole("button", { name: "branch-0" }));
  expect(onFilter).toHaveBeenLastCalledWith("local-0");
  const list = screen.getByLabelText("Branches and tags");
  list.scrollTop = 22026;
  fireEvent.scroll(list);
  fireEvent.click(
    await screen.findByRole("button", { name: "origin/branch-0" }),
  );
  expect(onFilter).toHaveBeenLastCalledWith("remote-0");
  expect(screen.getAllByRole("button").length).toBeLessThan(50);
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
      commitCount={3}
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
  expect(onFilter).toHaveBeenLastCalledWith("two");
  expect(onCheckout).not.toHaveBeenCalled();
  fireEvent.doubleClick(screen.getByRole("button", { name: "feature" }));
  expect(onCheckout).toHaveBeenLastCalledWith(refs[1]);
  fireEvent.click(screen.getByRole("button", { name: /LOCAL BRANCHES/ }));
  expect(screen.queryByRole("button", { name: "feature" })).toBeNull();
  expect(screen.getByRole("button", { name: "origin/feature" })).toBeTruthy();
});
