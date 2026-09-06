// @vitest-environment jsdom
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  within,
  act,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode, useEffect, useState, type ReactNode } from "react";
import { App } from "./App";
import { call } from "./api";
import type { Snapshot, Selection } from "./types";

const diffLoads = vi.hoisted(() => vi.fn());

vi.mock("./api", () => ({ native: false, call: vi.fn(), errorText: String }));
vi.mock("./PierreTree", () => ({
  PierreTree: ({
    paths,
    onSelect,
    selectionActive = true,
  }: {
    paths: string[];
    onSelect: (p: string) => void;
    selectionActive?: boolean;
  }) => {
    // Pierre only notifies when selection changes, not on a second click.
    const [selected, setSelected] = useState<string | null>(null);
    useEffect(() => {
      if (!selectionActive) setSelected(null);
    }, [selectionActive]);
    return (
      <div>
        {paths.map((path) => (
          <button
            key={path}
            onClick={() => {
              if (selected !== path) {
                setSelected(path);
                onSelect(path);
              }
            }}
          >
            {path}
          </button>
        ))}
      </div>
    );
  },
}));
vi.mock("./Surface", () => ({
  PierreProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  DiffSurface: ({ selection }: { selection: Selection }) => {
    useEffect(() => {
      diffLoads(selection.path);
    }, [selection.path]);
    return <div data-testid={`diff-${selection.source}`}>{selection.path}</div>;
  },
  // Pierre owns edits until a new document/version is supplied.
  EditorSurface: ({
    session,
    onChange,
  }: {
    session: { contents: string; version: number } | null;
    onChange: (s: string) => void;
  }) => {
    const [text, setText] = useState(session?.contents ?? "");
    useEffect(() => {
      setText(session?.contents ?? "");
    }, [session?.version]);
    return (
      <textarea
        aria-label={session ? "Test editor" : "Empty editor"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value);
        }}
      />
    );
  },
}));
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

