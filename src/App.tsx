import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ArrowUpRight,
  Columns2,
  FileCode2,
  Files,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  GitCompareArrows,
  GitFork,
  LoaderCircle,
  Minus,
  Plus,
  Save,
  Search,
  Settings2,
  X,
} from "lucide-react";
import { call, errorText, native } from "./api";
import { ChangeSections } from "./ChangeSections";
import { QuickOpen, type QuickItem } from "./QuickOpen";
import { ResizablePanel } from "./ResizablePanel";
import { BranchSidebar } from "./BranchSidebar";
import { History } from "./History";
import { PierreTree } from "./PierreTree";
import type { FileSession } from "./Surface";
import { reachable } from "./graph";
import { projectStaging, type StagingOperation } from "./staging";
import { startForegroundTiming } from "./timing";
import type {
  Commit,
  Details,
  Mode,
  Selection,
  Snapshot,
  Reference,
} from "./types";

const emptyDetails: Details = {
  message: "",
  paths: [],
  parent: null,
  elapsed_ms: 0,
};
const PierreProvider = lazy(() =>
  import("./Surface").then((m) => ({ default: m.PierreProvider })),
);
const DiffSurface = lazy(() =>
  import("./Surface").then((m) => ({ default: m.DiffSurface })),
);
const EditorSurface = lazy(() =>
  import("./Surface").then((m) => ({ default: m.EditorSurface })),
);
const layerStyle = (visible: boolean) => ({
  opacity: visible ? 1 : 0,
  pointerEvents: visible ? ("auto" as const) : ("none" as const),
  zIndex: visible ? 1 : 0,
});

interface QueuedStage extends StagingOperation {
  root: string;
  beforeSelection?: Selection;
  selectionRevision?: number;
}

function mergeSnapshot(
  previous: Snapshot,
  next: Snapshot,
  history: boolean,
): Snapshot {
  return {
    ...next,
    commits: next.commits ?? previous.commits,
    refs: next.refs ?? previous.refs,
    has_more: history ? next.has_more : previous.has_more,
  };
}

interface ProjectView {
  snapshot: Snapshot;
  limit: number;
  mode: Mode;
  selected: Commit | null;
  parent: string | null;
  details: Details;
  historySelection: Selection | null;
  changeSelection: Selection | null;
  file: FileSession | null;
  filter: string;
  branchFilter: string;
  message: string;
  description: string;
  reviewKind: "working" | "commit";
  diffOpen: boolean;
}

