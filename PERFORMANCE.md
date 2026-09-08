# Performance investigation

## Reproduce and capture

Use a release build for native measurements. In the performance notebook, **Export trace** downloads a bounded JSON snapshot (last 2,000 completed spans). It contains operation labels, monotonic start times, durations, outcomes, and per-label p50/p95/max. It excludes file paths, source text, Git arguments, and repository identities.

Included spans:

- `ipc.*`: full frontend invocation latency, including native queueing, backend work, serialization, and delivery. These are wall-clock measurements and include background operations.
- `diff.queue.foreground/background`: preparation scheduler wait, separate from actual work. Superseded jobs are recorded as errors.
- `diff.parse-worker`: worker creation, message transfer, parsing, and reply; not parsing CPU alone.
- `diff.highlight`: Pierre highlight-cache priming, including worker scheduling.
- `ui.file-open`, `ui.diff-ready`, `ui.tab-switch`, `ui.project-switch`: existing foreground timing boundaries. Focus-interrupted samples are excluded. These measure render/paint opportunities, not physical display presentation.

The export is a rolling sample, not lifetime statistics. Nested operations overlap; never add their durations together. Error samples are included in percentiles and counted separately. There is no external telemetry or disk logging by default.

Run the repeatable graph CPU benchmark:

```sh
pnpm perf:graph /tmp/githeaven-graph.json
# Optional read-only replay of all refs from a real repository (no OIDs exported):
pnpm perf:graph /tmp/githeaven-graph.json /path/to/repository
```

It uses three warmups and fifteen measured runs per deterministic workload, including 6,000 linear commits and wide histories with up to 256 concurrent lanes. Reports record Node version/platform/architecture and raw samples. Compare on the same machine with other builds stopped. This isolates graph layout; it does not benchmark WebKit, React, Git, cold startup, or total memory. It requires Node with TypeScript stripping (Node 22.18+ or 24 recommended).

## Findings — 2026-09-07

Graph edge construction repeatedly searched the entire lane array for each edge. A per-row object-ID-to-lane map removes those repeated scans while preserving lane/color decisions.

Synthetic median milliseconds, Node 24.14.1, macOS arm64, sequential baseline/optimized runs:

| Commits | Concurrent lanes | Before | After |
| ------- | ---------------- | ------ | ----- |
| 6,000   | 1                | 2.23   | 2.21  |
| 1,024   | 32               | 4.32   | 2.84  |
| 2,048   | 128              | 99.44  | 21.13 |
| 2,048   | 256              | 324.54 | 36.40 |

An independent comparison against the previous implementation produced identical complete row/edge/color output for 100 deterministic generated DAGs. Existing merge and history-pagination tests also cover graph invariants. The wide-history results are synthetic, not an app-wide speedup claim.

Read-only replay of the primary `terminal` repository's actual all-ref topological history also produced identical output. Median layout times dropped from 8.31 to 2.82 ms for 500 commits, 34.98 to 11.89 ms for 2,000, and 69.00 to 29.65 ms for 6,000 (same warmups/sample count). These are Node CPU measurements, not native UI timings.

## Remaining investigation scope

This performance effort is ongoing. The following areas still require baseline traces, attribution, optimization where warranted, and after-change verification:

| Area                                  | Required evidence                                                                              |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Cold launch and repository restore    | Native release launch-to-interactive; restored window and repository                           |
| Repository refresh and history paging | Native command/subprocess breakdown; clean/dirty repositories; watch bursts                    |
| Diff selection and live updates       | Cold/warm cache, large files, worker/highlight time, retained scroll and no flicker            |
| Editing                               | Cold/warm file opens, typing, gutter calculation, save, external changes                       |
| UI navigation                         | Edit/Git and repository switches; graph/sidebar/tree scrolling; command palette/filter latency |
| Git operations                        | Optimistic stage/unstage latency and completion; commit/checkout; error paths                  |
| Resource use                          | App plus WebKit helper CPU/RSS, worker/cache occupancy, sustained multi-repository sessions    |
| Regression gates                      | Repeatable native scenarios and stable thresholds, not timing assertions in jsdom              |

