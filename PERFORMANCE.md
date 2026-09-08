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

The pulse driver accepts only a generated fixture whose `src/file-01.ts` matches its manifest hash. It changes one value 12 times, one second apart by default, then restores the original working-file contents. It does not stage or commit. It checks for external modifications before each write and restores only if the file still matches its last write. Abrupt process termination may bypass restoration; regenerate the disposable fixture in that case. Counts are limited to 1–100 and intervals to 50–5,000ms.

For a native comparison, freshly launch with the fixture selected, open file-01, reset/start capture, close the notebook, run the pulse driver, then stop/export capture. Keep the same fixture, build mode, navigation and pulse pacing. Unopened saved project tabs do not load their repository sessions until selected; do not select live repositories during the fixture run. This tests watcher delivery and repeated replacement of the displayed diff, rather than changing to different files.

Code inspection found that every changed diff received a new syntax-cache key, while its previous highlighted version remained in Pierre's LRU after the source-cache entry was replaced. Baseline native capture confirmed **18 syntax entries for only five current source entries** after 12 pulses plus restoration. Those 13 obsolete versions compete with useful files for the 24-entry syntax cache. The baseline combined physical footprint snapshot was 442.4MiB. Its 13 live-update render samples had a 234ms median and 262ms maximum; this small sample is not a robust p95 estimate.

The cache now retires the previous syntax entry only after its replacement has been successfully highlighted and accepted into the source cache. It preserves the old version during reads/highlighting and on failures. Unchanged refreshes retain the same syntax entry. Unit coverage verifies pending replacement, failure preservation, unchanged refresh, and repeated versions staying at one current syntax entry. `diff.cache.retired-highlight` counts actual evictions. This removes stale retention without lowering useful-file cache capacity or showing a plain-text intermediate render.

The rebuilt native app recorded **13 retired-highlight events** during the same pulse sequence. Final syntax-cache occupancy fell from **18 to 6 entries**, while both runs retained the same five source entries / 455,864 estimated bytes. Thirteen live-update samples measured 231ms median / 257ms maximum after the change, versus 234/262ms before. This verifies removal of obsolete cached versions without a material latency change in this small run. One additional syntax entry remained beyond source-cache occupancy; superseded/in-flight preparation is a remaining lifecycle investigation target.

The after-change physical-footprint snapshot was **508.9MiB**, higher than the baseline's 442.4MiB despite lower cache occupancy. This does not establish a footprint improvement: allocator reuse, collection timing, compression and transient render allocations still require time-series comparison. The optimization is supported by actual retirement events and reduced retained syntax entries, not by a claimed process-memory reduction. The pulse driver restored the fixture and its original hash was verified. The disposable tab was closed, the original project tabs remained, and the primary graph was restored with capture stopped.

## Superseded preparation and rapid watcher bursts

```sh
pnpm perf:pulse /path/printed/by/perf-fixture 40 100
```

The fixture pulse driver now allows intervals down to 50ms for watcher-burst testing. Watcher coalescing means the number of file writes is not the number of refreshes or renders. After a burst, verify the restored fixture hash and the final displayed value, and wait for queue/worker gauges to settle before comparing retention.

A newer revision now replaces queued older work for the same diff comparison. In-flight Git reads are allowed to finish, but ownership is checked before parsing and highlighting. An obsolete parser is terminated. Highlighting already dispatched to Pierre is allowed to complete; a newly allocated stale syntax key is then evicted rather than retained. Reused syntax keys are preserved because they can belong to the current revision too. Cancellations leave the displayed diff in place and are not user-facing failures. `diff.prepare.superseded` counts cancellations and `diff.superseded.queue/read/parse/highlight` identifies their phase; cancelled queue/parse spans may appear as errors in the generic trace schema.

A controlled scheduling test submits 20 revisions with the first two reads held in flight: only three version reads and one highlight occur, the queue contains only the latest revision, and revision 20 wins. Separate tests verify parser termination, late-highlight eviction, and preservation of a syntax key shared with a newer refresh. This is deterministic avoided-work evidence, not an end-to-end latency benchmark.

A native 40-write / 100ms burst recorded nine superseded results, all after highlighting had already started, and settled at **five source-cache entries and five syntax-cache entries**, with no pending or queued work. The final UI showed the restored highlighted value without an error/loading placeholder; the fixture hash was independently verified. Twelve completed live-update samples had a 208ms median and 217ms maximum, but they exclude updates superseded/coalesced during the burst and must not be interpreted as latency for all 40 writes. This native run verifies cleanup of stale highlighted results; avoiding Git reads/parsing is covered by controlled scheduling tests. Full-burst pixel-level flicker/scroll verification and faster highlighting remain separate work. Capture was stopped, the fixture tab closed, and the primary repository restored.

## File and command search

```sh
pnpm perf:search /tmp/search.json
```

The deterministic Node benchmark ranks five query shapes over 10,000 and 100,000 file items plus a command. It records one index-construction measurement, three ranking warmups, 20 ranking samples, match counts, and hashes of the full ordered results. Empty queries, broad matches, selective subsequences, path matches, and misses are included. These are CPU measurements, not native input/display latency.

Search previously lowercased each label/path and normalized the query twice per candidate on every keystroke, allocated score objects even for non-matches, and sorted command priority with every result comparison. It now prepares a compact index once per item-array version while the palette is mounted, normalizes each query once, allocates scored results only for matches, and ranks commands separately ahead of other matches. All matching results remain available through the existing virtualized list; none are truncated. The index is released with the palette and rebuilt when repository items change.

Same-machine Node medians in milliseconds:

| Files   | Query               | Before | After |
| ------- | ------------------- | ------ | ----- |
| 10,000  | broad `f`           | 1.89   | 0.91  |
| 10,000  | selective `file-99` | 4.31   | 2.61  |
| 10,000  | no match            | 1.86   | 0.49  |
| 100,000 | broad `f`           | 18.70  | 8.50  |
| 100,000 | selective `file-99` | 41.08  | 28.85 |
| 100,000 | no match            | 17.93  | 4.86  |

The one-time index cost was 1.97ms for 10,000 files and 16.38ms for 100,000 files, whereas the old implementation had no preprocessing cost. This shifts some work to opening the palette; it is not a claim that every interaction is faster. All ten complete benchmark ranking hashes matched the previous implementation. Another 22 complete comparisons matched across mixed item kinds, Unicode, whitespace, empty queries and both modes. Frontend tests cover command priority, bounded visible rows, keyboard selection, and item updates during a query.

