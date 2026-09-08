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
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(target.ref, false);
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
  expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(
    true,
  );
  expect(
    (screen.getByRole("button", { name: "Delete branch" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("allows local or remote selection and force retries only the unmerged local copy", async () => {
  const remote = {
    name: "origin/feature",
    kind: "remote" as const,
    oid: "remote",
  };
  const onDelete = vi
    .fn()
    .mockRejectedValueOnce("error: branch is not fully merged")
    .mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <BranchContextMenu
      target={target}
      refs={[target.ref, remote]}
      checkedOut="main"
      onClose={onClose}
      onDelete={onDelete}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem"));
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes[0].checked).toBe(true);
  expect(boxes[1].checked).toBe(false);
  fireEvent.click(boxes[1]);
  fireEvent.click(
    screen.getByRole("button", { name: "Delete selected copies" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Delete anyway" }));
  await screen.findAllByText("Deleted");
  expect(onDelete.mock.calls).toEqual([
    [target.ref, false],
    [target.ref, true],
    [remote, false],
  ]);
});
it("matches renamed local branches by configured upstream", () => {
  const local = {
    name: "my-feature",
    kind: "local" as const,
    oid: "local",
    upstream: "origin/feature",
  };
  const remote = {
    name: "origin/feature",
    kind: "remote" as const,
    oid: "remote",
  };
  render(
    <BranchContextMenu
      target={{ ...target, ref: remote }}
      refs={[local, remote]}
      checkedOut="main"
      onClose={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem"));
  expect(screen.getByText("my-feature")).toBeTruthy();
  const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
  expect(boxes[0].checked).toBe(false);
  expect(boxes[1].checked).toBe(true);
});

it("does not repeat a successful local deletion when a remote retry is needed", async () => {
  const remote = {
    name: "origin/feature",
    kind: "remote" as const,
    oid: "remote",
  };
  const onDelete = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce("Remote unavailable")
    .mockResolvedValue(undefined);
  render(
    <BranchContextMenu
      target={target}
      refs={[target.ref, remote]}
      checkedOut="main"
      onClose={vi.fn()}
      onDelete={onDelete}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem"));
  fireEvent.click(screen.getAllByRole("checkbox")[1]);
  fireEvent.click(
    screen.getByRole("button", { name: "Delete selected copies" }),
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Remote unavailable",
  );
  expect(
    (screen.getAllByRole("checkbox")[0] as HTMLInputElement).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Delete branch" }));
  expect(onDelete.mock.calls).toEqual([
    [target.ref, false],
    [remote, false],
    [remote, false],
  ]);
});
