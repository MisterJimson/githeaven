# Prototype validation

Verified locally on macOS on 2026-09-04.

## Automated checks

- Production TypeScript/Vite build passed.
- Optimized Tauri macOS `.app` build passed, including bundled license resources.
- Fourteen frontend tests passed, covering graph layout/filtering, editor and tab-state preservation, foreground timing, branch virtualization, and live diff refreshes.
- Four Rust integration tests passed: empty repository/root commit, editing/staging/unstaging, status path parsing, and unsafe-path rejection.

## Native application checks

In the disposable `.demo` repository, verified branch filtering, commit selection and highlighted diffs, editing/saving, staging, and creating a local commit. An external file change preserved the unsaved draft and rejected a stale save.

In the final optimized build, opened `.stress` (6,000 commits and 10,001 files), loaded history from 500 to 1,000 rows, searched the Pierre file tree, opened and edited `sequence.ts`, saved it, and switched History → Files. The saved value remained correct. Switched repositories through the native folder picker and returned to `.demo`.

The fixture repositories contain these intentional test edits. Their creation scripts preserve existing fixtures.

## Performance observations

These are informal on-screen observations from one synthetic workload, not controlled benchmarks. The stress repository's displayed Git refresh duration ranged from about 0.2 to 2.6 seconds during the session. The selected two-line diff reported about 0.4 seconds from backend request through first render. This establishes a working baseline; it does not demonstrate extreme performance or superiority to another client.

The release `.app` occupies approximately 11 MB on disk. This is **not** a memory measurement. Total application/helper-process memory, cold launch timing, sustained scrolling frame times, and representative large real-world repository performance remain to be measured. Windows and Linux have not been tested.

## Tab-switch follow-up

Rebuilt the release and tested the user's `terminal` repository read-only: 7,971 files, 1,799 refs, and 500 loaded commits. Opened the existing `pnpm-lock.yaml` without editing it, switched between History, Files, and Changes, and verified the editor and selected diff remained available. Scrolled the virtualized sidebar into remote branches and returned to Files. No staging, commits, saves, or branch checkout operations were performed in this repository.

History, Files, and Changes now retain their views, with independent diff selections and one shared highlighter pool. The graph, editor, and tree integrations skip redundant updates. The branch sidebar renders visible rows plus overscan; its regression test confirms fewer than 40 buttons for a 2,000-ref list and verifies remote selection after scrolling.

In a six-switch foreground sample from the final release, the last React commit took 2 ms; the last event-to-paint-opportunity sample was 45 ms, with a sample p95 of 67 ms. These are informal native-automation observations, not physical-display latency or a controlled before/after benchmark. Background/interrupted measurements are discarded. The app remains open on the primary repository with the original editor file restored.

## Live diff refresh follow-up

The diff viewer now retains its document identity and increments its version when contents change, using Pierre's built-in viewport/line anchoring. The current diff remains mounted during reads and worker parsing. Identical snapshots cause no parse or document update. A transient error or missing file leaves the last diff visible with a notice. Explicit navigation still changes the selected document. The CodeView host now has the scrolling overflow required by Pierre.

Four focused surface tests verify retained DOM/scroll state during asynchronous updates, unchanged snapshot suppression, error recovery, stale response rejection, and resetting on explicit document navigation. An additional app regression verifies that a temporarily missing path does not redirect the selected diff.

Native release verification used an untracked 800-line text probe in the user's `terminal` repository, with authorization. Scrolled to row 282, rewrote the file externally, then atomically replaced it and appended 100 lines. Row 282 stayed at the same visible screen position after both updates; the existing viewer remained present. Temporarily removing the file retained the viewport with a stale-preview notice; restoring identical contents cleared the notice without a reload. The probe was removed afterward, and Git status was clean. Nothing was staged or committed. Screenshots establish the stable before/after position; the regression tests cover retaining the viewer while asynchronous work is pending.

If an update removes the anchored line or makes the document shorter than the viewport position, Pierre may clamp/re-anchor to the remaining content. This does not promise to preserve text that no longer exists.

## Compose layout follow-up

