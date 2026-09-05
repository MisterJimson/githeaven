// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ChangeSections } from "./ChangeSections";
import type { Change } from "./types";

vi.mock("./PierreTree", () => ({
  PierreTree: ({
    paths,
    onSelect,
    query,
    search,
  }: {
    paths: string[];
    onSelect: (path: string) => void;
    query: string;
    search: boolean;
  }) => (
    <div data-testid="tree" data-query={query} data-search={String(search)}>
      {paths.map((path) => (
        <button key={path} onClick={() => onSelect(path)}>
          {path}
        </button>
      ))}
    </div>
  ),
}));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(280);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(330);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
const files = (count: number, staged = false): Change[] =>
  Array.from({ length: count }, (_, index) => ({
    path: `${staged ? "staged" : "src"}/file-${String(index).padStart(2, "0")}.ts`,
    original_path: null,
    index: staged ? "M" : " ",
    worktree: staged ? " " : "M",
  }));

it("uses one remembered toggle for both sections without replacing their views or selecting files", () => {
  const onSelect = vi.fn();
  const changes = [...files(1), ...files(1, true)];
  const props = {
    changes,
    onSelect,
    selected: { path: "src/file-00.ts", source: "worktree" as const },
  };
  const { unmount } = render(<ChangeSections {...props} />);
  expect(
    screen.getByRole("button", { name: "Path" }).getAttribute("aria-pressed"),
  ).toBe("true");
  expect(screen.queryByRole("searchbox")).toBeNull();
  const pathView = screen.getByLabelText("Unstaged file paths");
  pathView.scrollTop = 84;
  const trees = screen.getAllByTestId("tree");
  expect(
    screen
      .getByRole("button", { name: "src/file-00.ts" })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Tree" }));
  expect(screen.getAllByTestId("tree")).toEqual(trees);
  expect(onSelect).not.toHaveBeenCalled();
  expect(localStorage.getItem("githeaven.changes-view")).toBe("tree");
  const staged = screen
    .getByRole("button", { name: "Staged Files (1)" })
    .closest("section")!;
  fireEvent.click(
    within(staged).getByRole("button", { name: "staged/file-00.ts" }),
  );
  expect(onSelect).toHaveBeenCalledWith("staged/file-00.ts", true);
  fireEvent.click(screen.getByRole("button", { name: "Path" }));
  expect(screen.getByLabelText("Unstaged file paths")).toBe(pathView);
  expect(pathView.scrollTop).toBe(84);
  fireEvent.click(screen.getByRole("button", { name: "Tree" }));
  unmount();
  render(<ChangeSections {...props} />);
  expect(
    screen.getByRole("button", { name: "Tree" }).getAttribute("aria-pressed"),
  ).toBe("true");
});

it("shows search above 20 files per section and clears hidden filters when the count drops", () => {
  const onSelect = vi.fn();
  const { rerender } = render(
    <ChangeSections
      changes={[...files(21), ...files(20, true)]}
      onSelect={onSelect}
    />,
  );
  const search = screen.getByRole("searchbox", {
    name: "Search unstaged files",
  });
  expect(
    screen.queryByRole("searchbox", { name: "Search staged files" }),
  ).toBeNull();
  fireEvent.change(search, { target: { value: "file-20" } });
  expect(screen.getByRole("button", { name: "src/file-20.ts" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "src/file-00.ts" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Tree" }));
  expect(screen.getAllByTestId("tree")[0].dataset.query).toBe("file-20");
  expect(screen.getAllByTestId("tree")[0].dataset.search).toBe("false");
  rerender(
    <ChangeSections
      changes={[...files(20), ...files(20, true)]}
      onSelect={onSelect}
    />,
  );
  expect(screen.queryByRole("searchbox")).toBeNull();
  expect(screen.getAllByTestId("tree")[0].dataset.query).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Path" }));
  expect(screen.getByRole("button", { name: "src/file-00.ts" })).toBeTruthy();
  rerender(
    <ChangeSections
      changes={[...files(21), ...files(21, true)]}
      onSelect={onSelect}
    />,
  );
  expect(
    (
      screen.getByRole("searchbox", {
        name: "Search unstaged files",
      }) as HTMLInputElement
    ).value,
  ).toBe("");
  expect(
    screen.getByRole("searchbox", { name: "Search staged files" }),
  ).toBeTruthy();
});

it("keeps the flat file list bounded for large change sets", () => {
  render(<ChangeSections changes={files(1000)} onSelect={vi.fn()} />);
  expect(
    within(screen.getByLabelText("Unstaged file paths")).getAllByRole("button")
      .length,
  ).toBeLessThan(30);
});
