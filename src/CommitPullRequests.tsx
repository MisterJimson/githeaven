import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
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
    <>
      {pulls.map((pr) => (
        <button
          className="text-button"
          key={pr.url}
          onClick={() => {
            setError("");
            void call("open_pull_request", { url: pr.url }).catch((reason) =>
              setError(String(reason)),
            );
          }}
        >
          <ExternalLink size={13} /> Open PR #{pr.number} on GitHub
        </button>
      ))}
      {error && <small role="status">{error}</small>}
    </>
  );
}