Native exports now include `search.index` and `search.rank` CPU spans, `ui.palette-open` from the shortcut/button request to two frame opportunities after modal focus, and `ui.palette-query` from input change to two frame opportunities after result rendering. Query text and item paths are not recorded. Queries superseded before the frame callbacks complete are omitted; closing the palette cancels callbacks. Tests verify measurement even when the result array is unchanged and cancellation on close.

On the primary repository, a short native run measured nine index builds at 2–3ms and 43 rankings at 2ms median / 4ms p95. Six completed query-to-paint samples were 21–32ms. The two palette-open samples were 32ms and 91ms, too few for a meaningful p95; this identifies opening/rendering latency beyond the small ranking cost as further work. File search and command-first results were checked in the native UI, then capture was stopped and the primary workspace left open.

### Palette opening stages

`ui.palette-react` measures elapsed time from the open request to the palette's mount layout effect, including React scheduling/render/commit work. `search.dialog-open` measures the synchronous native dialog `showModal()` and input focus calls. The existing `ui.palette-open` finishes after two animation-frame opportunities; it is a presentation proxy, not an OS compositor timestamp. These nested stages must not be added together.

A release-native capture of 20 file-palette opens on the primary repository measured 28.5ms median / 32ms p95 / 56ms maximum for the full proxy. The first open was 56ms; the remaining 19 were 21–32ms. Request-to-layout-effect was 3–5ms (3.5ms median), dialog opening/focus was 0–1ms, index construction was approximately 1ms, and empty-query ranking rounded to 0ms at the clock's resolution. Most elapsed time was therefore after synchronous dialog setup, within the two-frame measurement window. This run does not reproduce a recurring 91ms delay or justify additional index caching solely to optimize opening. It also does not isolate first-frame rendering from frame scheduling/compositing; cold-start and loaded-system repetitions remain needed. No query text or file paths are included in these spans.

## Editor gutter lookup

```sh
pnpm perf:gutter /tmp/gutter.json
```

This deterministic CPU benchmark looks up markers for 200 visible lines near the top, middle and bottom of files with 0, 100, 1,000 and 10,000 change ranges. It records five warmups, 30 measured passes and complete output hashes. It excludes DOM traversal, attribute updates, worker diff calculation, syntax highlighting and paint; it is not a typing-latency measurement. `editor.gutter-paint` in native traces measures the full synchronous gutter traversal/decoration pass, which also runs after virtualized editor renders.

Previously each visible line used a linear scan over all change ranges. Unchanged lines scanned the entire list, so even a viewport near the beginning paid for changes far below it. The lookup now binary-searches the first range whose end reaches the line, preserving first-match precedence at overlapping deletion anchors. Pierre's parsed ranges are emitted in file order; tests assert nondecreasing start/end coordinates and compare every line against linear lookup across 100 deterministic insertion/deletion/replacement diffs, plus explicit overlapping boundaries. Existing DOM tests still cover clearing markers, keeping gutter nodes and ignoring stale worker results.

On this machine, the 10,000-range bottom viewport fell from **1.455ms median / 1.917ms p95** to **0.0046ms / 0.0053ms** for lookup alone. The middle viewport fell from 1.009ms to 0.0046ms median. All 12 complete output hashes matched. These synthetic stress results establish improved scaling of marker lookup; native typing and scrolling improvements remain to be measured rather than inferred from the CPU ratio.

## Editor change calculation

```sh
pnpm perf:editor-changes /tmp/editor-changes.json
```

The benchmark calls the production marker calculation for 1,000-, 10,000- and 30,000-line synthetic files: clean, one-line replacement, edits every 20 lines, and entirely new files. Each case records its first call, three warmups, 20 measured calls, input character count, marker count and complete output hash. Clean inputs are separately reconstructed. This isolates calculation CPU; worker startup, message copies, debounce, DOM work and presentation are excluded.

Native traces now include `editor.changes-compute`, measured inside the worker with its time origin translated to the page clock. It includes completed obsolete calculations; `editor.changes-stale` counts replies discarded because a newer edit already exists. Terminated workers cannot report unfinished calculations. Errors are recorded as errors and retain the previous behavior of returning no markers. These metrics distinguish expensive calculations from main-thread gutter decoration without exporting source text.

Clean files now return immediately after string equality. Files absent from main or with an empty baseline count lines directly, including trailing-newline handling. Modified files retain Pierre's full parsing/alignment semantics. A direct `diffLines` prototype failed compatibility checks because Pierre additionally aligns unequal replacement blocks by similarity; it was not adopted.

For 30,000 lines on this machine, clean calculation fell from **13.111ms median to 0.027ms**, and new-file calculation from **30.666ms to 0.278ms**. All 12 benchmark output hashes matched. Another 510 compatibility cases compare against the prior Pierre-based extraction, covering Unicode, CRLF/LF, missing final newlines, empty files, repeated lines and mixed edits.

Scattered modifications remain expensive: 30,000 lines measured 498ms median before and 519ms after, with broad timing variation. That path still uses the same algorithm; this change makes no improvement claim for it. Native typing measurements, worker queue control and incremental calculation remain necessary follow-up work.

Validation note: the first full run intermittently failed the existing App test for keeping an unsaved edit when cancelling a project switch (the mocked editor showed original contents). It passed in isolation and on the complete rerun (96 frontend / 15 Rust tests). App and its editor mock were unchanged by this optimization; the cause is not established and remains a test-stability/unsaved-edit investigation item.

### Bound the editor worker backlog

A controlled slow-worker test held the first result while 20 edits arrived 150ms apart, each exceeding the 120ms debounce. Before the change, all 21 jobs were sent to the worker. Ignoring their replies did not prevent their calculations or structured-clone allocations.

The editor now permits one calculation in flight and stores only the latest pending revision on the page. Once the current job completes, it dispatches that revision if its debounce has elapsed. A newer keystroke clears pending readiness until its own debounce expires. Existing markers remain visible while calculations run, and stale results never replace them. File changes/unmount terminate the worker and discard pending state; late callbacks from a previous worker are ignored. Already running calculations are not interrupted.

The same controlled test now sends **two jobs instead of 21** and records **19 coalesced revisions**. `editor.changes-dispatched` counts posted jobs and `editor.changes-coalesced` counts replacements of debounce-ready pending revisions; keystrokes absorbed before the debounce fires are not counted. Tests additionally cover worker completion during a new debounce, file changes, unmount, and stale callbacks. This establishes avoided queued work, not a native typing-latency result. The current calculation can still delay the newest result by its own remaining runtime; incremental diff calculation and native burst traces remain follow-up work.

## Native editor fixture and capture

```sh
pnpm perf:fixture --editor
```

