import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const [directory, countText = "12", intervalText = "1000"] =
  process.argv.slice(2);
const count = Number(countText),
  interval = Number(intervalText);
if (
  !directory ||
  !Number.isInteger(count) ||
  count < 1 ||
  count > 100 ||
  !Number.isFinite(interval) ||
  interval < 50 ||
  interval > 5000
)
  throw new Error(
    "Usage: pnpm perf:pulse fixture-directory [1-100 updates] [50-5000 milliseconds]",
  );
const root = resolve(directory);
const manifest = JSON.parse(
  readFileSync(
    join(root, ".git", "githeaven-performance-fixture.json"),
    "utf8",
  ),
);
const path = join(root, "src", "file-01.ts");
const original = readFileSync(path, "utf8");
const hash = (text) => createHash("sha256").update(text).digest("hex");
if (
  manifest.version !== 1 ||
  manifest.files.find((file) => file.path === "src/file-01.ts")?.afterHash !==
    hash(original) ||
  !original.includes("'updated-1'")
)
  throw new Error("Expected an unchanged generated fixture; refusing to edit.");
let last = original;
try {
  for (let i = 1; i <= count; i++) {
    if (readFileSync(path, "utf8") !== last)
      throw new Error(
        "Fixture changed externally; stopping without overwriting it.",
      );
    last = original.replace("'updated-1'", `'pulse-${i}'`);
    writeFileSync(path, last);
    console.log(`Update ${i}/${count}`);
    await setTimeout(interval);
  }
} finally {
  if (readFileSync(path, "utf8") === last) writeFileSync(path, original);
  else
    console.error(
      "Fixture changed externally; original contents were not restored.",
    );
}
