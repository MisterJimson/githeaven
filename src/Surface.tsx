import { ImageDiff, isImagePath } from "./ImageDiff";
import {
  memo,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  CodeView,
  EditProvider,
  WorkerPoolContextProvider,
  useWorkerPool,
  type CodeViewHandle,
} from "@pierre/diffs/react";
import {
  Editor,
  resolveEditorCommandFromKeyboardEvent,
  type EditorFactory,
} from "@pierre/diffs/edit";
import {
  getSharedHighlighter,
  getHighlighterIfLoaded,
  getFiletypeFromFileName,
  type CodeViewItem,
} from "@pierre/diffs";
import HighlightWorker from "@pierre/diffs/worker/worker.js?worker";
import { FileCode2, LoaderCircle } from "lucide-react";
import {
  DiffCache,
  DiffPreparationSuperseded,
  type PreparedDiff,
} from "./DiffCache";
import { nearbyDiffs } from "./diffPrefetch";
import { errorText } from "./api";
import { useEditorChanges, changeGutterCSS } from "./useEditorChanges";
import { countEvent, registerGauge, startSpan } from "./performance";
import { startForegroundTiming } from "./timing";
import { measureEditorNavigation } from "./editorNavigation";
import type { Change, Selection, Versions } from "./types";

const poolOptions = {
  workerFactory: () => new HighlightWorker(),
  poolSize: 2,
  totalASTLRUCacheSize: 24,
};
const highlighterOptions = {
  theme: "pierre-dark" as const,
  preferredHighlighter: "shiki-wasm" as const,
  tokenizeMaxLineLength: 2000,
  maxLineDiffLength: 2000,
  langs: [
    "typescript",
    "tsx",
    "javascript",
    "json",
    "rust",
    "markdown",
  ] as const,
};
const createEditor: EditorFactory<undefined, undefined> = (type, options) =>
  new Editor(type, {
    ...options,
    historyMaxEntries: 150,
    viewportHighlight: type === "file",
  });
