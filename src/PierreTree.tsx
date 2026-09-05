import { useEffect, useMemo, useRef } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import type { Change } from "./types";

const noChanges: Change[] = [];

export function PierreTree({
  paths,
  changes = noChanges,
  onSelect,
  selected,
  selectionActive = true,
  search = true,
  query,
  syncSelection = false,
}: {
  paths: string[];
  changes?: Change[];
  onSelect: (path: string) => void;
  selected?: string;
  selectionActive?: boolean;
  search?: boolean;
  query?: string;
  syncSelection?: boolean;
}) {
  const synchronizing = useRef(false);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const pathSet = useMemo(() => new Set(paths), [paths]);
  const allowed = useRef(pathSet);
  allowed.current = pathSet;
  const { model } = useFileTree({
    paths,
    initialExpansion: "closed",
    flattenEmptyDirectories: true,
    search,
    overscan: 8,
    onSelectionChange: (selected) => {
      const path = selected.at(-1);
      if (!synchronizing.current && path && allowed.current.has(path))
        callback.current(path);
    },
  });
  useEffect(() => {
    if (query !== undefined) model.setSearch(query || null);
  }, [model, query]);
  const previousPaths = useRef(paths);
  useEffect(() => {
    // Construction already loaded these paths. Refreshes often return the same list.
    if (
      paths.length !== previousPaths.current.length ||
      paths.some((path, i) => path !== previousPaths.current[i])
    )
      model.resetPaths(paths);
    previousPaths.current = paths;
  }, [model, paths]);
  useEffect(() => {
    if (!syncSelection) return;
    synchronizing.current = true;
    try {
      const target = selectionActive ? selected : undefined;
      for (const path of model.getSelectedPaths()) {
        if (path !== target) model.getItem(path)?.deselect();
      }
      if (target && !model.getSelectedPaths().includes(target))
        model.getItem(target)?.select();
    } finally {
      synchronizing.current = false;
    }
  }, [model, selected, selectionActive, syncSelection, paths]);
  useEffect(() => {
    // The graph has no active file. Clear only the highlight so clicking the same
    // file opens it again; keep expansion, scrolling, and the model intact.
    if (!selectionActive) {
      for (const path of model.getSelectedPaths())
        model.getItem(path)?.deselect();
    }
  }, [model, selectionActive]);
  useEffect(() => {
    const statuses: GitStatusEntry[] = changes.map((c) => ({
      path: c.path,
      status:
        c.index === "?"
          ? "untracked"
          : c.index === "R"
            ? "renamed"
            : c.worktree === "D" || c.index === "D"
              ? "deleted"
              : c.index === "A"
                ? "added"
                : "modified",
    }));
    model.setGitStatus(statuses);
  }, [model, changes]);
  // Explorer selection stays with Pierre; change lists may synchronize it silently.
  return useMemo(
    () => (
      <FileTree
        model={model}
        className="pierre-tree"
        style={{ height: "100%", colorScheme: "dark" }}
        data-current-path={selected}
      />
    ),
    [model, selected],
  );
}