Keep raw local traces outside Git unless reviewed for inclusion. Document environment and sample sizes with every performance claim. Browser and Node benchmarks do not prove native WebKit latency.

## Native repository benchmark

```sh
pnpm perf:backend /path/to/repository > /tmp/githeaven-backend.csv
```

This release-mode Rust example directly calls the production repository code, without launching or modifying the desktop session. It performs read-only snapshots at 500/2,000/6,000 commits, individual status/file/ref/HEAD queries, snapshot serialization, commit details, and small working-file/diff-input reads. It never stages, commits, checks out, fetches, or writes repository files. Git runs with optional index locks disabled, as in the app. Use a repository with at least one commit. Errors abort the run with a nonzero exit code.

CSV rows contain operation, iteration, milliseconds, and output units. Output units are file counts for snapshots/commit details and byte lengths for other operations; they contain no paths or source text. Iteration 0 is the first call for that operation, followed by fifteen warm samples. The operating-system cache is not flushed. Environment/build mode goes to stderr. The calls isolate backend cost and exclude Tauri IPC, watcher delivery, UI scheduling, and rendering. Run without another build/benchmark for comparable results.

### Overlap independent snapshot reads

The original snapshot performed refs and history reads only after status/file discovery finished. The revised implementation starts refs and history as soon as the HEAD probe completes, overlapping them with the still-running status and file-list reads. Every refresh still reads live Git data, with unchanged parsing, limits, and error propagation; no result cache was introduced.

Primary `terminal` repository, release Rust, macOS arm64, fifteen warm samples per operation:

| Operation               | Before median ms | After median ms |
| ----------------------- | ---------------- | --------------- |
| Working snapshot        | 79.99            | 80.68           |
| Snapshot, 500 commits   | 130.69           | 85.52           |
| Snapshot, 2,000 commits | 144.45           | 88.91           |
| Snapshot, 6,000 commits | 186.14           | 124.64          |

Standalone status was about 69ms, file discovery 61–63ms, and serialization 0.5ms. Thus this change improves full snapshots by roughly a third but does not improve the working-only refresh bottleneck. File reads were about 0.01ms, while diff-version inputs took 47–49ms: inspecting the implementation shows three sequential Git subprocesses per blob read. Reducing that overhead while preserving missing-file/error handling and the pre-read size cap is a next investigation target.

### Combine blob size and content reads

Blob loading now resolves the exact entry from the index/tree listing, then requests its object ID through one `git cat-file --batch` process. The header supplies the type and size; the reader checks the 2 MB cap before allocating the content buffer and kills/reaps the process on rejection. This removes the separate `cat-file -s` subprocess while retaining normal missing-file behavior and propagating real errors. Object IDs, rather than filenames, go through the line protocol so tabs/newlines in filenames remain valid.

The same native primary-repository benchmark measured working-file diff inputs at **28.56ms median**, versus **49.17ms** before this change (15 warm samples, macOS arm64 release build). This isolates backend inputs; worker parsing, syntax highlighting, and native display latency remain separate measurements. Blob-read tests cover empty/missing files, invalid revisions and object types, unusual filenames, binary data, oversize rejection, and successful reads after a rejected request. A repeat on the final code measured 30.41ms median (40.90ms p95); an additional test verifies unresolved index stages remain errors. No persistent subprocess or blob cache was added.

## Native resource and UI capture

```sh
pnpm perf:resources /tmp/githeaven-resources.json
```

The macOS collector uses `launchctl` coalition bundle IDs to associate Githeaven with its WebContent, GPU, and networking processes, even when their parent is `launchd`. It then obtains RSS/CPU snapshots from `ps` and physical/peak footprints from Apple's `footprint` tool. It writes only names, PIDs, numeric usage, and attribution/completeness information; it does not export launchctl domain contents or process arguments. Failed attribution or missing footprint data marks the report incomplete. Physical footprint and RSS are different metrics; summing RSS can double-count shared memory. CPU percentages are `ps` snapshots, not an interval-based CPU benchmark. This collector is currently macOS-only.