async function openWorkspace(overrides: Partial<Snapshot> = {}) {
  let disk = "original contents";
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "open_repository")
      return {
        root: "/sample",
        name: "sample",
        branch: "main",
        head: null,
        files: ["sample.txt"],
        changes: [],
        commits: [],
        refs: [],
        has_more: false,
        elapsed_ms: 1,
        watch_warning: null,
        ...overrides,
      };
    if (command === "commit_details")
      return {
        paths: ["first.txt", "second.txt"],
        message: "A commit",
        parent: null,
        elapsed_ms: 1,
      };
    if (command === "read_file") return disk;
    if (command === "save_file") {
      disk = args!.contents as string;
      return undefined;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
  render(<App />);
  fireEvent.change(screen.getByLabelText("Or enter a repository path"), {
    target: { value: "/sample" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open path" }));
  await screen.findByRole("button", { name: "Edit" });
}

function refreshWorkspace() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Refresh repository" },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
}

async function openEditor() {
  await openWorkspace();
  fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
  fireEvent.click(await screen.findByRole("button", { name: "sample.txt" }));
  return screen.findByLabelText("Test editor");
}

const restoredSnapshot: Snapshot = {
  root: "/sample",
  name: "sample",
  branch: "main",
  head: null,
  files: [],
  changes: [],
  commits: [],
  refs: [],
  has_more: false,
  elapsed_ms: 1,
  watch_warning: null,
};

it("opens the last repository once on startup without showing the folder picker", async () => {
  localStorage.setItem("githeaven:last-repo", "/sample/nested");
  let finish!: (snapshot: Snapshot) => void;
  vi.mocked(call).mockReturnValue(
    new Promise<Snapshot>((resolve) => {
      finish = resolve;
    }),
  );
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Opening your repository",
  );
  expect(screen.queryByRole("button", { name: "Open path" })).toBeNull();
  await waitFor(() =>
    expect(call).toHaveBeenCalledExactlyOnceWith("open_repository", {
      path: "/sample/nested",
    }),
  );
  await act(async () => finish(restoredSnapshot));
  expect(await screen.findByRole("button", { name: "Git" })).toBeTruthy();
  expect(localStorage.getItem("githeaven:last-repo")).toBe("/sample");
  expect(call).toHaveBeenCalledTimes(1);
});

it("returns to folder selection after a failed restore and remembers the next successful folder", async () => {
  localStorage.setItem("githeaven:last-repo", "/missing");
  vi.mocked(call).mockRejectedValueOnce(
    new Error("Repository no longer exists"),
  );
  render(<App />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Repository no longer exists",
  );
  expect(call).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem("githeaven:last-repo")).toBe("/missing");
  vi.mocked(call).mockResolvedValueOnce(restoredSnapshot);
  fireEvent.change(screen.getByLabelText("Or enter a repository path"), {
    target: { value: "/sample" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open path" }));
  expect(await screen.findByRole("button", { name: "Git" })).toBeTruthy();
  expect(localStorage.getItem("githeaven:last-repo")).toBe("/sample");
  expect(call).toHaveBeenCalledTimes(2);
});

it("reopens saved contents when switching away from and back to the editor", async () => {
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: "saved contents" } });
  fireEvent.click(screen.getByRole("button", { name: /Save ⌘S/ }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: /Save ⌘S/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  fireEvent.click(screen.getByRole("button", { name: "Git" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  expect(
    ((await screen.findByLabelText("Test editor")) as HTMLTextAreaElement)
      .value,
  ).toBe("saved contents");
  expect(screen.getByLabelText("Test editor")).toBe(editor);
});

it("preserves mounted views and selections across all tabs without repeating reads", async () => {
  await openWorkspace({
    commits: [
      {
        oid: "abc123",
        parents: [],
        subject: "A commit",
        author: "Test",
        timestamp: 1,
      },
    ],
    changes: [
      { path: "changed.txt", index: " ", worktree: "M", original_path: null },
    ],
  });
  fireEvent.click((await screen.findAllByRole("option"))[1]);
  fireEvent.click(await screen.findByRole("button", { name: "second.txt" }));
  const diff = await screen.findByTestId("diff-commit");
  const graph = screen.getByRole("listbox", {
    name: "Commit history",
    hidden: true,
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const fileButton = await screen.findByRole("button", { name: "sample.txt" });
  fireEvent.click(fileButton);
  const editor = await screen.findByLabelText("Test editor");
  // Opening reads once; switching tabs must not reread the document.
  await waitFor(() =>
    expect(
      vi.mocked(call).mock.calls.filter(([command]) => command === "read_file"),
    ).toHaveLength(1),
  );
  const reads = vi.mocked(call).mock.calls.length;
  const loads = diffLoads.mock.calls.length;
  for (const name of ["Git", "Edit", "Git", "Edit"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
  expect(screen.getByLabelText("Test editor")).toBe(editor);
  expect(screen.getByRole("button", { name: "sample.txt" })).toBe(fileButton);
  fireEvent.click(screen.getByRole("button", { name: "Git" }));
  expect(
    screen.getByRole("listbox", { name: "Commit history", hidden: true }),
  ).toBe(graph);
  expect(screen.getByTestId("diff-commit")).toBe(diff);
  expect(diff.textContent).toBe("second.txt");
  expect(vi.mocked(call).mock.calls.length).toBe(reads);
  expect(diffLoads.mock.calls.length).toBe(loads);
});

it("requires an explicit decision before leaving an unsaved editor", async () => {
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: "unsaved contents" } });
  fireEvent.click(screen.getByRole("button", { name: "Git" }));
  expect(await screen.findByRole("dialog")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(
    (screen.getByLabelText("Test editor") as HTMLTextAreaElement).value,
  ).toBe("unsaved contents");
  expect(
    vi.mocked(call).mock.calls.some(([command]) => command === "save_file"),
  ).toBe(false);
});

it("keeps the viewed diff selected when an external refresh temporarily removes its path", async () => {
  await openWorkspace({
    changes: [
      { path: "changed.txt", index: " ", worktree: "M", original_path: null },
    ],
  });
  fireEvent.click(
    screen.getByRole("option", { name: "Working changes, 1 changed file" }),
  );
  const diff = await screen.findByTestId("diff-worktree");
  vi.mocked(call).mockResolvedValueOnce({
    root: "/sample",
    name: "sample",
    branch: "main",
    head: null,
    files: [],
    changes: [],
    commits: null,
    refs: null,
    has_more: false,
    elapsed_ms: 1,
    watch_warning: null,
  });
  refreshWorkspace();
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: /Working changes,/ }),
    ).toBeNull(),
  );
  expect(screen.getByTestId("diff-worktree")).toBe(diff);
  expect(diff.textContent).toBe("changed.txt");
});

it("shows both index and working changes and retains the diff when collapsing or resizing panels", async () => {
  await openWorkspace({
    changes: [
      { path: "partial.txt", index: "M", worktree: "M", original_path: null },
    ],
  });
  fireEvent.click(
    screen.getByRole("option", { name: "Working changes, 1 changed file" }),
  );
  const unstaged = screen.getByRole("button", { name: "Unstaged Files (1)" });
  const staged = screen.getByRole("button", { name: "Staged Files (1)" });
  fireEvent.click(
    within(staged.closest("section")!).getByRole("button", {
      name: "partial.txt",
    }),
  );
  const diff = await screen.findByTestId("diff-index");
  expect(screen.getByRole("button", { name: "Unstage file" })).toBeTruthy();
  fireEvent.click(staged);
  expect(staged.getAttribute("aria-expanded")).toBe("false");
  expect(unstaged.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByTestId("diff-index")).toBe(diff);
  const resize = screen.getByRole("separator", {
    name: "Resize staging and commit panel",
  });
  const before = Number(resize.getAttribute("aria-valuenow"));
  fireEvent.keyDown(resize, { key: "ArrowRight" });
  expect(Number(resize.getAttribute("aria-valuenow"))).toBe(before - 10);
  expect(screen.getByTestId("diff-index")).toBe(diff);
  fireEvent.click(
    within(unstaged.closest("section")!).getByRole("button", {
      name: "partial.txt",
    }),
  );
  expect(await screen.findByTestId("diff-worktree")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Stage file" })).toBeTruthy();
});

it("shares history and composing, retaining the graph and draft through commit inspection", async () => {
  await openWorkspace({
    commits: [
      {
        oid: "abc123",
        parents: [],
        subject: "A commit",
        author: "Test",
        timestamp: 1,
      },
    ],
    changes: [
      { path: "partial.txt", index: "M", worktree: "M", original_path: null },
    ],
  });
  const snapshot = await vi.mocked(call).mock.results[0].value;
  const implementation = vi.mocked(call).getMockImplementation()!;
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "refresh_repository") return snapshot;
    if (["stage_all_changes", "create_commit"].includes(command))
      return undefined;
    return implementation(command, args);
  });
  const graph = screen.getByRole("listbox", { name: "Commit history" });
  expect(screen.queryByRole("button", { name: /^Changes/ })).toBeNull();
  const summary = screen.getByRole("textbox", { name: "Commit summary" });
  fireEvent.change(summary, { target: { value: "Fix metrics" } });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Commit description" }),
    { target: { value: "Explain the change." } },
  );
  fireEvent.click(screen.getByRole("option", { name: /A commit/ }));
  expect(screen.getByRole("listbox", { name: "Commit history" })).toBe(graph);
  fireEvent.click(await screen.findByRole("button", { name: "second.txt" }));
  const diff = await screen.findByTestId("diff-commit");
  fireEvent.click(screen.getByRole("button", { name: "Back to graph" }));
  expect(screen.getByRole("listbox", { name: "Commit history" })).toBe(graph);
  fireEvent.click(screen.getByRole("button", { name: "second.txt" }));
  expect(screen.getByRole("button", { name: "Back to graph" })).toBeTruthy();
  expect(screen.getByTestId("diff-commit")).toBe(diff);
  fireEvent.click(screen.getByRole("button", { name: "Back to graph" }));
  fireEvent.click(
    screen.getByRole("option", { name: "Working changes, 1 changed file" }),
  );
  expect(screen.getByRole("textbox", { name: "Commit summary" })).toBe(summary);
  expect((summary as HTMLInputElement).value).toBe("Fix metrics");
  expect(screen.getByTestId("diff-commit")).toBe(diff);
  fireEvent.click(screen.getByRole("button", { name: "Stage all changes" }));
  await waitFor(() =>
    expect(vi.mocked(call)).toHaveBeenCalledWith("stage_all_changes", {
      root: "/sample",
      unstage: false,
    }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Commit 1 file",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Commit 1 file" }));
  await waitFor(() =>
    expect(vi.mocked(call)).toHaveBeenCalledWith("create_commit", {
      root: "/sample",
      message: "Fix metrics\n\nExplain the change.",
    }),
  );
  await waitFor(() => expect((summary as HTMLInputElement).value).toBe(""));
});

