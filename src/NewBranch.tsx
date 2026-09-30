import { useState } from "react";

export function NewBranch({
  branch,
  onCreate,
  onClose,
}: {
  branch: string;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !busy) onClose();
      }}
    >
      <form
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-branch-title"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !name.trim()) return;
          setBusy(true);
          setError("");
          try {
            await onCreate(name.trim());
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
      >
        <h2 id="new-branch-title">New branch</h2>
        <p>
          Start from <strong>{branch || "HEAD"}</strong> and switch to your new
          branch. Any staged and uncommitted changes come with you.
        </p>
        <label>
          Branch name
          <input
            autoFocus
            aria-label="Branch name"
            placeholder="feature/my-change"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary-button"
            disabled={busy || !name.trim()}
          >
            {busy ? "Creating…" : "Create and switch"}
          </button>
        </div>
      </form>
    </div>
  );
}
