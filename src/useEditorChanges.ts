import { useCallback, useEffect, useRef } from "react";
import { call } from "./api";
import type { LineMark } from "./editorChanges";

export const changeGutterCSS = `
[data-gutter] [data-main-change] { position: relative; }
[data-gutter] [data-main-change]::after { content: ''; position: absolute; right: 1px; top: 0; bottom: 0; width: 3px; pointer-events: none; background: #609c78; opacity: .8; }
[data-gutter] [data-main-change="modified"]::after { background: #6196bd; }
[data-gutter] [data-main-change="deleted"]::after { background: transparent; width: 0; height: 0; top: auto; bottom: -3px; border-left: 5px solid #c37777; border-top: 3px solid transparent; border-bottom: 3px solid transparent; z-index: 2; }
[data-gutter] [data-main-deleted-top]::after { top: -3px; bottom: auto; }
`;

export function useEditorChanges(
  root: string | undefined,
  path: string,
  contents: string,
  version: number,
  refresh: number,
) {
  const host = useRef<HTMLDivElement>(null);
  const marks = useRef<LineMark[]>([]);
  const input = useRef(contents);
  const baseline = useRef<string | null | undefined>(undefined);
  const worker = useRef<Worker | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const paint = useCallback(() => {
    for (const container of host.current?.querySelectorAll("diffs-container") ??
      []) {
      for (const node of container.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-gutter] [data-column-number]",
      ) ?? []) {
        const line = Number(node.dataset.columnNumber);
        const mark = marks.current.find(
          (m) => line >= m.start && line <= m.end,
        );
        if (mark) node.dataset.mainChange = mark.kind;
        else delete node.dataset.mainChange;
        if (mark?.top) node.dataset.mainDeletedTop = "";
        else delete node.dataset.mainDeletedTop;
      }
    }
  }, []);
  const schedule = useCallback((text: string) => {
    input.current = text;
    const id = ++sequence.current;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (baseline.current !== undefined)
        worker.current?.postMessage({
          id,
          old: baseline.current,
          contents: input.current,
        });
    }, 120);
  }, []);
  useEffect(() => {
    baseline.current = undefined;
    marks.current = [];
    paint();
    if (!root || !path) return;
    const w = new Worker(
      new URL("./editorChanges.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = (event: MessageEvent<{ id: number; marks: LineMark[] }>) => {
      if (event.data.id !== sequence.current) return;
      marks.current = event.data.marks;
      paint();
    };
    // Observe Pierre's virtualized gutter, including internal editor renders.
    const observer = new MutationObserver(paint);
    const observe = () => {
      for (const container of host.current?.querySelectorAll(
        "diffs-container",
      ) ?? []) {
        if (container.shadowRoot)
          observer.observe(container.shadowRoot, {
            childList: true,
            subtree: true,
          });
      }
    };
    const outer = new MutationObserver(observe);
    if (host.current)
      outer.observe(host.current, { childList: true, subtree: true });
    observe();
    return () => {
      ++sequence.current;
      clearTimeout(timer.current);
      w.terminate();
      worker.current = null;
      observer.disconnect();
      outer.disconnect();
    };
  }, [root, path, paint]);
  useEffect(() => {
    if (!root || !path) return;
    let active = true;
    call<string | null>("main_file", { root, path })
      .then((value) => {
        if (!active) return;
        baseline.current = value;
        schedule(input.current);
      })
      .catch(() => {
        if (!active) return;
        baseline.current = undefined;
        ++sequence.current;
        marks.current = [];
        paint();
      });
    return () => {
      active = false;
    };
  }, [root, path, refresh, schedule, paint]);
  useEffect(() => {
    schedule(contents);
  }, [path, version, contents, schedule]);
  return { host, paint, schedule };
}
