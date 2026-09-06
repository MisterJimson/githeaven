// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  useImperativeHandle,
  useLayoutEffect,
  type Ref,
  type ReactNode,
} from "react";
import type { CodeViewItem } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import { DiffSurface, EditorSurface } from "./Surface";
import { call } from "./api";
import type { Versions } from "./types";

const highlightPool = vi.hoisted(() => ({ primeDiffHighlightCache: vi.fn() }));
const installed = vi.hoisted(() => vi.fn());
const scrollTo = vi.hoisted(() => vi.fn());
vi.mock("./api", () => ({ call: vi.fn(), errorText: String }));
vi.mock("@pierre/diffs/worker/worker.js?worker", () => ({ default: class {} }));
vi.mock("@pierre/diffs/react", () => ({
  useWorkerPool: () => highlightPool,
  EditProvider: ({ children }: { children: ReactNode }) => children,
  WorkerPoolContextProvider: ({ children }: { children: ReactNode }) =>
    children,
  CodeView: ({
    items,
    options,
    ref,
  }: {
    items: CodeViewItem<undefined>[];
    options: {
      onPostRender: () => void;
      unsafeCSS?: string;
      itemMetrics?: { lineHeight: number };
    };
    ref: Ref<CodeViewHandle<undefined, undefined>>;
  }) => {
    useImperativeHandle(
      ref,
      () =>
        ({
          getItem: (id: string) => items.find((item) => item.id === id),
          scrollTo,
        }) as unknown as CodeViewHandle<undefined, undefined>,
      [items],
    );
    useLayoutEffect(() => {
      installed(items);
      options.onPostRender();
    }, [items, options]);
    const item = items[0];
    return (
      <div
        data-testid="viewer"
        data-css={options.unsafeCSS}
        data-line-height={options.itemMetrics?.lineHeight}
        data-id={item.id}
        data-version={item.version}
        style={{ overflow: "auto", height: 200 }}
      >
        <div style={{ height: 3000, width: 3000 }}>
          {item.type === "diff" ? item.fileDiff.name : ""}
        </div>
      </div>
    );
  },
}));

class DiffWorker {
  static instances: DiffWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string }) => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    DiffWorker.instances.push(this);
  }
  deliver(name: string) {
    this.onmessage?.({ data: { result: { name } } });
  }
}
beforeEach(() => {
  highlightPool.primeDiffHighlightCache
    .mockReset()
    .mockResolvedValue(undefined);
  vi.stubGlobal("Worker", DiffWorker);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  DiffWorker.instances = [];
});
const versions = (text: string): Versions => ({
  old: "base",
  new: text,
  elapsed_ms: 1,
});
const props = {
  root: "/repo",
  selection: { path: "file.ts", source: "worktree" as const },
  split: true,
  onTiming: vi.fn(),
};
async function finishWorker(index: number, text: string) {
  await waitFor(() =>
    expect(DiffWorker.instances.length).toBeGreaterThan(index),
  );
  await act(async () => DiffWorker.instances[index].deliver(text));
}

