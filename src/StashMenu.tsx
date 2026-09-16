import { useState } from "react";
import { createPortal } from "react-dom";
import type { Stash } from "./types";
export function StashMenu({
  stash,
  x,
  y,
  onAction,
  onClose,
}: {
  stash: Stash;
  x: number;
  y: number;
  onAction: (stash: Stash, action: "apply" | "pop" | "delete") => Promise<void>;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: "apply" | "pop" | "delete") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onAction(stash, action);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return createPortal(
    <div
      className={
        confirm || error
          ? "modal-backdrop discard-backdrop"
          : "branch-menu-backdrop"
      }
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      {confirm || error ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={error ? "Stash operation failed" : "Delete stash?"}
        >
          <h2>{error ? "Stash operation failed" : "Delete stash?"}</h2>
          <p>
            {stash.name}: {stash.message}
          </p>
          <p>
            {error ||
              "This permanently removes the saved stash. Your working files will not change."}
          </p>
          <div className="modal-actions">
            <button autoFocus disabled={busy} onClick={onClose}>
              {error ? "Close" : "Cancel"}
            </button>
            {!error && (
              <button
                className="delete-branch-action"
                disabled={busy}
                onClick={() => void run("delete")}
              >
                {busy ? "Deleting…" : "Delete stash"}
              </button>
            )}
          </div>
        </div>
      ) : (
        <div
          role="menu"
          aria-label="Stash actions"
          className="branch-context-menu"
          style={{
            left: Math.max(0, Math.min(x, window.innerWidth - 230)),
            top: Math.max(0, Math.min(y, window.innerHeight - 130)),
          }}
        >
          <button
            role="menuitem"
            autoFocus
            disabled={busy}
            onClick={() => void run("pop")}
          >
            Pop to working tree
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => void run("apply")}
          >
            Apply to working tree
          </button>
          <button
            role="menuitem"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            Delete stash…
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
