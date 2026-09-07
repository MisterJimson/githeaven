// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PierreTree } from "./PierreTree";
const tree = vi.hoisted(() => {
  const selected = new Set<string>();
  const expanded = new Set<string>();
  let callback: (paths: string[]) => void;
  const model = {
    getItem: (path: string) => ({
      expand: () => expanded.add(path),
      select: () => {
        selected.add(path);
        callback([...selected]);
      },
      deselect: () => {
        selected.delete(path);
        callback([...selected]);
      },
    }),
    getSelectedPaths: () => [...selected],
    getFocusedPath: vi.fn<() => string | null>(() => null),
    scrollToPath: vi.fn(),
    resetPaths: vi.fn(),
    setGitStatus: vi.fn(),
    setSearch: vi.fn(),
  };
  return {
    model,
    selected,
    expanded,
    register: (fn: typeof callback) => {
      callback = fn;
    },
  };
});
vi.mock("@pierre/trees/react", () => ({
  useFileTree: (options: { onSelectionChange: (paths: string[]) => void }) => {
    tree.register(options.onSelectionChange);
    return { model: tree.model };
  },
  FileTree: () => <div data-testid="tree" />,
}));
it("selects and reveals files opened outside the tree without reopening or stealing editor focus", async () => {
  const onSelect = vi.fn();
  const paths = ["src/deep/file.ts", "other.ts"];
  const props = { paths, onSelect, syncSelection: true, revealFocus: false };
  const { rerender, unmount } = render(
    <PierreTree {...props} selected="other.ts" revealPath="other.ts" />,
  );
  rerender(
    <PierreTree
      {...props}
      selected="src/deep/file.ts"
      revealPath="src/deep/file.ts"
    />,
  );
  await waitFor(() => expect([...tree.selected]).toEqual(["src/deep/file.ts"]));
  expect([...tree.expanded]).toContain("src/deep");
  expect(tree.model.scrollToPath).toHaveBeenLastCalledWith("src/deep/file.ts", {
    focus: false,
    offset: "nearest",
  });
  expect(onSelect).not.toHaveBeenCalled();
  unmount();
});

it("opens keyboard-focused files immediately, but ignores directories and modified arrows", async () => {
  tree.selected.clear();
  const onSelect = vi.fn();
  const { getByTestId, unmount } = render(
    <PierreTree paths={["one.ts", "two.ts"]} onSelect={onSelect} openOnArrow />,
  );
  tree.model.getFocusedPath.mockReturnValue("two.ts");
  fireEvent.keyDown(getByTestId("tree"), { key: "ArrowDown" });
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith("two.ts"));
  expect([...tree.selected]).toEqual(["two.ts"]);
  tree.model.getFocusedPath.mockReturnValue("one.ts");
  fireEvent.keyDown(getByTestId("tree"), { key: "ArrowUp" });
  await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith("one.ts"));
  tree.model.getFocusedPath.mockReturnValue("folder");
  fireEvent.keyDown(getByTestId("tree"), { key: "ArrowDown" });
  fireEvent.keyDown(getByTestId("tree"), { key: "ArrowUp", shiftKey: true });
  await Promise.resolve();
  expect(onSelect).toHaveBeenCalledTimes(2);
  unmount();
});
