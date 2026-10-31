# Working on musk

musk is a GSD Core capability: `capability.json` declares hooks; `fragments/` are injected into
GSD prompts; `skills/` become `/gsd-musk-*`; `musk-router.cjs` + `lib/` are the `gsd-tools musk`
command family. Read DESIGN.md before moving a hook, CORE-SEAMS.md before working around gsd-core.

## Rules

- **Public repo, private data.** Never name a real project, or anything from inside one
  (requirement IDs, file paths, product terms), in files, comments, tests, commit messages or
  `upstream/` drafts. Real-world numbers go in STATS.md with anonymous labels (P1, P2, …).
  Before every commit, grep the tree and the commit message for project names.
- **Every injected word costs tokens on every phase.** `stats` charges fragment size to musk's
  own pass cost. Keep fragments terse; put procedures in skills, which load only when invoked.
- **The ledger is append-only.** Never rewrite `.planning/musk/ledger.jsonl` rows; add a row type
  (`confirm`, `reinstate`, …) and fold it in `ledger.cuts()`. Keep reading older row shapes.
- **Routers must be synchronous.** gsd-tools rejects a Promise-returning router.
- **Inject dependencies.** All I/O goes through `deps` (`fs`, `homedir`, `now`, `stdout`), so tests
  run on fixtures. Fixtures are synthetic; never copy real transcripts or planning files in.
- **Change roadmap parsing only with a check across real projects.** `lib/planning.cjs` guesses
  milestones from free-form ROADMAP.md files. Diff `milestone-check` output against the installed
  version on every project you have before shipping; only intended changes may differ.

## Test and release

```bash
npm test                       # node --test test/*.test.cjs
```

A release bumps `version` in `capability.json` and `package.json` and the `#vX.Y.Z` in README's
install line, then commits, tags `vX.Y.Z` and pushes the tag. Install it with:

```bash
node ~/.claude/gsd-core/bin/gsd-tools.cjs capability install https://github.com/bitcreed/gsd-musk-simplification.git#vX.Y.Z --scope global --yes
node ~/.claude/gsd-core/bin/gsd-tools.cjs capability set musk --on --runtime claude --scope global   # restage skills
```

Third-party skills are staged as `gsd-<stem>`, so `skills/musk-retro` is `/gsd-musk-retro`.
