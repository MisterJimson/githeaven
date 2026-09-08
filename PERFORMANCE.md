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
