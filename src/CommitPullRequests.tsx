import { useEffect, useState } from "react";
import { GitPullRequest, ExternalLink } from "lucide-react";
import { call } from "./api";
type PullRequest = { number: number; url: string };
const cache = new Map<
  string,
  { expires: number; result: Promise<PullRequest[]> }
>();
export function CommitPullRequests({
  root,
  oid,
  active,
}: {
  root: string;
  oid: string;
  active: boolean;
}) {
  const [pulls, setPulls] = useState<PullRequest[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!active) return;
    let live = true;
    const load = () => {
      const key = JSON.stringify([root, oid]);
      let entry = cache.get(key);
      if (!entry || entry.expires < Date.now()) {
        entry = {
          expires: Date.now() + 60_000,
          result: call<PullRequest[]>("commit_pull_requests", {
            root,
            oid,
          }).catch(() => []),
        };
        cache.set(key, entry);
        if (cache.size > 128) cache.delete(cache.keys().next().value!);
      }
      void entry.result.then((value) => {
        if (live) setPulls(value);
      });
    };
    const timer = setTimeout(load, 150);
    const interval = setInterval(load, 60_000);
    return () => {
      live = false;
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [root, oid, active]);
  return (
    <div className="commit-pr-actions">
      {pulls.map((pr) => (
        <button
          className="commit-pr-button"
          aria-label={`Open PR #${pr.number} on GitHub`}
          title={`Open PR #${pr.number} on GitHub`}
          key={pr.url}
          onClick={() => {
            setError("");
            void call("open_pull_request", { url: pr.url }).catch((reason) =>
              setError(String(reason)),
            );
          }}
        >
          <GitPullRequest size={13} /> #{pr.number} <ExternalLink size={11} />
        </button>
      ))}
      {error && <small role="status">{error}</small>}
    </div>
  );
}