Working Changes now has stacked Unstaged Files and Staged Files sections with independent collapse controls. Each expanded section gets an equal share of available height; a collapsed section gives that space to the other list. The existing Pierre trees and diff remain mounted when sections collapse. The commit form is anchored toward the bottom of its panel.

Sidebar and composer boundaries support dragging, arrow-key resizing (Shift for larger steps), and double-click reset. Width preferences are saved locally; drag updates stay inside the panel component so they do not rerender the workspace. Preference writes happen when the drag finishes. Panel widths are bounded to leave room for the diff.

All 15 frontend tests pass, including a partially staged file test that selects both versions and verifies the correct stage/unstage action, independent collapse, and retained diff identity when resizing. Native macOS checks on the primary terminal repository verified both draggable boundaries and collapsing each section while a staged diff remains visible. Existing staging and the user's commit-message draft were preserved; no files were edited or committed for this verification.

The final release reopened with the saved sidebar/composer widths (356/367 CSS pixels); a further composer drag updated its width while the staged diff and commit draft stayed present. The app is left open on terminal in Changes.

## Unified Git workspace

Inspected the user's running GitKraken app as the structural reference. History now combines branch navigation, a WIP row, the commit graph, and a contextual right inspector. WIP shows stacked staging lists above the commit form. Selecting a commit shows its metadata and files; selecting a file opens its Pierre diff in the center. Graph returns to the existing graph instance. Files remains a separate retained editor workspace. Working and commit diffs keep independent identities and the commit draft survives browsing.

Added branch search and collapsible local/remote/tag groups, with single-click ancestry browsing and double-click checkout. Remote checkout creates a tracking branch and refuses an existing local branch name. Native Git switch runs without force flags and refuses conflicting working edits. Added Stage all/Unstage all and commit summary/description fields. Fetch/push, amend, and merge/rebase remain outside this change.

17 frontend tests pass, including graph/diff/draft preservation across WIP, history and Files; summary/description submission; bulk-stage command dispatch; and searchable, collapsible, virtualized branch navigation with explicit double-click checkout. Six Rust tests pass, including bulk staging/unstaging on unborn and existing HEADs, working-file preservation, local and remote checkout, existing branch collision, and refusal to overwrite edits. Mutation tests use disposable temporary repositories.

Native verification on terminal covered WIP → commit metadata → historical diff → Graph → WIP; the commit draft remained intact. Branch search for main, local-group collapse/expand, and ancestry browsing worked without checkout. Working-file diffs and Files/History switching also worked. A native-only same-file reselection issue was found and fixed by clearing the tree highlight when returning to the graph, without resetting the tree or diff; the final build successfully reopened the same file on a second visit. The regression mock now models Pierre's selection-change-only notification behavior.

The primary repository's cached diff checksum remained unchanged (ce45733627f85dd7cb45851886c525ee3fa02da3360bb87de7d9ba067e67c3f1). No staging, checkout, file edits, or commits were performed in terminal during this verification. The user's original commit-summary draft was restored, and the final release is open on the unified History/WIP view.

## UI cleanup

Removed the persistent local-workspace label, watcher-status label, footer timing readouts, technology branding, sidebar interaction instructions, and sidebar repository/file-count footer. Useful branch/change counts and operation feedback remain. Timing details and watcher fallback information are available only in the existing optional diagnostics panel. All 17 frontend tests pass.

## Tab labels and tree defaults

The primary tabs are now Edit followed by Git. File trees use Pierre's closed initial-expansion setting; opening a workspace starts with folders collapsed, while switching tabs retains the user's tree state. All 17 frontend tests pass with the new tab labels.

## Reopen the last repository on launch

Startup now opens the stored last-successful repository automatically, showing a brief loading state rather than the folder picker. If restoration fails, the error and folder-selection controls remain available, with no automatic retry loop. A successful replacement folder updates the saved path. Two new tests cover a single restore under Strict Mode and recovery from a missing repository; all 19 frontend tests pass.

Verified in the final native release: quit and relaunched the app, and terminal opened directly with its graph and staged change without using any folder-selection control. Restored the existing commit draft and returned to Edit.

