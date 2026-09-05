import { memo, useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, GitCommitHorizontal, Monitor, Cloud, Tag } from "lucide-react";
import { layoutGraph } from "./graph";
import type { Commit, Reference } from "./types";
const colors = [
  "#8dd9bb",
  "#ac9bef",
  "#e5b574",
  "#72b9e9",
  "#e58eac",
  "#b4c77b",
];
export const History = memo(function History({
  commits,
  refs,
  selected,
  onSelect,
  head,
  branch,
  workingCount,
  workingSelected,
  onSelectWorking,
  onSelectRef,
  onCheckoutRef,
  active = true,
  hasMore = false,
  onLoadMore,
}: {
  commits: Commit[];
  refs: Reference[];
  selected?: string;
  onSelect: (commit: Commit) => void;
  head: string | null;
  branch: string;
  workingCount: number;
  workingSelected: boolean;
  onSelectWorking: () => void;
  onSelectRef?: (ref: Reference) => void;
  onCheckoutRef?: (ref: Reference) => void;
  active?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
}) {
  const scroll = useRef<HTMLDivElement>(null);
  const headingScroll = useRef<HTMLDivElement>(null);
  // A presentation-only child of HEAD, never a real commit or Git command input.
  const entries = useMemo<Commit[]>(
    () => [
      {
        oid: "worktree",
        parents: head ? [head] : [],
        subject: "Working changes",
        author: "",
        timestamp: 0,
      },
      ...commits,
    ],
    [commits, head],
  );
  const graph = useMemo(() => layoutGraph(entries), [entries]);
  const headIndex = entries.findIndex((commit) => commit.oid === head);
  const ghostEnd = headIndex < 0 ? entries.length : headIndex;
  const refMap = useMemo(() => {
    const m = new Map<string, Reference[]>();
    for (const r of refs) m.set(r.oid, [...(m.get(r.oid) ?? []), r]);
    return m;
  }, [refs]);
  const lanes = graph.reduce(
    (max, row) =>
      row.below.reduce(
        (width, edge) => Math.max(width, edge.to + 1),
        Math.max(max, row.lane + 1),
      ),
    3,
  );
  const graphWidth = Math.min(280, lanes * 16 + 30);
  const columns = `160px ${graphWidth}px minmax(180px, 1fr)`;
  const minWidth = 160 + graphWidth + 180 + 10;
  const virtual = useVirtualizer({
    count: entries.length,
    getItemKey: (index) => entries[index].oid,
    getScrollElement: () => scroll.current,
    estimateSize: () => 37,
    overscan: 10,
    initialRect: { width: 800, height: 600 },
  });
  function loadNearEnd() {
    const viewport = scroll.current;
    if (
      active &&
      hasMore &&
      viewport &&
      viewport.clientHeight > 0 &&
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 740
    )
      onLoadMore?.();
  }
  useEffect(() => {
    loadNearEnd();
  }, [commits.length, active, hasMore, onLoadMore]);
  return (
    <div className="history-table">
      <div className="history-heading-viewport" ref={headingScroll}>
        <div
          className="history-columns"
          style={{
            gridTemplateColumns: columns,
            minWidth,
          }}
        >
          <span>BRANCH / TAG</span>
          <span>GRAPH</span>
          <span>COMMIT MESSAGE</span>
        </div>
      </div>
      <div
        className="history-scroll"
        ref={scroll}
        role="listbox"
        aria-label="Commit history"
        onScroll={(event) => {
          if (headingScroll.current)
            headingScroll.current.scrollLeft = event.currentTarget.scrollLeft;
          loadNearEnd();
        }}
      >
        <div
          style={{
            height: virtual.getTotalSize(),
            position: "relative",
            minWidth,
          }}
        >
          {virtual.getVirtualItems().map((item) => {
            const commit = entries[item.index];
            const row = graph[item.index];
            const isWorking = item.index === 0;
            const commitRefs = refMap.get(commit.oid) ?? [];
            const rowColor = colors[row.color];
            const isSelected = isWorking
              ? workingSelected
              : selected === commit.oid;
            return (
              <div
                tabIndex={0}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === "Enter" || event.key === " ")
                  ) {
                    event.preventDefault();
                    isWorking ? onSelectWorking() : onSelect(commit);
                  }
                }}
                key={commit.oid}
                role="option"
                aria-selected={isSelected}
                aria-label={
                  isWorking
                    ? `Working changes, ${workingCount} changed ${workingCount === 1 ? "file" : "files"}`
                    : undefined
                }
                className={`commit-row ${isWorking ? "ghost-commit" : ""} ${isSelected ? "selected" : ""}`}
                onClick={() =>
                  isWorking ? onSelectWorking() : onSelect(commit)
                }
                style={{
                  position: "absolute",
                  top: item.start,
                  height: item.size,
                  gridTemplateColumns: columns,
                }}
              >
                <span
                  className="commit-refs"
                  title={commitRefs.map((ref) => ref.name).join("\n")}
                >
                  {commitRefs.slice(0, 2).map((ref) => (
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectRef?.(ref);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        if (ref.kind !== "tag") onCheckoutRef?.(ref);
                      }}
                      aria-label={`${ref.kind} ${ref.name}`}
                      key={ref.kind + ref.name}
                      className={`ref-badge ${ref.kind}`}
                      title={`${ref.name} · ${ref.kind}${ref.kind !== "tag" ? " · Double-click to check out" : ""}`}
                      style={{
                        color: rowColor,
                        borderColor: `${rowColor}66`,
                        background: `${rowColor}20`,
                      }}
                    >
                      {ref.kind === "local" && ref.name === branch && (
                        <Check size={10} />
                      )}
                      <span>{ref.name}</span>
                      {ref.kind === "local" ? (
                        <Monitor size={12} />
                      ) : ref.kind === "remote" ? (
                        <Cloud size={12} />
                      ) : (
                        <Tag size={12} />
                      )}
                    </button>
                  ))}
                  {commitRefs.length > 2 && (
                    <span className="more-refs">+{commitRefs.length - 2}</span>
                  )}
                </span>
                <svg
                  width={graphWidth}
                  height="37"
                  aria-hidden="true"
                  className="graph-svg"
                >
                  {commitRefs.length > 0 && (
                    <path
                      d={`M 0 18.5 H ${22 + row.lane * 16}`}
                      stroke={rowColor}
                      opacity="0.6"
                    />
                  )}
                  {row.above.map((e, i) => (
                    <path
                      key={`a${i}`}
                      d={`M ${22 + e.from * 16} 0 L ${22 + e.to * 16} 18.5`}
                      stroke={colors[e.color]}
                      strokeDasharray={
                        head && item.index <= ghostEnd && e.from === 0
                          ? "3 3"
                          : undefined
                      }
                    />
                  ))}
                  {row.below.map((e, i) => (
                    <path
                      key={`b${i}`}
                      d={`M ${22 + e.from * 16} 18.5 C ${22 + e.from * 16} 29, ${22 + e.to * 16} 27, ${22 + e.to * 16} 37`}
                      stroke={colors[e.color]}
                      strokeDasharray={
                        head && item.index < ghostEnd && e.from === 0
                          ? "3 3"
                          : undefined
                      }
                    />
                  ))}
                  <circle
                    cx={22 + row.lane * 16}
                    cy="18.5"
                    r={isWorking ? 5 : commit.parents.length > 1 ? 4.5 : 3.5}
                    fill={
                      isWorking || commit.parents.length > 1
                        ? "#161a1d"
                        : colors[row.color]
                    }
                    stroke={colors[row.color]}
                    strokeWidth="2"
                    strokeDasharray={isWorking ? "2 2" : undefined}
                  />
                </svg>
                <span className="commit-subject">
                  {isWorking && <span className="wip-badge">// WIP</span>}
                  <span title={commit.subject}>{commit.subject}</span>
                  {isWorking && (
                    <span className="ghost-count">
                      {workingCount} {workingCount === 1 ? "file" : "files"}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
        {!commits.length && (
          <div className="empty">
            <GitCommitHorizontal size={26} />
            <p>No commits to show</p>
            <small>Try a different filter, or make your first commit.</small>
          </div>
        )}
      </div>
    </div>
  );
});
