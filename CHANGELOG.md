# Changelog

## Unreleased

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