const DiffCacheContext = createContext<DiffCache | null>(null);
function PreparedDiffs({
  children,
  root,
  changes,
  refresh,
  selection,
  previews,
}: {
  children: React.ReactNode;
  root?: string;
  changes?: Change[];
  refresh: number;
  selection?: Selection | null;
  previews?: Selection[];
}) {
  const pool = useWorkerPool();
  const cache = useMemo(() => (pool ? new DiffCache(pool) : null), [pool]);
  useEffect(() => {
    if (!cache || !pool) return;
    const removeCache = registerGauge("diff.cache", () => cache.stats());
    const removePool = registerGauge("diff.workers", () => ({
      ...pool.getStats(),
    }));
    return () => {
      removeCache();
      removePool();
    };
  }, [cache, pool]);
  useEffect(() => {
    if (!cache || !root || (!changes && !previews)) return;
    let active = true;
    const candidates: Selection[] = [...(previews ?? [])];
    for (const change of previews ? [] : (changes ?? [])) {
      if (change.worktree !== " ")
        candidates.push({
          path: change.path,
          source: "worktree",
          oldPath: change.original_path,
        });
      if (change.index !== " " && change.index !== "?")
        candidates.push({
          path: change.path,
          source: "index",
          oldPath: change.original_path,
        });
    }
    const nearby = nearbyDiffs(candidates, selection);
    const timer = setTimeout(() => {
      void (async () => {
        // One speculative diff at a time; leave the second highlight worker free for clicks.
        for (const { selection: candidate, maxBytes } of nearby) {
          if (!active) break;
          try {
            await cache.prepare(
              root,
              candidate,
              candidate.source === "commit" ? 0 : refresh,
              false,
              maxBytes,
            );
          } catch {
            /* Explicit selection reports errors. */
          }
        }
      })();
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    cache,
    root,
    changes,
    refresh,
    selection?.path,
    selection?.source,
    selection?.oid,
    selection?.parent,
    previews,
  ]);
  return (
    <DiffCacheContext.Provider value={cache}>
      {children}
    </DiffCacheContext.Provider>
  );
}
export function PierreProvider({
  children,
  root,
  changes,
  refresh = 0,
  selection,
  previews,
}: {
  children: React.ReactNode;
  root?: string;
  changes?: Change[];
  refresh?: number;
  selection?: Selection | null;
  previews?: Selection[];
}) {
  useEffect(() => {
    let cancelled = false;
    // Editable documents use a main-thread highlighter, separate from the pool.
    // Load and exercise its grammars before the first click, yielding between them.
    const warm = async () => {
      for (const lang of highlighterOptions.langs) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (cancelled) return;
        const highlighter = await getSharedHighlighter({
          themes: ["pierre-dark"],
          langs: [lang],
          preferredHighlighter: "shiki-wasm",
        });
        if (cancelled) return;
        highlighter.codeToTokens(
          'import { value } from "module";\nconst example = { value: 1 }; // example',
          {
            lang,
            theme: "pierre-dark",
          },
        );
      }
    };
    void warm().catch(() => {
      /* Opening a file retries initialization. */
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={{
        ...highlighterOptions,
        langs: [...highlighterOptions.langs],
      }}
    >
      <EditProvider createEditor={createEditor}>
        <PreparedDiffs
          root={root}
          changes={changes}
          refresh={refresh}
          selection={selection}
          previews={previews}
        >
          {children}
        </PreparedDiffs>
      </EditProvider>
    </WorkerPoolContextProvider>
  );
}
const shared = {
  theme: "pierre-dark" as const,
  themeType: "dark" as const,
  disableFileHeader: true,
  overflow: "scroll" as const,
  tokenizeMaxLineLength: 2000,
  maxLineDiffLength: 2000,
  unsafeCSS:
    ':host { --diffs-font-family: "SFMono-Regular", Consolas, monospace; --diffs-font-size: 12px; --diffs-line-height: 21px; }',
};

function useViewerFont(kind: "editor" | "diff") {
  const [size, setSize] = useState(() => {
    const saved = Number(localStorage.getItem(`githeaven.${kind}-font-size`));
    return saved >= 8 && saved <= 32 ? saved : 12;
  });
  const font = useMemo(
    () => ({
      unsafeCSS: `:host { --diffs-font-family: "SFMono-Regular", Consolas, monospace; --diffs-font-size: ${size}px; --diffs-line-height: ${size + 9}px; }`,
      itemMetrics: { lineHeight: size + 9 },
    }),
    [size],
  );
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !(event.metaKey || event.ctrlKey) ||
      event.altKey ||
      event.nativeEvent.isComposing
    )
      return;
    const delta =
      event.key === "+" || event.key === "=" ? 1 : event.key === "-" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    setSize((current) => {
      const next = Math.max(8, Math.min(32, current + delta));
      localStorage.setItem(`githeaven.${kind}-font-size`, String(next));
      return next;
    });
  };
  return { font, onKeyDownCapture };
}

interface DiffProps {
  root: string;
  selection: Selection;
  refresh: number;
  split: boolean;
  onTiming: (ms: number) => void;
  deferRefresh?: boolean;
}

export const DiffSurface = memo(function DiffSurface(props: DiffProps) {
  const {
    root,
    selection: { path, source, oid, parent, oldPath },
  } = props;
  const comparison = JSON.stringify([
    root,
    source === "commit" ? source : "working",
    path,
    oid ?? null,
    parent ?? null,
    source === "commit" ? (oldPath ?? null) : null,
  ]);
  // Keep the previous document mounted while another file is prepared.
  if (isImagePath(path)) return <ImageDiff key={root} {...props} />;
  return <LiveDiff key={root} {...props} comparison={comparison} />;
});

function LiveDiff({
  root,
  selection,
  refresh,
  split,
  onTiming,
  comparison,
  deferRefresh = false,
}: DiffProps & { comparison: string }) {
  const { font, onKeyDownCapture } = useViewerFont("diff");
  const workerPool = useWorkerPool();
  const sharedCache = useContext(DiffCacheContext);
  const localCache = useMemo(
    () =>
      new DiffCache(
        workerPool ?? {
          primeDiffHighlightCache: () =>
            Promise.reject(new Error("Syntax highlighting is unavailable.")),
        },
      ),
    [workerPool],
  );
  const cache = sharedCache ?? localCache;
  const [initial] = useState(() => cache.peek(root, selection));
  const [item, setItem] = useState<CodeViewItem<undefined> | null>(() =>
    initial
      ? { id: comparison, version: 1, type: "diff", fileDiff: initial.diff }
      : null,
  );
  const [error, setError] = useState("");
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const loaded = useRef<Versions | null>(initial?.versions ?? null);
  const loadedComparison = useRef(initial ? comparison : null);
  const revision = useRef(initial ? 1 : 0);
  const timing = useRef(onTiming);
  timing.current = onTiming;
  const started = useRef<{
    version: number;
    finish: () => number | null;
  } | null>(
    initial
      ? { version: 1, finish: startForegroundTiming("ui.diff-ready") }
      : null,
  );
  const measured = useRef(0);
  const { path, source, oid, parent, oldPath } = selection;

  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  const requestRefresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (deferRefresh) return;
    let active = true;
    let running = false;
    let completed: number | undefined;
    const publish = (prepared: PreparedDiff, finish: () => number | null) => {
      const data = prepared.versions;
      if (
        loadedComparison.current === comparison &&
        loaded.current?.old === data.old &&
        loaded.current?.new === data.new
      )
        return;
      const version = ++revision.current;
      loaded.current = data;
      loadedComparison.current = comparison;
      started.current = { version, finish };
      setItem({
        id: comparison,
        version,
        type: "diff",
        fileDiff: prepared.diff,
      });
    };
    const run = async () => {
      if (running || !active || completed === latestRefresh.current) return;
      running = true;
      try {
        while (active && completed !== latestRefresh.current) {
          const requested = latestRefresh.current;
          setError("");
          const finish = startForegroundTiming("ui.diff-ready");
          try {
            const prepared = await cache.prepare(root, selection, requested);
            if (!active) return;
            publish(prepared, finish);
          } catch (error) {
            if (active && !(error instanceof DiffPreparationSuperseded))
              setError(errorText(error));
          }
          completed = requested;
        }
      } finally {
        running = false;
      }
    };
    requestRefresh.current = () => {
      void run();
    };
    void run();
    return () => {
      active = false;
      requestRefresh.current = null;
    };
  }, [
    cache,
    root,
    path,
    source,
    oid,
    parent,
    oldPath,
    comparison,
    deferRefresh,
  ]);
  useEffect(() => {
    requestRefresh.current?.();
  }, [refresh]);

  useLayoutEffect(() => {
    // Reset only when the prepared replacement is installed, never while waiting
    // or refreshing the currently displayed file.
    if (item) view.current?.scrollTo({ type: "position", position: 0 });
  }, [item?.id]);

  const onPostRender = useCallback(() => {
    const start = started.current;
    if (!start || measured.current === start.version) return;
    requestAnimationFrame(() => {
      if (
        started.current !== start ||
        measured.current === start.version ||
        view.current?.getItem(comparison)?.version !== start.version
      )
        return;
      measured.current = start.version;
      const elapsed = start.finish();
      if (started.current === start && elapsed !== null)
        timing.current(elapsed);
    });
  }, [comparison]);
  const items = useMemo(() => (item ? [item] : []), [item]);
  const options = useMemo(
    () => ({
      ...shared,
      ...font,
      diffStyle: split ? ("split" as const) : ("unified" as const),
      onPostRender,
    }),
    [split, onPostRender, font],
  );

  if (!item)
    return error ? (
      <div className="empty">
        <FileCode2 size={26} />
        <p>Preview unavailable</p>
        <small>{error}</small>
      </div>
    ) : (
      <div className="empty">
        <LoaderCircle className="spin" size={22} />
        <small>Loading comparison…</small>
      </div>
    );
  return (
    <div
      className="diff-live"
      tabIndex={0}
      aria-label="Diff viewer"
      onKeyDownCapture={onKeyDownCapture}
    >
      <CodeView
        ref={view}
        className="code-view"
        items={items}
        options={options}
      />
      {error && (
        <div className="diff-refresh-error" role="status">
          Refresh unavailable — showing the last diff. {error}
        </div>
      )}
    </div>
  );
}

