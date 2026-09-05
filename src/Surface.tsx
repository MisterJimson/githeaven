import {
  memo,
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
  type CodeViewHandle,
} from "@pierre/diffs/react";
import { Editor, type EditorFactory } from "@pierre/diffs/edit";
import {
  getSharedHighlighter,
  type CodeViewItem,
  type FileDiffMetadata,
} from "@pierre/diffs";
import HighlightWorker from "@pierre/diffs/worker/worker.js?worker";
import { FileCode2, LoaderCircle } from "lucide-react";
import { call, errorText } from "./api";
import { useEditorChanges, changeGutterCSS } from "./useEditorChanges";
import { startForegroundTiming } from "./timing";
import type { Selection, Versions } from "./types";

const poolOptions = {
  workerFactory: () => new HighlightWorker(),
  poolSize: 2,
  totalASTLRUCacheSize: 12,
};
const highlighterOptions = {
  theme: "pierre-dark" as const,
  preferredHighlighter: "shiki-wasm" as const,
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
  new Editor(type, { ...options, historyMaxEntries: 150 });
export function PierreProvider({ children }: { children: React.ReactNode }) {
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
      <EditProvider createEditor={createEditor}>{children}</EditProvider>
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
  // Moving a working file between index and worktree retains its viewport too.
  return <LiveDiff key={comparison} {...props} comparison={comparison} />;
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
  const [item, setItem] = useState<CodeViewItem<undefined> | null>(null);
  const [error, setError] = useState("");
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const loaded = useRef<Versions | null>(null);
  const revision = useRef(0);
  const timing = useRef(onTiming);
  timing.current = onTiming;
  const started = useRef<{
    version: number;
    finish: () => number | null;
  } | null>(null);
  const measured = useRef(0);
  const { path, source, oid, parent, oldPath } = selection;

  useEffect(() => {
    if (deferRefresh) return;
    let active = true;
    let worker: Worker | undefined;
    setError("");
    const timer = setTimeout(() => {
      const finish = startForegroundTiming();
      call<Versions>("file_versions", {
        root,
        path,
        source,
        oid: oid ?? null,
        parent: parent ?? null,
        oldPath: oldPath ?? null,
      })
        .then((data) => {
          if (!active) return;
          if (data.old === null && data.new === null) {
            setError("This file no longer exists in this comparison.");
            return;
          }
          // Repository events include unrelated files and focus/poll refreshes.
          // Do not reparse or publish an identical snapshot.
          if (
            loaded.current?.old === data.old &&
            loaded.current?.new === data.new
          )
            return;
          worker = new Worker(new URL("./diff.worker.ts", import.meta.url), {
            type: "module",
          });
          worker.onmessage = (
            event: MessageEvent<{ result?: FileDiffMetadata; error?: string }>,
          ) => {
            if (!active) return;
            if (event.data.error) setError(event.data.error);
            else if (event.data.result) {
              const version = ++revision.current;
              loaded.current = data;
              started.current = { version, finish };
              // Pierre reconciles a stable id plus a new version in place, retaining
              // the live viewer and its numeric line/viewport scroll anchor.
              setItem({
                id: comparison,
                version,
                type: "diff",
                fileDiff: event.data.result,
              });
            }
            worker?.terminate();
          };
          worker.onerror = (event) => {
            if (active) setError(event.message || "Diff worker failed");
            worker?.terminate();
          };
          worker.postMessage({ path, old: data.old, new: data.new });
        })
        .catch((error) => {
          if (active) setError(errorText(error));
        });
    }, 35);
    return () => {
      active = false;
      clearTimeout(timer);
      worker?.terminate();
    };
  }, [
    root,
    path,
    source,
    oid,
    parent,
    oldPath,
    refresh,
    comparison,
    deferRefresh,
  ]);

  const onPostRender = useCallback(() => {
    const start = started.current;
    if (
      !start ||
      measured.current === start.version ||
      view.current?.getItem(comparison)?.version !== start.version
    )
      return;
    measured.current = start.version;
    requestAnimationFrame(() => {
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
  const view = useRef<CodeViewHandle<undefined, undefined>>(null);
  const { host, paint, schedule } = useEditorChanges(
    root,
    session.path,
    session.contents,
    session.version,
    refresh,
  );
  const current = useRef({ session, onReady });
  current.current = { session, onReady };
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
      if (ms != null) current.current.onReady(ms, opened.readMs ?? 0);
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
      unsafeCSS: font.unsafeCSS + changeGutterCSS,
      onPostRender,
    }),
    [onPostRender, font],
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
      onKeyDownCapture={onKeyDownCapture}
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
