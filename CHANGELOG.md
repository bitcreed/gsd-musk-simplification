# Changelog

## 0.5.10 (2026-11-19)

- **Checked against gsd-core 1.22.0.** No code change; all tests pass on it. Core seam #6
  (`execute:pre` call site) landed upstream (#5848); musk still registers nothing there, so the
  seam table marks it landed and unused. 1.22.0's fixes to pinned-tag capability installs (#5408)
  and loop-hook skill identifiers (#5397) do not touch musk, which installs from a bare tag and
  declares no skill steps.

## 0.5.9 (2026-11-18)

- **Prompts call `gsd_run`, not bare `gsd-tools`.** On installs where `gsd-tools` on PATH is
  another package's CLI, every musk `log`, `pass` and `phase-check` call failed (unknown option
  `--phase`), so phases got no requirement pass. A test keeps bare `gsd-tools` out of prompt text.
- **`musk audit` flags two small plans as a merge candidate.** The planner rule merges plans of
  1–2 tasks, but audit only proposed groups of 3 tasks or fewer, so a 2 + 2 chain went unreported
  at retro.
- **Docs: updating musk without reinstalling gsd-core** (README "Update", core seam #11).

## 0.5.8 (2026-11-18)

- **A retro no longer leaves musk state uncommitted in another checkout** (#1). Each checkout
  keeps its own `.planning/musk/` since 0.5.6, so a `/gsd-musk-retro` that ran `calibrate` in the
  main checkout and the rest in a worktree left `calibration.json` dirty in the main checkout,
  while `musk commit` in the worktree printed `committed`; its figures also came from the other
  checkout's ledger. Three changes:
  - The retro skill runs every command from the checkout it is in (musk reads the project's
    transcripts from any checkout) and commits everything under `.planning/musk/`.
  - `musk calibrate` commits `.planning/musk/` like the other writers (JSON `commit: {ok,
    reason}`; `--out` commits nothing).
  - `musk commit`, `record` and `calibrate`, run from a linked worktree, name musk files left
    uncommitted in the main checkout (`foreign_dirty: {checkout, files}`) instead of hiding them
    behind their own verdict. musk never commits in the other checkout.
- **A leftover ledger lock is no longer committed.** `musk commit`, `musk record` and worktree
  ledger writes commit all of `.planning/musk/`, which swept in `.ledger.lock` when a writer had
  crashed or was mid-write. Every checkout of that branch then started with a held lock, and the
  commit carried the writer's hostname and pid. musk now writes `.planning/musk/.gitignore`
  (`.ledger.lock*`) next to `.gitattributes`. A lock committed before this fix is still tracked:
  `git rm --cached .planning/musk/.ledger.lock`.

## 0.5.7 (2026-11-13)

- **`/gsd-quick-batch` items are quick-task samples.** Stats attributed a quick task only inside a
  `/gsd-quick` segment, so a batch's orchestrator and the agents it spawned fell outside
  `per_quick_task`. A batch segment now owns its agents like `/gsd-quick` does, each agent counted
  with the item whose quick id it names (and its children with it); the batch's shared tokens (the
  orchestrator's turns, agents naming no item) are split evenly over the run's items. The planner's
  batch catalog no longer makes every planner look like the first item.
- A quick command's arguments no longer set a phase: `/gsd-quick-batch --jobs 3 …` or
  `/gsd-quick fix 2 typos` charged the orchestrator to phase 3 or 2 when that phase existed.
- **Docs: when `musk commit` runs.** gsd-core dispatches `execute:post` after phase execution and
  after `/gsd-quick --full` only; plain `/gsd-quick` and `/gsd-quick-batch` never do. Ledger rows
  their planners log in the main checkout stay uncommitted until the next `execute:post` (usually
  the next phase execution) or `musk record` sweeps them; rows logged in a linked worktree are
  committed at once. The docs said it ran after every `/gsd-quick`. This is an upstream gap,
  listed as core seam #10.
- **Docs: `/gsd-quick-batch` planners get musk's `plan:pre` rules.** Since gsd-core 1.21.0 each
  batch item's planner receives `into: planner` contributions; README and design.md said it did
  not, and core seam #8 is marked landed.

## 0.5.6 (2026-11-12)

- **Worktree ledger rows are committed with the plans they belong to.** A musk command run in a
  linked git worktree (an isolated planner or executor) used to append to the main checkout's
  `.planning/musk/ledger.jsonl`, where nothing committed the rows. It now writes the worktree's
  own ledger and commits each write on the worktree's branch, so the rows merge with that branch.
  A worktree without `.planning/` still falls back to the main checkout, as gsd-tools does.
- Cut ids made in a worktree carry a random suffix (`M-0007-3fa9c1`) so parallel worktrees never
  hand out the same id. Main-checkout ids stay `M-0007`; existing ids read unchanged.
- `.planning/musk/.gitattributes` declares `ledger.jsonl merge=union`, so branches that each
  appended rows merge without a conflict. It is written with the next ledger row.
- **Upgrading:** a project whose main checkout already holds uncommitted ledger rows written from
  worktrees should commit them once: `gsd-tools musk commit` in the main checkout.