This creates a new disposable repository with three TypeScript files containing 1,000, 10,000 and 30,000 lines. Every twentieth line differs from the committed baseline. It retains the fixture manifest's before/after hashes and leaves the original default diff-navigation profile unchanged. The editor profile is deliberately incompatible with `perf:pulse`; that driver rejects its different fixture contents.

A release-native run on this Mac opened file-01 and file-02 in Edit, typed a short comment followed by 20 keys in the 10,000-line file, discarded it, then entered 20 individually observed keys and a rapid 20-key burst in the 30,000-line file. Accessibility observation paced the individually observed keys about 1.1 seconds apart; the rapid burst omitted those observations. This is an automated workload, not a recording of a human typing session. Capture included palette navigation and file opening as well as typing.

Results from the trace (no discarded samples):

| Measurement                                             | Samples | Median |   p95 | Maximum |
| ------------------------------------------------------- | ------: | -----: | ----: | ------: |
| Worker calculations before opening the 30,000-line file |       4 | 85.5ms |     — |    90ms |
| Worker calculations after opening the 30,000-line file  |      24 |  800ms | 852ms |   862ms |
| Key-to-two-frame proxy after that file opened           |      50 |   28ms |  33ms |    34ms |
| Gutter decoration across the capture                    |     109 |    0ms |   0ms |     1ms |

The two file-open measurements were 352ms and 899ms. The **aggregate** key p95 was 377ms, but its largest samples began during the first palette-driven file open. It must not be described as steady-state editor typing latency. The stage split above uses the second file-open start as its boundary, not individual editor-event labels; dedicated editor input attribution would be stronger evidence. Sub-millisecond values round to zero at the native clock's observed precision.

There were 28 dispatched calculations and 12 stale results, with no recorded replacement of debounce-ready pending revisions. The rapid burst was primarily absorbed by debounce, and the observed keys were spaced far enough apart for calculations to complete. Thus this run verifies native behavior with the bounded scheduler, but **does not prove its backlog reduction under native overload**; the controlled slow-worker test provides that evidence. Worker calculations remain materially slower than the Node benchmark even while native input stays responsive. File-open preparation and marker freshness are remaining targets.

All three fixture file hashes were verified unchanged after discarding edits. The fixture tab was closed, capture stopped, and the primary repository restored. Raw local trace: `githeaven-native-editor.json` in the system temporary directory.

### Unchanged baseline refreshes

Repository refreshes previously scheduled marker calculation after every successful `main_file` read, even when the baseline and editor contents were unchanged. A controlled test with ten unchanged refreshes recorded eleven worker jobs including the initial calculation. The hook now keeps its markers and pending editor work when the returned baseline equals the stored baseline; edits still use the normal scheduler, and baseline changes trigger recalculation. Failed calculations remain eligible for retry on the next refresh.

The same test now records one initial job, ten `editor.changes-unchanged-baseline` events, and a second job only when the baseline changes. A separate test verifies retry after a worker computation error. This avoids both worker calculation and source-text cloning for unchanged refreshes without adding another source cache. It does not avoid the native `main_file` read itself.

Native verification reopened the unchanged 30,000-line editor fixture, reset the trace after initial preparation, and invoked Refresh repository ten times. The trace recorded eleven refreshes including background activity: eleven `main_file` reads (48ms median / 56ms maximum), eleven unchanged-baseline events, and **no editor calculation dispatches or compute samples**. No trace samples were discarded. This verifies reuse in the native app; it does not claim that the approximately 800ms previous calculation cost applies identically to every avoided job. Source reads and diff prefetch on refresh remain measurable costs. The fixture tab was closed with no edits and the primary workspace restored. Local artifact: `githeaven-editor-refresh-reuse.json` in the system temporary directory.

### Pause hidden Git work while editing

The unchanged-baseline native trace also recorded 33 diff preparation cache misses, 22 skipped large prefetches and 11 cache hits during eleven repository refreshes while Edit was active. Git's mounted provider still received new refresh inputs and traversed its speculative diff candidates. Keeping both views mounted therefore preserved UI state but continued hidden preparation.

Edit now withholds both working-change and commit-preview prefetch candidates and defers the retained Git diff's refresh. Switching back to Git supplies current candidates and resumes comparison refresh; existing views and caches remain mounted. The prefetch loop's existing cleanup stops further candidates, although a speculative calculation already in progress can finish. No background work is cancelled solely by evicting cached content.

An App behavior test verifies candidate suppression and retained-diff deferral in Edit, then restoration when Git is selected. Existing Surface tests cover keeping the prior comparison during deferral and updating after it ends. This changes when cold comparisons become prepared: after a long editing session, an uncached comparison is prepared on returning to Git rather than continuously during every hidden refresh. Native repeat-capture results follow below; cold comparison selection immediately after a tab return still needs separate measurement.

Native repeat capture on the same unchanged editor fixture recorded **twelve repository refreshes, zero diff preparation events and zero `file_versions` calls** while Edit was active. The preceding capture had eleven refreshes and 33 file-version calls. Counts include background refreshes, so these are not identical-duration throughput runs; they directly establish that hidden refreshes no longer trigger comparison work. Repository refresh medians were similar (39ms after versus 38ms before), and no claim is made that pausing prefetch accelerates that independent operation. No samples were discarded.

A separate capture alternated Git and Edit ten times each with accessibility observation after each click. The twenty tab-switch samples measured **31ms median / 33ms p95 / 33ms maximum**; the first return to Git was 25ms. Prefetch resumed while Git was visible, recording 29 cache hits, three misses, two large-prefetch skips and 18 previously-deferred hits across the sequence. Existing mounted content and caches were retained. This is a current-build responsiveness result, not a before/after tab-speed improvement claim. It does not include immediate selection of an uncached large comparison.

Both captures were stopped and exported (`githeaven-hidden-git-refresh.json` and `githeaven-hidden-git-tabs.json` in the system temporary directory). The fixture tab was closed without edits and the primary repository restored.

## Editor opening CPU stages

```sh
pnpm perf:editor-open /tmp/editor-open.json
```

This benchmark uses Pierre's public `TextDocument`, `getSharedHighlighter`, and `renderFileWithHighlighter` APIs against the editor fixture's same three source shapes. It measures document construction plus line-count/end-position access, Shiki tokenization, and the full syntax-tree render used for editable files (`useTokenTransformer: true`). Each stage records a first call, three warmups, 20 measured calls and an output hash. Hash generation is outside the timed section. Highlighter initialization is recorded separately (31.44ms in this run). Node/platform/architecture accompany the results.

Same-machine CPU medians:

