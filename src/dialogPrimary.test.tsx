// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { activateDialogPrimary } from "./dialogPrimary";

afterEach(cleanup);

it("preserves multiline typing, select controls, and modified Enter", () => {
  const action = vi.fn();
  render(
    <div role="dialog" onKeyDownCapture={activateDialogPrimary}>
      <textarea aria-label="Description" />
      <select aria-label="Remote">
        <option>origin</option>
      </select>
      <button data-dialog-primary onClick={action}>
        Confirm
      </button>
    </div>,
  );
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  fireEvent.keyDown(screen.getByRole("button"), {
    key: "Enter",
    metaKey: true,
  });
  expect(action).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
  expect(action).toHaveBeenCalledOnce();
});
