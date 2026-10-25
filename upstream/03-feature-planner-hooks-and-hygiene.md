# Smaller proposals: capability slots and planner defaults

*Drafts for open-gsd/gsd-core. One issue each, not filed yet.*

## A. Render `plan:pre` in `/gsd-quick-batch` (enhancement)

`/gsd-quick` injects active `into: planner` contributions into its planner (`quick.md` step 5).
`/gsd-quick-batch` spawns `gsd-planner` per item without rendering `plan:pre`, so batch items get
no capability guidance. Fix: render once per batch and inject into each item's planner prompt,
reusing quick.md's block. Additive.

## B. Inject `into: checker` contributions (enhancement)

`into: checker` validates in manifests but is never injected: plan-phase §10 (checker) and §12
(revision) don't read it, and `plan:post` runs after the revision loop. A capability can't add a
plan-time check that uses the existing revision loop. Fix: inject active checker contributions
into the plan-checker and revision prompts. Additive.

## C. Planner defaults: source every task, merge small plans (enhancement)

Today plan sizing only ever splits. Measured across 14 projects (699M tokens), 40% of plans carry
1–2 tasks, and each still pays for an executor spawn, a SUMMARY, state updates and a commit.
Proposed defaults for the planner:

- every task traces to a requirement, decision or success criterion, or to work that makes one
  function (wiring, migration, guarding tests)
- merge plans that would carry only 1–2 tasks; one plan when a phase has 3 tasks or fewer
- never drop corrections to docs that have become wrong, or contract entries for new entry points

In use (as a capability) on 10 projects for four weeks, these rules cost about 300 tokens per
plan. Across all of musk's cuts reviewed at retros (208), 14% were restored, mostly the doc
corrections and entry-point entries now listed above.

**Acceptance:** context-budget.md and gsd-planner state the source and merge rules, and a phase
of 3 tasks or fewer is planned as one plan.