export function App() {
  const [repo, setRepo] = useState<Snapshot | null>(null);
  const repoRef = useRef(repo);
  repoRef.current = repo;
  const [mode, setMode] = useState<Mode>("history");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [selected, setSelected] = useState<Commit | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [details, setDetails] = useState<Details>(emptyDetails);
  const [historySelection, setHistorySelection] = useState<Selection | null>(
    null,
  );
  const [changeSelection, setChangeSelection] = useState<Selection | null>(
    null,
  );
  const changeSelectionRef = useRef(changeSelection);
  changeSelectionRef.current = changeSelection;
  const selectionRevision = useRef(0);
  const stageQueue = useRef<QueuedStage[]>([]);
  const stageRunning = useRef(false);
  const stageCompletion = useRef<Promise<void>>(Promise.resolve());
  const stageRevision = useRef(0);
  const [stageOperations, setStageOperations] = useState<QueuedStage[]>([]);
  const [indexPending, setIndexPending] = useState(false);
  const [reviewKind, setReviewKind] = useState<"working" | "commit">("working");
  const [diffOpen, setDiffOpen] = useState(false);
  const selection =
    reviewKind === "commit" ? historySelection : changeSelection;
  const [tabTimes, setTabTimes] = useState<number[]>([]);
  const tabRequest = useRef(0);
  const [tabCommitTime, setTabCommitTime] = useState<number | null>(null);
  const tabStarted = useRef<{ start: number; commit: number | null } | null>(
    null,
  );
  const [file, setFile] = useState<FileSession | null>(null);
  const fileRef = useRef(file);
  fileRef.current = file;
  const draft = useRef("");
  const original = useRef("");
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [external, setExternal] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [loadingFile, setLoadingFile] = useState(false);
  const [fileTimes, setFileTimes] = useState<{ total: number; read: number }[]>(
    [],
  );
  const [tick, setTick] = useState(0);
  const limitRef = useRef(500);
  const loadingOlder = useRef(false);
  const [filter, setFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [activeRef, setActiveRef] = useState<Reference | null>(null);
  const [checkoutPrompt, setCheckoutPrompt] = useState<Reference | null>(null);
  const [split, setSplit] = useState(true);
  const [staged, setStaged] = useState(false);
  const [message, setMessage] = useState("");
  const [description, setDescription] = useState("");
  const [showPerf, setShowPerf] = useState(false);
  const [quickOpen, setQuickOpen] = useState<"commands" | "files" | null>(null);
  const [times, setTimes] = useState<number[]>([]);
  const [startupPath] = useState(
    () => localStorage.getItem("githeaven:last-repo") ?? "",
  );
  const [projects, setProjects] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(
        localStorage.getItem("githeaven.projects") ?? "[]",
      );
      return [
        ...new Set([
          ...(Array.isArray(saved)
            ? saved.filter(
                (path): path is string => typeof path === "string" && !!path,
              )
            : []),
          ...(startupPath ? [startupPath] : []),
        ]),
      ];
    } catch {
      return startupPath ? [startupPath] : [];
    }
  });
  const [projectSettling, setProjectSettling] = useState(false);
  const [projectTimes, setProjectTimes] = useState<
    { cached: boolean; paint: number | null; commit: number }[]
  >([]);
  const projectTiming = useRef<{
    root: string;
    start: number;
    finish: () => number | null;
    cached: boolean;
  } | null>(null);
  const projectViews = useRef(new Map<string, ProjectView>());
  useEffect(() => {
    localStorage.setItem("githeaven.projects", JSON.stringify(projects));
  }, [projects]);
  const [openPath, setOpenPath] = useState(startupPath);
  const [restoringRepository, setRestoringRepository] = useState(!!startupPath);
  const restoreStarted = useRef(false);
  const [watchWarning, setWatchWarning] = useState<string | null>(null);
  const generation = useRef(0);
  const fileRequest = useRef(0);
  const fileVersion = useRef(0);
  const refreshing = useRef(false);
  const refreshAgain = useRef(false);
  const historyAgain = useRef(false);

  const markDirty = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };
  const onEditorChange = useCallback((text: string) => {
    draft.current = text;
    dirtyRef.current = text !== original.current;
    setDirty(dirtyRef.current);
  }, []);
  useLayoutEffect(() => {
    if (tabStarted.current)
      tabStarted.current.commit = performance.now() - tabStarted.current.start;
  }, [mode]);
  const navigate = (action: () => void) => {
    if (busy) return;
    if (dirtyRef.current) setPending(() => action);
    else action();
  };
  const report = (e: unknown) => setError(errorText(e));
  const save = useCallback(async () => {
    const current = fileRef.current;
    const root = repoRef.current?.root;
    if (!current || !root) return false;
    const text = draft.current;
    setBusy("Saving");
    setError("");
    try {
      await call("save_file", {
        root,
        path: current.path,
        original: original.current,
        contents: text,
      });
      original.current = text;
      markDirty(draft.current !== text);
      setExternal(false);
      setFile((f) => (f ? { ...f, original: text, contents: text } : f));
      setNotice("File saved");
      return !dirtyRef.current;
    } catch (e) {
      report(e);
      return false;
    } finally {
      setBusy("");
    }
  }, []);

  const refresh = useCallback(async (history = false) => {
    if (stageRunning.current) {
      refreshAgain.current = true;
      historyAgain.current ||= history;
      return;
    }
    if (refreshing.current) {
      refreshAgain.current = true;
      historyAgain.current ||= history;
      return;
    }
    const current = repoRef.current;
    if (!current) return;
    refreshing.current = true;
    const gen = generation.current;
    const indexRevision = stageRevision.current;
    try {
      const next = await call<Snapshot>("refresh_repository", {
        root: current.root,
        limit: limitRef.current,
        history,
      });
      if (generation.current !== gen) return;
      // A refresh started before an index write must never undo its projection.
      if (stageRunning.current || stageRevision.current !== indexRevision) {
        refreshAgain.current = true;
        historyAgain.current ||= history;
        return;
      }
      setRepo((prev) =>
        prev && prev.root === next.root
          ? mergeSnapshot(prev, next, history)
          : prev,
      );
      setTick((v) => v + 1);
      return true;
    } catch (e) {
      if (generation.current === gen) report(e);
    } finally {
      refreshing.current = false;
      if (refreshAgain.current && !stageRunning.current) {
        const full = historyAgain.current;
        refreshAgain.current = false;
        historyAgain.current = false;
        void refresh(full);
      }
    }
  }, []);

  const loadOlder = useCallback(async () => {
    if (
      loadingOlder.current ||
      refreshing.current ||
      stageRunning.current ||
      !repoRef.current?.has_more
    )
      return;
    loadingOlder.current = true;
    const gen = generation.current;
    const previousLimit = limitRef.current;
    limitRef.current += 500;
    try {
      const loaded = await refresh(true);
      if (!loaded && generation.current === gen)
        limitRef.current = previousLimit;
    } finally {
      loadingOlder.current = false;
    }
  }, [refresh]);

  async function openRepository(path: string) {
    if (!path.trim()) return false;
    if (repoRef.current?.root === path.trim()) return true;
    if (repo)
      projectViews.current.set(repo.root, {
        snapshot: repo,
        limit: limitRef.current,
        mode,
        selected,
        parent,
        details,
        historySelection,
        changeSelection,
        file: fileRef.current
          ? {
              ...fileRef.current,
              contents: original.current,
              original: original.current,
            }
          : null,
        filter,
        branchFilter,
        message,
        description,
        reviewKind,
        diffOpen,
      });
    setProjectSettling(true);
    const saved = projectViews.current.get(path.trim());
    projectTiming.current = {
      root: path.trim(),
      start: performance.now(),
      finish: startForegroundTiming(),
      cached: !!saved,
    };
    if (!saved || stageRunning.current) setBusy("Opening repository");
    setError("");
    const gen = ++generation.current;
    try {
      if (stageRunning.current) await stageCompletion.current;
      const next =
        saved?.snapshot ??
        (await call<Snapshot>("open_repository", {
          path: path.trim(),
        }));
      if (generation.current !== gen) return;
      const cached = projectViews.current.get(next.root);
      if (projectTiming.current) projectTiming.current.root = next.root;
      setProjects((paths) => [
        ...new Set([
          ...paths.filter(
            (entry) => entry !== path.trim() || entry === next.root,
          ),
          next.root,
        ]),
      ]);
      repoRef.current = next;
      setRepo(next);
      setActiveRef(null);
      setCheckoutPrompt(null);
      setWatchWarning(next.watch_warning);
      setOpenPath(next.root);
      setMode(cached?.mode ?? "history");
      setFilter(cached?.filter ?? "");
      setBranchFilter(cached?.branchFilter ?? "");
      limitRef.current = cached?.limit ?? 500;
      setSelected(cached?.selected ?? next.commits?.[0] ?? null);
      setParent(cached?.parent ?? null);
      setDetails(cached?.details ?? emptyDetails);
      setHistorySelection(cached?.historySelection ?? null);
      setChangeSelection(cached?.changeSelection ?? null);
      const restoredFile = cached?.file
        ? {
            ...cached.file,
            version: ++fileVersion.current,
            finishOpen: undefined,
          }
        : null;
      setFile(restoredFile);
      fileRef.current = restoredFile;
      original.current = restoredFile?.contents ?? "";
      draft.current = original.current;
      setExternal(false);
      setLoadingFile(false);
      setFileTimes([]);
      fileRequest.current++;
      markDirty(false);
      setMessage(cached?.message ?? "");
      setDescription(cached?.description ?? "");
      setReviewKind(cached?.reviewKind ?? "working");
      setDiffOpen(cached?.diffOpen ?? false);
      setTimes([]);
      setTabTimes([]);
      setTabCommitTime(null);
      tabStarted.current = null;
      tabRequest.current++;
      localStorage.setItem("githeaven:last-repo", next.root);
      return true;
    } catch (e) {
      setProjectSettling(false);
      report(e);
      return false;
    } finally {
      if (generation.current === gen) setBusy("");
    }
  }
  useLayoutEffect(() => {
    const measurement = projectTiming.current;
    if (!measurement || measurement.root !== repo?.root) return;
    projectTiming.current = null;
    const commit = performance.now() - measurement.start;
    const gen = generation.current;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        if (generation.current !== gen) return;
        const paint = measurement.finish();
        setProjectSettling(false);
        setProjectTimes((values) => [
          ...values.slice(-49),
          { cached: measurement.cached, paint, commit },
        ]);
        // Refresh only after the cached workspace has had a paint opportunity.
        if (measurement.cached) void refresh(true);
      });
    });
    let second = 0;
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [repo?.root, refresh]);
  useEffect(() => {
    // Only restore on launch, including React's development effect replay.
    // A missing folder returns to the picker without retrying on each render.
    if (restoreStarted.current) return;
    restoreStarted.current = true;
    if (startupPath) {
      void openRepository(startupPath).finally(() =>
        setRestoringRepository(false),
      );
    }
  }, [startupPath]);

  function closeProject(path: string) {
    const remove = () => {
      projectViews.current.delete(path);
      void call("close_repository", { root: path }).catch(report);
      setProjects((paths) => paths.filter((entry) => entry !== path));
    };
    if (repo?.root !== path) {
      remove();
      return;
    }
    navigate(() => {
      void (async () => {
        const index = projects.indexOf(path);
        const adjacent = projects[index + 1] ?? projects[index - 1];
        if (adjacent) {
          if (await openRepository(adjacent)) remove();
        } else {
          await stageCompletion.current;
          generation.current++;
          fileRequest.current++;
          setRepo(null);
          repoRef.current = null;
          setFile(null);
          fileRef.current = null;
          markDirty(false);
          setMessage("");
          setDescription("");
          setOpenPath("");
          localStorage.removeItem("githeaven:last-repo");
          remove();
        }
      })();
    });
  }

  async function chooseRepository() {
    if (!native) {
      setError("Use the desktop app: npm run tauri dev");
      return;
    }
    const path = await open({
      directory: true,
      multiple: false,
      title: "Open a Git repository",
    });
    if (path) await openRepository(path);
  }
  async function openFile(path: string) {
    const root = repoRef.current?.root;
    if (!root) return;
    const request = ++fileRequest.current;
    const gen = generation.current;
    const finishOpen = startForegroundTiming();
    const started = performance.now();
    setLoadingFile(true);
    setError("");
    try {
      const contents = await call<string>("read_file", { root, path });
      if (request !== fileRequest.current || gen !== generation.current) return;
      draft.current = contents;
      original.current = contents;
      markDirty(false);
      setExternal(false);
      setFile({
        path,
        original: contents,
        contents,
        version: ++fileVersion.current,
        finishOpen,
        readMs: performance.now() - started,
      });
      setMode("files");
    } catch (e) {
      if (request === fileRequest.current && gen === generation.current)
        report(e);
    } finally {
      if (request === fileRequest.current) setLoadingFile(false);
    }
  }
  const selectCommit = useCallback((commit: Commit) => {
    setReviewKind("commit");
    setDiffOpen(false);
    setSelected(commit);
    setParent(null);
  }, []);

  useEffect(() => {
    if (!repo || !selected) {
      setDetails(emptyDetails);
      return;
    }
    let active = true;
    setDetails(emptyDetails);
    setHistorySelection(null);
    const timer = setTimeout(() => {
      call<Details>("commit_details", {
        root: repo.root,
        oid: selected.oid,
        parent,
      })
        .then((d) => {
          if (!active) return;
          setDetails(d);
          setHistorySelection(
            d.paths[0]
              ? {
                  source: "commit",
                  oid: selected.oid,
                  parent: d.parent,
                  path: d.paths[0],
                }
              : null,
          );
        })
        .catch((e) => {
          if (active) report(e);
        });
    }, 35);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [repo?.root, selected?.oid, parent]);

  useEffect(() => {
    if (!native || !repo) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    listen<{ root: string; history: boolean }>("repo-changed", (event) => {
      if (event.payload.root === repo.root) void refresh(event.payload.history);
    })
      .then((fn) => {
        if (disposed) fn();
        else cleanup = fn;
      })
      .catch(report);
    const onFocus = () => {
      void refresh(true);
    };
    window.addEventListener("focus", onFocus);
    const interval = setInterval(() => {
      if (!document.hidden) void refresh(true);
    }, 30000);
    return () => {
      disposed = true;
      cleanup?.();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [repo?.root, refresh]);

  useEffect(() => {
    if (!native) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (dirtyRef.current) {
          event.preventDefault();
          setPending(() => () => {
            void getCurrentWindow().destroy();
          });
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else cleanup = fn;
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    const current = fileRef.current;
    if (!repo || !current) return;
    const request = fileRequest.current;
    let active = true;
    const isCurrent = () => active && request === fileRequest.current;
    call<string>("read_file", { root: repo.root, path: current.path })
      .then((contents) => {
        if (!isCurrent() || contents === original.current) return;
        if (dirtyRef.current) {
          setExternal(true);
          return;
        }
        original.current = contents;
        draft.current = contents;
        setFile((f) =>
          f
            ? {
                ...f,
                original: contents,
                contents,
                version: ++fileVersion.current,
                finishOpen: undefined,
              }
            : f,
        );
      })
      .catch(() => {
        if (isCurrent()) setExternal(true);
      });
    return () => {
      active = false;
    };
    // openFile already read the selected document. Only repository events reread it.
  }, [tick, repo?.root]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirtyRef.current) void save();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [save]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "p") return;
      event.preventDefault();
      event.stopPropagation();
      if (!pending && !checkoutPrompt)
        setQuickOpen(key === "p" ? "files" : "commands");
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [pending, checkoutPrompt]);
  useEffect(() => {
    if (notice) {
      const id = setTimeout(() => setNotice(""), 3500);
      return () => clearTimeout(id);
    }
  }, [notice]);

  const changes = useMemo(
    () =>
      stageOperations.reduce(
        (current, operation) => projectStaging(current, operation),
        repo?.changes ?? [],
      ),
    [repo?.changes, stageOperations],
  );
  const unstagedChanges = changes.filter((c) => c.worktree !== " ");
  const stagedChanges = changes.filter(
    (c) => c.index !== " " && c.index !== "?",
  );
  const activeChanges = staged ? stagedChanges : unstagedChanges;
  function chooseChange(path: string, isStaged = staged) {
    selectionRevision.current++;
    setReviewKind("working");
    setDiffOpen(true);
    setStaged(isStaged);
    const change = changes.find((c) => c.path === path);
    setChangeSelection({
      path,
      source: isStaged ? "index" : "worktree",
      oldPath: change?.original_path,
    });
  }
  function switchMode(next: Mode) {
    if (next === mode) return;
    navigate(() => {
      const request = ++tabRequest.current;
      const finishTiming = startForegroundTiming();
      const measurement = {
        start: performance.now(),
        commit: null as number | null,
      };
      tabStarted.current = measurement;
      setMode(next);
      // Two frames include a paint opportunity after React reveals the retained pane.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const elapsed = finishTiming();
          if (tabRequest.current === request && elapsed !== null) {
            setTabCommitTime(measurement.commit);
            setTabTimes((values) => [...values.slice(-49), elapsed]);
          }
        }),
      );
    });
  }
  useEffect(() => {
    // Keep the viewed path selected through external deletes/atomic saves or
    // temporarily clean snapshots; only explicit navigation changes the document.
    if (!changeSelection) {
      const first = activeChanges[0] ?? stagedChanges[0] ?? unstagedChanges[0];
      const isStaged =
        !!first &&
        stagedChanges.includes(first) &&
        (staged || !unstagedChanges.includes(first));
      if (first) setStaged(isStaged);
      setChangeSelection(
        first
          ? {
              path: first.path,
              source: isStaged ? "index" : "worktree",
              oldPath: first.original_path,
            }
          : null,
      );
    }
  }, [repo?.changes, staged, changeSelection]);

  useEffect(() => {
    if (indexPending || !changeSelection) return;
    const change = changes.find((item) => item.path === changeSelection.path);
    if (!change) return;
    const inIndex = change.index !== " " && change.index !== "?";
    const inWorktree = change.worktree !== " ";
    const source =
      changeSelection.source === "index" && !inIndex && inWorktree
        ? "worktree"
        : changeSelection.source === "worktree" && !inWorktree && inIndex
          ? "index"
          : changeSelection.source;
    if (
      source !== changeSelection.source ||
      change.original_path !== changeSelection.oldPath
    ) {
      const next = {
        ...changeSelection,
        source,
        oldPath: change.original_path,
      };
      changeSelectionRef.current = next;
      setChangeSelection(next);
      setStaged(source === "index");
    }
  }, [changes, indexPending, changeSelection]);

  const showWorking = useCallback(() => {
    setReviewKind("working");
    setDiffOpen(false);
  }, []);
  const filterBranch = useCallback((oid: string) => {
    setActiveRef(null);
    setBranchFilter(oid);
    setDiffOpen(false);
  }, []);
  const checkoutBranch = useCallback(
    (ref: Reference, stash = false) => {
      navigate(() => {
        void (async () => {
          if (!repo || ref.kind === "tag") return;
          setBusy("Switching branch");
          setError("");
          try {
            await stageCompletion.current;
            await call("checkout_branch", {
              root: repo.root,
              name: ref.name,
              kind: ref.kind,
              stash,
            });
            setBranchFilter("");
            setActiveRef(null);
            setChangeSelection(null);
            showWorking();
            await refresh(true);
            setNotice(`Checked out ${ref.name}`);
          } catch (error) {
            if (errorText(error).includes("WIP_STASH_REQUIRED"))
              setCheckoutPrompt(ref);
            else report(error);
          } finally {
            setBusy("");
          }
        })();
      });
    },
    [repo?.root, busy],
  );
  const drainStages = useCallback(async () => {
    if (stageRunning.current) return;
    stageRunning.current = true;
    setIndexPending(true);
    try {
      while (stageQueue.current.length) {
        const operation = stageQueue.current[0];
        let applied = false;
        try {
          await call(
            operation.path === undefined ? "stage_all_changes" : "stage_file",
            {
              root: operation.root,
              ...(operation.path === undefined ? {} : { path: operation.path }),
              unstage: operation.unstage,
            },
          );
          applied = true;
        } catch (error) {
          // Remove only this failed projection; preserve later queued intentions.
          stageQueue.current = stageQueue.current.filter(
            (item) => item !== operation,
          );
          setStageOperations([...stageQueue.current]);
          if (
            operation.beforeSelection &&
            operation.selectionRevision === selectionRevision.current
          ) {
            setChangeSelection(operation.beforeSelection);
            changeSelectionRef.current = operation.beforeSelection;
            setStaged(operation.beforeSelection.source === "index");
          }
          report(
            `${operation.unstage ? "Could not unstage" : "Could not stage"} ${operation.path ?? "changes"}: ${errorText(error)}`,
          );
        }
        // Reconcile even after failure, since another process may have changed Git.
        try {
          const next = await call<Snapshot>("refresh_repository", {
            root: operation.root,
            limit: limitRef.current,
            history: false,
          });
          setRepo((previous) =>
            previous?.root === next.root
              ? mergeSnapshot(previous, next, false)
              : previous,
          );
        } catch (error) {
          if (applied) {
            // A refresh failure cannot undo a successful Git write.
            setRepo((previous) =>
              previous?.root === operation.root
                ? {
                    ...previous,
                    changes: projectStaging(previous.changes, operation),
                  }
                : previous,
            );
            report(
              `Changes ${operation.unstage ? "unstaged" : "staged"}, but refresh failed: ${errorText(error)}`,
            );
          }
        }
        stageQueue.current = stageQueue.current.filter(
          (item) => item !== operation,
        );
        setStageOperations([...stageQueue.current]);
        stageRevision.current++;
        setTick((value) => value + 1);
      }
    } finally {
      stageRunning.current = false;
      setIndexPending(false);
      if (refreshAgain.current) {
        const history = historyAgain.current;
        refreshAgain.current = false;
        historyAgain.current = false;
        void refresh(history);
      }
    }
  }, [refresh]);

  function enqueueStage(operation: StagingOperation) {
    const current = repoRef.current;
    if (!current || busy || dirtyRef.current) return;
    const queued: QueuedStage = { ...operation, root: current.root };
    const viewed = changeSelectionRef.current;
    if (
      viewed &&
      (operation.path === undefined || operation.path === viewed.path) &&
      viewed.source === (operation.unstage ? "index" : "worktree")
    ) {
      queued.beforeSelection = viewed;
      queued.selectionRevision = ++selectionRevision.current;
      const next = {
        ...viewed,
        source: operation.unstage ? ("worktree" as const) : ("index" as const),
      };
      changeSelectionRef.current = next;
      setChangeSelection(next);
      setStaged(!operation.unstage);
    }
    stageRevision.current++;
    stageQueue.current.push(queued);
    setStageOperations([...stageQueue.current]);
    setError("");
    if (!stageRunning.current) stageCompletion.current = drainStages();
  }
  function stageAllChanges(unstage: boolean) {
    enqueueStage({ unstage });
  }
  function toggleStage() {
    const viewed = changeSelectionRef.current;
    if (viewed)
      enqueueStage({ path: viewed.path, unstage: viewed.source === "index" });
  }
  async function commit() {
    if (!repo || stageRunning.current || busy || dirtyRef.current) return;
    setBusy("Committing");
    setError("");
    try {
      await call("create_commit", {
        root: repo.root,
        message: description.trim()
          ? `${message.trim()}\n\n${description.trim()}`
          : message.trim(),
      });
      setMessage("");
      setDescription("");
      setReviewKind("working");
      setDiffOpen(false);
      setNotice("Commit created");
      await refresh(true);
      setChangeSelection(null);
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  const visibleCommits = useMemo(() => {
    const commits = repo?.commits ?? [];
    const reach = branchFilter ? reachable(commits, branchFilter) : null;
    const query = filter.toLowerCase();
    return commits.filter(
      (c) =>
        (!reach || reach.has(c.oid)) &&
        (!query ||
          `${c.subject} ${c.author} ${c.oid}`.toLowerCase().includes(query)),
    );
  }, [repo?.commits, filter, branchFilter]);
  const recordTiming = useCallback(
    (ms: number) => setTimes((t) => [...t.slice(-49), ms]),
    [],
  );
  const recordFileTiming = useCallback(
    (total: number, read: number) =>
      setFileTimes((t) => [...t.slice(-49), { total, read }]),
    [],
  );
  const p95 = times.length
    ? [...times].sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1]
    : null;

  const quickFiles = useMemo<QuickItem[]>(
    () =>
      (repo?.files ?? []).map((path) => ({
        id: `file:${path}`,
        label: path.split("/").at(-1)!,
        detail: path,
        kind: "file",
        value: path,
      })),
    [repo?.files],
  );
  const quickCommands = useMemo<QuickItem[]>(() => {
    const commands: QuickItem[] = [
      { id: "open", label: "Open repository…", kind: "command", value: "open" },
    ];
    if (!repo) return commands;
    commands.unshift(
      ...[
        ["files", "Go to Edit"],
        ["history", "Go to Git history"],
        ["working", "Go to working changes"],
        ["compose", "Write a commit"],
        ["branches", "Search branches and tags"],
        ["commits", "Search commit history"],
        ["find", "Go to file…"],
        ["refresh", "Refresh repository"],
        ["split", "Toggle split / unified diff"],
      ].map(([value, label]): QuickItem => ({
        id: value,
        value,
        label,
        kind: "command",
      })),
    );
    if (dirty && !busy)
      commands.push({
        id: "save",
        value: "save",
        label: "Save current file",
        kind: "command",
      });
    return [
      ...commands,
      ...(repo.refs ?? []).map((ref): QuickItem => ({
        id: `ref:${ref.kind}:${ref.name}`,
        value: ref.oid,
        label: ref.name,
        detail: `Browse ${ref.kind} ${ref.kind === "tag" ? "tag" : "branch"}`,
        kind: "branch",
      })),
      ...(repo.commits ?? []).map((commit): QuickItem => ({
        id: `commit:${commit.oid}`,
        value: commit.oid,
        label: commit.subject,
        detail: `${commit.oid.slice(0, 7)} · ${commit.author}`,
        kind: "commit",
      })),
      ...changes.flatMap((change): QuickItem[] => [
        ...(change.worktree !== " "
          ? [
              {
                id: `worktree:${change.path}`,
                value: change.path,
                label: change.path,
                kind: "worktree" as const,
              },
            ]
          : []),
        ...(change.index !== " " && change.index !== "?"
          ? [
              {
                id: `index:${change.path}`,
                value: change.path,
                label: change.path,
                kind: "index" as const,
              },
            ]
          : []),
      ]),
      ...quickFiles,
    ];
  }, [repo, quickFiles, changes, dirty, busy]);
  function pickQuickItem(item: QuickItem) {
    if (item.kind === "command" && item.value === "refresh") {
      void refresh(true);
      return;
    }
    if (item.kind === "command" && item.value === "save") {
      void save();
      return;
    }
    if (item.kind === "file" && fileRef.current?.path === item.value) {
      setMode("files");
      return;
    }
    if (item.kind === "command" && item.value === "find") {
      setQuickOpen("files");
      return;
    }
    navigate(() => {
      const focus = (label: string) =>
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(`[aria-label="${label}"]`)
            ?.focus(),
        );
      if (item.kind === "file") {
        if (fileRef.current?.path === item.value) setMode("files");
        else void openFile(item.value);
      } else if (item.kind === "branch") {
        setMode("history");
        setFilter("");
        filterBranch(item.value);
      } else if (item.kind === "commit") {
        const commit = repo?.commits?.find((entry) => entry.oid === item.value);
        if (commit) {
          setMode("history");
          setFilter("");
          setBranchFilter("");
          selectCommit(commit);
        }
      } else if (item.kind === "index" || item.kind === "worktree") {
        setMode("history");
        chooseChange(item.value, item.kind === "index");
      } else
        switch (item.value) {
          case "open":
            void chooseRepository();
            break;
          case "files":
            setMode("files");
            break;
          case "history":
            setMode("history");
            setDiffOpen(false);
            setFilter("");
            setBranchFilter("");
            break;
          case "working":
            setMode("history");
            showWorking();
            break;
          case "compose":
            setMode("history");
            showWorking();
            focus("Commit summary");
            break;
          case "branches":
            setMode("history");
            focus("Filter branches");
            break;
          case "commits":
            setMode("history");
            setDiffOpen(false);
            focus("Search commits");
            break;
          case "refresh":
            void refresh(true);
            break;
          case "split":
            setSplit((value) => !value);
            break;
          case "save":
            void save();
            break;
        }
    });
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="project-tabs" role="tablist" aria-label="Projects">
          {projects.map((path) => (
            <div
              className={`project-tab ${repo?.root === path ? "active" : ""}`}
              key={path}
            >
              <button
                role="tab"
                aria-selected={repo?.root === path}
                title={path}
                disabled={!!busy}
                onClick={() => {
                  if (repo?.root !== path)
                    navigate(() => {
                      void openRepository(path);
                    });
                }}
              >
                <FolderGit2 size={14} />
                <span>{path.split(/[\\/]/).filter(Boolean).at(-1)}</span>
              </button>
              <button
                className="project-close"
                aria-label={`Close project ${path}`}
                title="Close project"
                disabled={!!busy}
                onClick={() => closeProject(path)}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="icon-button add-project"
          aria-label="Add project"
          title="Open folder"
          disabled={!!busy}
          onClick={() =>
            navigate(() => {
              void chooseRepository();
            })
          }
        >
          <Plus size={17} />
        </button>
        <div className="topbar-spacer" />
        <button
          className="icon-button"
          aria-label="Command palette"
          title="Command palette (⌘K)"
          onClick={() => setQuickOpen("commands")}
        >
          <Search size={17} />
        </button>
        <button
          className={`icon-button ${showPerf ? "active" : ""}`}
          title="Performance measurements"
          aria-label="Performance measurements"
          onClick={() => setShowPerf((v) => !v)}
        >
          <Settings2 size={17} />
        </button>
      </header>
      {repo ? (
        <>
          <div className="toolbar">
            <nav>
              {(
                [
                  ["files", Files, "Edit"],
                  ["history", GitFork, `Git (${changes.length})`],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  className={`nav-tab ${mode === id ? "active" : ""}`}
                  onClick={() => switchMode(id)}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </nav>
            <div className="toolbar-spacer" />
            {mode === "history" && (
              <label className="search">
                <Search size={14} />
                <input
                  aria-label="Search commits"
                  placeholder="Search commits…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
                <kbd>⌕</kbd>
              </label>
            )}
          </div>
          <div className="workspaces">
            <Suspense
              fallback={
                <div className="empty">
                  <LoaderCircle className="spin" />
                  <small>Loading workspace…</small>
                </div>
              }
            >
              <PierreProvider>
                {(["history", "files"] as const).map((paneMode) => {
                  const active = mode === paneMode;
                  return (
                    <div
                      key={`${repo.root}:${paneMode}`}
                      className="workspace"
                      data-pane={paneMode}
                      aria-hidden={!active}
                      inert={!active}
                      style={{
                        opacity: active ? 1 : 0,
                        pointerEvents: active ? "auto" : "none",
                        zIndex: active ? 1 : 0,
                      }}
                    >
                      <ResizablePanel
                        className="sidebar"
                        label={
                          paneMode === "history" ? "branches panel" : "sidebar"
                        }
                        side="left"
                        initialWidth={230}
                        minWidth={190}
                        storageKey={`githeaven.${paneMode}.sidebar-width`}
                      >
                        {paneMode === "history" ? (
                          <BranchSidebar
                            activeRef={activeRef}
                            refs={repo.refs ?? []}
                            commitCount={repo.commits?.length ?? 0}
                            branch={repo.branch}
                            branchFilter={branchFilter}
                            onFilter={filterBranch}
                            onCheckout={checkoutBranch}
                            busy={!!busy}
                          />
                        ) : (
                          <>
                            <div className="section-label">
                              EXPLORER<span>{repo.files.length} files</span>
                            </div>
                            <div className="tree-wrap">
                              {(active || file) && (
                                <PierreTree
                                  key={repo.root}
                                  paths={repo.files}
                                  changes={changes}
                                  selected={file?.path}
                                  syncSelection
                                  revealPath={active ? file?.path : undefined}
                                  revealFocus={false}
                                  onSelect={(path) =>
                                    navigate(() => {
                                      void openFile(path);
                                    })
                                  }
                                />
                              )}
                            </div>
                          </>
                        )}
                      </ResizablePanel>
                      <main className="workspace-center">
                        {paneMode === "history" && (
                          <div
                            className="retained-view history-panel"
                            aria-hidden={diffOpen}
                            inert={diffOpen}
                            style={layerStyle(!diffOpen)}
                          >
                            {branchFilter && (
                              <div className="panel-title">
                                <button
                                  className="text-button"
                                  onClick={() => setBranchFilter("")}
                                >
                                  Clear branch filter <X size={12} />
                                </button>
                              </div>
                            )}
                            <History
                              root={repo.root}
                              active={active && !diffOpen}
                              hasMore={repo.has_more}
                              onLoadMore={loadOlder}
                              commits={visibleCommits}
                              refs={repo.refs ?? []}
                              selected={
                                reviewKind === "commit"
                                  ? selected?.oid
                                  : undefined
                              }
                              onSelectRef={setActiveRef}
                              onCheckoutRef={checkoutBranch}
                              onSelect={selectCommit}
                              head={repo.head}
                              branch={repo.branch}
                              workingCount={changes.length}
                              workingSelected={reviewKind === "working"}
                              onSelectWorking={showWorking}
                            />
                            {filter && (
                              <div className="filter-note">
                                Showing matching commits. Edges may continue
                                through hidden commits.
                              </div>
                            )}
                          </div>
                        )}
                        {(paneMode === "history"
                          ? (["commit", "working"] as const)
                          : (["editor"] as const)
                        ).map((kind) => {
                          const mode =
                            kind === "editor"
                              ? "files"
                              : kind === "commit"
                                ? "history"
                                : "changes";
                          const selection =
                            kind === "commit"
                              ? historySelection
                              : changeSelection;
                          const visible =
                            kind === "editor" ||
                            (diffOpen && reviewKind === kind);
                          return (
                            <section
                              key={kind}
                              className={`retained-view review-panel ${mode}`}
                              aria-hidden={!visible}
                              inert={!visible}
                              style={layerStyle(visible)}
                            >
                              <div className="file-panel">
                                <div className="file-toolbar">
                                  {mode !== "files" && (
                                    <button
                                      className="text-button back-to-graph"
                                      onClick={() => setDiffOpen(false)}
                                      aria-label="Back to graph"
                                    >
                                      <GitFork size={14} /> Graph
                                    </button>
                                  )}
                                  <FileCode2 size={15} />
                                  <span
                                    className="file-path"
                                    title={
                                      mode === "files"
                                        ? file?.path
                                        : selection?.path
                                    }
                                  >
                                    {mode === "files"
                                      ? (file?.path ?? "Editor")
                                      : (selection?.path ?? "Select a file")}
                                  </span>
                                  {mode === "files" && dirty && (
                                    <span className="dirty-dot" />
                                  )}
                                  <div className="toolbar-spacer" />
                                  {mode !== "files" ? (
                                    <>
                                      <div className="segmented">
                                        <button
                                          title="Split diff"
                                          aria-label="Split diff"
                                          className={split ? "active" : ""}
                                          onClick={() => setSplit(true)}
                                        >
                                          <Columns2 size={13} />
                                          Split
                                        </button>
                                        <button
                                          title="Unified diff"
                                          aria-label="Unified diff"
                                          className={!split ? "active" : ""}
                                          onClick={() => setSplit(false)}
                                        >
                                          Unified
                                        </button>
                                      </div>
                                      {selection && (
                                        <button
                                          className="icon-button"
                                          title="Edit working file"
                                          aria-label="Edit working file"
                                          onClick={() =>
                                            navigate(() => {
                                              void openFile(selection.path);
                                            })
                                          }
                                        >
                                          <ArrowUpRight size={15} />
                                        </button>
                                      )}
                                      {mode === "changes" && selection && (
                                        <button
                                          className="small-button"
                                          disabled={!!busy || dirty}
                                          onClick={() => {
                                            void toggleStage();
                                          }}
                                        >
                                          {staged ? (
                                            <Minus size={13} />
                                          ) : (
                                            <Plus size={13} />
                                          )}{" "}
                                          {staged
                                            ? "Unstage file"
                                            : "Stage file"}
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <>
                                      <span className="muted tiny">
                                        {dirty
                                          ? "Unsaved changes"
                                          : file
                                            ? "Saved to disk"
                                            : ""}
                                      </span>
                                      <button
                                        className="small-button"
                                        disabled={!dirty || !!busy}
                                        onClick={() => {
                                          void save();
                                        }}
                                      >
                                        <Save size={13} />
                                        Save <kbd>⌘S</kbd>
                                      </button>
                                    </>
                                  )}
                                </div>
                                {mode !== "files" && selection && (
                                  <div className="comparison-labels">
                                    <span>
                                      {selection.source === "commit"
                                        ? (details.parent?.slice(0, 7) ??
                                          "Empty tree")
                                        : selection.source === "index"
                                          ? "HEAD"
                                          : "Index"}
                                    </span>
                                    <span>
                                      {selection.source === "commit"
                                        ? selected?.oid.slice(0, 7)
                                        : selection.source === "index"
                                          ? "Staged changes"
                                          : "Working tree"}
                                    </span>
                                  </div>
                                )}
                                {external && mode === "files" && (
                                  <div className="external-warning">
                                    File changed on disk. Your draft is
                                    preserved.
                                    <button
                                      onClick={() =>
                                        file &&
                                        navigate(() => {
                                          void openFile(file.path);
                                        })
                                      }
                                    >
                                      Reload file
                                    </button>
                                  </div>
                                )}
                                <div
                                  className="surface-container"
                                  aria-busy={mode === "files" && loadingFile}
                                  inert={mode === "files" && loadingFile}
                                >
                                  <Suspense
                                    fallback={
                                      <div className="empty">
                                        <LoaderCircle className="spin" />
                                        <small>Loading Pierre…</small>
                                      </div>
                                    }
                                  >
                                    <>
                                      {mode === "files" ? (
                                        <>
                                          <div
                                            className="editor-slot"
                                            aria-hidden={!file}
                                            inert={!file}
                                            style={{ opacity: file ? 1 : 0 }}
                                          >
                                            <EditorSurface
                                              key={repo.root}
                                              session={file}
                                              root={repo.root}
                                              refresh={tick}
                                              onChange={onEditorChange}
                                              onReady={recordFileTiming}
                                            />
                                          </div>
                                          {!file && (
                                            <div className="empty editor-placeholder">
                                              {loadingFile ? (
                                                <>
                                                  <LoaderCircle className="spin" />
                                                  <p>Opening file…</p>
                                                </>
                                              ) : (
                                                <>
                                                  <Files size={30} />
                                                  <h3>
                                                    A little room to make
                                                    changes.
                                                  </h3>
                                                  <p>
                                                    Choose a file from the
                                                    explorer to start editing.
                                                  </p>
                                                </>
                                              )}
                                            </div>
                                          )}
                                        </>
                                      ) : selection ? (
                                        <DiffSurface
                                          root={repo.root}
                                          selection={selection}
                                          refresh={
                                            selection.source === "commit"
                                              ? 0
                                              : tick
                                          }
                                          deferRefresh={
                                            projectSettling ||
                                            (selection.source !== "commit" &&
                                              stageOperations.some(
                                                (operation) =>
                                                  operation.path ===
                                                    undefined ||
                                                  operation.path ===
                                                    selection.path,
                                              ))
                                          }
                                          split={split}
                                          onTiming={recordTiming}
                                        />
                                      ) : (
                                        <div className="empty">
                                          <GitCompareArrows size={30} />
                                          <h3>
                                            {mode === "changes"
                                              ? "Everything in its place."
                                              : "The story behind your code."}
                                          </h3>
                                          <p>
                                            {mode === "changes"
                                              ? "Select a changed file to review it."
                                              : "Select a commit to explore its changes."}
                                          </p>
                                        </div>
                                      )}
                                    </>
                                  </Suspense>
                                </div>
                              </div>
                            </section>
                          );
                        })}
                      </main>
                      {paneMode === "history" && (
                        <ResizablePanel
                          className="git-inspector"
                          label="staging and commit panel"
                          side="right"
                          initialWidth={330}
                          minWidth={270}
                          storageKey="githeaven.composer-width"
                        >
                          <div
                            className="retained-view working-inspector"
                            aria-hidden={reviewKind !== "working"}
                            inert={reviewKind !== "working"}
                            style={layerStyle(reviewKind === "working")}
                          >
                            <div className="panel-title">
                              <span>
                                {changes.length}{" "}
                                {changes.length === 1
                                  ? "file change"
                                  : "file changes"}{" "}
                                on{" "}
                                <strong className="branch-badge">
                                  {repo.branch}
                                </strong>
                              </span>
                            </div>
                            <ChangeSections
                              changes={changes}
                              selected={changeSelection}
                              onSelect={chooseChange}
                              onStageAll={stageAllChanges}
                              busy={!!busy || dirty}
                              selectionActive={
                                diffOpen && reviewKind === "working"
                              }
                            />
                            <div className="commit-form">
                              <div className="commit-form-title">
                                <GitCommitHorizontal size={15} />
                                Commit<span>{stagedChanges.length} staged</span>
                              </div>
                              <div className="commit-fields">
                                <input
                                  aria-label="Commit summary"
                                  placeholder="Commit summary"
                                  value={message}
                                  onChange={(event) =>
                                    setMessage(event.target.value)
                                  }
                                />
                                <textarea
                                  aria-label="Commit description"
                                  placeholder="Description (optional)"
                                  value={description}
                                  onChange={(event) =>
                                    setDescription(event.target.value)
                                  }
                                />
                              </div>
                              <button
                                className="primary-button"
                                disabled={
                                  !stagedChanges.length ||
                                  !message.trim() ||
                                  !!busy ||
                                  indexPending ||
                                  dirty
                                }
                                onClick={() => {
                                  void commit();
                                }}
                              >
                                <GitCommitHorizontal size={15} />
                                {busy === "Committing"
                                  ? "Committing…"
                                  : !stagedChanges.length
                                    ? "Stage files to commit"
                                    : !message.trim()
                                      ? "Write a summary to commit"
                                      : `Commit ${stagedChanges.length} ${stagedChanges.length === 1 ? "file" : "files"}`}
                              </button>
                            </div>
                          </div>
                          <div
                            className="retained-view commit-inspector"
                            aria-hidden={reviewKind !== "commit"}
                            inert={reviewKind !== "commit"}
                            style={layerStyle(reviewKind === "commit")}
                          >
                            <div className="panel-title">
                              <span>
                                <GitCommitHorizontal size={15} />
                                Commit details
                              </span>
                              <button
                                className="text-button"
                                onClick={showWorking}
                              >
                                Working changes
                              </button>
                            </div>
                            {selected && (
                              <>
                                <div className="commit-details">
                                  <div className="commit-avatar">
                                    {selected.author.slice(0, 2).toUpperCase()}
                                  </div>
                                  <div className="commit-text">
                                    <strong>{selected.subject}</strong>
                                    <span>
                                      {selected.author}
                                      <span className="dot-separator">·</span>
                                      {new Date(
                                        selected.timestamp * 1000,
                                      ).toLocaleString()}
                                      <span className="dot-separator">·</span>
                                      <code>{selected.oid.slice(0, 7)}</code>
                                    </span>
                                    {details.message.trim().includes("\n") && (
                                      <details>
                                        <summary>Full commit message</summary>
                                        <pre>{details.message}</pre>
                                      </details>
                                    )}
                                  </div>
                                  {selected.parents.length > 1 && (
                                    <select
                                      aria-label="Compare merge parent"
                                      value={parent ?? selected.parents[0]}
                                      onChange={(e) =>
                                        setParent(e.target.value)
                                      }
                                    >
                                      {selected.parents.map((p, i) => (
                                        <option key={p} value={p}>
                                          Parent {i + 1} · {p.slice(0, 7)}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <span className="files-changed">
                                    {details.paths.length} files changed
                                  </span>
                                </div>
                              </>
                            )}
                            <div className="section-label">
                              CHANGED FILES<span>{details.paths.length}</span>
                            </div>
                            <div className="tree-wrap">
                              <PierreTree
                                key={`${repo.root}:${selected?.oid}:${parent}`}
                                paths={details.paths}
                                selectionActive={
                                  diffOpen && reviewKind === "commit"
                                }
                                onSelect={(path) => {
                                  if (selected) {
                                    setHistorySelection({
                                      source: "commit",
                                      path,
                                      oid: selected.oid,
                                      parent: details.parent,
                                    });
                                    setDiffOpen(true);
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </ResizablePanel>
                      )}
                    </div>
                  );
                })}
              </PierreProvider>
            </Suspense>
          </div>
          <footer className="statusbar">
            <span>
              <GitBranch size={12} />
              {repo.branch}
            </span>
            <span>
              {busy ||
                notice ||
                `${changes.length} changed · ${stagedChanges.length} staged`}
            </span>
          </footer>
        </>
      ) : restoringRepository ? (
        <div className="empty" role="status">
          <LoaderCircle className="spin" size={24} />
          <p>Opening your repository…</p>
        </div>
      ) : (
        <div className="welcome">
          <div className="welcome-copy">
            <span className="eyebrow">YOUR CODE. A CLEARER VIEW.</span>
            <h1>
              Good changes
              <br />
              start here<span>.</span>
            </h1>
            <p>
              Your branches, files, and diffs.
              <br />
              One focused, local Git workspace.
            </p>
            <button
              className="primary-button"
              disabled={!!busy}
              onClick={() => {
                void chooseRepository();
              }}
            >
              <FolderOpen size={17} />
              {busy || "Open a repository"}
              <ArrowUpRight size={16} />
            </button>
            <div className="path-open">
              <label htmlFor="repo-path">Or enter a repository path</label>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void openRepository(openPath);
                }}
              >
                <input
                  id="repo-path"
                  placeholder="/path/to/your/repository"
                  value={openPath}
                  onChange={(e) => setOpenPath(e.target.value)}
                />
                <button aria-label="Open path" disabled={!!busy || !openPath}>
                  <ArrowUpRight size={16} />
                </button>
              </form>
            </div>
            {!native && (
              <div className="browser-note">
                Browser preview · launch <code>npm run tauri dev</code> for
                local Git access.
              </div>
            )}
          </div>
          <div className="welcome-art">
            <svg viewBox="0 0 420 400" fill="none">
              <path
                d="M120 0v400M200 0v90c0 30-80 40-80 85M290 0v200c0 45-90 35-90 90v110M120 180c0 45 80 40 80 90M290 200c0 45 70 40 70 90v110"
                stroke="currentColor"
                strokeWidth="2"
              />
              <g fill="#121718" stroke="currentColor" strokeWidth="2">
                {[40, 110, 180, 260, 330].map((y) => (
                  <circle key={y} cx="120" cy={y} r="7" />
                ))}
                <circle cx="200" cy="55" r="7" />
                <circle cx="290" cy="100" r="7" />
                <circle cx="290" cy="200" r="7" />
                <circle cx="200" cy="325" r="7" />
                <circle cx="360" cy="350" r="7" />
              </g>
            </svg>
            <div className="art-label">
              <span className="status-dot" />A little closer to your code.
            </div>
          </div>
        </div>
      )}
      {quickOpen && (
        <QuickOpen
          key={`${repo?.root}:${quickOpen}`}
          mode={quickOpen}
          items={quickOpen === "files" ? quickFiles : quickCommands}
          onClose={() => setQuickOpen(null)}
          onPick={pickQuickItem}
        />
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {showPerf && (
        <div className="perf-popover">
          <div className="panel-title">
            <span>Performance notebook</span>
            <button
              className="icon-button"
              aria-label="Close measurements"
              onClick={() => setShowPerf(false)}
            >
              <X size={14} />
            </button>
          </div>
          {watchWarning && (
            <p>
              File watching is unavailable; changes are refreshed by polling.{" "}
              {watchWarning}
            </p>
          )}
          <dl>
            <div>
              <dt>Last file → editable + paint opportunity</dt>
              <dd>{fileTimes.at(-1)?.total.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>File read (included above)</dt>
              <dd>{fileTimes.at(-1)?.read.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>File opens · {fileTimes.length} samples</dt>
              <dd>
                {fileTimes.map((t) => t.total.toFixed(0)).join(", ") || "—"} ms
              </dd>
            </div>
            <div>
              <dt>Last Git refresh</dt>
              <dd>{repo?.elapsed_ms.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Last diff, request → render</dt>
              <dd>{times.at(-1)?.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Diff p95 · {times.length} samples</dt>
              <dd>{p95?.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Last repository switch → paint opportunity</dt>
              <dd>
                {projectTimes.at(-1)?.paint?.toFixed(1) ?? "—"} ms{" "}
                {projectTimes.at(-1)
                  ? projectTimes.at(-1)!.cached
                    ? "(cached)"
                    : "(first open)"
                  : ""}
              </dd>
            </div>
            <div>
              <dt>Last repository React commit</dt>
              <dd>{projectTimes.at(-1)?.commit.toFixed(1) ?? "—"} ms</dd>
            </div>
            {[true, false].map((cached) => {
              const samples = projectTimes
                .filter((t) => t.cached === cached)
                .flatMap((t) => (t.paint === null ? [] : [t.paint]))
                .sort((a, b) => a - b);
              return (
                <div key={String(cached)}>
                  <dt>
                    {cached
                      ? "Cached repository switches"
                      : "First repository opens"}{" "}
                    p95 · {samples.length} samples
                  </dt>
                  <dd>
                    {samples.length
                      ? samples[Math.ceil(samples.length * 0.95) - 1].toFixed(1)
                      : "—"}{" "}
                    ms
                  </dd>
                </div>
              );
            })}
            {projectTimes.some((t) => t.paint === null) && (
              <div>
                <dt>
                  Repository paint samples excluded (background/focus change)
                </dt>
                <dd>{projectTimes.filter((t) => t.paint === null).length}</dd>
              </div>
            )}
            <div>
              <dt>Last tab switch → paint opportunity</dt>
              <dd>{tabTimes.at(-1)?.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Tab switch p95 · {tabTimes.length} samples</dt>
              <dd>
                {tabTimes.length
                  ? [...tabTimes]
                      .sort((a, b) => a - b)
                      [Math.ceil(tabTimes.length * 0.95) - 1].toFixed(1)
                  : "—"}{" "}
                ms
              </dd>
            </div>
            <div>
              <dt>Last tab React commit</dt>
              <dd>{tabCommitTime?.toFixed(1) ?? "—"} ms</dd>
            </div>
            <div>
              <dt>Loaded commits</dt>
              <dd>{repo?.commits?.length ?? 0} / 5,000 cap</dd>
            </div>
            <div>
              <dt>Highlight workers</dt>
              <dd>2 maximum</dd>
            </div>
          </dl>
          <p>
            Diff timing includes IPC, Git reads, diff computation, and first
            render. Highlighting may finish later. Use Activity Monitor for
            total app + WebKit memory; development builds are not benchmarks.
          </p>
          <button
            className="text-button"
            onClick={() => {
              setTimes([]);
              setTabTimes([]);
              setFileTimes([]);
              setProjectTimes([]);
            }}
          >
            Reset samples
          </button>
        </div>
      )}
      {checkoutPrompt && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="stash-title"
          >
            <h2 id="stash-title">Stash changes before switching?</h2>
            <p>
              Your staged, unstaged, and untracked files will be saved in a Git
              stash before switching to {checkoutPrompt.name}. The stash stays
              saved for you to apply later.
            </p>
            <div className="modal-actions">
              <button autoFocus onClick={() => setCheckoutPrompt(null)}>
                Cancel switch
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  const ref = checkoutPrompt;
                  setCheckoutPrompt(null);
                  checkoutBranch(ref, true);
                }}
              >
                Stash and switch
              </button>
            </div>
          </div>
        </div>
      )}
      {pending && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="unsaved-title"
          >
            <FileCode2 size={24} />
            <h2 id="unsaved-title">Keep your changes?</h2>
            <p>
              <strong>{file?.path}</strong> has unsaved edits. Save them before
              leaving, or discard the draft.
            </p>
            <div className="modal-actions">
              <button className="small-button" onClick={() => setPending(null)}>
                Keep editing
              </button>
              <button
                className="small-button"
                onClick={() => {
                  const action = pending;
                  markDirty(false);
                  draft.current = original.current;
                  setFile((f) =>
                    f
                      ? {
                          ...f,
                          contents: original.current,
                          version: Date.now(),
                        }
                      : f,
                  );
                  setPending(null);
                  action();
                }}
              >
                Discard
              </button>
              <button
                className="primary-button"
                disabled={!!busy}
                onClick={async () => {
                  const action = pending;
                  if (await save()) {
                    setPending(null);
                    action();
                  }
                }}
              >
                Save & continue
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
