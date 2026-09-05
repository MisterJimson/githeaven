import { editorChanges } from "./editorChanges";
self.onmessage = (
  event: MessageEvent<{ id: number; old: string | null; contents: string }>,
) => {
  const { id, old, contents } = event.data;
  try {
    self.postMessage({ id, marks: editorChanges(old, contents) });
  } catch {
    self.postMessage({ id, marks: [] });
  }
};
