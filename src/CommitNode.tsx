import { useEffect, useState } from "react";
import { GRAPH_ROW_CENTER } from "./graph";
import { call } from "./api";
import type { Commit } from "./types";
type Avatar = { login: string; url: string };
const cache = new Map<string, Promise<Avatar | null>>();
const authors = new Map<string, Avatar>();
let running = 0;
const queue: (() => void)[] = [];
function lookup(root: string, commit: Commit) {
  const authorKey = JSON.stringify([root, commit.author_email || commit.oid]);
  const key = JSON.stringify([root, commit.oid]);
  const known = authors.get(authorKey);
  if (known) return Promise.resolve(known);
  if (queue.length >= 64) return Promise.resolve(null);
  let result = cache.get(key);
  if (!result) {
    result = new Promise<Avatar | null>((resolve) => {
      const run = () => {
        const known = authors.get(authorKey);
        if (known) {
          resolve(known);
          queue.shift()?.();
          return;
        }
        running++;
        void call<Avatar | null>("commit_avatar", { root, oid: commit.oid })
          .then(
            (value) => {
              if (value) {
                authors.set(authorKey, value);
                if (authors.size > 512)
                  authors.delete(authors.keys().next().value!);
              }
              resolve(value);
            },
            () => resolve(null),
          )
          .finally(() => {
            running--;
            queue.shift()?.();
          });
      };
      if (running < 2) run();
      else queue.push(run);
    });
    cache.set(key, result);
    if (cache.size > 512) cache.delete(cache.keys().next().value!);
  }
  return result;
}
export function authorDetails(commit: Commit, login?: string) {
  return [
    `${commit.author}${commit.author_email ? ` <${commit.author_email}>` : ""}${login ? ` (@${login})` : ""}`,
    ...(commit.coauthors ?? []).map((author) => `Co-author: ${author}`),
    new Date(commit.timestamp * 1000).toLocaleString(),
    commit.oid.slice(0, 12),
  ].join("\n");
}
function useCommitAvatar(root: string | undefined, commit: Commit) {
  const identity = JSON.stringify([root, commit.oid, commit.author_email]);
  const known = root
    ? (authors.get(JSON.stringify([root, commit.author_email || commit.oid])) ??
      null)
    : null;
  const [resolved, setResolved] = useState<{
    identity: string;
    avatar: Avatar | null;
  } | null>(null);
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null);
  const avatar =
    known ?? (resolved?.identity === identity ? resolved.avatar : null);
  useEffect(() => {
    if (!root || known) return;
    let active = true;
    // Delay only uncached identity lookups; cached avatars render synchronously.
    const timer = setTimeout(() => {
      void lookup(root, commit).then((value) => {
        if (active) setResolved({ identity, avatar: value });
      });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [root, commit.oid, commit.author_email, identity, known]);
  return {
    avatar,
    failed: failedIdentity === identity,
    setFailed: (failed: boolean) => setFailedIdentity(failed ? identity : null),
  };
}

export function CommitAvatar({
  root,
  commit,
}: {
  root?: string;
  commit: Commit;
}) {
  const { avatar, failed, setFailed } = useCommitAvatar(root, commit);
  const title = authorDetails(commit, avatar?.login);
  return (
    <div className="commit-avatar" role="img" aria-label={title} title={title}>
      {avatar && !failed ? (
        <img src={avatar.url} alt="" onError={() => setFailed(true)} />
      ) : (
        commit.author.slice(0, 2).toUpperCase()
      )}
    </div>
  );
}

export function CommitNode({
  root,
  commit,
  x,
  color,
}: {
  root?: string;
  commit: Commit;
  x: number;
  color: string;
}) {
  const { avatar, failed, setFailed } = useCommitAvatar(root, commit);
  const show = avatar && !failed;
  const title = authorDetails(commit, avatar?.login);
  return (
    <g role="img" aria-label={title}>
      <title>{title}</title>
      <circle
        cx={x}
        cy={GRAPH_ROW_CENTER}
        r={9}
        fill={commit.parents.length > 1 ? "#161a1d" : color}
        stroke={color}
        strokeWidth={2}
      />
      {show && (
        <image
          href={avatar.url}
          x={x - 8}
          y={GRAPH_ROW_CENTER - 8}
          width={16}
          height={16}
          style={{ clipPath: "circle(50%)" }}
          onError={() => setFailed(true)}
        />
      )}
      <circle
        cx={x}
        cy={GRAPH_ROW_CENTER}
        r={11}
        fill="transparent"
        stroke="none"
      />
    </g>
  );
}
