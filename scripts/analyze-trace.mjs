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

export function analyzeTrace(report, range) {
  if (![2, 3].includes(report?.version) || !Array.isArray(report.samples))
    throw new Error("Expected a Githeaven trace (schema 2 or 3).");
  if (
    range &&
    (!Number.isFinite(range.start) ||
      range.start < 0 ||
      !Number.isFinite(range.end) ||
      range.end <= range.start)
  )
    throw new Error(
      "Expected a nonnegative start and a later finite end for the range.",
    );
  let overlappingFromBefore = 0;
  let endingAfterRange = 0;
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
    if (range) {
      if (
        sample.start < range.start &&
        sample.start + sample.duration > range.start
      )
        overlappingFromBefore++;
      if (sample.start < range.start || sample.start >= range.end) continue;
      if (sample.start + sample.duration > range.end) endingAfterRange++;
    }
    const group = groups.get(sample.name) ?? { values: [], errors: 0 };
    if (sample.outcome === "ok") group.values.push(sample.duration);
    else group.errors++;
    groups.set(sample.name, group);
  }
  const warnings = [
    "Successful durations only; errors are counted separately. Nested spans overlap: do not add them.",
    "p95 is omitted below 20 successful samples. Larger counts still do not guarantee representative results.",
  ];
  if (range)
    warnings.push(
      "Range selects span starts in [start, end); selected durations are not clipped. Cross-boundary counts are reported separately. Watcher counters and startup gauges are omitted because they cannot be attributed to this interval.",
    );
  if (report.version === 2)
    warnings.push("Schema 2 has no reset-window or discarded-sample metadata.");
  else if (report.window?.discardedSamples > 0)
    warnings.push(
      `${report.window.discardedSamples} earlier samples were discarded; counters cover a longer interval than retained timings.`,
    );
  return {
    window: report.window ?? null,
    range: range ? { ...range, overlappingFromBefore, endingAfterRange } : null,
    startup: range ? null : analyzeStartup(report.gauges?.startup),
    watcher: [
      "batch.history",
      "batch.working",
      "category.worktree",
      "category.index",
      "category.head",
      "category.refs",
      "category.objects",
      "category.metadata",
    ].flatMap((label) => {
      const name = `watch.${label}`;
      const batches = report.counters?.[name];
      if (batches === undefined) return [];
      if (!Number.isSafeInteger(batches) || batches < 0)
        throw new Error(`Invalid watcher counter: ${name}.`);
      return range ? [] : [{ name, batches }];
    }),
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

export function parseTraceArgs(args) {
  const paths = [];
  const ranges = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--range" || arg === "--after-range") {
      if (ranges[arg]) throw new Error(`Duplicate ${arg}.`);
      const value = args[++i];
      if (!value || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(value))
        throw new Error(`Expected ${arg} start:end in frontend milliseconds.`);
      const [start, end] = value.split(":").map(Number);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start)
        throw new Error("Range end must be later than start.");
      ranges[arg] = { start, end };
    } else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}.`);
    else paths.push(arg);
  }
  if (paths.length < 1 || paths.length > 2)
    throw new Error(
      "Usage: pnpm perf:trace trace.json [after.json] [--range start:end --after-range start:end]",
    );
  if (ranges["--after-range"] && paths.length !== 2)
    throw new Error("--after-range requires two traces.");
  if (
    paths.length === 2 &&
    Boolean(ranges["--range"]) !== Boolean(ranges["--after-range"])
  )
    throw new Error("Specify both trace ranges when comparing intervals.");
  return paths.map((path, i) => ({
    path,
    range: ranges[i ? "--after-range" : "--range"],
  }));
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
    const reports = parseTraceArgs(process.argv.slice(2)).map(
      ({ path, range }) =>
        analyzeTrace(JSON.parse(readFileSync(path, "utf8")), range),
    );
    for (const [i, report] of reports.entries()) {
      console.log(
        `Run ${i + 1}`,
        report.window ?? "Unknown measurement window",
      );
      if (report.range) console.log("Selected interval", report.range);
      for (const warning of report.warnings) console.log(warning);
      if (report.watcher.length) {
        console.log(
          "Watcher counts cover the reset window and active repository at each event. Categories overlap: these count batches containing each category, not raw events. They do not count focus or periodic refreshes.",
        );
        console.table(report.watcher);
      }
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
