import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { Reference } from "./types";
export function BranchContextMenu({
  target,
  checkedOut,
  onClose,
  onDelete,
}: {
  target: { ref: Reference; x: number; y: number };
  checkedOut: string;
  onClose: () => void;
  onDelete: (ref: Reference) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = target.ref.kind === "local" && target.ref.name === checkedOut;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", escape, true);
    return () => document.removeEventListener("keydown", escape, true);
  }, [busy, onClose]);
  return createPortal(
    confirm ? (
      <div className="modal-backdrop">
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-branch-title"
        >
          <h2 id="delete-branch-title">Delete {target.ref.kind} branch?</h2>
          <p>
            <strong>{target.ref.name}</strong>
          </p>
          <p>
            {target.ref.kind === "remote"
              ? "This deletes the branch on the remote server for everyone using it."
              : "This removes the local branch. Git will refuse deletion if it contains unmerged work or is checked out in a worktree."}
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button autoFocus disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="delete-branch-action"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void onDelete(target.ref).then(onClose, (reason) => {
                  setError(String(reason));
                  setBusy(false);
                });
              }}
            >
              {busy ? "Deleting…" : "Delete branch"}
            </button>
          </div>
        </div>
      </div>
    ) : (
      <div
        className="branch-menu-backdrop"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      >
        <div
          className="branch-context-menu"
          role="menu"
          aria-label="Branch actions"
          style={{
            left: Math.max(0, Math.min(target.x, window.innerWidth - 230)),
            top: Math.max(0, Math.min(target.y, window.innerHeight - 52)),
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <button
            autoFocus
            role="menuitem"
            aria-disabled={current}
            title={
              current
                ? "Switch branches before deleting this branch"
                : undefined
            }
            onClick={() => {
              if (!current) setConfirm(true);
            }}
          >
            <Trash2 size={14} /> Delete branch
          </button>
        </div>
      </div>
    ),
    document.body,
  );
}
