// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { CommitStats } from "./CommitStats";
afterEach(cleanup);
it("shows addition/deletion totals with proportionate blocks and reserves loading space", () => {
  const { container, rerender } = render(<CommitStats />);
  const stats = screen.getByLabelText("Loading change counts");
  expect(stats.style.visibility).toBe("hidden");
  rerender(<CommitStats additions={435} deletions={92} />);
  expect(screen.getByLabelText("435 lines added, 92 lines removed")).toBe(
    stats,
  );
  expect(stats.style.visibility).toBe("visible");
  expect(container.querySelectorAll("i.added")).toHaveLength(4);
  expect(container.querySelectorAll("i.removed")).toHaveLength(1);
});