## Working changes as a ghost commit

Removed the shortcut beside the tabs and the separate WIP strip. Working changes is now the first virtualized graph row, using a hollow dashed node and a dashed connection to the actual HEAD, including when newer remote commits precede HEAD. It remains available in empty repositories and under history filters. Selecting the row opens staging and the composer without calling any commit-inspection or Git mutation command. Its layout is independent of the change count, avoiding graph recomputation on count-only updates.

20 frontend tests pass. The new graph regression covers connecting WIP to HEAD rather than the newest remote commit, separate selection callbacks, and the unborn/empty state. The native release was checked on terminal: selected a real commit, then the ghost row, confirming the inspector switched back to staging. Reopened the user's previously viewed stacks/DatadogForwarder.ts without editing it.

## History column order

The graph table now uses Branch / Tag, Graph, and Commit Message columns, in that order. Ref badges moved out of the message cell, follow the graph lane color, and identify the checked-out local branch. Full ref names are available on hover, with an overflow count for additional refs. Author, date, and hash remain in commit details. Header and row columns share their layout and stay aligned during horizontal scrolling. All 20 frontend tests pass.

## Edit file-opening latency (2026-09-04)

Edit now mounts one empty Pierre editor when the repository opens and reuses its document slot across file selections. Opening keeps the previous viewport mounted during the single native file read; an inert state prevents editing the outgoing document during that read. Selected-file changes no longer trigger a duplicate read. Repository events still reread the current document and preserve unsaved drafts. Switching documents resets the viewport to the top; same-document updates do not.

Pierre's editable documents initialize a separate main-thread highlighter from the diff worker pool. Both now use its supported Shiki WebAssembly engine. The main highlighter loads and exercises the six common language grammars after repository mount, yielding between languages. This keeps one editor rather than caching a growing collection of file editors or potentially stale file contents.

Native release checks in terminal (7,971 files, 1,800 refs): first JSON open 23 ms; first TypeScript open 85 ms; subsequent opens 54, 70, and 85 ms. An additional open after discarding a test draft took 118 ms, including a 62 ms native read. Measurements run from the open request through a frame at which Pierre exposes the new editable document, and exclude time across window blur. These are small-file samples, not a guarantee for every repository/file size. The optional measurements popover now reports file-open and read durations.

Verified native editing in a reused document, the unsaved-navigation dialog, discarding the temporary draft, and that undo in the next document did not restore the previous document's edits. No files were saved or committed in terminal; its pre-existing staged diff hash remained unchanged. All 23 frontend tests pass. Frontend regression coverage includes persistent editor identity, one read per open, superseded read rejection, read failures preserving the old document, fresh disk contents on revisits, and external refreshes preserving dirty drafts.

After the final release restart, opening DatadogForwarder.ts as the first document measured 81 ms, including a 24 ms native read. Left the app in Edit with terminal open and the measurements popover closed.

## Optimistic staging and unstaging (2026-09-04)

Single-file and bulk stage/unstage actions project the new index/worktree lists immediately, without setting the global busy state. Index writes run serially, reconcile against Git after each operation, and retain later queued intentions. A failed write removes only its projection; a failed status refresh after a successful write keeps that success visible and reports the refresh error. Refreshes started before index mutations cannot replace newer state. Commit, repository switching, and branch checkout wait for index writes to settle; ordinary file/tab navigation remains available.

Working diffs retain a stable document identity across index/worktree transitions. Affected comparisons defer reading until their writes settle, then update the existing viewer. Status reconciliation updates the selected comparison and rename metadata without clearing the selection or commit text. The file panel now permits its flex child to shrink, bounding long diff viewports so they can scroll.

All 32 frontend tests pass, including pending-command projections, immediate reversal/serialization, independent queued-operation failure, bulk rollback while navigating, stale refresh suppression, successful writes followed by refresh failures, status projection for partial/new/deleted/renamed files, and stable diff identity/scroll across a deferred source change. Desktop release builds pass.