The existing long-lived primary-repository session measured **747.3 MiB combined physical footprint**, with about 686 MiB attributed to WebContent. The Rust app alone used about 32 MiB. This identifies a memory investigation target; it does not prove a leak or an optimization. The session had 38 working changes and two project tabs. Do not compare it directly to a fresh launch.

In the performance notebook, **Start capture** enables a foreground animation-frame probe and input-to-two-frame-opportunity timings. It continues when the notebook closes; **Stop capture** removes listeners and cancels outstanding frame callbacks. Only frame intervals above 50ms are stored, with observed/slow-frame counters. Blurs and visibility changes reset the interval; they are not counted as UI stalls. The probe is off by default and consumes no continuous animation frames until enabled. Frame gaps show stalls, not their cause or physical display latency.

Trace schema v2 also includes current diff-cache entry/source-byte/queue counts, Pierre worker/cache occupancy, and diff preparation hit/miss/shared-request counters. Source bytes exclude AST and renderer memory, so use the native resource report alongside these gauges. Exports use a native save dialog in Tauri and the browser download mechanism only in browser preview. A native validation found the previous blob-download path blocked in WebKit's download-destination sandbox call; the native dialog bypasses that path.

### Bound speculative diff preparation

A live primary-repository trace showed repeated preparation churn: 24 speculative candidates competed for a 6 MiB source cache that held only 16 of them. More than 1,000 preparations accumulated during the longer baseline session. The preloader now attempts at most eight candidates per pass and defers speculative inputs above 128 KiB of estimated source storage. Explicit selection retains the existing 2 MB per-file limit and bypasses the speculative cap, including when a click promotes an in-flight background request. Tests cover both direct selection and promotion.

Native observations with 38 working changes, release builds on the same Mac:

- Earlier fresh-session snapshot: 16 source entries / 6,103,706 bytes; 24 syntax-cache entries; 617.7 MiB combined physical footprint.
- After bounded prefetch and a short diff/tab navigation sequence: 8 source entries / 233,402 bytes; 8 syntax-cache entries; 527.7 MiB combined footprint.
- The repeated two-file navigation produced 8ms and 11ms diff-ready samples, versus one 81ms sample in the baseline. Edit/Git transitions remained 33–77ms in the short post-change capture.

These are live observations with different session durations and background activity, not a controlled memory/latency benchmark or a leak determination. They show reduced retained speculative content and a direction for further measurement. Native trace export was verified through the save dialog and the resulting JSON inspected. Capture was stopped after verification. Raw traces/resource snapshots remain in the local temporary directory.

### Resettable windows and navigation-aware prefetch

Reset samples now clears the exported trace and counters as well as the notebook's timing lists. Trace schema v3 reports the window start, elapsed duration, and number of samples discarded by the 2,000-entry bound. Spans started before reset are excluded when they finish afterward; live cache gauges remain available. Counters cover the whole window, whereas latency summaries cover only retained samples when `discardedSamples` is nonzero. The window duration is wall-clock elapsed time since reset (or page startup before the first reset), not foreground capture time. Reset before each scenario and use equal foreground sequences for comparisons.

The eight speculative candidates now follow the selected file, alternating next/previous neighbors, rather than selecting that file plus the first seven entries. Selection identity includes index/worktree/commit source and commit revision. This preserves the existing source-size and concurrency limits. In a deterministic 40-file candidate-list walk, coverage of the immediately adjacent file improved from 7/39 to 39/39 steps in each direction. This measures candidate coverage only: it assumes neither completed prefetch nor a cache hit, and does not establish a native latency improvement. Tests cover middle/end navigation, short/empty lists, missing selection, and staged/commit identity. Native rapid-navigation latency and sustained cache behavior still need measurement.

