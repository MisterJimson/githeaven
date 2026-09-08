// @vitest-environment jsdom
import {
  act,
  cleanup,
  render,
  renderHook,
  waitFor,
} from "@testing-library/react";
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
  cleanup();
  vi.useRealTimers();
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

it("keeps one calculation in flight and submits only the latest debounced edit", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", Background);
  const { result, unmount } = renderHook(() =>
    useEditorChanges("repo", "a.txt", "initial", 1, 0),
  );
  await act(async () => {});
  act(() => vi.advanceTimersByTime(120));
  const worker = Background.instances[0];
  const first = worker.postMessage.mock.lastCall![0].id;
  for (let i = 1; i <= 20; i++) {
    act(() => result.current.schedule(`revision ${i}`));
    act(() => vi.advanceTimersByTime(150));
  }
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  act(() => worker.onmessage?.({ data: { id: first, marks: [] } }));
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  const latest = worker.postMessage.mock.lastCall![0];
  expect(latest.contents).toBe("revision 20");
  expect(performanceReport().counters["editor.changes-coalesced"]).toBe(19);
  expect(performanceReport().counters["editor.changes-dispatched"]).toBe(2);
  act(() => worker.onmessage?.({ data: { id: latest.id, marks: [] } }));
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  unmount();
});

it("does not dispatch a new edit before its debounce expires when the worker finishes", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", Background);
  const { result } = renderHook(() =>
    useEditorChanges("repo", "a.txt", "initial", 1, 0),
  );
  await act(async () => {});
  act(() => vi.advanceTimersByTime(120));
  const worker = Background.instances[0];
  const first = worker.postMessage.mock.lastCall![0].id;
  act(() => result.current.schedule("older"));
  act(() => vi.advanceTimersByTime(120));
  act(() => result.current.schedule("newest"));
  act(() => worker.onmessage?.({ data: { id: first, marks: [] } }));
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(119));
  expect(worker.postMessage).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(1));
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  expect(worker.postMessage.mock.lastCall![0].contents).toBe("newest");
});

it("drops pending work on file switches and ignores late replies from terminated workers", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", Background);
  const { result, rerender, unmount } = renderHook(
    ({ path }) => useEditorChanges("repo", path, path, 1, 0),
    { initialProps: { path: "a.txt" } },
  );
  await act(async () => {});
  act(() => vi.advanceTimersByTime(120));
  const previous = Background.instances[0];
  const first = previous.postMessage.mock.lastCall![0].id;
  act(() => result.current.schedule("old-file-pending"));
  act(() => vi.advanceTimersByTime(120));
  rerender({ path: "b.txt" });
  await act(async () => {});
  expect(previous.terminate).toHaveBeenCalledTimes(1);
  act(() => previous.onmessage?.({ data: { id: first, marks: [] } }));
  act(() => vi.advanceTimersByTime(120));
  const current = Background.instances[1];
  expect(previous.postMessage).toHaveBeenCalledTimes(1);
  expect(current.postMessage).toHaveBeenCalledTimes(1);
  expect(current.postMessage.mock.lastCall![0].contents).toBe("b.txt");
  act(() => result.current.schedule("pending-on-unmount"));
  unmount();
  act(() => vi.advanceTimersByTime(120));
  expect(current.postMessage).toHaveBeenCalledTimes(1);
  expect(current.terminate).toHaveBeenCalledTimes(1);
});