Native verification used a newly created 700-line untracked file in terminal. Staging and unstaging moved only that file between the two lists, retained the existing diff, and kept line 188 at the top of the visible viewport through both transitions. The final build also verified that branch rows and the folder selector do not become dimmed during these operations. Branch browsing stays enabled; checkout and repository changes wait for outstanding index writes when needed. The fixture was unstaged and deleted after verification. The user's existing control-plane-metrics.ts modification remained unstaged and byte-for-byte unchanged (diff SHA-256 ce45733627f85dd7cb45851886c525ee3fa02da3360bb87de7d9ba067e67c3f1). No commits were created. Left terminal open on the Git graph with its original one changed file.

## Changed-file Path / Tree views (2026-09-04)

The staged/unstaged sections share a Path / Tree toggle, defaulting to Path and remembering the preference. The flat path list is virtualized; both views remain mounted to retain scroll and expansion when toggled. Each section shows search only above 20 files. Search filters either view, and dropping to 20 clears the filter when the field disappears.

All 35 frontend tests pass, including persisted view preference, retained view identity/scroll, selected-file dispatch, independent search thresholds, filter clearing, and bounded rendering for 1,000 paths. The desktop release build passes. Native verification in terminal confirmed collapsed Tree mode, Path selection opening the diff, and the diff staying open across toggles. Twenty temporary files brought the unstaged total to 21: search appeared and filtered both views to file-03. Removing one fixture brought the count to 20: search disappeared and all remaining paths returned. All fixtures were then removed; the user's original unstaged modification and its diff hash above remained unchanged. No files were staged or committed. Left the updated app open with Path selected.

## Command palette and quick file navigation (2026-09-04)

Cmd-K opens commands and destinations: Edit, Git history, working changes, commit writing, branch/commit search, local and remote refs/tags, loaded commits, changed-file diffs, files, repository opening/refresh, diff layout, and saving a dirty editor. Cmd-P lists the repository's existing file inventory with case-insensitive subsequence matching on filename/path. Both support arrow keys, Enter, Escape, mouse selection, and switching directly with the other shortcut. Ctrl shortcuts also work. A native modal dialog contains focus and restores the previous focus on dismissal; navigation uses the existing unsaved-edit guard. Results render only a viewport-sized slice.

All 40 frontend tests pass. New coverage includes 10,000-file virtualization, keyboard navigation past the viewport, fuzzy ranking, empty results, palette switching, branch browsing without checkout, composer focus, and protecting/saving dirty edits. The release build passes. Native verification on terminal (7,971 files) used Cmd-P to find stacks/DatadogForwarder.ts from dtadgfwd and open it with Enter; Cmd-K worked from the focused editor and Write a commit focused the summary. Arrow navigation, direct palette switching, main branch ancestry browsing, and Escape dismissal also worked. No repository files were modified, staged, or committed; the original modification's diff hash remained unchanged. Left the updated app on Git with all branches shown.

## Automatic history loading (2026-09-05)

Removed the Commit history label/count and Load older button above the graph. Scrolling within 740 pixels of the end requests another 500 commits, preserving the mounted viewport and selection. Requests are guarded against overlapping refresh/index operations; failed loads restore the previous limit for retry on a later scroll. Hidden history panes do not request older commits. Removed the previous 5,000-commit ceiling and avoided spreading the growing graph into Math.max arguments.

All 43 frontend tests and six Rust tests pass; the desktop release builds. Native verification on terminal scrolled across two page boundaries: the loaded history grew from 500 to 1,000 and then 1,500 while remaining among the older rows. The column headings remain; the redundant title/count and manual pagination button are gone. No repository files were edited or committed.

## Focused viewer font shortcuts (2026-09-05)

Cmd-plus (including Cmd-equals) and Cmd-minus adjust the focused file/diff viewer by one pixel, bounded to 8–32px. Ctrl equivalents work too. The editor and diff preferences persist independently. Font CSS and Pierre's virtual row metrics change together; document identity stays intact. Shortcuts are handled on the viewer wrapper, leaving other app inputs unaffected.

All 44 frontend tests pass and the release builds. Native checks increased both a focused TypeScript editor and a working diff from 12 to 15px, confirming the surrounding UI did not zoom and the editor stayed saved. Cmd-minus restored each to 12px. No repository files were edited or committed.

