import { readFileSync } from "node:fs";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const version = JSON.parse(read("package.json")).version;
const tauri = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const cargo = read("src-tauri/Cargo.toml").match(
  /\[package\][\s\S]*?\nversion = "([^"]+)"/,
)?.[1];
const lock = read("src-tauri/Cargo.lock").match(
  /\[\[package\]\]\nname = "githeaven"\nversion = "([^"]+)"/,
)?.[1];
if ([tauri, cargo, lock].some((value) => value !== version)) {
  throw new Error(
    "Release versions must match in package.json, tauri.conf.json, Cargo.toml, and Cargo.lock.",
  );
}
const tag = process.env.RELEASE_TAG;
if (
  tag &&
  (!/^v\d+\.\d+\.\d+-alpha\.(0|[1-9]\d*)$/.test(tag) || tag !== `v${version}`)
) {
  throw new Error(`Expected alpha tag v${version}; received ${tag}.`);
}
console.log(`Release version verified: ${version}`);