|  Lines | Document preparation | Tokenization | Full editor syntax tree |
| -----: | -------------------: | -----------: | ----------------------: |
|  1,000 |               0.03ms |      31.33ms |                 36.39ms |
| 10,000 |               0.11ms |     358.94ms |                389.25ms |
| 30,000 |               0.40ms |   1,028.42ms |              1,095.60ms |

The syntax-tree stage includes tokenization; do not add those columns. Allocation/GC and warmup variation mean the difference between separately measured stages is not an exact estimate of tree-construction overhead. At 30,000 lines their p95 values were 0.47ms, 1,485.42ms and 1,180.31ms respectively. These measurements exclude React, DOM construction, worker IPC, viewport painting, and editor attachment. They identify a candidate CPU bottleneck, not an attribution of all 899ms in the earlier native opening sample.

Inspection of the installed Pierre 1.4.0 implementation shows its colored `renderFileWithHighlighter` path resets the requested range to the whole file. `FileRenderer` obtains that full result before projecting visible rows, and the editor also has its own viewport/incremental tokenizer. Document indexing is therefore not the current optimization target. Avoiding the initial full-file colored render merits a native experiment, but any approach must preserve syntax highlighting at first presentation, editing, undo, scrolling and language-state continuity. No production renderer behavior was changed in this measurement pass. Raw local artifact: `/tmp/githeaven-editor-open-stages.json`.

### Rejected tokenizer-limit experiment

A native experiment set the Edit surface's public `tokenizeMaxLength` option to zero, attempting to bypass FileRenderer's full-file colored AST and rely on the editor's own tokenizer. The unchanged 30,000-line fixture recorded one 47ms file-open sample, versus the earlier normal-renderer sample of 899ms. This is a single-sample diagnostic comparison, not a latency distribution.

It failed the feature check: the viewport rendered as plain text, and a second screenshot after exporting the trace still showed unhighlighted TypeScript. The editable textarea existed, but the editor did not automatically replace the plain initial rows with colored rows. This option therefore disables required presentation rather than solving the startup pipeline. The change was reverted without being committed, and the normal native renderer rebuilt. No fixture contents were edited. Local trace: `githeaven-editor-plain-experiment.json` in the system temporary directory.

The experiment reinforces the cost attribution but is not a shipped speedup. Further work must integrate viewport highlighting with the editable initial render, including token metadata and language state, rather than lowering the global tokenization limit.

### Viewport highlighting for editable files

The pinned Pierre 1.4.0 patch in `patches/` adds an opt-in editor viewport-tokenization entry point. Edit uses the plain initial AST only when its language and theme are already loaded, then applies the editor tokenizer's colored tokens and editable character metadata to visible rows during attachment. Cold grammars retain the existing full renderer. Diff rendering is unchanged. The patch must be reviewed when upgrading Pierre; it reaches internal tokenizer and renderer APIs.

Viewport tokenization builds the grammar state leading into the visible range and retains checkpoints. Pending edit jobs invalidate checkpoints beyond their cursor before a distant viewport can use them. Four tests compare per-character colors against full-file Shiki output for initial/overlapping/distant ranges, multiline comments/templates, replacements, insertions and deletions with background work held pending. The unchanged viewport operation also leaves document version and undo state untouched.

Native verification on the unchanged editor fixture showed colored TypeScript immediately after opening 30,000 lines and at the final lines after a jump. A single pasted comment in the 1,000-line file was undone back to the saved state. A separate typing sequence in the large file required discarding its remaining draft; a single undo does not imply an entire multi-event typing sequence is undone. All three disk hashes still match the fixture manifest.

The focused native trace recorded 10,000 / 30,000 / 1,000-line openings at **24 / 30 / 18ms**, respectively. These were revisits with the grammar warm. Three first-completion-frame checks found colored editable token spans, with no uncolored events and no discarded samples. The earlier mixed interaction run recorded an initial 30,000-line opening of 86ms in the notebook; its raw sample was evicted by continuous frame capture, so the focused trace is the retained raw evidence. Earlier normal-renderer native samples were 352ms at 10,000 lines and 899ms at 30,000 lines. These small samples establish an encouraging reduction, not p95 guarantees or an equivalent cold-start benchmark. The first-frame check tests colored DOM tokens at the completion frame, not compositor pixels or every intervening frame.

Local artifacts: `githeaven-editor-viewport-native.json` and `githeaven-editor-viewport-openings.json` in the system temporary directory. Capture was stopped, the fixture closed and the primary repository restored.

Native checking also exposed duplicate completion of retained editor timing callbacks: the trace suppressed duplicate samples but the notebook accepted a newly inflated duration. Foreground timing now returns null after its first completion, with a regression assertion covering a much later second call.

Remaining: cold grammar/startup measurements; repeatable native opening distributions; long-line and non-TypeScript coverage; distant-jump latency while prefix checkpoints are still cold; large-file scroll behavior and memory. Viewport coloring does not remove plain full-file AST allocation or the existing approximately 800ms scattered-change marker computation. A native end-to-start jump traversed intermediate viewports slowly and needs separate attribution before claiming large-file navigation is instant.

### Editor navigation CPU benchmark

```sh
pnpm perf:editor-navigation /tmp/editor-navigation.json
```

This runs the pinned editor tokenizer directly with a 60-line viewport. Each of three warmups and twenty measured iterations constructs a fresh document/tokenizer and visits the start, the previously unseen end, the same end again, and the start again. The TypeScript grammar is warm; no background prebuild runs. Fixtures include multiline comments across viewports. Every viewport's per-character colors are checked against full-file Shiki output outside the clock, and output hashes are retained. Document construction, DOM, native scrolling, IPC and marker workers are excluded. Node/platform/architecture and highlighter initialization accompany raw samples.

Same-machine CPU results:

|  Lines | Initial viewport median | Unseen end median / p95 | Cached end median | Return to start median |
| -----: | ----------------------: | ----------------------: | ----------------: | ---------------------: |
|  1,000 |                  1.79ms |         28.76 / 46.73ms |            1.92ms |                 1.78ms |
| 10,000 |                  1.72ms |       295.65 / 369.12ms |            1.89ms |                 1.75ms |
| 30,000 |                  1.72ms |   1,030.59 / 1,589.55ms |            1.92ms |                 1.75ms |

All 276 viewport checks matched full-file highlighting (23 iterations × four viewports × three sizes). The initial viewport cost remains bounded in this workload, but the first distant jump synchronously builds preceding grammar state. The viewport opening optimization defers that work; it does not eliminate it. Background checkpoint preparation or worker-backed state computation needs evaluation with input responsiveness, total CPU and memory considered together.

