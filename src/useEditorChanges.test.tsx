// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useEditorChanges } from "./useEditorChanges";
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
  act(() =>
    w.onmessage?.({
      data: { id: first, marks: [{ start: 1, end: 1, kind: "modified" }] },
    }),
  );
  expect(row.dataset.mainChange).toBe("modified");
  act(() => update("base\n"));
  act(() =>
    w.onmessage?.({
      data: { id: first, marks: [{ start: 1, end: 1, kind: "added" }] },
    }),
  );
  expect(row.dataset.mainChange).toBe("modified");
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
