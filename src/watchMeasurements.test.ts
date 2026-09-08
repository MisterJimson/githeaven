import { afterEach, expect, it } from "vitest";
import { clearPerformanceSamples, performanceReport } from "./performance";
import { recordWatchBatch } from "./watchMeasurements";

afterEach(clearPerformanceSamples);
it("counts each category once per batch and excludes unknown payload labels", () => {
  recordWatchBatch(true, ["objects", "index", "index", "/private/file"]);
  recordWatchBatch(false, ["index"]);
  recordWatchBatch(true);
  expect(performanceReport().counters).toEqual({
    "watch.batch.history": 2,
    "watch.batch.working": 1,
    "watch.category.objects": 1,
    "watch.category.index": 2,
  });
  clearPerformanceSamples();
  expect(performanceReport().counters).toEqual({});
});