export interface FileSession {
  path: string;
  original: string;
  contents: string;
  version: number;
  finishOpen?: () => number | null;
  readMs?: number;
}
const emptyEditorSession: FileSession = {
  path: "",
  original: "",
  contents: "",
  version: 0,
};
export const EditorSurface = memo(function EditorSurface({
  session: selectedSession,
  root,
  refresh = 0,
  onChange,
  onReady,
}: {
  session: FileSession | null;
  root?: string;
  refresh?: number;
  onChange: (text: string) => void;
  onReady: (ms: number, readMs: number) => void;
}) {
  const { font, onKeyDownCapture } = useViewerFont("editor");
  const session = selectedSession ?? emptyEditorSession;
  const cancelNavigation = useRef<(() => void) | undefined>(undefined);
  useEffect(
    () => () => cancelNavigation.current?.(),
    [session.path, session.version],
  );
  const viewportHighlight = useMemo(() => {
    const highlighter = getHighlighterIfLoaded();
    return (
      highlighter?.getLoadedThemes().includes("pierre-dark") === true &&
      highlighter
        .getLoadedLanguages()
        .includes(getFiletypeFromFileName(session.path))
    );
  }, [session.path, session.version]);
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const { host, paint, schedule } = useEditorChanges(
    root,
    session.path,
    session.contents,
    session.version,
    refresh,
  );
  const current = useRef({ session, onReady, viewportHighlight });
  current.current = { session, onReady, viewportHighlight };
  const measured = useRef(0);
  const onPostRender = useCallback(() => {
    paint();
    const opened = current.current.session;
    if (!opened.finishOpen || measured.current === opened.version) return;
    requestAnimationFrame(() => {
      if (
        current.current.session.version !== opened.version ||
        measured.current === opened.version ||
        view.current?.getEditor("editor")?.getFile()?.name !== opened.path
      )
        return;
      measured.current = opened.version;
      const ms = opened.finishOpen?.();
      if (ms == null) return;
      if (current.current.viewportHighlight) {
        const colored = host.current
          ?.querySelector("diffs-container")
          ?.shadowRoot?.querySelector(
            "[data-content] span[data-char][style*='color']",
          );
        countEvent(
          colored
            ? "editor.viewport-first-frame.colored"
            : "editor.viewport-first-frame.uncolored",
        );
      }
      current.current.onReady(ms, opened.readMs ?? 0);
    });
  }, [paint]);
  useLayoutEffect(() => {
    // A different file starts at the top; same-file refreshes keep their viewport.
    view.current?.scrollTo({ type: "position", position: 0 });
  }, [session.path]);
  const options = useMemo(
    () => ({
      ...shared,
      ...font,
      tokenizeMaxLength: viewportHighlight ? 0 : undefined,
      unsafeCSS: font.unsafeCSS + changeGutterCSS,
      onPostRender,
    }),
    [onPostRender, font, viewportHighlight],
  );
  const change = useCallback(
    (event: { file: { contents: string } }) => {
      schedule(event.file.contents);
      onChange(event.file.contents);
    },
    [onChange, schedule],
  );
  const items = useMemo<CodeViewItem<undefined>[]>(
    () => [
      {
        // One editor slot; Pierre resets the document/undo state when its name changes.
        id: "editor",
        version: session.version,
        type: "file",
        file: { name: session.path, contents: session.contents },
        edit: true,
      },
    ],
    [session.path, session.version],
  );
  return (
    <div
      ref={host}
      className="editor-live"
      tabIndex={0}
      aria-label="File viewer"
      onKeyDownCapture={(event) => {
        onKeyDownCapture(event);
        cancelNavigation.current?.();
        const command = resolveEditorCommandFromKeyboardEvent(
          event.nativeEvent,
        );
        if (
          event.isDefaultPrevented() ||
          event.nativeEvent.isComposing ||
          (command !== "moveCursorToDocStart" &&
            command !== "moveCursorToDocEnd") ||
          !event.nativeEvent
            .composedPath()
            .some(
              (node) =>
                node instanceof HTMLElement &&
                node.getAttribute("contenteditable") === "true",
            )
        )
          return;
        const editor = view.current?.getEditor("editor");
        const doc = editor?.getEditState()?.document;
        if (editor && doc && host.current) {
          const line = command === "moveCursorToDocStart" ? 1 : doc.lineCount;
          const controller = new AbortController();
          const cancel = measureEditorNavigation(
            host.current,
            line,
            command === "moveCursorToDocStart" ? "start" : "end",
            () => controller.abort(),
          );
          cancelNavigation.current = cancel;
          event.preventDefault();
          event.stopPropagation();
          const finishPreparation = startSpan("editor.jump-prepare");
          void editor
            .prepareLine(line, controller.signal)
            .then((ready) => {
              if (!ready || controller.signal.aborted) {
                cancel();
                return;
              }
              finishPreparation();
              // Keep the previous highlighted viewport until prefix state is
              // ready; then move the caret and virtual viewport together.
              editor.focus({
                lineNumber: line,
                character:
                  command === "moveCursorToDocEnd"
                    ? doc.getLineLength(line - 1)
                    : 0,
                preventScroll: true,
              });
              view.current?.scrollTo({
                type: "line",
                id: "editor",
                lineNumber: line,
                behavior: "instant",
              });
            })
            .catch(() => {
              finishPreparation("error");
              cancel();
            });
        }
      }}
    >
      <CodeView
        ref={view}
        className="code-view"
        items={items}
        options={options}
        onItemEditChange={change}
      />
    </div>
  );
});