it("keeps the current diff and latest scroll position during an asynchronous refresh", async () => {
  vi.mocked(call).mockResolvedValueOnce(versions("first"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await finishWorker(0, "first");
  const viewer = screen.getByTestId("viewer");
  const id = viewer.dataset.id;
  viewer.scrollTop = 450;
  viewer.scrollLeft = 120;
  let resolve!: (value: Versions) => void;
  vi.mocked(call).mockImplementationOnce(
    () =>
      new Promise<Versions>((done) => {
        resolve = done;
      }),
  );
  rerender(<DiffSurface {...props} refresh={1} />);
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  expect(screen.queryByText("Loading comparison…")).toBeNull();
  expect(viewer.textContent).toBe("first");
  expect(screen.getByTestId("viewer")).toBe(viewer);
  // The user can continue scrolling while the background read/parse is pending.
  viewer.scrollTop = 700;
  await act(async () => resolve(versions("second")));
  expect(viewer.textContent).toBe("first");
  await finishWorker(1, "second");
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(viewer.dataset.id).toBe(id);
  expect(viewer.dataset.version).toBe("2");
  expect(viewer.textContent).toBe("second");
  expect(viewer.scrollTop).toBe(700);
  expect(viewer.scrollLeft).toBe(120);
});

it("ignores unchanged content from unrelated repository refreshes", async () => {
  vi.mocked(call).mockResolvedValue(versions("same"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await finishWorker(0, "same");
  const count = installed.mock.calls.length;
  rerender(<DiffSurface {...props} refresh={1} />);
  await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
  expect(DiffWorker.instances).toHaveLength(1);
  expect(installed).toHaveBeenCalledTimes(count);
});

it("retains the last diff on transient read errors and recovers in place", async () => {
  vi.mocked(call).mockResolvedValueOnce(versions("first"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await finishWorker(0, "first");
  const viewer = screen.getByTestId("viewer");
  viewer.scrollTop = 300;
  vi.mocked(call).mockRejectedValueOnce(new Error("File temporarily missing"));
  rerender(<DiffSurface {...props} refresh={1} />);
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(viewer.textContent).toBe("first");
  vi.mocked(call).mockResolvedValueOnce(versions("recovered"));
  rerender(<DiffSurface {...props} refresh={2} />);
  await finishWorker(1, "recovered");
  expect(viewer.textContent).toBe("recovered");
  expect(viewer.scrollTop).toBe(300);
  expect(screen.queryByRole("status")).toBeNull();
});

it("rejects superseded parses and resets only when navigating to another comparison", async () => {
  vi.mocked(call).mockResolvedValueOnce(versions("old"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await waitFor(() => expect(DiffWorker.instances).toHaveLength(1));
  vi.mocked(call).mockResolvedValueOnce(versions("latest"));
  rerender(<DiffSurface {...props} refresh={1} />);
  await finishWorker(1, "latest");
  act(() => DiffWorker.instances[0].deliver("stale"));
  expect(screen.getByTestId("viewer").textContent).toBe("latest");
  vi.mocked(call).mockResolvedValueOnce(versions("other"));
  rerender(
    <DiffSurface
      {...props}
      selection={{ ...props.selection, path: "other.ts" }}
      refresh={1}
    />,
  );
  const previous = screen.getByTestId("viewer");
  previous.scrollTop = 400;
  expect(previous.textContent).toBe("latest");
  expect(screen.queryByText("Loading comparison…")).toBeNull();
  const resets = scrollTo.mock.calls.length;
  await finishWorker(2, "other");
  expect(screen.getByTestId("viewer")).toBe(previous);
  expect(scrollTo.mock.calls.length).toBe(resets + 1);
  expect(screen.getByTestId("viewer").textContent).toBe("other");
});

it("warms one editor slot and replaces documents without remounting the viewport", () => {
  const onChange = vi.fn();
  const onReady = vi.fn();
  const { rerender } = render(
    <EditorSurface session={null} onChange={onChange} onReady={onReady} />,
  );
  const viewer = screen.getByTestId("viewer");
  const first = {
    path: "one.ts",
    original: "one",
    contents: "one",
    version: 1,
  };
  rerender(
    <EditorSurface session={first} onChange={onChange} onReady={onReady} />,
  );
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(installed.mock.lastCall![0][0]).toMatchObject({
    id: "editor",
    file: { name: "one.ts", contents: "one" },
  });
  scrollTo.mockClear();
  rerender(
    <EditorSurface
      session={{ ...first, contents: "updated", version: 2 }}
      onChange={onChange}
      onReady={onReady}
    />,
  );
  expect(scrollTo).not.toHaveBeenCalled();
  rerender(
    <EditorSurface
      session={{ path: "two.ts", original: "two", contents: "two", version: 3 }}
      onChange={onChange}
      onReady={onReady}
    />,
  );
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(installed.mock.lastCall![0][0]).toMatchObject({
    id: "editor",
    file: { name: "two.ts", contents: "two" },
  });
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({
    type: "position",
    position: 0,
  });
});

it("retains the diff and scroll while staging switches its source, reading only after Git settles", async () => {
  vi.mocked(call).mockResolvedValue(versions("working"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await finishWorker(0, "working");
  const viewer = screen.getByTestId("viewer");
  viewer.scrollTop = 700;
  viewer.scrollLeft = 120;
  const staged = {
    ...props,
    selection: { path: "file.ts", source: "index" as const },
  };
  rerender(<DiffSurface {...staged} refresh={0} deferRefresh />);
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(screen.queryByText("Loading comparison…")).toBeNull();
  expect(call).toHaveBeenCalledTimes(1);
  vi.mocked(call).mockResolvedValue(versions("staged"));
  rerender(<DiffSurface {...staged} refresh={1} deferRefresh={false} />);
  await finishWorker(1, "staged");
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(viewer.textContent).toBe("staged");
  expect(viewer.scrollTop).toBe(700);
  expect(viewer.scrollLeft).toBe(120);
  expect(call).toHaveBeenLastCalledWith(
    "file_versions",
    expect.objectContaining({ source: "index" }),
  );
});

it("zooms only the focused viewer without replacing its document", () => {
  const session = {
    path: "file.ts",
    original: "original",
    contents: "original",
    version: 1,
  };
  const onChange = vi.fn();
  render(
    <EditorSurface session={session} onChange={onChange} onReady={vi.fn()} />,
  );
  const viewer = screen.getByTestId("viewer");
  const firstItem = installed.mock.calls.at(-1)![0][0];
  fireEvent.keyDown(window, { key: "+", metaKey: true });
  expect(viewer.getAttribute("data-css")).toContain("font-size: 12px");
  fireEvent.keyDown(viewer, { key: "+", metaKey: true, shiftKey: true });
  expect(viewer.getAttribute("data-css")).toContain("font-size: 13px");
  expect(viewer.getAttribute("data-line-height")).toBe("22");
  expect(installed.mock.calls.at(-1)![0][0]).toBe(firstItem);
  fireEvent.keyDown(viewer, { key: "=", metaKey: true });
  expect(viewer.getAttribute("data-css")).toContain("font-size: 14px");
  fireEvent.keyDown(viewer, { key: "-", metaKey: true });
  expect(viewer.getAttribute("data-css")).toContain("font-size: 13px");
  expect(localStorage.getItem("githeaven.editor-font-size")).toBe("13");
  expect(onChange).not.toHaveBeenCalled();
});

it("publishes a diff only after its syntax cache is ready, retaining the previous rendered diff during refresh", async () => {
  let ready: () => void = () => {};
  highlightPool.primeDiffHighlightCache.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
  );
  vi.mocked(call).mockResolvedValue(versions("first"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await waitFor(() => expect(DiffWorker.instances.length).toBe(1));
  act(() => DiffWorker.instances[0].deliver("first"));
  await waitFor(() =>
    expect(highlightPool.primeDiffHighlightCache).toHaveBeenCalled(),
  );
  expect(screen.queryByTestId("viewer")).toBeNull();
  await act(async () => ready());
  const viewer = await screen.findByTestId("viewer");
  let updated: () => void = () => {};
  highlightPool.primeDiffHighlightCache.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        updated = resolve;
      }),
  );
  vi.mocked(call).mockResolvedValue(versions("second"));
  rerender(<DiffSurface {...props} refresh={1} />);
  await waitFor(() => expect(DiffWorker.instances.length).toBe(2));
  act(() => DiffWorker.instances[1].deliver("second"));
  await waitFor(() =>
    expect(highlightPool.primeDiffHighlightCache).toHaveBeenCalledTimes(2),
  );
  expect(screen.getByTestId("viewer")).toBe(viewer);
  const before = viewer.getAttribute("data-version");
  await act(async () => updated());
  expect(screen.getByTestId("viewer")).toBe(viewer);
  expect(viewer.getAttribute("data-version")).not.toBe(before);
  const keys = highlightPool.primeDiffHighlightCache.mock.calls.map(
    ([diff]) => diff.cacheKey,
  );
  expect(new Set(keys).size).toBe(2);
});

it("switches to a different file even when its contents match the previous file", async () => {
  vi.mocked(call).mockResolvedValue(versions("same"));
  const { rerender } = render(<DiffSurface {...props} refresh={0} />);
  await finishWorker(0, "first.ts");
  const viewer = screen.getByTestId("viewer");
  rerender(
    <DiffSurface
      {...props}
      selection={{ ...props.selection, path: "second.ts" }}
      refresh={0}
    />,
  );
  expect(viewer.textContent).toBe("first.ts");
  await finishWorker(1, "second.ts");
  expect(viewer.textContent).toBe("second.ts");
});
