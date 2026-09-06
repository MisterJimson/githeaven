# Project workflow

Work directly on `main` until v1. Do not create feature branches unless the user asks.

Remote: https://github.com/MisterJimson/githeaven

Run frontend tests for UI behavior changes and Rust tests for Git/backend changes. Keep build outputs, dependencies, and disposable demo/stress repositories out of commits.

Use pnpm 12 for package management (`packageManager` pins the exact version). Use `pnpm lint` (oxlint), `pnpm format` (oxfmt), and `pnpm format:check`. Run `pnpm check` for the full validation suite. Do not add npm lockfiles or Prettier configuration.
