import { useState } from "react";
import { createPortal } from "react-dom";
export function DiscardMenu({
  paths,
  x,
  y,
  disabled,
  onDiscard,
  onClose,
}: {
  paths: string[];
  x: number;
  y: number;
  disabled: boolean;
  onDiscard: (paths: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return createPortal(
    <div
      className={
        confirm ? "modal-backdrop discard-backdrop" : "branch-menu-backdrop"
      }
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      {confirm ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="discard-title"
        >
          <h2 id="discard-title">
            Discard changes to{" "}
            {paths.length === 1 ? "this file" : `${paths.length} files`}?
          </h2>
          <p>
            Restore these files to the current commit, removing both staged and
            unstaged changes. Newly added files will be deleted. This cannot be
            undone.
          </p>
          <ul className="discard-paths">
            {paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button autoFocus disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="delete-branch-action"
              disabled={busy || disabled}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await onDiscard(paths);
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                  setBusy(false);
                }
              }}
            >
              {busy ? "Discarding…" : "Discard changes"}
            </button>
          </div>
        </div>
      ) : (
        <div
          className="branch-context-menu"
          role="menu"
          aria-label="File actions"
          style={{
            left: Math.max(0, Math.min(x, window.innerWidth - 230)),
            top: Math.max(0, Math.min(y, window.innerHeight - 52)),
          }}
        >
          <button
            role="menuitem"
            autoFocus
            disabled={disabled}
            onClick={() => setConfirm(true)}
          >
            Discard changes{paths.length > 1 ? ` to ${paths.length} files` : ""}
            …
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
