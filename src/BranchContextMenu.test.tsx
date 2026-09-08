// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BranchContextMenu } from "./BranchContextMenu";
afterEach(cleanup);
const target = {
  ref: { name: "feature", kind: "local" as const, oid: "abc" },
  x: 40,
  y: 80,
};
it("requires confirmation and allows cancellation without deleting", () => {
  const onDelete = vi.fn(),
    onClose = vi.fn();
  render(
    <BranchContextMenu
      target={target}
      checkedOut="main"
      onClose={onClose}
      onDelete={onDelete}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete branch" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onDelete).not.toHaveBeenCalled();
});
it("deletes only after confirmation and keeps errors visible", async () => {
  const onDelete = vi.fn().mockRejectedValue("Branch is not merged");
  render(
    <BranchContextMenu
      target={target}
      checkedOut="main"
      onClose={vi.fn()}
      onDelete={onDelete}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem"));
  fireEvent.click(screen.getByRole("button", { name: "Delete branch" }));
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(target.ref);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Branch is not merged",
  );
});
it("prevents deletion of the checked out branch", () => {
  render(
    <BranchContextMenu
      target={target}
      checkedOut="feature"
      onClose={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem"));
  expect(screen.queryByRole("dialog")).toBeNull();
});
