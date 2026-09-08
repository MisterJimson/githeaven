import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, GitCommitHorizontal, Monitor, Cloud, Tag } from "lucide-react";
import { CommitNode } from "./CommitNode";
import { startSpan } from "./performance";
import { layoutGraph, GRAPH_ROW_HEIGHT, GRAPH_ROW_CENTER } from "./graph";
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
  root,
  commits,
  search = "",
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
  root?: string;
  commits: Commit[];
  search?: string;
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
  const [widths, setWidths] = useState<Partial<Record<Column, number>>>(() => {
    const saved: Partial<Record<Column, number>> = {};
    for (const column of ["branch", "graph"] as const) {
      try {
        const value = Number(
          localStorage.getItem(`githeaven.column.${column}`),
        );
        if (Number.isFinite(value) && value > 0)
          saved[column] = clampColumn(column, value);
      } catch {
        /* Optional preference. */
      }
    }
    return saved;
  });
  function resizeColumn(column: Column, value: number | null, persist = true) {
    const next = value === null ? undefined : clampColumn(column, value);
    setWidths((current) => ({ ...current, [column]: next }));
    if (persist) {
      try {
        if (next === undefined)
          localStorage.removeItem(`githeaven.column.${column}`);
        else localStorage.setItem(`githeaven.column.${column}`, String(next));
      } catch {
        /* Optional preference. */
      }
    }
  }
  const scroll = useRef<HTMLDivElement>(null);
  const headingScroll = useRef<HTMLDivElement>(null);
  const hasWorkingChanges = workingCount > 0;
  const query = search.trim().toLowerCase();
  // A presentation-only child of HEAD, never a real commit or Git command input.
  const entries = useMemo<Commit[]>(
    () =>
      hasWorkingChanges
        ? [
            {
              oid: "worktree",
              parents: head ? [head] : [],
              subject: "Working changes",
              author: "",
              timestamp: 0,
            },
            ...commits,
          ]
        : commits,
    [commits, head, hasWorkingChanges],
  );
  const graph = useMemo(() => {
    const finish = startSpan("history.layout");
    try {
      const rows = layoutGraph(entries);
      finish();
      return rows;
    } catch (error) {
      finish("error");
      throw error;
    }
  }, [entries]);
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
  const branchWidth = widths.branch ?? 160;
  const graphWidth = widths.graph ?? Math.min(280, lanes * 16 + 30);
  const columns = `${branchWidth}px ${graphWidth}px minmax(180px, 1fr)`;
  const minWidth = branchWidth + graphWidth + 180 + 10;
  const virtual = useVirtualizer({
    count: entries.length,
    getItemKey: (index) => entries[index].oid,
    getScrollElement: () => scroll.current,
    estimateSize: () => GRAPH_ROW_HEIGHT,
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
          <span>
            BRANCH / TAG
            <ColumnDivider
              column="branch"
              width={branchWidth}
              onResize={(value, persist) =>
                resizeColumn("branch", value, persist)
              }
            />
          </span>
          <span>
            GRAPH
            <ColumnDivider
              column="graph"
              width={graphWidth}
              onResize={(value, persist) =>
                resizeColumn("graph", value, persist)
              }
            />
          </span>
          <span>COMMIT MESSAGE</span>
        </div>
      </div>
      <div
        className="history-scroll"
        ref={scroll}
        role="listbox"
        aria-label="Commit history"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            !active ||
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey ||
            (event.key !== "ArrowUp" && event.key !== "ArrowDown") ||
            !entries.length
          )
            return;
          event.preventDefault();
          const current =
            workingSelected && hasWorkingChanges
              ? 0
              : entries.findIndex((commit) => commit.oid === selected);
          const next =
            current < 0
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    entries.length - 1,
                    current + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
          // Keep keyboard focus stable when the previous row is virtualized away.
          event.currentTarget.focus({ preventScroll: true });
          virtual.scrollToIndex(next, { align: "auto" });
          if (next === current) return;
          if (hasWorkingChanges && next === 0) onSelectWorking();
          else onSelect(entries[next]);
        }}
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
            const isWorking = hasWorkingChanges && item.index === 0;
            const dimmed =
              !isWorking &&
              !!query &&
              !`${commit.subject} ${commit.author} ${commit.oid}`
                .toLowerCase()
                .includes(query);
            const commitRefs = refMap.get(commit.oid) ?? [];
            const checkedOut =
              commitRefs.some(
                (ref) => ref.kind === "local" && ref.name === branch,
              ) && commit.oid === head;
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
                    if (isWorking) onSelectWorking();
                    else onSelect(commit);
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
                className={`commit-row ${isWorking ? "ghost-commit" : ""} ${isSelected ? "selected" : ""} ${dimmed ? "search-dimmed" : ""}`}
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
                  {commitRefs.length > 0 && (
                    <span
                      aria-hidden="true"
                      className={`ref-connector ${checkedOut ? "checked-out" : ""}`}
                      style={{ background: rowColor }}
                    />
                  )}
                </span>
                <svg
                  width={graphWidth}
                  height={GRAPH_ROW_HEIGHT}
                  aria-label={isWorking ? "Working changes" : undefined}
                  className="graph-svg"
                >
                  {commitRefs.length > 0 && (
                    <path
                      d={`M 0 ${GRAPH_ROW_CENTER} H ${22 + row.lane * 16}`}
                      stroke={rowColor}
                      opacity={checkedOut ? 1 : 0.6}
                      strokeWidth={checkedOut ? 3 : 1.4}
                    />
                  )}
                  {row.above.map((e, i) => (
                    <path
                      key={`a${i}`}
                      d={`M ${22 + e.from * 16} 0 L ${22 + e.to * 16} ${GRAPH_ROW_CENTER}`}
                      stroke={colors[e.color]}
                      strokeDasharray={
                        hasWorkingChanges &&
                        head &&
                        item.index <= ghostEnd &&
                        e.from === 0
                          ? "3 3"
                          : undefined
                      }
                    />
                  ))}
                  {row.below.map((e, i) => (
                    <path
                      key={`b${i}`}
                      d={`M ${22 + e.from * 16} ${GRAPH_ROW_CENTER} C ${22 + e.from * 16} ${GRAPH_ROW_HEIGHT * 0.78}, ${22 + e.to * 16} ${GRAPH_ROW_HEIGHT * 0.73}, ${22 + e.to * 16} ${GRAPH_ROW_HEIGHT}`}
                      stroke={colors[e.color]}
                      strokeDasharray={
                        hasWorkingChanges &&
                        head &&
                        item.index < ghostEnd &&
                        e.from === 0
                          ? "3 3"
                          : undefined
                      }
                    />
                  ))}
                  {isWorking ? (
                    <circle
                      cx={22 + row.lane * 16}
                      cy={GRAPH_ROW_CENTER}
                      r={5}
                      fill="var(--canvas)"
                      stroke={rowColor}
                      strokeWidth={2}
                      strokeDasharray="2 2"
                    />
                  ) : (
                    <CommitNode
                      root={root}
                      commit={commit}
                      x={22 + row.lane * 16}
                      color={rowColor}
                    />
                  )}
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