## Analyze and compare native traces

```sh
pnpm perf:trace /tmp/before.json
pnpm perf:trace /tmp/before.json /tmp/after.json
```

The analyzer validates schema 2/3 samples and calculates distributions from raw successful samples, with errors separately counted. It omits p95 below 20 successful samples, retains operations absent from one run, and warns when rolling-buffer loss means counters and timings cover different intervals. It does not sum nested durations or declare a regression from unmatched workloads. A 20-sample cutoff is a minimum display rule, not statistical confidence. Compare the same native release scenario, machine, repository state, pacing, and cache conditions. Older schema 2 captures lack reset-window metadata.

### Native sequential navigation and redundant reads

A release run on the primary repository (45 working changes) selected `docs/integrations/actions.md`, moved down 12 files and back up 12 using the keyboard. CUA observed the UI between each key, so this measures individual navigation at roughly half-second intervals, not key-repeat stress. The 25 diff-ready samples had a 16ms median, 224ms p95, and 381ms maximum. The slowest open included a 41ms versions read, 8ms parsing, and 319ms highlight priming. Highlighting dominated that miss; many warm opens took 12–18ms. The trace window also included idle time and background repository changes: 123 versions reads and 32 speculative size rejections are not per-click counts.

Two redundant-read cases are now avoided. A syntax-cache eviction reuses already-current source versions instead of reading Git again; a new repository refresh still revalidates them. Large speculative rejections are remembered for that refresh in a bounded 64-key map, so nearby navigation does not repeatedly read the same rejected file. Explicit selections bypass rejection memory, and a new refresh permits another speculative attempt. Counters `diff.prepare.source-cache-hit` and `diff.prepare.deferred-hit` expose the avoided work. This does not change the speculative size budget, foreground file-size limit, or source/AST retention limits. Tests verify reuse, refresh invalidation, explicit selection, and in-flight promotion.

Repeating the same 25 selections in the rebuilt app recorded **18 deferred-hit events**, directly confirming avoided speculative reads. Median/p95 diff-ready was **15/222ms**, effectively unchanged from **16/224ms**. Highlighting large TypeScript inputs remains the main tail-latency target. The after trace had 75 versions reads versus 123 before, but its reset window was shorter (27.5s versus 61.8s) and had fewer background refreshes (4 versus 7), so the raw count reduction is not an attributable speedup. No source-cache-hit event occurred in this sequence; that optimization is verified by the focused eviction/invalidation test, not this native run. Both captures retained all samples. The updated app was left on the primary graph with capture stopped.

## Highlighting CPU benchmark

```sh
pnpm perf:highlight /tmp/highlight.json
# Optional read-only HEAD-versus-working-file inputs (tracked files, at most 2 MiB per side):
pnpm perf:highlight /tmp/highlight.json /path/to/repository relative/file.ts
```

The benchmark calls Pierre's production parser and full-diff renderer with the app's theme, word-diff mode and line-length limits. It compares WebAssembly and JavaScript regex engines on deterministic 100/1,000-line TypeScript fixtures and optional real files. Each engine initializes once; each fixture records its first render and 20 warm renders. Reports include engine initialization, parse cost, source size, raw warm samples, p50/p95, and exact rendered-output equality against WebAssembly. They exclude paths, source, and rendered content. This is Node CPU work, not WebKit worker scheduling, transfer, IPC, or display timing. Run without builds or other benchmarks. Optional files compare HEAD with the working file, not the index.

An initial isolated primary-repository test reproduced the slow native highlighting: WebAssembly took roughly 140ms on warm renders of the 112,780-character combined input, versus roughly 530ms for JavaScript, with identical output. Disabling word-level diff markings still took roughly 140ms, so it would lose detail without solving the bottleneck. The app keeps WebAssembly and full syntax highlighting.

### Larger immediate-neighbor preparation