The earlier slow native return from the end cannot be attributed solely to tokenizer CPU: this benchmark's return to the start stays below 2ms median even at 30,000 lines. Inspection shows editor document-boundary commands use caret `scrollIntoView`, while CodeView maintains its own virtualized/paged scroll model. Native navigation-to-settled-viewport measurement is needed to distinguish caret/scroll coordination from rendering cost before changing behavior. Local raw artifact: `/tmp/githeaven-editor-navigation.json`.

### Native document-boundary navigation

`ui.editor-jump.start` and `ui.editor-jump.end` now measure an Edit document-boundary command until its destination row intersects the viewer and has unchanged vertical bounds on two consecutive animation frames. The probe runs only during the command, cancels on focus loss, a later key, pointer/wheel input, document replacement or unmount, and records an error after 15 seconds without a destination. It includes virtualized rendering and scrolling through the destination check; it is not a compositor-presentation guarantee or a full visible-content correctness test. Names contain no paths or source text.

Six probe tests cover intermediate/moving/offscreen rows, cancellation, detach and timeout. A Surface integration test uses a contenteditable target, matching Pierre's actual editor, and covers both boundary commands. The first native instrumentation attempt incorrectly filtered for textarea targets and recorded no jumps; that attempt is not performance evidence.

With the corrected probe, returning from the end of the 30,000-line fixture timed out at **15,031ms**, while the UI continued traversing intermediate lines. Appending a CodeView scroll request after Pierre's default caret command did not resolve the behavior. The accepted change handles the two non-selection document-boundary commands together: focus Pierre's caret at the exact document position with native scrolling disabled, then navigate through CodeView's virtual line layout with instant behavior. Command resolution uses Pierre's platform keymap. Ordinary arrows and selection-extension commands keep their existing behavior.

Native verification of the accepted change recorded six return-to-start samples of **50–78ms** (58ms median), with the first row and caret visible immediately in the screenshot. Five repeated cached end jumps measured **51–89ms** (64ms median). The first end jump still cost **887ms**, consistent with the previously identified cold grammar-state prefix work; this fix does not eliminate that cost. An additional end jump after an edit/undo measured 87ms. The small samples are not p95 estimates. No trace samples were discarded.

Pasted test comments landed at the first and final document positions and each undo returned to the saved state. All three fixture disk hashes match the original manifest; the fixture tab was closed and the primary repository restored. Native artifacts in the system temporary directory: `githeaven-jump-baseline.json` and `githeaven-jump-after.json`. Native Linux/Windows verification, selection-extension performance and cold-prefix responsiveness remain outstanding.

### CPU attribution for cold navigation

```sh
node --cpu-prof --cpu-prof-dir=/tmp --cpu-prof-name=githeaven-navigation.cpuprofile scripts/benchmark-editor-navigation.mjs /tmp/navigation-profiled.json
pnpm perf:cpu /tmp/githeaven-navigation.cpuprofile buildStateStack
```

`perf:cpu` reads a sampled V8 CPU profile and weights leaf samples by their microsecond time deltas. An optional function-name substring retains only stacks containing that function; matching nested ancestors do not double-count a sample. Output includes total/selected sampled time, selected sample count and sorted self time per function/source/line. It rejects invalid nodes, call trees, sample references and time-delta arrays. Tests cover weighted attribution, overlapping matching ancestors, unmatched filters and malformed input. Profiles include local source locations and should remain outside commits.

The navigation benchmark profile contained 30.86 seconds of sampled time, of which **27.38 seconds (88.7%)** lay inside `buildStateStack` stacks. Within those stacks, **78.4%** was sampled in WebAssembly functions and **9.9%** in the Oniguruma JavaScript wrapper, including **5.8%** in its memcpy helper. The three hottest WASM frames alone accounted for 72.8%. This identifies grammar regex execution and its boundary overhead as the dominant CPU work, rather than visible-row token arrays or React. The profiled 30,000-line cold-end median was 932.74ms; profiling overhead and run variation make it unsuitable as a before/after speedup claim. All viewport output comparisons still matched.

This attribution is scoped to the synthetic Node workload, not total native app CPU. Filtered GC samples can lose the operation's stack, so their absence does not establish zero allocation cost. WASM frames are unsymbolized; the profile does not identify a particular grammar expression for safe removal. The next architectural candidate is yielding/background or worker-backed state preparation with stale-document cancellation and retained highlighting, evaluated against native input responsiveness, total work and memory together. Changing themes, disabling bracket metadata or optimizing React alone cannot be credited with removing the measured regex work.

Local artifacts: `/tmp/githeaven-navigation.cpuprofile`, `/tmp/githeaven-navigation-profiled.json`, and `/tmp/githeaven-navigation-cpu.json`. No renderer behavior changed in this profiling pass.

### Yielding cold-jump preparation

The pinned editor patch now exposes cancellable prefix-state preparation in approximately 4ms slices, yielding through MessageChannel tasks between slices. The budget is checked between grammar lines, so it is a soft budget: a pathological individual grammar match can still exceed it. No worker or extra full-file source cache is introduced. Preparation retains checkpoints for the existing tokenizer and stops on abort, document-version change, theme change or cleanup.

For the two document-boundary commands, Edit keeps its current highlighted viewport and caret while preparing the destination. It then moves the caret and virtual viewport together. Later keys, pointer/wheel input, focus loss, timeout, replacement or unmount cancel pending work; stale completion cannot trigger a later jump. Completed preparation is recorded as `editor.jump-prepare`; cancelled requests are counted by the existing navigation probe. Other scrolling paths still use synchronous viewport preparation.

```sh
pnpm perf:editor-navigation /tmp/navigation-sync.json
pnpm perf:editor-navigation /tmp/navigation-yield.json --yield
```

The benchmark now records each operation's longest observed event-loop task gap using a 1ms timer. The yielding mode prepares state before requesting the same visible tokens. Twenty measured iterations per size, after three warmups, produced these cold-end results:

|  Lines | Synchronous elapsed median | Yielding elapsed median | Synchronous longest-gap median | Yielding longest-gap median / p95 |
| -----: | -------------------------: | ----------------------: | -----------------------------: | --------------------------------: |
|  1,000 |                    31.41ms |                 29.29ms |                        31.41ms |                     4.62 / 6.15ms |
| 10,000 |                   296.36ms |                300.06ms |                       296.36ms |                    4.59 / 15.70ms |
| 30,000 |                   934.31ms |                898.13ms |                       934.32ms |                    4.75 / 25.05ms |

