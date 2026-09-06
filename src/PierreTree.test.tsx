// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
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
  FileTree: () => <div />,
}));
it("selects and reveals files opened outside the tree without reopening or stealing editor focus", async () => {
  const onSelect = vi.fn();
  const paths = ["src/deep/file.ts", "other.ts"];
  const props = { paths, onSelect, syncSelection: true, revealFocus: false };
  const { rerender } = render(
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
});
