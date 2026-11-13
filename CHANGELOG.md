# Changelog

## Unreleased

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