The largest yielding task gap at 30,000 lines was 48.03ms. Total elapsed time remains approximately the same; this is a responsiveness improvement, not elimination of tokenization work. All twelve output hashes match between modes, with full-file highlighting comparisons inside each run. Four additional tokenizer tests force yields and verify completion, abort, editing and cleanup without changing colors or undo state. A Surface regression test verifies that typing cancels a pending jump before it moves the caret.

Native verification on the 30,000-line fixture recorded an uninterrupted preparation of **861ms**, an end jump reaching its destination in **934ms**, and a **23ms** input-to-paint-opportunity sample for that command. No recorded frame gap over 50ms intersected that preparation interval. Subsequent cached start/end jumps were 79/54ms. During a separate pending cold jump, typing `x` after approximately 151ms cancelled the jump and inserted at the original first-line cursor; the typing sample was 27ms and undo restored saved contents. The trace recorded two cancelled navigation requests, including an immediately superseded start command.

The full capture also contains seventeen frame gaps above 50ms, up to 304ms, outside the uninterrupted preparation interval, including edit/undo, file switching and accessibility-observation periods. This change does not establish that the editor is stall-free overall. All fixture disk hashes remain unchanged, capture is off, and the primary workspace was restored. Local artifacts: `/tmp/githeaven-navigation-sync.json`, `/tmp/githeaven-navigation-yield.json`, and `githeaven-yield-native.json` in the system temporary directory.

## Native startup milestones

Release trace exports now include `gauges.startup`, with fixed numeric `native_entry_to_*_ms` values. A Rust monotonic clock starts at the beginning of `main`; milestones record native setup, receipt of the frontend initialization signal, repository discovery, snapshot completion, watcher setup, and receipt of the rendered repository or welcome signal. Each milestone is retained once per process. The first repository/welcome outcome wins, so opening a folder long after the welcome screen or switching repositories does not overwrite startup.

The rendered signal is emitted after the actual workspace Suspense boundary mounts and two animation-frame opportunities occur. Measuring only repository state would finish before the lazy workspace bundle renders. `ready_in_foreground` records the page's focus/visibility state at that checkpoint. The elapsed native values remain separate from frontend span timestamps; subtracting clocks with different origins would create invalid trace spans. They intentionally survive Reset samples as process-lifetime metadata. No paths, repo identities, source text or network telemetry are added.

To collect a baseline, build the release app, quit it, launch it with the desired saved project state, and export the trace after the workspace appears. Repeat as separate processes under the same workload and report focus state. Operating-system caches are not flushed. The native clock excludes executable loading before `main`, and receipt of a frontend milestone includes outgoing IPC scheduling. Two frame opportunities do not prove physical presentation or all controls' readiness; this instrumentation is a startup-stage baseline, not a complete launch-to-interactive gate.

A macOS arm64 release restart with the primary repository and two saved project tabs recorded:

| Milestone                               | Milliseconds since native entry |
| --------------------------------------- | ------------------------------: |
| Native setup                            |                          239.08 |
| Frontend initialization received        |                          452.49 |
| Repository discovered                   |                          481.16 |
| Snapshot complete                       |                          590.14 |
| Watcher setup complete                  |                          622.83 |
| Rendered repository checkpoint received |                          810.92 |

The frontend's `open_repository` invocation was 163ms. The page reported `ready_in_foreground: false`, so this run is **not** a verified foreground launch-to-interactive sample. It is one fresh-process observation with warm OS caches and a live primary repository (79 working changes); no percentile or improvement claim is warranted. Stage attribution suggests further investigation of work before frontend initialization and between native repository completion and the rendered checkpoint. Foreground window activation, repeated controlled launch distributions and per-stage optimization remain outstanding. Raw local artifact: `githeaven-startup-1.json` in the system temporary directory.

A Rust test verifies monotonic capture, immutable first milestones, the first-ready outcome rule and numeric serialization. A frontend test verifies that an unmounted/unfinished rendering probe cannot signal readiness, two frames are required, and duplicate or alternate later outcomes are ignored. Full validation and a native release build pass.

### Overlap workspace module loading with repository open

The shared lazy workspace import now records a single `bundle.surface` span and is started immediately after an uncached `open_repository` invocation. Its module promise is shared by the provider, editor and diff components. Cached repository switches keep their synchronous path; welcome-only startup still does not load the workspace module. A deferred-repository test verifies that module loading completes while the repository request is outstanding and the loading screen remains visible.

Native release traces on the same Mac with the primary repository and two saved tabs showed:

| Frontend-clock operation | Before           | After            |
| ------------------------ | ---------------- | ---------------- |
| Repository invocation    | 82–227ms (145ms) | 86–248ms (162ms) |
| Workspace module import  | 241–292ms (51ms) | 87–135ms (48ms)  |

The module load now fits entirely inside the native request instead of following it. Native watcher-completion-to-rendered-checkpoint time decreased from 176.62ms to 137.44ms. Total native-entry-to-rendered-checkpoint time was essentially unchanged in this pair, **739.27ms before / 739.76ms after**, because earlier setup and repository stages varied. Both checkpoints reported `ready_in_foreground: false`; this remains rendering-stage evidence, not a verified foreground launch-to-interactive speedup. The live repository had 79 working changes at launch and continued changing afterward. Repeated controlled process-launch distributions remain necessary.

The cached-switch test caught an experimental extra await on the cached path; that await was removed before the final build. An existing save/reopen test also exposed premature test readiness: a renamed mock-editor label could precede its content synchronization, and a disabled Save button could mean the save was still in progress. The helper now waits for initial contents, and the save/reopen test waits for the explicit saved result before switching views. This tightens the tested sequence without adding timing thresholds or changing editor behavior. Other previously observed test flakes are not declared resolved.

Full validation passes (122 frontend tests, 16 Rust tests), and the release app restores its graph, branches and composer. Local artifacts: `githeaven-module-before.json` and `githeaven-module-after.json` in the system temporary directory. The performance notebook was closed and the primary workspace left open.

### Startup stages in exported trace analysis

`pnpm perf:trace trace.json [after.json]` now prints native startup milestones and the interval from each preceding observed milestone, alongside each run's foreground-ready status. These process-lifetime measurements remain separate from reset-window frontend spans and their distributions. Missing milestones are omitted, never filled with zero; the `since` column identifies the actual interval boundary. Absent foreground metadata is reported as unknown. Numeric timing and boolean foreground metadata are validated rather than coerced. Older traces without startup gauges remain supported.

Running this analyzer on the native module-overlap before/after exports reproduces the 176.615ms / 137.438ms watcher-to-render intervals and explicitly displays `false` foreground status for both. The output cautions that rendering readiness does not prove interactivity, native entry excludes OS launch before `main`, and repeated exports of one process are not independent startup samples. Tests cover partial milestone sets, missing startup metadata, foreground false/unknown, malformed inputs, and separation from frontend timing distributions.

