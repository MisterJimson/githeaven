import type { KeyboardEvent } from "react";

/** Activate the default action even when another dialog button has focus. */
export function activateDialogPrimary(event: KeyboardEvent<HTMLElement>) {
  if (
    event.key !== "Enter" ||
    event.nativeEvent.isComposing ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  )
    return;

  const target = event.target;
  if (
    target instanceof HTMLElement &&
    (target.matches("textarea, select") || target.isContentEditable)
  )
    return;

  const primary = event.currentTarget.querySelector<HTMLButtonElement>(
    "button[data-dialog-primary]",
  );
  if (!primary) return;

  event.preventDefault();
  event.stopPropagation();
  if (!event.repeat && !primary.disabled) primary.click();
}