Only the immediately following and preceding files now get a 512KiB speculative source budget. The selected and more distant candidates retain 128KiB, with at most eight candidates (1.75MiB aggregate speculative allowances). Existing foreground limits and the 6MiB/24-entry source cache and 24-entry AST cache remain unchanged; these budgets do not describe total renderer memory. A deferred file is reconsidered if its new allowance can accommodate it. Tests cover list edges, both neighbors, total allowances, deferred retries, and rejection above the larger cap. This moves expensive preparation ahead of likely navigation; it does not reduce the CPU cost of highlighting an individual file or guarantee a hit during rapid key repeat.

The repeatable Node benchmark measured the primary TypeScript input at 134.44ms median / 140.66ms p95 with WebAssembly, versus 605.67/824.07ms with JavaScript (20 warm samples). Exact rendered output matched for both synthetic cases and the real input. The engine comparison is workload-sensitive: the synthetic 100-line fixture was about 29–31ms on both engines.

Native after-change navigation measured **16ms median, 43ms p95, 52ms maximum over 29 opens**. The earlier run measured 15ms median/222ms p95 over 25 opens. Two new billing files appeared in the working tree between runs; the after sequence traversed the same range plus those two files in each direction. This is live evidence of lower selection latency, not a controlled percentage speedup. Highlight priming still reached 195ms, but was completed speculatively before those selections. The source cache held 24 entries / 1,447,400 estimated bytes at export; the AST cache held 24 entries. The capture was stopped and the app returned to the graph.

A native resource snapshot after this run reported **835.6MiB combined physical footprint**, about 758MiB in WebContent, with a roughly 919MiB WebContent peak. This is a remaining concern, not a memory success claim. Session length, watch activity, selected files, and garbage collection differ from earlier snapshots; fixed-workload before/after memory measurements are needed before attributing the difference to the larger neighbor allowance. Use the resource collector alongside latency traces, and investigate sustained allocation/cache behavior rather than treating source-byte gauges as total memory.

## Fixed workload and memory sampling

```sh
pnpm perf:fixture
# Open the printed disposable directory in Githeaven.
pnpm perf:resources /tmp/graph-idle.json
pnpm perf:resource-series /tmp/settled.json 7 5
```

`perf:fixture` always creates a new temporary repository with no remote, one deterministic baseline commit, and 32 modified TypeScript files. Eight have 60 lines and 24 have 600 lines; changes are small while full-file syntax work is substantial. The `.git/githeaven-performance-fixture.json` manifest records before/after byte lengths and SHA-256 hashes plus a navigation recipe. Two independently generated repositories were verified to have identical manifests and exactly 32 modified tracked files. It never resets an existing directory or copies user source. Generated repositories and reports stay outside this project.

For an isolated run, record existing project tabs and ensure there are no unsaved drafts, open only the fixture, and restart the release app. Record graph idle, select file-00, move down 23 files and up 23 with an observation after every key, return to the graph, and record settled memory. Restore original project tabs afterward. The initial selection plus keyboard traversal is 47 actions; use actual completed foreground timing counts from the trace rather than assuming every action yielded a sample.

The timed collector takes 2–600 samples with 1–60 seconds between collections, defaults to seven samples five seconds apart, and writes progress after every completed sample. Partial runs have `complete: false`. It flags process-set changes and incomplete attribution, so a restarted app is not silently treated as continuous memory growth. Collection itself adds overhead; intervals are delays between collections, not exact fixed-rate timestamps. Avoid builds and other benchmarks during a run.

Resource schema v2 adds selected OS allocation categories for each process: WebKit malloc, JS JIT code, JS VM Gigacage, and owned graphics footprint where available. Categories include dirty, swapped, and reclaimable bytes. They are diagnostic categories, not additive physical-footprint components; compressed/swapped accounting differs from RSS. Missing categories are omitted, not reported as zero. No mappings, addresses, source, or process arguments are exported.

### Fixed-workload baseline, release c2a9850

On the same Mac with the fixture as the only open project:

