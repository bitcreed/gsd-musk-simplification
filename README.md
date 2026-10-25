# musk: a subtraction pass for GSD

> "The most common error of a smart engineer is to optimize a thing that should not exist."

Most of GSD pushes toward *more*: every requirement covered, every gap filled, every phase fully
discussed, researched, planned in 3–5 plans, checked, verified. This capability adds the
missing question, **should this exist, and at what size?**, and asks it wherever GSD plans:

| Level | When | What gets cut |
|---|---|---|
| Milestone | first discuss of a milestone (one-shot), or `/gsd-musk-roadmap` | whole phases (to backlog), merges, unowned requirements |
| Requirements | every `discuss:pre`; again at `plan:pre` for any phase with no recorded pass | requirements and success criteria with no owner; over-broad ones narrowed |
| Ceremony | every `discuss:pre` | small phases take the **lean lane**: short discuss, no researcher, one plan |
| Implementation & plans | every `plan:pre` (also `/gsd-quick`, not `/gsd-quick-batch`) | tasks, flags, layers, shims, docs, tests nobody asked for; fewest plans (≤3 tasks → one plan) |
| Process | `/gsd-musk-retro` at milestone end | gates and steps that cost tokens and never caught anything |

Every cut goes into `.planning/musk/ledger.jsonl`, and every phase's pass leaves a `pass` row, cuts or not. A phase that reaches planning with no pass row (discuss skipped, or a hand-driven discuss that missed the hook) gets the pass at `plan:pre`. The ledger always lives in the main checkout: commands run from a linked git worktree (an isolated subagent) write there, not into the worktree's committed copy, and planning reads follow the active workstream. `gsd-tools musk stats` prices the cuts from
**your own measured token usage** (Claude Code transcripts of this project) and subtracts the
pass's own cost.

## Why musk is a must-have

**1. GSD has no brake.** Each part of GSD is built to add, not to remove:
- gap-analysis wants every requirement covered
- nyquist fills test gaps
- the api-coverage checkpoint defaults to full coverage
- researchers surface "table stakes" features
- planners add defensive code, flags and layers
- plan sizing only ever *splits*

Each of these is reasonable alone. Together they ratchet one way. Nothing in the loop asks whether
something should exist. Musk is that question, asked where it's cheapest: before discussing,
before planning, before executing.

**2. Deletion is the cheapest optimisation there is.** A requirement cut before discuss costs
nothing, while the same requirement built costs its share of a whole phase: discuss, research,
plans, checks, execution, verification, review and UAT. Measured across 14 real GSD projects
(699M tokens, [STATS.md](STATS.md)), the medians are:

| Unit | Median cost |
|---|---|
| Executed task | 112k tokens |
| Requirement | 1.04M |
| Phase | 6.9M |

The pass costs about **900 tokens** of injected text per phase. So one deleted task pays for more
than a hundred phases of it, and one deferred requirement pays for about a thousand.

**3. Ceremony is a fixed cost that doesn't scale down.** In the same data:
- Executors, the agents that write the code, spend only **40%** of GSD's tokens. The other 60% is
  orchestration, planning, research, checking and verification. That is an upper bound, and not
  all of it is waste.
- **40% of plans carry only 1–2 tasks**, yet each one still pays for its own executor spawn,
  SUMMARY, state updates and commit.
- A median phase directory holds **14 artifacts**. Musk's
**lean lane** gives small phases the flow they deserve: no questioning, no researcher, one plan.
The planner rules stop 1-task plans from being written at all. Honest sizing: only about 7% of
real phases are small enough for the lean lane. The ceremony savings alone come to roughly
0.5–7% of total tokens (see STATS.md for the arithmetic). The bigger lever is point 2, cutting
scope before it's built. That can't be estimated from history; the ledger will measure it.

**4. It follows Musk's order, which is the part people get wrong.** They optimise first, then
automate, and only later notice the thing shouldn't exist. Musk runs the steps in order:
1. Make every requirement name an **owner**.
2. **Delete** the unowned.
3. **Simplify** only what survived.
4. Then **accelerate** and **automate**, applied at the retro to GSD's own process: which
   gates cost tokens and never caught anything.

**5. It is safe to leave on.**
- Scope cuts are reversible: items move to v2 or the backlog, never into the void.
- Every cut is logged with its original text, and reinstating one is a single command.
- Security mitigations, locked decisions, your explicit asks and guarding tests are never cut.
- Implementation cuts never remove a sourced requirement.
- Unattended cuts are marked `inferred` and come up for review at the retro.