it("retains the editor while reading a new file and ignores superseded reads", async () => {
  await openWorkspace({
    files: ["sample.txt", "second.txt", "third.txt", "missing.txt"],
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: "sample.txt" }));
  const editor = (await screen.findByLabelText(
    "Test editor",
  )) as HTMLTextAreaElement;
  const pending = new Map<string, (contents: string) => void>();
  vi.mocked(call).mockImplementation((command, args) => {
    if (command === "read_file")
      return new Promise((resolve) =>
        pending.set(args!.path as string, resolve as (text: string) => void),
      );
    throw new Error(`Unexpected command: ${command}`);
  });
  fireEvent.click(screen.getByRole("button", { name: "second.txt" }));
  expect(screen.getByLabelText("Test editor")).toBe(editor);
  expect(editor.value).toBe("original contents");
  fireEvent.click(screen.getByRole("button", { name: "third.txt" }));
  await act(async () => pending.get("third.txt")!("third contents"));
  expect(screen.getByLabelText("Test editor")).toBe(editor);
  expect(editor.value).toBe("third contents");
  await act(async () => pending.get("second.txt")!("outdated contents"));
  expect(editor.value).toBe("third contents");
  // Revisit still checks disk, so agent edits cannot be hidden by a text cache.
  fireEvent.click(screen.getByRole("button", { name: "sample.txt" }));
  await act(async () => pending.get("sample.txt")!("changed externally"));
  expect(editor.value).toBe("changed externally");
  vi.mocked(call).mockRejectedValueOnce(new Error("File missing"));
  fireEvent.click(screen.getByRole("button", { name: "missing.txt" }));
  await screen.findByText("Error: File missing");
  expect(screen.getByLabelText("Test editor")).toBe(editor);
  expect(editor.value).toBe("changed externally");
});

