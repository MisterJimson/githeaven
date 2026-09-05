// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QuickOpen, fuzzyScore, type QuickItem } from "./QuickOpen";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);
const files: QuickItem[] = Array.from({ length: 10000 }, (_, i) => ({
  id: `${i}`,
  label: `file-${i}.tsx`,
  detail: `src/components/file-${i}.tsx`,
  kind: "file",
  value: `src/components/file-${i}.tsx`,
}));

it("matches noncontiguous, case-insensitive names and rejects unrelated queries", () => {
  expect(fuzzyScore("ControlPlaneMetrics.ts", "cplm")).toBeGreaterThan(0);
  expect(fuzzyScore("src/App.tsx", "SRapp")).toBeGreaterThan(0);
  expect(fuzzyScore("src/App.tsx", "zq")).toBe(-Infinity);
  expect(fuzzyScore("src/foo.ts", "foo")).toBeGreaterThan(
    fuzzyScore("src/far/out/other.ts", "foo"),
  );
});

it("virtualizes all files, follows keyboard selection beyond the viewport and opens with Enter", () => {
  const onPick = vi.fn();
  render(
    <QuickOpen mode="files" items={files} onClose={vi.fn()} onPick={onPick} />,
  );
  const input = screen.getByRole("combobox");
  expect(document.activeElement).toBe(input);
  expect(screen.getAllByRole("option").length).toBeLessThan(20);
  for (let i = 0; i < 30; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true }).textContent).toContain(
    "file-30.tsx",
  );
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith(files[30]);
});

it("resets selection on fuzzy search, ignores Enter with no matches, and closes on Escape", () => {
  const onPick = vi.fn(),
    onClose = vi.fn();
  render(
    <QuickOpen mode="files" items={files} onClose={onClose} onPick={onPick} />,
  );
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "f9999tx" } });
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith(files[9999]);
  onPick.mockClear();
  fireEvent.change(input, { target: { value: "no match zzz" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onPick).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).toHaveBeenCalled();
});

it("keeps matching commands above stronger file matches while ranking each group", () => {
  const items: QuickItem[] = [
    { id: "file", kind: "file", label: "git", value: "git" },
    {
      id: "weak",
      kind: "command",
      label: "Go to Git history",
      value: "history",
    },
    { id: "strong", kind: "command", label: "Git", value: "git" },
    { id: "other", kind: "command", label: "Open repository", value: "open" },
  ];
  const onPick = vi.fn();
  render(
    <QuickOpen
      mode="commands"
      items={items}
      onClose={vi.fn()}
      onPick={onPick}
    />,
  );
  expect(screen.getAllByRole("option").at(-1)?.textContent).toBe("gitFile");
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "git" } });
  expect(
    screen.getAllByRole("option").map((option) => option.textContent),
  ).toEqual(["GitCommand", "Go to Git historyCommand", "gitFile"]);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onPick).toHaveBeenCalledWith(items[2]);
});
