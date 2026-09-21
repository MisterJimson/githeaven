New in alpha.7:

- Docked, resizable sidebar sections with independent scrolling and collapsible local branches, remotes, tags, and stashes.
- Clearer graph lanes for separate histories, live branch highlighting, and Escape to clear branch selection after closing a diff.
- macOS system typography and remembered app zoom with Command +/−; focused editor and diff viewers retain independent text zoom.
- Create branches without losing working changes, fetch all remotes, and publish new branches with an upstream prompt.
- Remote branch checkout fetches and fast-forwards the matching local branch, preserving divergent local commits.
- Multi-file selection, discard with confirmation, and stashing from the working-files context menu.
- Stashes in the graph and sidebar, including apply/pop/delete actions, saved untracked-file diffs, and faster cached previews.
- Commit addition/deletion counts and branch context menus on graph badges.

Early macOS alpha of Githeaven: a focused Git graph, staging and commit workspace, with an integrated file editor.

- Apple Silicon (arm64) Macs only.
- Download the DMG, open it, and drag Githeaven into Applications. A ZIP of the same app is also provided.
- Git must be installed and available on your Mac. GitHub CLI (`gh`) is optional for GitHub avatars and open pull-request links.
- This alpha is ad-hoc signed, **not Apple-notarized**. macOS may block the first launch. After attempting to open the app, use System Settings → Privacy & Security → Open Anyway, only if you trust this download.
- SHA256SUMS.txt contains checksums for the downloads.

This is pre-release software. Windows/Linux packages and automatic updates are not included. Report problems through this repository's Issues tab.
