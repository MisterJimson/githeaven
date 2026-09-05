import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Layers, ChevronDown, GitBranch, Check } from "lucide-react";
import type { Reference } from "./types";

type Row =
  | { type: "header"; key: string; title: string; count: number }
  | { type: "ref"; key: string; ref: Reference }
  | { type: "empty"; key: string; title: string };

export const BranchSidebar = memo(function BranchSidebar({
  refs,
  commitCount,
  branch,
  branchFilter,
  onFilter,
  onCheckout,
  busy = false,
  activeRef,
}: {
  refs: Reference[];
  commitCount: number;
  branch: string;
  branchFilter: string;
  onFilter: (oid: string) => void;
  onCheckout?: (ref: Reference) => void;
  busy?: boolean;
  activeRef?: Reference | null;
}) {
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
    return rows;
  }, [refs, query, collapsed]);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroll.current,
    getItemKey: (index) => rows[index].key,
    estimateSize: (index) => (rows[index].type === "header" ? 42 : 30),
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
      <div className="section-label">REPOSITORY</div>
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
      <div className="checked-out-branch">
        <GitBranch size={14} />
        <strong>{branch}</strong>
        <span>checked out</span>
      </div>
      <button
        className={`sidebar-link ${!branchFilter ? "active" : ""}`}
        onClick={() => onFilter("")}
      >
        <Layers size={15} />
        All branches<span>{commitCount}</span>
      </button>
      <div
        className="branch-scroll"
        ref={scroll}
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
                  top: item.start,
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
                ) : row.type === "empty" ? (
                  <span className="no-refs">{row.title}</span>
                ) : (
                  <button
                    className={`branch-row ${(activeRef ? activeRef.name === row.ref.name && activeRef.kind === row.ref.kind : branchFilter === row.ref.oid) ? "filtered" : ""}`}
                    title={`${row.ref.name}${row.ref.kind !== "tag" && onCheckout ? " — Double-click to check out" : ""}`}
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
    </>
  );
});
