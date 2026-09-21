import { StashMenu } from "./StashMenu";
import { BranchContextMenu } from "./BranchContextMenu";
import { memo, useEffect, useMemo, useState } from "react";
import { DockedSections, type DockGroup } from "./DockedSections";
import { Layers, GitBranch, Check } from "lucide-react";
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
  branch: string;
  branchFilter: string;
  onFilter: (oid: string, reference?: Reference) => void;
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
  const groups: DockGroup<Exclude<Row, { type: "header" }>>[] = [];
  for (const row of rows) {
    if (row.type === "header") groups.push({ ...row, items: [] });
    else groups.at(-1)!.items.push(row);
  }
  return (
    <>
      <input
        className="branch-search"
        aria-label="Filter branches"
        placeholder="Filter branches…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <DockedSections
        groups={groups}
        collapsed={collapsed}
        onToggle={(key) =>
          setCollapsed((current) => ({ ...current, [key]: !current[key] }))
        }
        selectedKey={
          activeRef ? `${activeRef.kind}:${activeRef.name}` : undefined
        }
        renderItem={(row) =>
          row.type === "stash" ? (
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
              onClick={() => onFilter(row.ref.oid, row.ref)}
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
          )
        }
      />

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