### Stage/unstage completion attribution

Staging now exports `git.stage.file.*`, `git.stage.all.*`, `git.unstage.file.*`, and `git.unstage.all.*` spans. Each operation records `queue` (accepted intention to start of its Git write), `write` (native invocation), `reconcile` (following status refresh and scheduling its state update), and `total` (acceptance through reconciliation and queue removal). Total includes the other phases; do not add them. These are wall-clock completion measurements, not foreground optimistic-paint latency. The existing `ipc.*` spans overlap their corresponding write/refresh phases.

A failed write records an error even when reconciliation succeeds. A successful write followed by a failed refresh keeps the successful write sample but marks reconciliation and total as errors; it does not imply Git rolled the write back. Measurements contain operation categories only, with no paths or repository identities. Deferred-command tests verify that an immediate reversal remains queued through the first operation's reconciliation, total is not recorded at write completion, and each phase records once. Failure-path tests distinguish a rejected write from a rejected refresh. Each tested scenario resets its measurement window to avoid inspecting prior test samples.

Inspection confirms that each queued intention currently performs a separate status refresh before the next write. Native fixture traces are still needed to establish the latency distribution and whether this reconciliation policy warrants optimization. No staging speedup or optimistic-paint latency claim is made from jsdom tests.

### Remove the extra HEAD probe from unstaging

Native macOS arm64 release measurements on a newly generated 32-file fixture (`githeaven-performance-ZTefMN`) showed bulk unstaging spending a median 46ms in the write invocation versus 25ms for staging. Inspection found an extra `rev-parse --verify HEAD` subprocess on every unstage, used to choose between reset and removing cached files. Using `git reset -q -- <paths>` without an explicit revision handles both HEAD and an unborn branch in one command. Single-file and bulk unstaging now use that form; staging and reconciliation are unchanged. A disposable unborn-repository probe and Rust tests verify the behavior with Apple Git 2.50.1.

Two fresh release processes on the same Mac ran 20 alternating stage-all/unstage-all pairs each against the same fixture, with warm OS caches and no concurrent build during capture. The measurement window was reset before each sequence. UI automation read controls between operations, so these are serialized interactions with essentially zero queue wait, not a rapid reversal burst. No file was selected in the diff viewer.

| Operation / phase | Before median / p95 ms | After median / p95 ms |
| ----------------- | ---------------------- | --------------------- |
| Stage write       | 25 / 46                | 24 / 31               |
| Stage total       | 44 / 64                | 43 / 52               |
| Unstage write     | 46 / 60                | 30 / 37               |
| Unstage reconcile | 22 / 27                | 22 / 27               |
| Unstage total     | 68 / 85                | 53 / 83               |

Unstage median completion improved by about 22%; the total p95 barely changed. The unchanged staging command also varied between runs, and the optimized unstage maximum was higher (106ms versus 94ms), so this is a small controlled scenario, not a general tail-latency guarantee. All measured staging phases succeeded. Each trace contained 82 `refresh_repository` calls for 40 intentions, including watcher-driven refreshes beyond the 40 explicit reconciliations. Determining which additional refreshes can safely be avoided remains open. Optimistic paint latency, rapid queued reversals, single-file native performance, large repositories, and cross-platform behavior remain unverified by this capture.

Full validation passed (124 frontend tests and the existing 16 Rust tests); an additional Rust preservation test subsequently passed with all 17 Rust tests. It verifies single-file unstaging on an unborn branch preserves newer working contents and another file's staged contents, then bulk unstaging leaves both files intact. The final fixture retained all 32 original working-file hashes, an empty index diff, and its single original commit. The fixture tab and notebook were closed and the primary repository restored. Raw local artifacts in the system temporary directory: `githeaven-stage-bulk-baseline.json`, `githeaven-stage-bulk-after.json`.

### Use working-only watcher refreshes for index updates

The watcher previously classified every path inside the Git directories as requiring history. Index-only events now still emit a repository-change event, but request a working snapshot rather than rereading refs/history. All other Git metadata remains conservative; a batch containing any history-relevant event still requests history. This is not event suppression or a debounce change. Tests cover the regular Git directory and linked-worktree layout, including HEAD, refs, packed refs, objects, directories, and mixed index/ref batches.

General refresh invocations now export `git.refresh.history` or `git.refresh.working` so future traces can distinguish their cost. These spans cover the native invocation after refresh queue admission and overlap `ipc.refresh_repository`; explicit staging reconciliations retain their existing separate labels.

In a macOS arm64 release run using the same 32-file fixture, ten alternating bulk stage/unstage pairs produced ten working refreshes, each following an unstage, with **21ms median / 22ms maximum**. Ten staging events still caused full history refreshes, plus one other full refresh in the capture; full refreshes measured **31ms median / 32ms maximum**. The prior implementation necessarily treated index metadata as history, but lacked these distinct trace labels. No percentile is claimed for these groups below 20 samples. Total unstage completion remained about 52ms median, consistent with 53ms in the preceding build: this change reduces subsequent background work, not the synchronous operation's completion time. Staging's remaining metadata events need further attribution before making broader exclusions.

Creating and deleting a temporary branch through Git in the disposable fixture automatically added and removed it in the native branch sidebar. Full validation passed (124 frontend / 18 Rust tests), the release build passed, all fixture file hashes and its empty index diff were preserved, and only its original main branch remained. The fixture tab was closed and the primary workspace restored. Raw local artifact: `githeaven-index-watch.json` in the system temporary directory, exported before the separate external-branch verification.

### Watcher batch category counters

Watcher notifications now carry a deduplicated set of fixed categories: `worktree`, `index`, `head`, `refs`, `objects`, and `metadata`. The active repository's frontend listener records `watch.batch.history` / `watch.batch.working` and `watch.category.*` counters. Category counts mean **batches containing that category**, not raw filesystem events or paths; a mixed batch contributes to multiple categories. Existing access-event, lock-file, and build-directory exclusions run before classification. Inactive repository notifications do not contribute. Only whitelisted category labels enter performance exports, and resetting measurements clears these counters. No file paths or object/ref names are added to exports.

The classification is shared with the existing history decision, preserving index-only working refreshes and conservative handling of all other metadata. Rust tests cover fixed categories in linked-worktree and common-directory paths, as well as deduplication/serialization. Frontend tests verify mixed batches, duplicate labels, omitted categories for compatibility, reset behavior, and rejection of unknown labels from exported counters. Native category capture is still needed to explain why staging continues to request history after the index-only optimization.

