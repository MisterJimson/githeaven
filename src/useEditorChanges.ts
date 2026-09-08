import { useCallback, useEffect, useRef } from "react";
import { call } from "./api";
import type { LineMark } from "./editorChanges";
import { findLineMark } from "./lineMark";
import {
  countEvent,
  recordDuration,
  startSpan,
  type PerfSample,
} from "./performance";

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
  const inFlight = useRef<number | null>(null);
  const ready = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const paint = useCallback(() => {
    const finish = startSpan("editor.gutter-paint");
    for (const container of host.current?.querySelectorAll("diffs-container") ??
      []) {
      for (const node of container.shadowRoot?.querySelectorAll<HTMLElement>(
        "[data-gutter] [data-column-number]",
      ) ?? []) {
        const line = Number(node.dataset.columnNumber);
        const mark = findLineMark(marks.current, line);
        if (mark) node.dataset.mainChange = mark.kind;
        else delete node.dataset.mainChange;
        if (mark?.top) node.dataset.mainDeletedTop = "";
        else delete node.dataset.mainDeletedTop;
      }
    }
    finish();
  }, []);
  const dispatch = useCallback(() => {
    if (
      inFlight.current !== null ||
      ready.current === null ||
      baseline.current === undefined ||
      !worker.current
    )
      return;
    const id = ready.current;
    ready.current = null;
    inFlight.current = id;
    countEvent("editor.changes-dispatched");
    worker.current.postMessage({
      id,
      old: baseline.current,
      contents: input.current,
    });
  }, []);
  const schedule = useCallback(
    (text: string) => {
      input.current = text;
      if (ready.current !== null) countEvent("editor.changes-coalesced");
      ready.current = null;
      const id = ++sequence.current;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        ready.current = id;
        dispatch();
      }, 120);
    },
    [dispatch],
  );
  useEffect(() => {
    baseline.current = undefined;
    inFlight.current = null;
    ready.current = null;
    marks.current = [];
    paint();
    if (!root || !path) return;
    const w = new Worker(
      new URL("./editorChanges.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    w.onmessage = (
      event: MessageEvent<{
        id: number;
        marks: LineMark[];
        timing?: {
          startedAt: number;
          duration: number;
          outcome: PerfSample["outcome"];
        };
      }>,
    ) => {
      if (worker.current !== w) return;
      if (event.data.id === inFlight.current) inFlight.current = null;
      const timing = event.data.timing;
      if (timing)
        recordDuration(
          "editor.changes-compute",
          timing.startedAt - performance.timeOrigin,
          timing.duration,
          timing.outcome,
        );
      if (event.data.id !== sequence.current) {
        countEvent("editor.changes-stale");
      } else {
        marks.current = event.data.marks;
        paint();
      }
      dispatch();
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
      inFlight.current = null;
      ready.current = null;
      observer.disconnect();
      outer.disconnect();
    };
  }, [root, path, paint, dispatch]);
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
        ready.current = null;
        clearTimeout(timer.current);
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
