import { parseDiffFromFile } from "@pierre/diffs";
self.onmessage = (
  event: MessageEvent<{ path: string; old: string | null; new: string | null }>,
) => {
  const d = event.data;
  try {
    const result = parseDiffFromFile(
      d.old === null ? null : { name: d.path, contents: d.old },
      d.new === null ? null : { name: d.path, contents: d.new },
      { context: 5 },
    );
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: String(e) });
  }
};
