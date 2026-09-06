# Githeaven

A local Git workspace prototype: **Tauri 2 + Rust + React**, with **Pierre Trees** as the file explorer and **Pierre Diffs / CodeView** for virtualized diffs and editing. No Node server or Electron runtime is shipped. Fonts and code-highlighting assets are bundled for offline use.

## Run

Requirements: Node.js 22.13+ (or a supported newer Node release), pnpm 12 (pinned in `packageManager`), Rust, Git, and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
pnpm install --frozen-lockfile
pnpm tauri dev
```

Choose a local Git repository once; the app automatically reopens the last successfully opened folder on subsequent launches. If that folder is unavailable, it returns to folder selection. Opening and browsing a repository does not check out branches or change its files. Remote branches are the locally fetched remote-tracking refs; the prototype does not fetch from a server.

For a disposable example with branches, merges, tags, a staged file, and working changes:

```sh
pnpm demo
```

Open the `.demo` directory printed by that command. The script leaves an existing demo untouched. It does not contact a remote. All Git identity configuration is confined to that sample repository.

`pnpm stress` creates a separate `.stress` repository with 6,000 commits and 10,001 files for exercising pagination, tree search, and rendering. It also leaves any existing fixture untouched. These are synthetic workloads, not representative performance claims.

`pnpm dev` alone opens the browser preview. Filesystem/Git access requires the Tauri desktop app; the browser preview intentionally does not expose a local HTTP API.

## Included

- Compact project tabs with a folder picker; open projects and the last active project are remembered.
- Cmd/Ctrl+K command and destination palette; Cmd/Ctrl+P fuzzy file navigation.
- Virtualized, topologically ordered history graph, with independently interactive local/remote branch badges.
- Branch ancestry filtering, loaded-history search, and automatic history loading near the end of the viewport (500 at a time).
- Commit messages, changed files, first-parent comparisons, and a merge-parent selector.
- Path/Tree views for staged and unstaged files, with search shown only above 20 files per section.
- Pierre file trees with search and status decorations.
- Split/unified diffs, with diff computation in a separate worker and a two-worker syntax-highlighting pool.
- Pierre's editable CodeView, explicit save, Cmd/Ctrl+S, undo, and find/replace.
- Focused file/diff font sizing with Cmd/Ctrl+plus/minus.
- Unsaved-edit navigation/close protection and external-change detection.
- File-level and bulk staging/unstaging, plus local commits with summary and description, using installed Git and its normal hooks/signing behavior.
- A unified Git workspace: branches on the left, WIP and commit graph in the center, contextual staging/composer or commit details on the right. Select a file for a diff; Graph returns to the retained history.
- Searchable, collapsible branch groups. Click a branch to browse its loaded ancestry; double-click to check out a local branch or create a tracking branch from a remote ref. Existing local branches and conflicting working changes are never force-overwritten.
- Checkout prompts to stash or cancel when working changes exist; confirmed stashes include untracked files and remain saved after switching.
- Filesystem watching, coalesced refreshes, refresh-on-focus, and a 30-second reconciliation fallback.
- Live diffs update in place, preserving Pierre's line/viewport scroll anchor. Unchanged snapshots skip parsing and rendering; transient refresh errors retain the last diff with a visible notice.
- Optional Git refresh and request-to-first-diff-render measurements.
- Retained Edit and Git views, plus independent working and commit diffs: switching views preserves trees, scroll containers, editor contents, and commit drafts.

## Performance and boundaries

This is a functional prototype, not a production Git client or a demonstrated replacement for GitKraken on large repositories.

The performance panel records the last 50 diff samples. Its timer starts at the backend request (after a short selection debounce), includes Git reads and diff parsing, and ends after Pierre's first render and the next animation-frame callback. Syntax highlighting can finish afterward. It does not measure physical display presentation or cold application startup.

The panel also records the last 50 tab switches, from the navigation action to a second animation-frame callback (a paint opportunity). Measurements beginning in the background or interrupted by focus/visibility changes are discarded because WebKit can suspend animation frames there. Tab views share one two-worker highlighter pool. One editor and up to two selected diff views remain mounted, so switches avoid reconstruction at the cost of retaining this bounded view state. This timer does not measure physical display latency.

Measure the release build for meaningful comparisons. Include the app and its WebKit/WebView helper processes in memory totals. Do not compare a Rust parent process alone with an Electron process tree.

- Text previews and editing are capped at 2 MB per file. Binary, non-UTF-8, and symlink editing are deliberately unavailable.
- File explorer discovery currently lists all tracked/unignored untracked paths. Refreshes still run whole-repository Git status; lazy path discovery and incremental status are follow-up optimizations.
- Commits are loaded in bounded batches; loading another batch currently repeats the history query up to the new limit. Search and branch filters cover only loaded history.
- Newer selections ignore stale read results and terminate obsolete diff workers. An already-running Git subprocess is not forcibly cancelled.
- File saves check original contents before replacement and preserve permissions. This is not a cross-process filesystem transaction: an external writer can still race a save. Always keep important work backed up.
- One editor document is active at a time. Undo history is scoped to the current editor session; this is not a full IDE/tab system.
- Watch events from common generated directories (`node_modules`, `target`, `dist`, `.next`) are ignored to reduce noise. Periodic reconciliation catches tracked changes there.
- Hunk/line staging, push/fetch, merge/rebase actions, recovery UI, submodule navigation, and Git LFS content handling are outside this prototype. Whole-file staging and local commits are real operations.
- Commit hooks run as configured and may take time. There is not yet a credential/signing prompt or hook-output console; errors are shown in the app.
- Tested on macOS in this workspace. Windows and Linux use supported Tauri components but still need platform testing, including IME, file replacement semantics, and packaging.

## Validate and package

```sh
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri build --bundles app  # macOS .app
```

The macOS app is written to `src-tauri/target/release/bundle/macos/Githeaven.app`. It is a local build, not a notarized release. Use Tauri's platform-appropriate bundle target on Windows/Linux.

## Layout

- `src/App.tsx`: workspace/navigation, repository state, composer, and draft guards.
- `src/History.tsx`, `src/graph.ts`: virtualized history and lane layout.
- `src/PierreTree.tsx`: Pierre Trees integration.
- `src/Surface.tsx`, `src/diff.worker.ts`: Pierre CodeView, editing, and diff workers.
- `src-tauri/src/repository.rs`: Git queries, file safety, staging, and integration tests.
- `src-tauri/src/main.rs`: asynchronous Tauri commands, repository session, watcher.

## Reused software

Pierre [Diffs](https://github.com/pierrecomputer/pierre/tree/main/packages/diffs) and [Trees](https://github.com/pierrecomputer/pierre/tree/main/packages/trees) are Apache-2.0 licensed. Tauri, React, TanStack Virtual, notify, Shiki, Lucide, and DM Sans are also used. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md); dependency license and notice files remain the authoritative terms.

### Commit avatars

History resolves commit authors through the GitHub CLI (`gh`) using its existing sign-in and the repository's GitHub `origin`. Install/sign in to `gh` to enable matching, including private repositories. Avatar lookups run after graph rendering, with two requests at a time and bounded caches; browsing Git remains available without network access or `gh`. Unmatched authors and failed images retain the ordinary commit circle. Hover a node for local author/email, co-authors, commit date, short ID, and the matched GitHub username when available.

### Code quality

Use `pnpm lint` for oxlint, `pnpm format` to apply oxfmt, and `pnpm format:check` to check formatting. `pnpm check` runs lint, formatting checks, frontend tests/build, and Rust tests. Commit `pnpm-lock.yaml`; install reproducibly with `pnpm install --frozen-lockfile`. Rust formatting remains `cargo fmt --manifest-path src-tauri/Cargo.toml`.