## Compact project tabs (2026-09-05)

Replaced the branding/repository picker bar with horizontally scrollable project tabs, individual close controls, and a + button that opens the native folder picker. Both top rows are now 38px tall. Open project paths and the last active project persist across launch; reopening an existing path does not duplicate its tab. Switching projects reopens the native repository session and restores that project's view, selected file/comparison, filters, and commit draft in memory. Unsaved-file navigation continues through the existing save/discard/cancel guard. Closing the active project opens a neighbor, or returns to the folder picker when no tabs remain.

All 46 frontend tests pass and the desktop release builds. Native verification opened the existing .demo repository through +, switched between terminal and .demo, confirmed their commit drafts stayed separate, and closed .demo to return to terminal. The temporary demo draft was cleared. No repository files were edited or committed. Left the compact tab bar open on terminal.

## Interactive graph branch badges (2026-09-05)

Graph badges now suffix local branches with a monitor, remote branches with a cloud, and tags with a tag icon. Each badge has its own hover, focus, click, and double-click target. Single-click reveals and highlights the exact kind/name in the sidebar without selecting the commit or moving the graph. Double-click checks out a branch. Remote checkout creates a tracking local branch or switches to its existing matching tracking branch, refusing unrelated name collisions.

Checkout checks Git status under the write lock. With staged/unstaged/untracked changes it returns a stash-or-cancel prompt; only explicit confirmation stashes and switches. Stashes remain saved rather than being reapplied automatically. Failed switches retain the stash and report it. Stash commands bypass the global literal-pathspec setting, which otherwise left saved untracked files on disk and prevented a clean switch.

All 48 frontend tests and seven Rust tests pass, including independent badge events, explicit stash confirmation/cancel, local/remote checkout, and restoration of staged, working, and untracked content from the resulting stash. Native verification selected a remote badge and observed the sidebar reveal/highlight without changing commit selection. A temporary untracked file triggered the prompt on a real double-click; Cancel kept main checked out and the file intact. The fixture was removed, leaving terminal clean. No commits or branch switches were performed in terminal.

## Hide clean WIP row (2026-09-05)

The graph includes its synthetic Working changes row only when staged or unstaged changes exist. Clean repositories start with a real commit, and ghost-only dashed edges are disabled. Regression coverage checks clean/dirty transitions, real-commit identity and click behavior, and an empty repository. All 48 frontend tests pass; the release builds.

## Simplified Git toolbar (2026-09-05)

Removed the duplicate branch indicator and refresh button from the top toolbar. The bottom-left branch indicator remains. Automatic filesystem-event, focus, and periodic reconciliation refreshes remain enabled. The command-palette refresh action now bypasses the unsaved-navigation guard, matching automatic refresh behavior and preserving dirty editor drafts. All 48 frontend tests pass.

## Change-list arrow navigation (2026-09-05)

Up/Down in the staged or unstaged file area now selects the adjacent file and opens its diff, preventing default page scrolling. Navigation is bounded within the focused section and uses its filtered, sorted file list. Path mode scrolls the virtual list to the selected file; Tree mode expands ancestors and reveals/focuses it. Mouse selection clears the prior keyboard reveal target. All 50 frontend tests pass, including both views, section boundaries, and filtered results.

## Edit gutter changes against main — 2026-09-05

- Added a read-only baseline lookup pinned to the local main commit. Missing main or unreadable baselines leave the gutter clear; a path absent from main is treated as added.
- Pierre computes line ranges in a dedicated worker after a 120 ms typing debounce, including unsaved edits. Gutter decorations update in place and follow virtualized rows without replacing the document or changing line heights.
- Green marks additions, blue marks replacements, and red triangles anchor deletions. Repository refreshes reread the main baseline; obsolete worker results are ignored.
- Validation: 56 frontend tests, 8 Rust tests, TypeScript check, and Tauri release app build passed. Coverage includes insertion/replacement/deletion positions, absent paths, main versus feature/working contents, stale results, and stable gutter DOM.
- Native app: verified green markers on a new file and a blue marker after an unsaved first-line edit to README.md. Undid the temporary edit and confirmed “Saved to disk”; no test edit saved.

