import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function analyzeStartup(gauge) {
  if (gauge == null) return null;
  if (typeof gauge !== "object" || Array.isArray(gauge))
    throw new Error("Invalid startup gauge.");
  const milestones = [];
  for (const name of [
    "setup",
    "frontend",
    "repository_discovery",
    "repository_snapshot",
    "repository_watch",
    "repository",
    "welcome",
  ]) {
    const value = gauge[`native_entry_to_${name}_ms`];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`Invalid startup milestone: ${name}.`);
    milestones.push({ name, nativeEntryMs: value });
  }
  const foreground = gauge.ready_in_foreground;
  if (foreground !== undefined && typeof foreground !== "boolean")
    throw new Error("Invalid startup foreground status.");
  milestones.sort((a, b) => a.nativeEntryMs - b.nativeEntryMs);
  return {
    readyInForeground: foreground ?? null,
    milestones: milestones.map((row, index) => ({
      ...row,
      since: index ? milestones[index - 1].name : "native_entry",
      intervalMs:
        row.nativeEntryMs - (index ? milestones[index - 1].nativeEntryMs : 0),
    })),
  };
}

export function analyzeTrace(report) {
  if (![2, 3].includes(report?.version) || !Array.isArray(report.samples))
    throw new Error("Expected a Githeaven trace (schema 2 or 3).");
  const groups = new Map();
  for (const sample of report.samples) {
    if (
      typeof sample.name !== "string" ||
      !Number.isFinite(sample.start) ||
      sample.start < 0 ||
      !Number.isFinite(sample.duration) ||
      sample.duration < 0 ||
      !["ok", "error"].includes(sample.outcome)
    )
      throw new Error("Invalid trace sample.");
    const group = groups.get(sample.name) ?? { values: [], errors: 0 };
    if (sample.outcome === "ok") group.values.push(sample.duration);
    else group.errors++;
    groups.set(sample.name, group);
  }
  const warnings = [
    "Successful durations only; errors are counted separately. Nested spans overlap: do not add them.",
    "p95 is omitted below 20 successful samples. Larger counts still do not guarantee representative results.",
  ];
  if (report.version === 2)
    warnings.push("Schema 2 has no reset-window or discarded-sample metadata.");
  else if (report.window?.discardedSamples > 0)
    warnings.push(
      `${report.window.discardedSamples} earlier samples were discarded; counters cover a longer interval than retained timings.`,
    );
  return {
    window: report.window ?? null,
    startup: analyzeStartup(report.gauges?.startup),
    warnings,
    operations: [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, group]) => {
        const values = group.values.sort((a, b) => a - b);
        const n = values.length;
        return {
          name,
          n,
          errors: group.errors,
          p50: n ? values[Math.ceil(n * 0.5) - 1] : null,
          p95: n >= 20 ? values[Math.ceil(n * 0.95) - 1] : null,
          max: values.at(-1) ?? null,
        };
      }),
  };
}

export function compareTraces(before, after) {
  const old = new Map(before.operations.map((row) => [row.name, row]));
  const next = new Map(after.operations.map((row) => [row.name, row]));
  return [...new Set([...old.keys(), ...next.keys()])].sort().map((name) => {
    const a = old.get(name),
      b = next.get(name);
    return {
      name,
      beforeN: a?.n ?? 0,
      afterN: b?.n ?? 0,
      beforeErrors: a?.errors ?? 0,
      afterErrors: b?.errors ?? 0,
      beforeP50: a?.p50 ?? null,
      afterP50: b?.p50 ?? null,
      beforeP95: a?.p95 ?? null,
      afterP95: b?.p95 ?? null,
      p95DeltaMs: a?.p95 != null && b?.p95 != null ? b.p95 - a.p95 : null,
    };
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const paths = process.argv.slice(2);
    if (paths.length < 1 || paths.length > 2)
      throw new Error("Usage: pnpm perf:trace trace.json [after.json]");
    const reports = paths.map((path) =>
      analyzeTrace(JSON.parse(readFileSync(path, "utf8"))),
    );
    for (const [i, report] of reports.entries()) {
      console.log(
        `Run ${i + 1}`,
        report.window ?? "Unknown measurement window",
      );
      for (const warning of report.warnings) console.log(warning);
      if (report.startup) {
        console.log(
          "Startup ready in foreground:",
          report.startup.readyInForeground ?? "unknown",
        );
        console.log(
          "One process startup, retained across measurement resets. Intervals join observed milestones only; missing stages are not zero. Native clock excludes OS launch before main and is separate from frontend span starts. Rendering readiness does not prove interactivity.",
        );
        console.table(
          report.startup.milestones.map((row) => ({
            ...row,
            nativeEntryMs: Number(row.nativeEntryMs.toFixed(3)),
            intervalMs: Number(row.intervalMs.toFixed(3)),
          })),
        );
      }
    }
    console.table(
      reports.length === 2 ? compareTraces(...reports) : reports[0].operations,
    );
    if (reports.length === 2)
      console.log(
        "Deltas are descriptive, not a regression gate. Match build mode, machine, workload, and cache state before interpreting them.",
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
