// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEditorChanges } from "./useEditorChanges";
import { clearPerformanceSamples, performanceReport } from "./performance";
vi.mock("./api", () => ({ call: vi.fn().mockResolvedValue("base\n") }));
class Background {
  static instances: Background[] = [];
  onmessage?: (event: { data: unknown }) => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    Background.instances.push(this);
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  Background.instances = [];
  clearPerformanceSamples();
});
it("decorates virtualized gutters without replacing text and ignores stale results", async () => {
  vi.stubGlobal("Worker", Background);
  let update: (text: string) => void = () => {};
  function Harness() {
    const { host, schedule } = useEditorChanges(
      "repo",
      "a.txt",
      "changed\n",
      1,
      0,
    );
    update = schedule;
    return (
      <div ref={host}>
        <div
          ref={(node) => {
            if (node && !node.firstChild)
              node.appendChild(document.createElement("diffs-container"));
          }}
        />
      </div>
    );
  }
  const { container, unmount } = render(<Harness />);
  const shadow = container
    .querySelector("diffs-container")!
    .attachShadow({ mode: "open" });
  shadow.innerHTML =
    '<div data-gutter><div data-column-number="1">1</div></div>';
  const row = shadow.querySelector("[data-column-number]") as HTMLElement;
  const w = Background.instances[0];
  await waitFor(() => expect(w.postMessage).toHaveBeenCalled());
  const first = w.postMessage.mock.lastCall![0].id;
  const computeStart = performance.now();
  act(() =>
    w.onmessage?.({
      data: {
        id: first,
        marks: [{ start: 1, end: 1, kind: "modified" }],
        timing: {
          startedAt: performance.timeOrigin + computeStart,
          duration: 12,
          outcome: "ok",
        },
      },
    }),
  );
  expect(row.dataset.mainChange).toBe("modified");
  const sample = performanceReport().samples.find(
    (s) => s.name === "editor.changes-compute",
  );
  expect(sample?.duration).toBe(12);
  expect(sample?.start).toBeCloseTo(computeStart, 2);
  act(() => update("base\n"));
  act(() =>
    w.onmessage?.({
      data: { id: first, marks: [{ start: 1, end: 1, kind: "added" }] },
    }),
  );
  expect(row.dataset.mainChange).toBe("modified");
  expect(performanceReport().counters["editor.changes-stale"]).toBe(1);
  await waitFor(() =>
    expect(w.postMessage.mock.lastCall![0].id).toBeGreaterThan(first),
  );
  act(() =>
    w.onmessage?.({
      data: { id: w.postMessage.mock.lastCall![0].id, marks: [] },
    }),
  );
  expect(row.dataset.mainChange).toBeUndefined();
  expect(shadow.querySelector("[data-column-number]")).toBe(row);
  unmount();
  expect(w.terminate).toHaveBeenCalled();
});
