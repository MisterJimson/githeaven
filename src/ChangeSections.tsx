import { DiscardMenu } from "./DiscardMenu";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, List, ListTree } from "lucide-react";
import { PierreTree } from "./PierreTree";
import { ChangePaths } from "./ChangePaths";
import type { Change, Selection } from "./types";

export function ChangeSections({
  changes,
  onSelect,
  onStageAll,
  onDiscard,
  busy = false,
  selectionActive = true,
  selected,
}: {
  changes: Change[];
  onSelect: (path: string, staged: boolean) => void;
  onDiscard?: (paths: string[]) => Promise<void>;
  onStageAll?: (unstage: boolean) => void;
  busy?: boolean;
  selectionActive?: boolean;
  selected?: Selection | null;
}) {
  const [view, setView] = useState<"path" | "tree">(() =>
    localStorage.getItem("githeaven.changes-view") === "tree" ? "tree" : "path",
  );
  const sections = useMemo(
    () => [
      {
        name: "Unstaged",
        staged: false,
        paths: changes.filter((c) => c.worktree !== " ").map((c) => c.path),
      },
      {
        name: "Staged",
        staged: true,
        paths: changes
          .filter((c) => c.index !== " " && c.index !== "?")
          .map((c) => c.path),
      },
    ],
    [changes],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="change-sections">
      <div
        className="changes-view-toggle"
        role="group"
        aria-label="Changed files view"
      >
        {(["path", "tree"] as const).map((value) => (
          <button
            key={value}
            aria-pressed={view === value}
            onClick={() => {
              setView(value);
              localStorage.setItem("githeaven.changes-view", value);
            }}
          >
            {value === "path" ? <List size={13} /> : <ListTree size={13} />}
            {value === "path" ? "Path" : "Tree"}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <section
          key={section.name}
          className={`change-section ${collapsed[section.name] ? "collapsed" : ""}`}
        >
          <div className="change-section-header">
            <button
              className="change-section-heading"
              aria-expanded={!collapsed[section.name]}
              aria-controls={`changes-${section.name}`}
              onClick={() =>
                setCollapsed((current) => ({
                  ...current,
                  [section.name]: !current[section.name],
                }))
              }
            >
              <ChevronDown size={14} />
              {section.name} Files <span>({section.paths.length})</span>
            </button>
            {onStageAll && section.paths.length > 0 && (
              <button
                className="stage-all-button"
                disabled={busy}
                onClick={() => onStageAll(section.staged)}
                aria-label={
                  section.staged ? "Unstage all changes" : "Stage all changes"
                }
              >
                {section.staged ? "Unstage all" : "Stage all"}
              </button>
            )}
          </div>
          <div
            id={`changes-${section.name}`}
            className="change-section-content"
            hidden={!!collapsed[section.name]}
          >
            {section.paths.length ? (
              <ChangeFiles
                paths={section.paths}
                onDiscard={onDiscard}
                busy={busy}
                changes={changes}
                staged={section.staged}
                view={view}
                onSelect={(path) => onSelect(path, section.staged)}
                selected={
                  selectionActive &&
                  selected?.source === (section.staged ? "index" : "worktree")
                    ? selected.path
                    : undefined
                }
              />
            ) : (
              <p className="change-section-empty">
                {section.staged ? "Nothing staged yet" : "No unstaged changes"}
              </p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

export function ChangeFiles({
  paths,
  changes,
  staged,
  label,
  view,
  selected,
  onSelect,
  onDiscard,
  busy = false,
}: {
  onDiscard?: (paths: string[]) => Promise<void>;
  busy?: boolean;
  paths: string[];
  changes: Change[];
  staged: boolean;
  label?: string;
  view: "path" | "tree";
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const [multiple, setMultiple] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const [menu, setMenu] = useState<{
    paths: string[];
    x: number;
    y: number;
  } | null>(null);
  const highlighted =
    multiple.length && selected && multiple.includes(selected)
      ? multiple.filter((path) => paths.includes(path))
      : selected
        ? [selected]
        : [];
  function eventPath(event: { nativeEvent: Event }) {
    for (const item of event.nativeEvent.composedPath()) {
      if (item instanceof HTMLElement) {
        const path = item.getAttribute("data-item-path");
        if (path && filtered.includes(path)) return path;
      }
    }
  }
  function select(path: string, extend = false) {
    const base = anchor.current ?? selected ?? path;
    if (extend && onDiscard) {
      const from = filtered.indexOf(base),
        to = filtered.indexOf(path);
      setMultiple(
        from < 0
          ? [path]
          : filtered.slice(Math.min(from, to), Math.max(from, to) + 1),
      );
      anchor.current = base;
    } else {
      setMultiple([path]);
      anchor.current = path;
    }
    onSelect(path);
  }
  const [query, setQuery] = useState("");
  const [keyboardPath, setKeyboardPath] = useState<string>();
  const searchable = paths.length > 20;
  const effectiveQuery = searchable ? query : "";
  useEffect(() => {
    if (!searchable) setQuery("");
  }, [searchable]);
  const filtered = useMemo(
    () =>
      paths
        .filter((path) =>
          path.toLowerCase().includes(effectiveQuery.toLowerCase()),
        )
        .sort(),
    [paths, effectiveQuery],
  );
  return (
    <div className="change-files">
      {menu && onDiscard && (
        <DiscardMenu
          {...menu}
          disabled={busy}
          onDiscard={onDiscard}
          onClose={() => setMenu(null)}
        />
      )}
      {searchable && (
        <input
          type="search"
          className="change-files-search"
          aria-label={`Search ${label ?? (staged ? "staged" : "unstaged")} files`}
          placeholder="Search files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      )}
      <div
        className="change-file-views"
        tabIndex={0}
        aria-label={`${label ?? (staged ? "Staged" : "Unstaged")} file navigation`}
        onPointerDownCapture={(event) => {
          setKeyboardPath(undefined);
          if (onDiscard && eventPath(event)) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onClickCapture={(event) => {
          if (!onDiscard) return;
          const path = eventPath(event);
          if (!path) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          select(path, event.shiftKey);
        }}
        onContextMenuCapture={(event) => {
          if (!onDiscard) return;
          const path = eventPath(event);
          if (!path) return;
          event.preventDefault();
          event.stopPropagation();
          const targets = highlighted.includes(path) ? highlighted : [path];
          if (!highlighted.includes(path)) select(path);
          setMenu({ paths: targets, x: event.clientX, y: event.clientY });
        }}
        onKeyDownCapture={(event) => {
          if (
            event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            (event.key !== "ArrowDown" && event.key !== "ArrowUp")
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          if (!filtered.length) return;
          const current = selected ? filtered.indexOf(selected) : -1;
          const index =
            current < 0
              ? event.key === "ArrowDown"
                ? 0
                : filtered.length - 1
              : Math.max(
                  0,
                  Math.min(
                    filtered.length - 1,
                    current + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
          const path = filtered[index];
          event.currentTarget.focus({ preventScroll: true });
          setKeyboardPath(path);
          select(path, event.shiftKey);
        }}
      >
        <div
          className="change-file-view"
          aria-hidden={view !== "path"}
          inert={view !== "path"}
          style={{
            opacity: view === "path" ? 1 : 0,
            pointerEvents: view === "path" ? "auto" : "none",
            zIndex: view === "path" ? 1 : 0,
          }}
        >
          <ChangePaths
            revealPath={view === "path" ? keyboardPath : undefined}
            paths={filtered}
            changes={changes}
            staged={staged}
            label={label}
            selected={selected}
            selectedPaths={onDiscard ? highlighted : undefined}
            onSelect={select}
          />
          {!filtered.length && (
            <p className="change-section-empty">No matching files</p>
          )}
        </div>
        <div
          className="change-file-view"
          aria-hidden={view !== "tree"}
          inert={view !== "tree"}
          style={{
            opacity: view === "tree" ? 1 : 0,
            pointerEvents: view === "tree" ? "auto" : "none",
            zIndex: view === "tree" ? 1 : 0,
          }}
        >
          <PierreTree
            paths={paths}
            changes={changes}
            onSelect={select}
            selectedPaths={onDiscard ? highlighted : undefined}
            search={false}
            query={effectiveQuery}
            selected={selected}
            syncSelection
            revealPath={view === "tree" ? keyboardPath : undefined}
          />
        </div>
      </div>
    </div>
  );
}
