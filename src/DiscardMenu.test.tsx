// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiscardMenu } from "./DiscardMenu";

afterEach(cleanup);

it("focuses the discard action when the confirmation opens", async () => {
  const onDiscard = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <DiscardMenu
      paths={["first.ts", "second.ts"]}
      x={10}
      y={10}
      disabled={false}
      onDiscard={onDiscard}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: /Discard changes/ }));
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Discard changes" }),
  );
  fireEvent.click(document.activeElement!);
  await waitFor(() =>
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith([
      "first.ts",
      "second.ts",
    ]),
  );
  expect(onClose).toHaveBeenCalledOnce();
});

it("respects focus on Cancel instead of redirecting Enter to discard", () => {
  const onDiscard = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  render(
    <DiscardMenu
      paths={["first.ts"]}
      x={10}
      y={10}
      disabled={false}
      onDiscard={onDiscard}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: /Discard changes/ }));
  const cancel = screen.getByRole("button", { name: "Cancel" });
  cancel.focus();
  expect(fireEvent.keyDown(cancel, { key: "Enter" })).toBe(true);
  expect(onDiscard).not.toHaveBeenCalled();
  fireEvent.click(cancel);
  expect(onClose).toHaveBeenCalledOnce();
  expect(onDiscard).not.toHaveBeenCalled();
});
