import { editorChanges } from "./editorChanges";
self.onmessage = (
  event: MessageEvent<{ id: number; old: string | null; contents: string }>,
) => {
  const { id, old, contents } = event.data;
  const start = performance.now();
  let marks: ReturnType<typeof editorChanges>;
  let outcome: "ok" | "error" = "ok";
  try {
    marks = editorChanges(old, contents);
  } catch {
    marks = [];
    outcome = "error";
  }
  self.postMessage({
    id,
    marks,
    timing: {
      startedAt: performance.timeOrigin + start,
      duration: performance.now() - start,
      outcome,
    },
  });
};
