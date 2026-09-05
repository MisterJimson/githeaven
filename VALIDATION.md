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