## Reveal Edit file selection — 2026-09-06

- The Edit explorer now synchronizes Pierre's actual selection with the open file, including navigation from the diff arrow and quick open.
- Opening a file or returning to Edit expands its parent folders and reveals its row without stealing editor focus or triggering a second file read.
- Frontend regression coverage verifies changing the selected file, ancestor expansion, nearest scrolling without focus, and suppression of recursive selection callbacks.

## Repository-tab latency — 2026-09-06

- Previously every project-tab click awaited discovery, a full Git snapshot, and watcher setup before displaying the destination. Already-open projects now synchronously restore their saved snapshot and view; Git refresh starts after a paint opportunity. First opens still load the repository normally.
- Backend sessions retain one watcher per open repository, authorize commands by their explicit root, and release the session/watcher when its project tab closes. Returning to a cached project makes no `open_repository` request.
- Avoid constructing the hidden Edit explorer before it is needed, and defer diff refreshes during the repository switch's initial paint. Cached snapshots retain the loaded history limit, commit drafts, selections, and saved editor document.
- Performance notebook records repository React commit time and click-to-paint-opportunity time, with separate cached/first-open p95s and sample counts. Samples survive repository switches. Focus-interrupted/background paint samples are excluded explicitly; React commit time remains available. These measurements are not a guarantee of every frame or full diff readiness.
- Native release checks used terminal (~8,000 files) and githeaven. The initial cached implementation measured 21–53 ms React commit / 59–116 ms paint opportunity; deferring the hidden tree reduced observed React commits to 18–29 ms (three cached paint samples: 82, 85, 101 ms). Final scheduling additionally defers diff work until after the switch measurement; no final latency claim is inferred from those earlier samples.
- Final validation: 58 frontend tests, 9 Rust tests, and Tauri release app build passed. The new regression holds background Git requests pending and verifies synchronous cached selection, enabled project tabs, preserved timing samples, and no repeat open call. Backend coverage checks independent open-root authorization and removal. One full-suite run intermittently failed an existing unsaved-draft test; its isolated reproduction and the subsequent complete suite passed without changing that test.

## Diff syntax first paint — 2026-09-06

- Parsed diffs now receive a unique cache key and prime Pierre's worker highlight cache before being published to CodeView. Worker and viewer tokenization settings match, so the first render can consume the highlighted AST rather than rendering plain code and replacing it later.
- Removed the previous 35 ms read delay. Refreshes retain the previous highlighted document while the next version is prepared; cancelled selections cannot publish late highlight results. Highlight failures preserve the previous diff and report the error.
- The existing diff timing now includes highlight-cache preparation. The cache remains bounded by Pierre's existing 12-entry pool limit.
- Validation: 60 frontend tests passed, including a controlled delayed-highlight regression that checks initial rendering waits for readiness, refresh preserves the DOM container, and revisions receive distinct cache keys. Existing scroll, stale-result, unchanged-content, staging, and error-recovery tests pass. Tauri release build passed.

## GitHub commit avatars — 2026-09-06

