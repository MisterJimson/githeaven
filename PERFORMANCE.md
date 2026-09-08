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