| Phase                                        | Combined physical footprint |
| -------------------------------------------- | --------------------------- |
| Fresh graph idle                             | 355.5 MiB                   |
| After forward navigation                     | 583.6 MiB                   |
| After reverse navigation and return to graph | 514.7 MiB                   |
| Later seven-sample idle series               | 605.6–606.4 MiB             |

The idle series used the same processes throughout with complete attribution and stabilized near 606.3MiB over 30 seconds. The final WebContent categories included about 403MiB dirty and 358MiB swapped WebKit malloc; these are not figures to add to the combined footprint. This short run neither proves nor excludes a leak, and the changing idle figures show why a single RSS or physical-footprint snapshot is insufficient.

The trace recorded 46 completed diff-ready samples at 12ms median, 15ms p95, and 17ms maximum. At export, the source cache held 24 entries / 3,802,464 estimated bytes and the AST cache held 24 entries, with no queued or active workers. Source retention is bounded, but does not explain total WebKit memory. Subsequent optimization should compare repeated identical navigation cycles and allocation categories, retaining both latency and memory evidence. The original `terminal` and `githeaven` tabs were restored, with `terminal` selected and capture stopped.

## Repeated live updates and obsolete highlight retention

```sh
pnpm perf:pulse /path/printed/by/perf-fixture 12 1000
```

The pulse driver accepts only a generated fixture whose `src/file-01.ts` matches its manifest hash. It changes one value 12 times, one second apart by default, then restores the original working-file contents. It does not stage or commit. It checks for external modifications before each write and restores only if the file still matches its last write. Abrupt process termination may bypass restoration; regenerate the disposable fixture in that case. Counts are limited to 1–100 and intervals to 500–5,000ms.

For a native comparison, freshly launch with the fixture selected, open file-01, reset/start capture, close the notebook, run the pulse driver, then stop/export capture. Keep the same fixture, build mode, navigation and pulse pacing. Unopened saved project tabs do not load their repository sessions until selected; do not select live repositories during the fixture run. This tests watcher delivery and repeated replacement of the displayed diff, rather than changing to different files.

Code inspection found that every changed diff received a new syntax-cache key, while its previous highlighted version remained in Pierre's LRU after the source-cache entry was replaced. Baseline native capture confirmed **18 syntax entries for only five current source entries** after 12 pulses plus restoration. Those 13 obsolete versions compete with useful files for the 24-entry syntax cache. The baseline combined physical footprint snapshot was 442.4MiB. Its 13 live-update render samples had a 234ms median and 262ms maximum; this small sample is not a robust p95 estimate.

The cache now retires the previous syntax entry only after its replacement has been successfully highlighted and accepted into the source cache. It preserves the old version during reads/highlighting and on failures. Unchanged refreshes retain the same syntax entry. Unit coverage verifies pending replacement, failure preservation, unchanged refresh, and repeated versions staying at one current syntax entry. `diff.cache.retired-highlight` counts actual evictions. This removes stale retention without lowering useful-file cache capacity or showing a plain-text intermediate render.

The rebuilt native app recorded **13 retired-highlight events** during the same pulse sequence. Final syntax-cache occupancy fell from **18 to 6 entries**, while both runs retained the same five source entries / 455,864 estimated bytes. Thirteen live-update samples measured 231ms median / 257ms maximum after the change, versus 234/262ms before. This verifies removal of obsolete cached versions without a material latency change in this small run. One additional syntax entry remained beyond source-cache occupancy; superseded/in-flight preparation is a remaining lifecycle investigation target.

The after-change physical-footprint snapshot was **508.9MiB**, higher than the baseline's 442.4MiB despite lower cache occupancy. This does not establish a footprint improvement: allocator reuse, collection timing, compression and transient render allocations still require time-series comparison. The optimization is supported by actual retirement events and reduced retained syntax entries, not by a claimed process-memory reduction. The pulse driver restored the fixture and its original hash was verified. The disposable tab was closed, the original project tabs remained, and the primary graph was restored with capture stopped.
