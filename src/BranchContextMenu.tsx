import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trash2 } from "lucide-react";
import type { Reference } from "./types";
export function BranchContextMenu({
  target,
  checkedOut,
  refs = [],
  onClose,
  onDelete,
}: {
  target: { ref: Reference; x: number; y: number };
  checkedOut: string;
  refs?: Reference[];
  onClose: () => void;
  onDelete: (ref: Reference, force?: boolean) => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = (ref: Reference) => `${ref.kind}:${ref.name}`;
  const [copies] = useState(() => {
    const selected = target.ref;
    const localName =
      selected.kind === "local"
        ? selected.name
        : selected.name.slice(selected.name.indexOf("/") + 1);
    const related = refs.filter((ref) => {
      if (
        ref.kind === "tag" ||
        (ref.kind === "remote" && ref.name.endsWith("/HEAD"))
      )
        return false;
      if (ref.kind === "local")
        return selected.kind === "remote" && ref.upstream
          ? ref.upstream === selected.name
          : ref.name === localName;
      return (
        ref.name === selected.upstream ||
        ref.name.slice(ref.name.indexOf("/") + 1) === localName
      );
    });
    return [
      selected,
      ...related.filter((ref) => id(ref) !== id(selected)),
    ].sort((a, b) => a.kind.localeCompare(b.kind));
  });
  const [selectedIds, setSelectedIds] = useState(
    () =>
      new Set(
        target.ref.kind === "local" && target.ref.name === checkedOut
          ? []
          : [id(target.ref)],
      ),
  );
  const [deleted, setDeleted] = useState<Set<string>>(() => new Set());
  const [unmerged, setUnmerged] = useState<string | null>(null);
  const chosen = copies.filter(
    (ref) => selectedIds.has(id(ref)) && !deleted.has(id(ref)),
  );
  async function remove(force = false) {
    setBusy(true);
    setError("");
    const completed = new Set(deleted);
    for (const ref of chosen) {
      try {
        await onDelete(ref, force && id(ref) === unmerged);
        completed.add(id(ref));
        setDeleted(new Set(completed));
      } catch (reason) {
        const message = String(reason);
        const notMerged =
          ref.kind === "local" && message.includes("not fully merged");
        setUnmerged(notMerged ? id(ref) : null);
        setError(
          notMerged
            ? `${ref.name} contains unmerged commits. Delete anyway removes this branch without merging them.`
            : message,
        );
        setBusy(false);
        return;
      }
    }
    onClose();
  }
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
          <h2 id="delete-branch-title">Delete branch</h2>
          <p>Select the copies to delete.</p>
          <div className="branch-delete-copies">
            {copies.map((ref) => {
              const key = id(ref);
              const current = ref.kind === "local" && ref.name === checkedOut;
              return (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(key)}
                    disabled={busy || current || deleted.has(key)}
                    onChange={(event) => {
                      setSelectedIds((previous) => {
                        const next = new Set(previous);
                        if (event.target.checked) next.add(key);
                        else next.delete(key);
                        return next;
                      });
                      setError("");
                      setUnmerged(null);
                    }}
                  />
                  <span>
                    <strong>{ref.kind === "local" ? "Local" : "Remote"}</strong>
                    <span>{ref.name}</span>
                    <small>
                      {deleted.has(key)
                        ? "Deleted"
                        : current
                          ? "Checked out — switch branches to delete"
                          : ""}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          {!copies.some((ref) => ref.kind === "local") && (
            <p>No local copy found.</p>
          )}
          {!copies.some((ref) => ref.kind === "remote") && (
            <p>No remote copy found in fetched refs.</p>
          )}
          {chosen.some((ref) => ref.kind === "remote") && (
            <p>
              Selected remote branches will be deleted from the server for
              everyone using them.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <button autoFocus disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="delete-branch-action"
              disabled={busy || chosen.length === 0}
              onClick={() => void remove(unmerged !== null)}
            >
              {busy
                ? "Deleting…"
                : unmerged
                  ? "Delete anyway"
                  : chosen.length > 1
                    ? "Delete selected copies"
                    : "Delete branch"}
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
          <button autoFocus role="menuitem" onClick={() => setConfirm(true)}>
            <Trash2 size={14} /> Delete branch
          </button>
        </div>
      </div>
    ),
    document.body,
  );
}