- Added local author email and Co-authored-by trailers to history records. Commit node hover text includes those details, date, short SHA, and GitHub login when matched.
- The optional GitHub CLI lookup uses the exact GitHub origin and commit SHA with existing `gh` authentication, following [GitHub's commit author association](https://docs.github.com/en/rest/commits/commits#get-a-commit). It does not search names or submit author emails to an identity service. Requests time out after eight seconds and unavailable matches fall back to ordinary nodes.
- Visible nodes defer lookup by 100 ms; frontend concurrency is two, the queue is capped at 64, and commit/author caches are bounded at 512 each. Successful author matches are reused; an unpublished commit does not poison another commit's lookup for that author. WIP retains its dotted circle. Avatar images are restricted to avatars.githubusercontent.com by CSP and use branch-colored rings.
- Validation: 63 frontend tests and 11 Rust tests passed; release build passed. Tests cover author/co-author fields, exact GitHub origin parsing, avatar/image failure fallback, cached author reuse, and unpublished commit fallback. Verified a real GitHub association through gh and visually confirmed avatar circles in the native githeaven graph.

## Prepared diff selection — 2026-09-06

- Added a shared prepared-diff cache under the existing Pierre provider. A ready cache entry supplies the initial CodeView item synchronously, with its syntax AST already in Pierre's cache. Re-selecting a current entry does not repeat Git reads, parsing, or highlighting.
- Background preparation covers up to 24 working/index comparisons or files in the selected commit, starting after a 150 ms idle interval. Explicit selections are prioritized over queued speculation; two preparation jobs can run concurrently, and the waiting queue is capped at 24. Background preparation itself runs sequentially.
- Retention is capped at 24 entries and 6 MiB of source strings (AST/metadata memory is additional); Pierre's AST cache is capped at 24 entries. Cache identity separates repositories, paths, source, commit, parent, and rename path. Missing syntax ASTs are re-primed before rendering. Repository refresh generations revalidate working content; immutable commit previews use a stable generation.
- Existing displayed diffs survive refresh failures and background updates. Clicks can attach to in-flight preparation instead of duplicating work. The render-timing callback checks the CodeView handle on the next frame so an already-ready first mount can be measured too.
- Validation: 66 frontend tests and release app build passed. New tests verify request deduplication, synchronous cache availability, revalidation, AST eviction, entry bounds, and source separation; existing stale-response, syntax-first-render, scroll, and staging tests remain passing. Native terminal-repo selection rendered a prepared comparison; no quantitative latency claim is based on that screenshot/AX observation.
- Cold or evicted files still require preparation. This change accelerates ready selections rather than disguising cold work with stale content from a different file.

## Retain diff while switching files — 2026-09-06

- File selection no longer remounts the diff surface. It keeps the displayed document and scroll position until the requested comparison finishes preparing, then installs the replacement and resets its scroll to the top. Same-file refreshes continue preserving scrolling.
- Comparison identity is checked alongside contents so distinct files with identical content still replace each other. Failed loads retain the prior diff with the existing error notice; stale requests cannot replace a newer selection. Repository changes still isolate the viewer.
- Validation: 67 frontend tests passed, covering retained DOM/content during delayed file selection, scroll reset only at replacement, identical-content file navigation, and existing stale-result/highlighting behavior.

## pnpm 12 and Oxc tooling — 2026-09-06

- Pinned `pnpm@12.3.4` in packageManager, added Node/pnpm engine requirements, imported the npm dependency lock into pnpm-lock.yaml, and removed package-lock.json and the Prettier dependency.
- Added oxlint 1.81.0 and oxfmt 0.66.0 with committed configuration and lint/format/format:check scripts. Applied the formatter baseline and rewrote one side-effect ternary as an if/else to satisfy the linter without changing behavior.
- Tauri hooks, runtime development hints, README commands, and AGENTS.md now use pnpm. pnpm-workspace.yaml allows only esbuild's required dependency build script.
- Validation: `pnpm install --frozen-lockfile` and `pnpm check` passed, including lint with warnings denied, formatting checks, 67 frontend tests, frontend build, and 11 Rust tests. The imported graph retains the existing Pierre theming peer-version warning; no unrelated dependency upgrades were introduced to address it.

## React Compiler

- Enabled pinned `babel-plugin-react-compiler` 1.0.0 through the existing Vite React plugin, targeting React 19. Vitest uses this same configuration.
- An isolated Babel diagnostic pass over non-test TypeScript sources reported eight compiled functions: ChangeSections, ChangeFiles, CommitNode, QuickOpen, PierreProvider, useViewerFont, DiffSurface, and useEditorChanges. Production output contains compiler memo-cache code in the main and Surface bundles.
- Other functions safely bail out on unsupported control flow, render-time ref access, or incompatible virtualizer APIs. Existing manual memoization is retained. No latency improvement is claimed without a native before/after measurement.
- `pnpm check` passed: oxlint, oxfmt, 67 frontend tests, production build, and 11 Rust tests.
