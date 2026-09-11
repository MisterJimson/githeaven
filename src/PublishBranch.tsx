import { useState } from "react";
export type PublishTarget = { root: string; branch: string; remotes: string[] };
export function PublishBranch({
  target,
  onPublish,
  onClose,
}: {
  target: PublishTarget;
  onPublish: (remote: string, name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [remote, setRemote] = useState(
    target.remotes.includes("origin") ? "origin" : target.remotes[0] || "",
  );
  const [name, setName] = useState(target.branch);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div
      className="modal-backdrop"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" && !busy) onClose();
      }}
    >
      <form
        className="modal publish-branch"
        role="dialog"
        aria-modal="true"
        aria-labelledby="publish-title"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || !remote || !name.trim()) return;
          setBusy(true);
          setError("");
          try {
            await onPublish(remote, name.trim());
            onClose();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setBusy(false);
          }
        }}
      >
        <h2 id="publish-title">Publish branch</h2>
        <p>
          <strong>{target.branch}</strong> has no upstream. Push it to a remote
          branch and track it for future pushes and pulls. Your commit is
          already saved locally.
        </p>
        <label>
          Remote
          <select
            aria-label="Remote"
            value={remote}
            disabled={busy}
            onChange={(e) => setRemote(e.target.value)}
          >
            {target.remotes.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Remote branch name
          <input
            autoFocus
            aria-label="Remote branch name"
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {!remote && (
          <p role="alert">No remotes configured for this repository.</p>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={busy || !remote || !name.trim()}
          >
            {busy ? "Publishing…" : "Publish branch"}
          </button>
        </div>
      </form>
    </div>
  );
}
