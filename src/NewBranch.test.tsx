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
  fireEvent.submit(screen.getByRole("dialog"));
  await screen.findByRole("alert");
  expect(close).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole("dialog"));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(create).toHaveBeenCalledWith("feature/test");
});