it("refreshes the retained document without replacing an unsaved draft", async () => {
  const editor = (await openEditor()) as HTMLTextAreaElement;
  let disk = "external update";
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "refresh_repository")
      return { ...restoredSnapshot, files: ["sample.txt"] };
    if (command === "read_file") return disk;
    throw new Error(`Unexpected command: ${command}`);
  });
  refreshWorkspace();
  await waitFor(() => expect(editor.value).toBe("external update"));
  expect(screen.getByLabelText("Test editor")).toBe(editor);
  fireEvent.change(editor, { target: { value: "my unsaved draft" } });
  disk = "another external update";
  refreshWorkspace();
  await screen.findByText("File changed on disk. Your draft is preserved.");
  expect(editor.value).toBe("my unsaved draft");
});

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const modifiedChange = {
  path: "changed.txt",
  original_path: null,
  index: " ",
  worktree: "M",
};

it("stages optimistically, queues an immediate reversal, and waits for Git before enabling commit", async () => {
  await openWorkspace({
    changes: [modifiedChange],
    refs: [{ name: "topic", oid: "abc", kind: "local" }],
  });
  const snapshot: Snapshot = await vi.mocked(call).mock.results[0].value;
  const first = deferred();
  const second = deferred();
  const status = deferred<Snapshot>();
  let writes = 0;
  let reads = 0;
  vi.mocked(call).mockImplementation((command) => {
    if (command === "stage_file")
      return ++writes === 1 ? first.promise : second.promise;
    if (command === "refresh_repository")
      return ++reads === 1 ? status.promise : Promise.resolve(snapshot);
    throw new Error(`Unexpected command: ${command}`);
  });
  fireEvent.click(screen.getByRole("button", { name: "changed.txt" }));
  await screen.findByRole("button", { name: "Stage file" });
  fireEvent.change(screen.getByRole("textbox", { name: "Commit summary" }), {
    target: { value: "My commit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Stage file" }));
  expect(screen.getByRole("button", { name: "Staged Files (1)" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Unstaged Files (0)" }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Commit 1 file" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("button", { name: "Edit" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Unstage file" }));
  expect(
    screen.getByRole("button", { name: "Unstaged Files (1)" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Staged Files (0)" })).toBeTruthy();
  expect(
    (screen.getByRole("tab", { name: "sample" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  expect(
    (screen.getByRole("button", { name: "topic" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  expect(writes).toBe(1);
  await act(async () => first.resolve(undefined));
  expect(writes).toBe(1);
  await act(async () =>
    status.resolve({
      ...snapshot,
      changes: [{ ...modifiedChange, index: "M", worktree: " " }],
    }),
  );
  expect(writes).toBe(2);
  expect(screen.getByRole("button", { name: "Staged Files (0)" })).toBeTruthy();
  await act(async () => second.resolve(undefined));
  expect(screen.getByRole("button", { name: "Stage file" })).toBeTruthy();
  expect(
    (
      screen.getByRole("textbox", {
        name: "Commit summary",
      }) as HTMLInputElement
    ).value,
  ).toBe("My commit");
});

it("rolls back a failed bulk stage while preserving a newer diff selection and commit text", async () => {
  await openWorkspace({
    changes: [modifiedChange, { ...modifiedChange, path: "other.txt" }],
  });
  const snapshot: Snapshot = await vi.mocked(call).mock.results[0].value;
  const write = deferred();
  vi.mocked(call).mockImplementation((command) => {
    if (command === "stage_all_changes") return write.promise;
    if (command === "refresh_repository") return Promise.resolve(snapshot);
    throw new Error(`Unexpected command: ${command}`);
  });
  fireEvent.click(screen.getByRole("button", { name: "changed.txt" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Commit summary" }), {
    target: { value: "Keep this" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Stage all changes" }));
  expect(screen.getByRole("button", { name: "Staged Files (2)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "other.txt" }));
  await act(async () => write.reject(new Error("index.lock exists")));
  expect(
    await screen.findByText(
      /Could not stage changes: Error: index.lock exists/,
    ),
  ).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Unstaged Files (2)" }),
  ).toBeTruthy();
  expect(screen.getByRole("button", { name: "Staged Files (0)" })).toBeTruthy();
  expect(screen.getByTestId("diff-worktree").textContent).toBe("other.txt");
  expect(
    (
      screen.getByRole("textbox", {
        name: "Commit summary",
      }) as HTMLInputElement
    ).value,
  ).toBe("Keep this");
});

it("does not falsely roll back a successful stage when only the refresh fails", async () => {
  await openWorkspace({ changes: [modifiedChange] });
  vi.mocked(call).mockImplementation(async (command) => {
    if (command === "stage_all_changes") return;
    throw new Error("Status unavailable");
  });
  fireEvent.click(screen.getByRole("button", { name: "Stage all changes" }));
  await screen.findByText(/Changes staged, but refresh failed/);
  expect(screen.getByRole("button", { name: "Staged Files (1)" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Unstaged Files (0)" }),
  ).toBeTruthy();
});

it("discards a stale refresh from before a stage without undoing the optimistic UI", async () => {
  await openWorkspace({ changes: [modifiedChange] });
  const snapshot: Snapshot = await vi.mocked(call).mock.results[0].value;
  const stagedSnapshot = {
    ...snapshot,
    changes: [{ ...modifiedChange, index: "M", worktree: " " }],
  };
  const stale = deferred<Snapshot>();
  const write = deferred();
  let reads = 0;
  vi.mocked(call).mockImplementation((command) => {
    if (command === "stage_all_changes") return write.promise;
    if (command === "refresh_repository")
      return ++reads === 1 ? stale.promise : Promise.resolve(stagedSnapshot);
    throw new Error(`Unexpected command: ${command}`);
  });
  refreshWorkspace();
  fireEvent.click(screen.getByRole("button", { name: "Stage all changes" }));
  await act(async () => write.resolve(undefined));
  expect(screen.getByRole("button", { name: "Staged Files (1)" })).toBeTruthy();
  await act(async () => stale.resolve(snapshot));
  expect(screen.getByRole("button", { name: "Staged Files (1)" })).toBeTruthy();
  expect(reads).toBe(3);
});

it("rolls back one failed file without dropping a later queued file", async () => {
  await openWorkspace({
    changes: [modifiedChange, { ...modifiedChange, path: "other.txt" }],
  });
  const snapshot: Snapshot = await vi.mocked(call).mock.results[0].value;
  const failed = deferred();
  const later = deferred();
  let reads = 0;
  vi.mocked(call).mockImplementation((command, args) => {
    if (command === "stage_file")
      return args!.path === "changed.txt" ? failed.promise : later.promise;
    if (command === "refresh_repository")
      return Promise.resolve(
        ++reads === 1
          ? snapshot
          : {
              ...snapshot,
              changes: [
                modifiedChange,
                {
                  ...modifiedChange,
                  path: "other.txt",
                  index: "M",
                  worktree: " ",
                },
              ],
            },
      );
    throw new Error(`Unexpected command: ${command}`);
  });
  fireEvent.click(screen.getByRole("button", { name: "changed.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "Stage file" }));
  fireEvent.click(screen.getByRole("button", { name: "other.txt" }));
  fireEvent.click(screen.getByRole("button", { name: "Stage file" }));
  expect(screen.getByRole("button", { name: "Staged Files (2)" })).toBeTruthy();
  await act(async () => failed.reject(new Error("Cannot stage this file")));
  expect(screen.getByRole("button", { name: "Staged Files (1)" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Unstaged Files (1)" }),
  ).toBeTruthy();
  expect(screen.getByTestId("diff-index").textContent).toBe("other.txt");
  await act(async () => later.resolve(undefined));
  expect(screen.getByRole("button", { name: "Staged Files (1)" })).toBeTruthy();
  expect(screen.getByTestId("diff-index").textContent).toBe("other.txt");
});

it("opens fuzzy file search globally and protects unsaved edits when navigating", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  await openWorkspace({ files: ["src/ControlPlane.ts", "other.txt"] });
  fireEvent.keyDown(window, { key: "p", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "cplts" },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  const editor = await screen.findByLabelText("Test editor");
  expect(call).toHaveBeenCalledWith("read_file", {
    root: "/sample",
    path: "src/ControlPlane.ts",
  });
  fireEvent.change(editor, { target: { value: "unsaved draft" } });
  fireEvent.keyDown(editor, { key: "p", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "other" },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(screen.getByText("Keep your changes?")).toBeTruthy();
  expect(call).not.toHaveBeenCalledWith("read_file", {
    root: "/sample",
    path: "other.txt",
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect((editor as HTMLTextAreaElement).value).toBe("unsaved draft");
  fireEvent.keyDown(editor, { key: "k", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Save current file" },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      "save_file",
      expect.objectContaining({ contents: "unsaved draft" }),
    ),
  );
});

it("switches palettes with shortcuts and jumps to command and branch destinations", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  await openWorkspace({
    refs: [{ name: "feature/navigation", kind: "remote", oid: "abc" }],
  });
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "p", metaKey: true });
  expect(screen.getByRole("dialog", { name: "Go to file" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "k", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "feature/navigation" },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(call).not.toHaveBeenCalledWith("checkout_branch", expect.anything());
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "Write a commit" },
  });
  fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByLabelText("Commit summary"),
    ),
  );
});

it("loads older history on scroll once per request and retains the graph viewport", async () => {
  const commits = Array.from({ length: 500 }, (_, i) => ({
    oid: `c${i}`,
    parents: [`c${i + 1}`],
    subject: `Commit ${i}`,
    author: "A",
    timestamp: 500 - i,
  }));
  await openWorkspace({ commits, has_more: true });
  const history = screen.getByRole("listbox", { name: "Commit history" });
  expect(screen.queryByRole("button", { name: /Load older/ })).toBeNull();
  expect(screen.queryByText("Commit history")).toBeNull();
  Object.defineProperties(history, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, value: 18537 },
    scrollTop: { configurable: true, writable: true, value: 17500 },
  });
  let finish!: (snapshot: Snapshot) => void;
  vi.mocked(call).mockImplementation((command) => {
    if (command === "refresh_repository")
      return new Promise((resolve) => {
        finish = resolve as typeof finish;
      });
    return Promise.reject(new Error(`Unexpected ${command}`));
  });
  fireEvent.scroll(history);
  fireEvent.scroll(history);
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([command]) => command === "refresh_repository"),
  ).toHaveLength(1);
  expect(call).toHaveBeenCalledWith("refresh_repository", {
    root: "/sample",
    limit: 1000,
    history: true,
  });
  await act(async () =>
    finish({
      ...restoredSnapshot,
      commits: [
        ...commits,
        {
          oid: "last",
          parents: [],
          subject: "Oldest",
          author: "A",
          timestamp: 0,
        },
      ],
      has_more: false,
    }),
  );
  expect(screen.getByRole("listbox", { name: "Commit history" })).toBe(history);
  expect(history.scrollTop).toBe(17500);
  fireEvent.scroll(history);
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([command]) => command === "refresh_repository"),
  ).toHaveLength(1);
});

it("switches remembered project tabs, preserves commit drafts, and closes the active tab", async () => {
  localStorage.setItem(
    "githeaven.projects",
    JSON.stringify(["/sample", "/other"]),
  );
  await openWorkspace();
  fireEvent.change(screen.getByLabelText("Commit summary"), {
    target: { value: "Sample draft" },
  });
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "open_repository")
      return {
        ...restoredSnapshot,
        root: args!.path,
        name: args!.path === "/other" ? "other" : "sample",
      };
    throw new Error(`Unexpected ${command}`);
  });
  fireEvent.click(screen.getByRole("tab", { name: "other" }));
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "other" }).getAttribute("aria-selected"),
    ).toBe("true"),
  );
  expect(
    (screen.getByLabelText("Commit summary") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.change(screen.getByLabelText("Commit summary"), {
    target: { value: "Other draft" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "sample" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Commit summary") as HTMLInputElement).value,
    ).toBe("Sample draft"),
  );
  fireEvent.click(screen.getByRole("tab", { name: "other" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("Commit summary") as HTMLInputElement).value,
    ).toBe("Other draft"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close project /other" }));
  await waitFor(() =>
    expect(screen.queryByRole("tab", { name: "other" })).toBeNull(),
  );
  expect(
    (screen.getByLabelText("Commit summary") as HTMLInputElement).value,
  ).toBe("Sample draft");
  expect(JSON.parse(localStorage.getItem("githeaven.projects")!)).toEqual([
    "/sample",
  ]);
  expect(localStorage.getItem("githeaven:last-repo")).toBe("/sample");
  fireEvent.click(
    screen.getByRole("button", { name: "Close project /sample" }),
  );
  await screen.findByLabelText("Or enter a repository path");
  expect(localStorage.getItem("githeaven:last-repo")).toBeNull();
  expect(screen.queryByText("PREVIEW")).toBeNull();
  expect(screen.getByRole("button", { name: "Add project" })).toBeTruthy();
});

it("does not switch project tabs when an unsaved edit is kept", async () => {
  localStorage.setItem(
    "githeaven.projects",
    JSON.stringify(["/sample", "/other"]),
  );
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: "Unsaved edit" } });
  fireEvent.click(screen.getByRole("tab", { name: "other" }));
  expect(screen.getByText("Keep your changes?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(
    screen.getByRole("tab", { name: "sample" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect((editor as HTMLTextAreaElement).value).toBe("Unsaved edit");
  expect(call).not.toHaveBeenCalledWith("open_repository", { path: "/other" });
});

it("prompts for WIP before checkout and only stashes after explicit confirmation", async () => {
  await openWorkspace({
    refs: [{ name: "feature", kind: "local", oid: "abc" }],
  });
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "checkout_branch") {
      if (!args!.stash) throw new Error("WIP_STASH_REQUIRED");
      return undefined;
    }
    if (command === "refresh_repository")
      return { ...restoredSnapshot, branch: "feature" };
    throw new Error(`Unexpected ${command}`);
  });
  fireEvent.doubleClick(screen.getByRole("button", { name: "feature" }));
  await screen.findByText("Stash changes before switching?");
  fireEvent.click(screen.getByRole("button", { name: "Cancel switch" }));
  expect(
    vi
      .mocked(call)
      .mock.calls.filter(([command]) => command === "checkout_branch"),
  ).toHaveLength(1);
  fireEvent.doubleClick(screen.getByRole("button", { name: "feature" }));
  await screen.findByText("Stash changes before switching?");
  fireEvent.click(screen.getByRole("button", { name: "Stash and switch" }));
  await waitFor(() =>
    expect(call).toHaveBeenCalledWith("checkout_branch", {
      root: "/sample",
      name: "feature",
      kind: "local",
      stash: true,
    }),
  );
});

it("reveals cached repositories synchronously without another Git open and records warm switch timing", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  localStorage.setItem(
    "githeaven.projects",
    JSON.stringify(["/sample", "/other"]),
  );
  await openWorkspace();
  const opened: string[] = [];
  vi.mocked(call).mockImplementation(async (command, args) => {
    if (command === "open_repository") {
      opened.push(args!.path as string);
      return { ...restoredSnapshot, root: args!.path, name: "other" };
    }
    // Background Git can remain pending; tab interactions must not wait for it.
    return new Promise(() => {});
  });
  fireEvent.click(screen.getByRole("tab", { name: "other" }));
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "other" }).getAttribute("aria-selected"),
    ).toBe("true"),
  );
  fireEvent.click(screen.getByRole("tab", { name: "sample" }));
  expect(
    screen.getByRole("tab", { name: "sample" }).getAttribute("aria-selected"),
  ).toBe("true");
  expect(
    (screen.getByRole("tab", { name: "other" }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(
    screen.getByRole("button", { name: "Performance measurements" }),
  );
  await screen.findByText(/Cached repository switches p95 · 1 samples/);
  fireEvent.click(screen.getByRole("tab", { name: "other" }));
  expect(
    screen.getByRole("tab", { name: "other" }).getAttribute("aria-selected"),
  ).toBe("true");
  await screen.findByText(/Cached repository switches p95 · 2 samples/);
  expect(opened).toEqual(["/other"]);
});