Validation exposed an unrelated exact floating-point assertion in the editor-navigation test: an 80ms simulated duration sometimes subtracts to 80.00000000000011ms. Its duration check now uses a tight numeric tolerance; frame progression, measurement count, name and outcome assertions remain intact.

### Native attribution of staging's remaining history refreshes

A fresh macOS arm64 release process ran five alternating bulk stage/unstage pairs on the unchanged 32-file fixture. After resetting the measurement window, the native export reported five `watch.batch.history`, five `watch.batch.working`, ten `watch.category.index`, and five `watch.category.objects`. No HEAD/ref/other-metadata category was recorded. All five stage operations were followed by history refreshes; all five unstages by working refreshes. Thus the remaining staging-triggered history work is attributable to object-store notifications, not a failure of index classification. The capture also had one general history refresh beyond the watcher count; watcher counters intentionally exclude focus/periodic triggers.

This evidence does not identify whether each object notification represented creation, a timestamp change, or another filesystem event. Object events remain history-relevant pending a correctness-preserving distinction: a blanket exclusion would also affect external object fetch/maintenance activity. No additional refresh suppression or latency improvement is claimed. The small capture is attribution evidence, not a percentile distribution. Fixture file hashes and its empty index diff remained unchanged, and the fixture tab/notebook were closed before restoring the primary workspace. Raw local artifact: `githeaven-watch-categories.json` in the system temporary directory.

`pnpm perf:trace` now prints these fixed watcher counters for each supplied trace, with an explicit explanation of overlapping categories, reset windows and excluded non-watcher triggers. Missing counters remain absent rather than being reported as zero; malformed numeric counts are rejected. Tests cover those rules and prevent unknown payload-derived labels from entering the displayed table. The analyzer was run against the native artifact and reproduced the counts above. Full validation passes with 126 frontend and 19 Rust tests.

### Bound watcher backlog by coalescing before queueing

The native watcher previously retained every raw `notify::Event` (including its paths) in an unbounded channel and copied the accumulated events into a vector after each 120ms debounce interval. It now classifies each callback immediately and merges its fixed categories into one pending set, with a nonblocking, capacity-one wake-up channel. The consumer takes that set after the same debounce interval. A full wake-up channel means a wake-up already exists; the categories remain merged rather than being discarded. No overflow-based event suppression is needed, and mixed categories still request history conservatively.

A deterministic 100,000-notification test retains exactly one wake-up and the six possible category labels, rather than one queued event per notification. Other tests exercise arrivals during debounce, arrivals after a drain while the wake-up channel is full, ignored access/lock/build events, mixed index/ref/worktree events, and sender disconnect. This establishes a bound on application-owned pending notification state; it does not bound memory inside the OS/notify backend, the transient current callback's path list, or total process footprint. Classification now runs in the notify callback, so native callback CPU and sustained-burst responsiveness still need measurement.

Root subscription still begins before Git-directory resolution; relevant events during that short initialization interval conservatively request history. Normal classification starts once the directories are resolved. Empty redundant wake-ups do not emit refresh events. Full validation passes with 126 frontend and 22 Rust tests. Native release burst verification remains outstanding; no RSS or latency improvement is claimed from the deterministic queue test alone.

### Native burst verification of bounded watcher batching

A macOS arm64 release build with the bounded watcher opened `src/file-01.ts` in the 32-file fixture's diff viewer. `pnpm perf:pulse <fixture> 100 50` applied 100 updates at 50ms intervals and restored the original contents. The performance capture then included a separate late update with a short visible marker and its restoration. The native screenshot showed that late marker in the highlighted diff, confirming delivery after the burst/drain. Final checks verified all 32 original working-file hashes and an empty index diff.

The exported window contains 44 worktree-category / working-refresh batches: 42 refreshes in the approximately 5.1-second pulse-response interval, followed by the two separate late changes. Working refreshes measured 22ms median, 37ms p95, and 62ms maximum across all 44. There were also three general history refreshes outside the watcher category counts. No completed measurements were discarded. Of 5,152 observed frames in the broader 86.8-second window, three gaps exceeded 50ms (52, 62, and 81ms), all outside the observed first-to-last pulse refresh interval. This is not a physical presentation or before/after latency claim, and the window includes UI automation and inspection outside the pulse.

One resource snapshot around the end of the pulse reported complete process attribution, 604.9 MiB combined physical footprint and 25.7 MiB for the Rust app. There is no matched pre-change burst resource baseline, so this does not establish a process-memory reduction. The bound on application-owned pending notifications remains established by the 100,000-notification test; native verification here establishes continuing update delivery under the tested pulse.

The capture also identifies remaining live-diff work: 41 preparations were superseded (38 during highlighting, three queued), and 62 highlight spans measured 178ms median / 223ms p95 across the window. Parsing was about 5ms median. Those overlapping samples include background work and should not be added to infer UI latency. Avoiding obsolete highlighting during sustained updates is a next optimization target. The release build passed; capture was stopped, the notebook and fixture tab closed, and the primary workspace restored. Artifacts: `githeaven-coalesced-watch.json` in the system temporary directory, `/tmp/githeaven-coalesced-resources.json`, and `/tmp/githeaven-coalesced-pulse.log`.

### Finish visible live-diff work and coalesce waiting refreshes

The live diff previously invalidated its active effect on every repository refresh. When highlighting took longer than the refresh interval, each new request superseded the preceding highlight and the renderer could not publish its completed result. The visible comparison now has one preparation in flight and remembers the newest requested refresh. It publishes each fully prepared result, then reads the newest waiting revision, skipping intervening requests. It retains the existing viewer instance and scroll for same-comparison updates. A different file/comparison, hidden/deferred view, or unmount still deactivates that owner, so obsolete results cannot replace the new view.

Background prefetch requests for a newer revision now share an already-running foreground preparation rather than superseding it; the foreground owner remains responsible for reading the newest revision. The export counter `diff.prepare.foreground-protected` identifies this case. This does not mark the older cache entry as current for the newer revision, and a later explicit preparation still reads fresh inputs.

A deferred-highlight integration test submits refreshes 1 through 20 while the first update is unfinished. It observes only the initial read and active update before releasing highlighting, then exactly one read for the latest request: three preparations total. The already-highlighted intermediate update is published and then replaced by the latest result in the same viewer. A separate test verifies switching files starts immediately while the old file's parse is unfinished, and that late completion cannot replace the newly selected file. Cache tests verify foreground protection and a subsequent fresh read. Existing scroll preservation, unchanged-content, transient-error, deferred staging, and syntax-readiness tests remain green. Full validation passes; native burst comparison remains necessary before claiming reduced CPU, supersession counts, or improved display latency.