type Column = "branch" | "graph";
const columnLimits = { branch: [100, 600], graph: [60, 800] } as const;
function clampColumn(column: Column, width: number) {
  const [min, max] = columnLimits[column];
  return Math.round(Math.max(min, Math.min(max, width)));
}
function ColumnDivider({
  column,
  width,
  onResize,
}: {
  column: Column;
  width: number;
  onResize: (width: number | null, persist?: boolean) => void;
}) {
  const drag = useRef<{ x: number; width: number; pointer: number } | null>(
    null,
  );
  const [min, max] = columnLimits[column];
  return (
    <span
      className="column-divider"
      role="separator"
      aria-label={`Resize ${column === "branch" ? "branch / tag" : "graph"} column`}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        drag.current = { x: event.clientX, width, pointer: event.pointerId };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current && drag.current.pointer === event.pointerId)
          onResize(drag.current.width + event.clientX - drag.current.x, false);
      }}
      onPointerUp={(event) => {
        if (!drag.current || drag.current.pointer !== event.pointerId) return;
        onResize(drag.current.width + event.clientX - drag.current.x);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        if (drag.current) onResize(drag.current.width, false);
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => onResize(null)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 50 : 10;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onResize(width + (event.key === "ArrowRight" ? step : -step));
        } else if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          onResize(event.key === "Home" ? min : max);
        }
      }}
    />
  );
}
