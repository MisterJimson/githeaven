import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { FilePlus2, FileMinus2, Pencil, MoveRight } from "lucide-react";
import type { Change } from "./types";

export function ChangePaths({
  paths,
  changes,
  staged,
  selected,
  onSelect,
  revealPath,
}: {
  paths: string[];
  changes: Change[];
  staged: boolean;
  selected?: string;
  revealPath?: string;
  onSelect: (path: string) => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const statuses = useMemo(
    () =>
      new Map(
        changes.map((change) => [
          change.path,
          staged ? change.index : change.worktree,
        ]),
      ),
    [changes, staged],
  );
  const virtual = useVirtualizer({
    count: paths.length,
    getItemKey: (index) => paths[index],
    getScrollElement: () => scroll.current,
    estimateSize: () => 28,
    overscan: 6,
    initialRect: { width: 330, height: 280 },
  });
  useEffect(() => {
    if (!revealPath) return;
    const index = paths.indexOf(revealPath);
    if (index >= 0) virtual.scrollToIndex(index, { align: "auto" });
  }, [revealPath, paths, virtual]);
  return (
    <div
      ref={scroll}
      className="change-path-list"
      aria-label={`${staged ? "Staged" : "Unstaged"} file paths`}
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((item) => {
          const path = paths[item.index];
          const status = statuses.get(path);
          const Icon =
            status === "A" || status === "?"
              ? FilePlus2
              : status === "D"
                ? FileMinus2
                : status === "R"
                  ? MoveRight
                  : Pencil;
          return (
            <button
              key={path}
              className="change-path-row"
              aria-label={path}
              title={path}
              aria-pressed={selected === path}
              data-status={status}
              onClick={() => onSelect(path)}
              style={{
                position: "absolute",
                top: item.start,
                height: item.size,
                width: "100%",
              }}
            >
              <Icon size={12} aria-hidden="true" />
              <span>{path}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
