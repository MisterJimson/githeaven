import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// V8's timeDeltas are microseconds. Attribute each sample once to its leaf,
// optionally keeping only stacks containing a matching function name.
export function analyzeCPU(profile, containing = "") {
  if (
    !Array.isArray(profile?.nodes) ||
    !Array.isArray(profile.samples) ||
    !Array.isArray(profile.timeDeltas) ||
    profile.samples.length !== profile.timeDeltas.length
  )
    throw new Error(
      "Expected a sampled V8 .cpuprofile with matching timeDeltas.",
    );
  const nodes = new Map();
  const parents = new Map();
  for (const node of profile.nodes) {
    if (
      !Number.isInteger(node.id) ||
      nodes.has(node.id) ||
      typeof node.callFrame?.functionName !== "string"
    )
      throw new Error("Invalid or duplicate profile node.");
    nodes.set(node.id, node);
    for (const child of node.children ?? []) {
      if (parents.has(child))
        throw new Error("Profile node has multiple parents.");
      parents.set(child, node.id);
    }
  }
  const included = new Map();
  const visiting = new Set();
  const includes = (id) => {
    if (included.has(id)) return included.get(id);
    if (!nodes.has(id) || visiting.has(id))
      throw new Error("Invalid profile call tree.");
    visiting.add(id);
    const parent = parents.get(id);
    const ancestorMatch = parent === undefined ? false : includes(parent);
    const match =
      containing === "" ||
      nodes.get(id).callFrame.functionName.includes(containing) ||
      ancestorMatch;
    included.set(id, match);
    visiting.delete(id);
    return match;
  };
  for (const id of nodes.keys()) includes(id);
  for (const id of parents.keys())
    if (!nodes.has(id)) throw new Error("Missing child node.");
  const frames = new Map();
  let totalMs = 0;
  let selectedMs = 0;
  let selectedSamples = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i];
    const delta = profile.timeDeltas[i];
    if (!nodes.has(id) || !Number.isFinite(delta) || delta < 0)
      throw new Error("Invalid profile sample.");
    const ms = delta / 1000;
    totalMs += ms;
    if (!included.get(id)) continue;
    selectedMs += ms;
    selectedSamples++;
    const frame = nodes.get(id).callFrame;
    const key = JSON.stringify([
      frame.functionName,
      frame.url,
      frame.lineNumber,
    ]);
    const row = frames.get(key) ?? {
      function: frame.functionName || "(anonymous)",
      source: frame.url ?? "",
      line: (frame.lineNumber ?? -1) + 1,
      selfMs: 0,
    };
    row.selfMs += ms;
    frames.set(key, row);
  }
  return {
    containing,
    totalMs,
    selectedMs,
    selectedSamples,
    warnings: [
      "Sampled CPU time, not native UI latency; profiling itself adds overhead.",
      "Filtered results include matching stacks only. GC/idle samples without that stack are excluded; absence does not prove zero allocation cost.",
    ],
    frames: [...frames.values()]
      .sort((a, b) => b.selfMs - a.selfMs)
      .map((row) => ({
        ...row,
        percent: selectedMs ? (row.selfMs / selectedMs) * 100 : 0,
      })),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4)
      throw new Error(
        "Usage: pnpm perf:cpu profile.cpuprofile [function-name-substring]",
      );
    console.log(
      JSON.stringify(
        analyzeCPU(
          JSON.parse(readFileSync(process.argv[2], "utf8")),
          process.argv[3],
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
