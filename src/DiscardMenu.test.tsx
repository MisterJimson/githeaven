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

it("confirms a discard with Enter, even while Cancel is focused", async () => {
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
  const dialog = screen.getByRole("dialog");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Cancel" }),
  );
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  await waitFor(() =>
    expect(onDiscard).toHaveBeenCalledExactlyOnceWith([
      "first.ts",
      "second.ts",
    ]),
  );
  expect(onClose).toHaveBeenCalledOnce();
  expect(dialog).toBeTruthy();
});

it("does not activate a disabled primary action or repeat a held Enter", async () => {
  const onDiscard = vi.fn().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const { rerender } = render(
    <DiscardMenu
      paths={["first.ts"]}
      x={10}
      y={10}
      disabled
      onDiscard={onDiscard}
      onClose={onClose}
    />,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: /Discard changes/ }));
  fireEvent.keyDown(document.activeElement!, { key: "Enter" });
  expect(onDiscard).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  rerender(
    <DiscardMenu
      paths={["first.ts"]}
      x={10}
      y={10}
      disabled={false}
      onDiscard={onDiscard}
      onClose={onClose}
    />,
  );
  fireEvent.keyDown(document.activeElement!, { key: "Enter", repeat: true });
  expect(onDiscard).not.toHaveBeenCalled();
});
