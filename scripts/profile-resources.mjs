import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

if (process.platform !== "darwin")
  throw new Error("This collector currently supports macOS only.");
const targetBundle = "dev.githeaven.app";
const ps = execFileSync("ps", ["-axo", "pid,ppid,rss,%cpu,comm"], {
  encoding: "utf8",
});
const candidates = ps.split("\n").flatMap((line) => {
  const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
  if (!match || !/githeaven$|com\.apple\.WebKit\./.test(match[5])) return [];
  return [
    {
      pid: Number(match[1]),
      parent: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      cpuPercent: Number(match[4]),
      name: basename(match[5]),
    },
  ];
});
const processes = [];
const unresolved = [];
for (const candidate of candidates) {
  try {
    const domain = execFileSync(
      "launchctl",
      ["print", `pid/${candidate.pid}`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const bundles = [...domain.matchAll(/^\s*bundle ID = (.+)$/gm)].map((m) =>
      m[1].trim(),
    );
    if (bundles.includes(targetBundle)) processes.push(candidate);
    else if (!bundles.length && candidate.name === "githeaven")
      unresolved.push(candidate.pid);
  } catch {
    unresolved.push(candidate.pid);
  }
}
if (!processes.length)
  throw new Error(
    "No running Githeaven coalition found. Open the release app first.",
  );
const directory = mkdtempSync(join(tmpdir(), "githeaven-resources-"));
try {
  const file = join(directory, "footprint.json");
  execFileSync(
    "footprint",
    [
      ...processes.flatMap((p) => ["-p", String(p.pid)]),
      "--noCategories",
      "-j",
      file,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const footprint = JSON.parse(readFileSync(file, "utf8"));
  const report = {
    version: 1,
    capturedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    attribution: "launchctl coalition bundle ID",
    bundle: targetBundle,
    processes: processes.map((process) => {
      const memory = footprint.processes?.find(
        (entry) => entry.pid === process.pid,
      );
      return {
        ...process,
        physicalFootprintBytes: memory?.auxiliary?.phys_footprint ?? null,
        peakPhysicalFootprintBytes:
          memory?.auxiliary?.phys_footprint_peak ?? null,
      };
    }),
    combinedFootprintBytes: footprint["total footprint"],
    unresolvedPids: unresolved,
    incomplete:
      unresolved.length > 0 ||
      !!footprint.errors?.length ||
      !!footprint.warnings?.length ||
      (footprint.processes?.length ?? 0) !== processes.length,
  };
  console.table(report.processes);
  console.log(
    `Combined footprint: ${(report.combinedFootprintBytes / 1024 ** 2).toFixed(1)} MiB; incomplete: ${report.incomplete}`,
  );
  if (process.argv[2])
    writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + "\n");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
