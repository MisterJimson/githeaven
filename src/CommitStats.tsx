export function CommitStats({
  additions,
  deletions,
}: {
  additions?: number;
  deletions?: number;
}) {
  const ready = additions !== undefined && deletions !== undefined;
  const total = (additions ?? 0) + (deletions ?? 0);
  const green = total ? Math.round((5 * (additions ?? 0)) / total) : 0;
  return (
    <span
      className="commit-stats"
      aria-label={
        ready
          ? `${additions} lines added, ${deletions} lines removed`
          : "Loading change counts"
      }
      style={{ visibility: ready ? "visible" : "hidden" }}
    >
      <span className="added">+{additions?.toLocaleString()}</span>
      <span className="removed">−{deletions?.toLocaleString()}</span>
      <span className="change-blocks" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <i
            key={i}
            className={
              total === 0 ? "neutral" : i < green ? "added" : "removed"
            }
          />
        ))}
      </span>
    </span>
  );
}
