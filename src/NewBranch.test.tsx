// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NewBranch } from "./NewBranch";
afterEach(cleanup);
it("creates and switches on Enter and keeps errors available for correction", async () => {
  const create = vi
    .fn()
    .mockRejectedValueOnce(new Error("Branch already exists"))
    .mockResolvedValueOnce(undefined);
  const close = vi.fn();
  render(<NewBranch branch="main" onCreate={create} onClose={close} />);
  fireEvent.change(screen.getByLabelText("Branch name"), {
    target: { value: "feature/test" },
  });
  fireEvent.keyDown(screen.getByLabelText("Branch name"), { key: "Enter" });
  await screen.findByRole("alert");
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("button", { name: "Cancel" }), {
    key: "Enter",
  });
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith("feature/test");
});
