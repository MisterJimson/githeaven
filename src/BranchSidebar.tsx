import { StashMenu } from "./StashMenu";
import { BranchContextMenu } from "./BranchContextMenu";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { Layers, ChevronDown, GitBranch, Check } from "lucide-react";
import type { Reference, Stash } from "./types";

type Row =
  | { type: "header"; key: string; title: string; count: number }
  | { type: "stash"; key: string; stash: Stash }
  | { type: "ref"; key: string; ref: Reference }
  | { type: "empty"; key: string; title: string };

export const BranchSidebar = memo(function BranchSidebar({
  refs,
  stashes = [],
  onStashAction,
  onSelectStash,
  commitCount,
  branch,
  branchFilter,
  onFilter,
  onCheckout,
  onDelete,
  busy = false,
  activeRef,
}: {
  refs: Reference[];
  stashes?: Stash[];
  onSelectStash?: (stash: Stash) => void;
  onStashAction?: (
    stash: Stash,
    action: "apply" | "pop" | "delete",
  ) => Promise<void>;
  commitCount: number;
  branch: string;
  branchFilter: string;
  onFilter: (oid: string) => void;
  onCheckout?: (ref: Reference) => void;
  onDelete?: (ref: Reference, force?: boolean) => Promise<void>;
  busy?: boolean;
  activeRef?: Reference | null;
}) {
  const [context, setContext] = useState<{
    ref: Reference;
    x: number;
    y: number;
  } | null>(null);
  const [stashMenu, setStashMenu] = useState<{
    stash: Stash;
    x: number;
    y: number;
  } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (activeRef) {
      setQuery("");
      setCollapsed((current) => ({ ...current, [activeRef.kind]: false }));
    }
  }, [activeRef]);
  const rows = useMemo(() => {
    const rows: Row[] = [];
    for (const kind of ["local", "remote", "tag"] as const) {
      const group = refs.filter(
        (ref) =>
          ref.kind === kind &&
          ref.name.toLowerCase().includes(query.toLowerCase()),
      );
      rows.push({
        type: "header",
        key: kind,
        count: group.length,
        title:
          kind === "local"
            ? "LOCAL BRANCHES"
            : kind === "remote"
              ? "REMOTES"
              : "TAGS",
      });
      if (collapsed[kind]) continue;
      for (const ref of group)
        rows.push({ type: "ref", key: `${kind}:${ref.name}`, ref });
      if (!group.length)
        rows.push({
          type: "empty",
          key: `${kind}:empty`,
          title: kind === "tag" ? "No tags" : "No branches",
        });
    }
    const visibleStashes = stashes.filter((stash) =>
      `${stash.name} ${stash.message}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
    rows.push({
      type: "header",
      key: "stashes",
      title: "STASHES",
      count: visibleStashes.length,
    });
    if (!collapsed.stashes) {
      for (const stash of visibleStashes)
        rows.push({
          type: "stash",
          key: `stash:${stash.oid}:${stash.name}`,
          stash,
        });
      if (!visibleStashes.length)
        rows.push({ type: "empty", key: "stashes:empty", title: "No stashes" });
    }
    return rows;
  }, [refs, stashes, query, collapsed]);
  const headers = rows.flatMap((row, index) =>
    row.type === "header" ? [index] : [],
  );
  const virtual = useVirtualizer({
    count: rows.length,
    rangeExtractor: (range) =>
      [...new Set([...headers, ...defaultRangeExtractor(range)])].sort(
        (a, b) => a - b,
      ),
    getScrollElement: () => scroll.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => (rows[index].type === "header" ? 26 : 22),
    overscan: 6,
    initialRect: { width: 223, height: 600 },
  });
  useEffect(() => {
    if (!activeRef) return;
    const index = rows.findIndex(
      (row) =>
        row.type === "ref" &&
        row.ref.name === activeRef.name &&
        row.ref.kind === activeRef.kind,
    );
    if (index >= 0) virtual.scrollToIndex(index, { align: "auto" });
  }, [activeRef, rows, virtual]);
  return (
    <>
      <input
        className="branch-search"
        aria-label="Filter branches"
        placeholder="Filter branches…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          if (scroll.current) scroll.current.scrollTop = 0;
        }}
      />
      <button
        className={`sidebar-link branch-all ${!branchFilter ? "active" : ""}`}
        onClick={() => onFilter("")}
      >
        <Layers size={15} />
        All branches<span>{commitCount}</span>
      </button>
      <div
        className="branch-scroll"
        ref={scroll}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        aria-label="Branches and tags"
      >
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={row.key}
                style={{
                  position: "absolute",
                  top:
                    row.type === "header"
                      ? Math.max(
                          item.start,
                          scrollTop + headers.indexOf(item.index) * 26,
                        )
                      : item.start,
                  zIndex: row.type === "header" ? 2 : undefined,
                  background:
                    row.type === "header" ? "var(--panel)" : undefined,
                  height: item.size,
                  width: "100%",
                }}
              >
                {row.type === "header" ? (
                  <button
                    className="section-label branch-group"
                    aria-expanded={!collapsed[row.key]}
                    onClick={() =>
                      setCollapsed((current) => ({
                        ...current,
                        [row.key]: !current[row.key],
                      }))
                    }
                    style={{ height: "100%" }}
                  >
                    <span>
                      <ChevronDown
                        size={11}
                        style={{
                          transform: collapsed[row.key]
                            ? "rotate(-90deg)"
                            : undefined,
                        }}
                      />
                      {row.title}
                    </span>
                    <span>{row.count}</span>
                  </button>
                ) : row.type === "stash" ? (
                  <button
                    className="branch-row"
                    title={`${row.stash.name}: ${row.stash.message}`}
                    onClick={() => onSelectStash?.(row.stash)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      if (!busy && onStashAction)
                        setStashMenu({
                          stash: row.stash,
                          x: event.clientX,
                          y: event.clientY,
                        });
                    }}
                  >
                    <Layers size={13} />
                    <span>
                      {row.stash.name}: {row.stash.message}
                    </span>
                  </button>
                ) : row.type === "empty" ? (
                  <span className="no-refs">{row.title}</span>
                ) : (
                  <button
                    className={`branch-row ${(activeRef ? activeRef.name === row.ref.name && activeRef.kind === row.ref.kind : branchFilter === row.ref.oid) ? "filtered" : ""}`}
                    title={`${row.ref.name}${row.ref.kind !== "tag" && onCheckout ? " — Double-click to check out" : ""}`}
                    onContextMenu={(event) => {
                      if (!onDelete || row.ref.kind === "tag") return;
                      event.preventDefault();
                      if (!busy)
                        setContext({
                          ref: row.ref,
                          x: event.clientX,
                          y: event.clientY,
                        });
                    }}
                    onClick={() => onFilter(row.ref.oid)}
                    onDoubleClick={() =>
                      !busy && row.ref.kind !== "tag" && onCheckout?.(row.ref)
                    }
                  >
                    <GitBranch size={13} />
                    <span>{row.ref.name}</span>
                    {row.ref.kind === "local" && row.ref.name === branch && (
                      <Check size={12} />
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {stashMenu && onStashAction && (
        <StashMenu
          {...stashMenu}
          onAction={onStashAction}
          onClose={() => setStashMenu(null)}
        />
      )}
      {context && onDelete && (
        <BranchContextMenu
          key={`${context.ref.kind}:${context.ref.name}`}
          target={context}
          refs={refs}
          checkedOut={branch}
          onClose={() => setContext(null)}
          onDelete={onDelete}
        />
      )}
    </>
  );
});