**Month 1, measured.** On 10 projects over four weeks (474M tokens), musk's estimated net saving was
**3.8% of spend for the median project** and 8.2% in aggregate, at a cost of about 1% of spend.
Of 208 cuts reviewed at retros, 14.4% were restored. Details: [STATS.md](STATS.md#month-1-in-use-2026-09-29-to-2026-10-24).

**6. It measures itself honestly.** Every cut is priced from **your own** token usage, parsed
from this project's Claude Code transcripts. Prices are p25–p75 ranges, labelled `harness`
(measured) or `prior` (default), and the pass's own cost is subtracted. The **add-back ratio** is
the self-correcting signal: 0% means it's too timid, above 30% too aggressive. Musk expects you
to add back about 10%. If you never do, it didn't cut enough.

**7. Zero workflow change.** You keep using plain GSD. Musk is on in every project once
installed, and it tells you when a manual step is due. Nothing else asks for your attention.

## Install

```bash
node ~/.claude/gsd-core/bin/gsd-tools.cjs capability install \
  https://github.com/bitcreed/gsd-musk-simplification.git#v0.5.0 --scope global
node ~/.claude/gsd-core/bin/gsd-tools.cjs capability set musk --on --runtime claude   # stage the skills now
```

That's it: it is on in every GSD project, existing ones included. Opt a project out with
`gsd-tools config-set musk.enabled false`.

The skills appear as `/gsd-musk-roadmap` and `/gsd-musk-retro`. GSD prefixes third-party skill stems with `gsd-`.

The capability ships a command module (`gsd-tools musk …`), so the installer asks for consent.
The module reads `.planning/` and this project's transcripts under `~/.claude/projects/<slug>/`.
It sends nothing anywhere.

## Configure

| Key | Default | |
|---|---|---|
| `musk.enabled` | `true` | installing is the opt-in; set `false` per project to opt out |
| `musk.scope_cuts` | `defer` | `defer`: apply reversibly without asking (the item moves to v2/backlog, gets a `[deferred]` decision, and is marked inferred). `propose`: log only. `ask`: ask per batch. |
| `musk.lean_lane` | `true` | small phases skip gray-area questioning and research, and get one plan |
| `musk.milestone_pass` | `true` | run the milestone pass automatically at the first discuss of a milestone |

The pass never cuts:
- threat or security mitigations
- locked decisions
- anything you asked for in this milestone
- tests that guard behaviour that remains
- corrections to existing docs or claims that are now wrong
- contract and registry entries for new entry points
- api-coverage rows (it writes an `OPT-OUT` instead)

## Using it day to day

You keep using plain GSD commands. What changes:

- Discuss runs cut work before gathering context. Cuts show up as `D-NN [deferred]` decisions in
  CONTEXT.md, and as requirements moved to v2/Future in REQUIREMENTS.md.
- Small phases skip the gray-area questions and the researcher. Their RESEARCH.md says
  "Research not needed".
- Phases get fewer, fuller plans.
- After each verify, one line reports the running net savings and how many cuts are still
  unreviewed.

You don't need to remember the manual steps. The line printed after each verify names one only
when it is due, and asks the agent to list it in its next steps:

| Suggested step | When |
|---|---|
| `/gsd-musk-retro` | the milestone's last phase is verified and no retro exists yet. It reviews the `inferred` cuts that `defer` mode applied without asking, and reports savings and process findings. |
| `/gsd-musk-roadmap` | the milestone pass never ran (discuss was skipped, or musk was installed mid-milestone) and unstarted phases remain |

At the start of a milestone, the milestone pass runs by itself.

## Numbers

```bash
gsd-tools musk calibrate          # measure this project's token costs from transcripts
gsd-tools musk stats [--phase N]  # cuts, add-back ratio, gross / pass cost / net (p25–p75)
gsd-tools musk list               # the ledger
gsd-tools musk reinstate M-0007 --reason "needed for export"
gsd-tools musk confirm M-0003 M-0004 --reason "reviewed at retro"   # keep cuts applied without your approval
```

Each price carries a `basis`:
- `harness`: measured in this project, with at least 5 samples.
- `prior`: a rough default used until enough history exists.

Deleted work is counterfactual: it never ran, so a "saving" is always an estimate. The stats show
ranges rather than a single number.

**Add-back ratio** (reinstated ÷ applied) is the self-tuning signal:
- about 10%: healthy
- 0%: too timid
- above 30%: too aggressive

## Design

See [DESIGN.md](DESIGN.md) for the hook map, why each hook sits where it does in gsd-core 1.15,
the ledger schema and the pricing model. [CORE-SEAMS.md](CORE-SEAMS.md) lists the gsd-core
changes that would let this go further.
