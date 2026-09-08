import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";

const [output, countText = "7", intervalText = "5"] = process.argv.slice(2);
const count = Number(countText),
  interval = Number(intervalText);
if (
  !output ||
  !Number.isInteger(count) ||
  count < 2 ||
  count > 600 ||
  !Number.isFinite(interval) ||
  interval < 1 ||
  interval > 60
)
  throw new Error(
    "Usage: pnpm perf:resource-series report.json [2-600 samples] [1-60 seconds between samples]",
  );
const directory = mkdtempSync(join(tmpdir(), "githeaven-resource-series-"));
const samples = [];
let initialPids;
try {
  for (let i = 0; i < count; i++) {
    const file = join(directory, "sample.json");
    execFileSync(
      process.execPath,
      [
        fileURLToPath(new URL("./profile-resources.mjs", import.meta.url)),
        file,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const sample = JSON.parse(readFileSync(file, "utf8"));
    const pids = sample.processes
      .map((p) => p.pid)
      .sort((a, b) => a - b)
      .join(",");
    initialPids ??= pids;
    samples.push({ ...sample, processesChanged: pids !== initialPids });
    // Save every completed sample so an interrupted run still has useful evidence.
    writeFileSync(
      output,
      JSON.stringify(
        {
          version: 1,
          requestedSamples: count,
          intervalSeconds: interval,
          complete: samples.length === count,
          sameProcesses: samples.every((s) => !s.processesChanged),
          attributionComplete: samples.every((s) => !s.incomplete),
          samples,
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      `${i + 1}/${count}: ${(sample.combinedFootprintBytes / 1024 ** 2).toFixed(1)} MiB${sample.incomplete ? " (incomplete attribution)" : ""}${pids !== initialPids ? " (process set changed)" : ""}`,
    );
    if (i + 1 < count) await setTimeout(interval * 1000);
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
