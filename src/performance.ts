import { invoke, isTauri } from "@tauri-apps/api/core";
export interface PerfSample {
  name: string;
  start: number;
  duration: number;
  outcome: "ok" | "error";
}
const samples: PerfSample[] = [];
const capacity = 2000;
let windowStart = 0;
let discardedSamples = 0;

export function recordDuration(
  name: string,
  start: number,
  duration: number,
  outcome: PerfSample["outcome"] = "ok",
) {
  // Ignore work started before Reset, even if it finishes in the new window.
  if (start < windowStart) return;
  if (samples.length === capacity) {
    samples.shift();
    discardedSamples++;
  }
  samples.push({ name, start, duration, outcome });
}
// Names are operation labels only: never include source text, paths or command arguments.
export function startSpan(name: string) {
  const start = performance.now();
  let finished = false;
  return (outcome: PerfSample["outcome"] = "ok") => {
    if (finished) return;
    finished = true;
    recordDuration(name, start, performance.now() - start, outcome);
  };
}
export function performanceReport() {
  const groups = new Map<string, PerfSample[]>();
  for (const sample of samples) {
    const group = groups.get(sample.name) ?? [];
    group.push(sample);
    groups.set(sample.name, group);
  }
  return {
    version: 3,
    window: {
      start: windowStart,
      duration: performance.now() - windowStart,
      startedAt: new Date(performance.timeOrigin + windowStart).toISOString(),
      discardedSamples,
    },
    counters: Object.fromEntries(counters),
    gauges: Object.fromEntries(
      [...gauges].map(([name, read]) => [name, read()]),
    ),
    capturedAt: new Date().toISOString(),
    capacity,
    summary: [...groups].map(([name, group]) => {
      const values = group.map((s) => s.duration).sort((a, b) => a - b);
      const percentile = (p: number) =>
        values[Math.ceil(values.length * p) - 1];
      return {
        name,
        count: group.length,
        errors: group.filter((s) => s.outcome === "error").length,
        p50: percentile(0.5),
        p95: percentile(0.95),
        max: values.at(-1),
      };
    }),
    samples: samples.map((s) => ({ ...s })),
  };
}
export function clearPerformanceSamples() {
  samples.length = 0;
  counters.clear();
  windowStart = performance.now();
  discardedSamples = 0;
}
export async function downloadPerformanceReport() {
  if (isTauri()) {
    await invoke("export_performance_report", {
      report: JSON.stringify(performanceReport(), null, 2),
    });
    return;
  }
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(performanceReport(), null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "githeaven-performance.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function measureAsync<T>(
  name: string,
  work: () => Promise<T>,
): Promise<T> {
  const finish = startSpan(name);
  try {
    const result = await work();
    finish();
    return result;
  } catch (error) {
    finish("error");
    throw error;
  }
}

const counters = new Map<string, number>();
const gauges = new Map<
  string,
  () => Record<string, number | string | boolean>
>();
export function countEvent(name: string) {
  counters.set(name, (counters.get(name) ?? 0) + 1);
}
export function registerGauge(
  name: string,
  read: () => Record<string, number | string | boolean>,
) {
  gauges.set(name, read);
  return () => {
    if (gauges.get(name) === read) gauges.delete(name);
  };
}
