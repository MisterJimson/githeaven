import { useEffect, useRef, useState } from "react";
import { call } from "./api";
import type { Selection, Versions } from "./types";

export const isImagePath = (path: string) =>
  /\.(png|jpe?g|gif|webp|svg|avif|bmp|ico)$/i.test(path);

async function decode(url: string | null) {
  if (!url) return;
  const image = new Image();
  image.src = url;
  await image.decode();
}

export function ImageDiff({
  root,
  selection,
  refresh,
  split,
  deferRefresh = false,
  onTiming,
}: {
  root: string;
  selection: Selection;
  refresh: number;
  split: boolean;
  deferRefresh?: boolean;
  onTiming: (ms: number) => void;
}) {
  const [data, setData] = useState<Versions | null>(null);
  const [error, setError] = useState("");
  const timing = useRef(onTiming);
  timing.current = onTiming;
  const { path, source, oid, parent, oldPath } = selection;
  useEffect(() => {
    if (deferRefresh) return;
    let cancelled = false;
    const start = performance.now();
    setError("");
    void call<Versions>("file_versions", {
      root,
      path,
      source,
      oid: oid ?? null,
      parent: parent ?? null,
      oldPath: oldPath ?? null,
    })
      .then(async (next) => {
        if (cancelled) return;
        await Promise.all([decode(next.old), decode(next.new)]);
        if (cancelled) return;
        setData(next);
        timing.current(performance.now() - start);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [root, path, source, oid, parent, oldPath, refresh, deferRefresh]);
  return (
    <div className="image-diff" tabIndex={0} aria-label="Image diff viewer">
      {error && (
        <div role="status">
          Image preview unavailable. {error}
          {data && " Showing the last comparison."}
        </div>
      )}
      {!data && !error && (
        <div className="empty">Loading image comparison…</div>
      )}
      {data && (
        <div className={`image-comparison ${split ? "split" : "unified"}`}>
          {(["old", "new"] as const).map((side) => (
            <section key={side}>
              <h3>{side === "old" ? "Before" : "After"}</h3>
              <div className="image-preview">
                {data[side] ? (
                  <img
                    src={data[side]}
                    alt={side === "old" ? "Before version" : "After version"}
                  />
                ) : (
                  <p>
                    {side === "old"
                      ? "File added — no previous image"
                      : "File deleted — no new image"}
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
