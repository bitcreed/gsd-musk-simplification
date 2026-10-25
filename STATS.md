# Real-world GSD cost stats

Measured on 14 real GSD projects (12 with Claude Code transcripts), 2026-08-20 to 2026-09-29.
These numbers describe **plain GSD**. Musk has not yet run on any real project, so nothing below
is a measured saving. The last section is an **estimate** built from the measured cost structure.

Regenerate: `node scripts/real-world-stats.cjs <project-dir>...` (read-only, zero deps, uses `lib/`).

Headline tokens = `input + cache_creation + output`. `cache_read` is reported separately.

## Cost per unit (p25 / **p50** / p75, n)

| Project | Executed task | Phase | Quick task | Requirement | Fit r² (exec ~ tasks) |
| --- | --- | --- | --- | --- | --- |
| **Pooled** | 90k / **112k** / 146k (n=465) | 3.70M / **6.87M** / 8.86M (n=56) | 287k / **455k** / 651k (n=228) | 639k / **1.04M** / 1.66M (n=56) | 0.139 (n=465) |
| A (Rust, 28 phases) | 98k / **103k** / 118k (n=29) | 835k / **1.63M** / 5.99M (n=7) | 253k / **382k** / 550k (n=55) | 193k / **299k** / 678k (n=7) | 0.588 (n=29) |
| B (Python, 23 phases) | 83k / **104k** / 137k (n=231) | 4.27M / **6.98M** / 8.60M (n=21) | 388k / **513k** / 823k (n=19) | 716k / **871k** / 1.60M (n=21) | 0.223 (n=231) |
| C (Dart, 20 phases) | 75k / **90k** / 117k (n=15) | – (n=4) | – (n=3) | – (n=4) | 0.077 (n=15) |
| E (Dart, 18 phases) | 95k / **112k** / 129k (n=16) | 6.58M / **6.97M** / 8.46M (n=6) | 203k / **287k** / 384k (n=7) | 1.18M / **1.94M** / 3.89M (n=6) | 0.01 (n=16) |
| H (Python, 10 phases) | 102k / **134k** / 182k (n=124) | 8.90M / **10.32M** / 14.33M (n=8) | 277k / **458k** / 605k (n=61) | 1.31M / **1.57M** / 2.07M (n=8) | 0.048 (n=124) |
| I (Python, 10 phases) | 103k / **128k** / 150k (n=46) | 6.01M / **6.60M** / 7.67M (n=9) | 360k / **574k** / 696k (n=14) | 959k / **1.10M** / 1.20M (n=9) | 0.052 (n=46) |
| J (Dart, 8 phases) | – (n=0) | – (n=0) | 401k / **528k** / 815k (n=56) | – (n=0) | – |
| N (JavaScript, 1 phase) | – (n=0) | – (n=0) | 183k / **271k** / 424k (n=12) | – (n=0) | – |

Projects D, F, K and L have fewer than 5 samples in every column. They count toward the pooled figures.

**Cache reads (p50):** 5.03M per task, 287M per phase and 15.8M per quick task. That is about 40×
the headline tokens. In total that is 28.4G cache-read tokens against 699M headline tokens.

## Where the tokens go (pooled, share of all 699M tokens)

| Bucket | Share | | Bucket | Share |
| --- | --- | --- | --- | --- |
| `gsd-executor` | **33%** | | `gsd-plan-checker` | 2% |
| `gsd-planner` | 14% | | `gsd-security-auditor` | 2% |
| `general-purpose` (non-GSD) | 13% | | `gsd-code-fixer` | 2% |
| `orchestrator:/gsd-quick` | 5% | | `orchestrator:/gsd-plan-phase` | 2% |
| `main` (outside any GSD command) | 4% | | `orchestrator:/gsd-progress` | 2% |
| `gsd-phase-researcher` | 3% | | `orchestrator:/gsd-capture` | 1% |
| `gsd-verifier` | 3% | | `orchestrator:/gsd-fast` | 1% |
| `gsd-code-reviewer` | 3% | | `gsd-pattern-mapper` | 1% |
| `orchestrator:/gsd-execute-phase` | 2% | | `orchestrator:/gsd-discuss-phase` | 1% |
| other (39 buckets, each ≤1%) | 6% | | | |

GSD-attributed buckets (`gsd-*` agents plus `orchestrator:/gsd-*`) hold 572M tokens, 82% of the total.
**Executor: 40% of GSD tokens. Ceremony share (everything else): 60%.** This is an upper bound.
Not all ceremony is waste. Verifier, reviewer and security gates catch real defects. `/gsd-quick` and
`/gsd-fast` orchestrators and `gsd-code-fixer` also do implementation work. Counting those
three as work gives a ceremony share of about 50%.

| Project | Executed plans | Executor / GSD | Ceremony (upper bound) |
| --- | --- | --- | --- |
| A (Rust) | 29 | 36% | 64% |
| B (Python) | 231 | 47% | 53% |
| C (Dart) | 15 | 29% | 71% |
| E (Dart) | 16 | 42% | 58% |
| H (Python) | 124 | 41% | 59% |
| I (Python) | 46 | 36% | 64% |

## Ceremony shape (`audit` logic over every phase dir with ≥1 plan)

| Project | Phases | Plans/phase p50 | Tasks/plan p50 | Plans with 1–2 tasks | Phases ≤3 tasks (lean-eligible) | Phases with merge candidates | Files/phase dir p25/p50/p75 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Pooled** | 157 | 4 | 3 | **40%** | **7%** | **10%** | 9 / 14 / 22 |
| A (Rust, 28 phases) | 24 | 4 | 3 | 40% | 17% | 13% | 8 / 11 / 21 |
| B (Python, 23 phases) | 23 | 9 | 3 | 27% | 0% | 0% | 23 / 29 / 39 |
| C (Dart, 20 phases) | 20 | 3 | 2 | 61% | 5% | 10% | 10 / 13 / 17 |
| D (TypeScript, 19 phases) | 16 | 2.5 | 2 | 60% | 6% | 0% | 6 / 9 / 13 |
| E (Dart, 18 phases) | 18 | 4 | 3 | 47% | 6% | 11% | 11 / 15 / 24 |
| F (Dart, 16 phases) | 8 | 3 | 2 | 69% | 13% | 13% | 8 / 10 / 11 |
| G (TypeScript, 11 phases) | 11 | 3 | 2 | 69% | 18% | 36% | 8 / 10 / 13 |
| H (Python, 10 phases) | 10 | 11.5 | 3 | 27% | 0% | 0% | 20 / 33 / 42 |
| I (Python, 10 phases) | 8 | 6.5 | 3 | 29% | 0% | 13% | 21 / 23 / 27 |
| J (Dart, 8 phases) | 5 | 5 | 2 | 52% | 0% | 20% | 11 / 13 / 15 |
| K (Kotlin, 5 phases) | 5 | 2 | 2 | 100% | 20% | 0% | 7 / 7 / 8 |
| L (Python, 5 phases) | 5 | 4 | 2 | 79% | 0% | 40% | 13 / 14 / 14 |
| M (Dart, 3 phases) | 3 | 5 | 3 | 24% | 0% | 0% | 13 / 17 / 19 |
| N (JavaScript, 1 phase) | 1 | 3 | 8 | 0% | 0% | 0% | 12 / 12 / 12 |

Plan sizes (pooled, n=993 plans): 1 task 2%, 2 tasks 38%, 3 tasks 55%, 4 tasks 3%, 5 tasks 1%,
6+ tasks 1%. Planners pack almost every plan to 2–3 tasks and then add more plans. A phase is
therefore rarely ≤3 tasks, but it often has 4–12 small plans. Each plan comes with its own
executor spawn, SUMMARY and checker pass. The p50 plans per phase ranges from 2 to 11.5
across projects.

## Illustrative estimate (NOT measured)

This applies `lib/pricing.cjs` to the audited shape, using pooled measured prices: `per_phase` p50
6.87M and `per_quick_task` p50 455k, both measured on this machine. `per_plan_overhead` uses the 60k
prior, because it is not separable (see caveats).

| Cut | Arithmetic | p50 |
| --- | --- | --- |
| 11 lean-eligible phases → `reroute-quick` | 11 × (6.87M − 455k); p25/p75 37.6M / 90.3M | 70.6M |
| 12 surplus plans in merge groups (non-lean phases) → `plan-merge` | 12 × 60k | 0.7M |
| **Upper estimate** | 71.3M ÷ (157 phases × 6.87M = 1.08G) | **≈7%** |
| Lower bound: lean lane only drops researcher + pattern-mapper | 11 × 6% of phase tokens × 6.87M + 0.7M | 5.6M ≈ **0.5%** |

So the lean lane and plan merges alone are worth roughly **0.5–7%** of phase spend. The larger
lever is in the measured structure, not in this estimate. 60% of GSD tokens are non-executor,
and planning costs 14% on its own, before any scope is cut. Scope cuts (a deleted requirement
≈ 1.04M, a deleted phase ≈ 6.87M) are not estimated here. Their frequency is unknown until musk
has run on a real project.

## Month 1 in use (2026-09-29 to 2026-10-24)

musk v0.3–v0.5 ran on 10 projects of one developer, all with `scope_cuts: defer`. The ledger is
measured; savings are estimates (deleted work never ran), priced with v0.5's `lib/pricing.cjs`
from each project's own transcripts (`harness`) or the priors above (`prior`, fewer than 5 samples).
Projects are labelled by spend rank only.

| Project | Spend | Cuts | Restored | Est. net p50 | Net ÷ spend | musk's own cost ÷ spend | Basis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | 176M | 84 | 15 | 17.2M | 9.7% | 0.8% | harness |
| P2 | 70M | 20 | 3 | 1.9M | 2.7% | 0.5% | harness |
| P3 | 67M | 24 | 2 | 0.5M | 0.7% | <0.1% | harness |
| P4 | 41M | 13 | 0 | 13.0M | 31.6%¹ | 0.7% | harness |
| P5 | 40M | 34 | 3 | 2.7M | 6.9% | 2.2% | harness |
| P6 | 33M | 31 | 7 | 0.9M | 2.8% | 5.0%² | prior |
| P7 | 21M | 9 | 0 | 0.7M | 3.6% | <0.1% | harness |
| P8 | 9M | 2 | 0 | 0.4M | 4.1% | 0.7% | prior |
| P9 | 9M | 5 | 0 | 1.2M | 13.7% | 0 | prior |
| P10 | 9M | 4 | 0 | 0.1M | 1.6% | 0.9% | harness |
| **All** | **474M** | **226** | **30** | **38.6M** | **8.2%** aggregate, **3.8%** median | **1.0%** | |

¹ Inflated: two plan steps were logged as `phase-merge` (priced at 35% of a phase each) and two
plan-level features at milestone level. Without them P4 is about 9%.
² Includes the cost of its retro, which reviewed 31 cuts.

**Review.** Seven projects (P1–P6, P8) ran `/gsd-musk-retro`. The retro reinstated cuts that git
history showed were rebuilt, confirmed the ones that held, and asked the user about scope cuts.
Of the 208 cuts reviewed, **30 were restored (14.4%)**, inside the 5–20% band musk treats as
healthy. What came back:

- corrections to existing docs that had become wrong (legal and compliance docs above all)
- contract or registry entries for new entry points
- a few tests and flags that review or validation asked for
- two scope cuts the user overruled

The first two are now on the planner's never-cut list (v0.4.5).

**What the month showed:**
- **Typical saving about 4% of spend**, with a long tail to about 10% on projects with roadmap
  bloat. musk's own cost is about 1% of spend, so it pays for itself about 4–8×.
- **Most of the value is scope and implementation cuts.** The lean lane fired once in a month,
  consistent with the 7% eligibility estimate above.
- **Reminders depend on the verify:post step, which runs unreliably.** One project recorded 3
  snapshots for 24 verified phases, another 20 for 40. In one project, 5 milestones closed without
  the retro reminder ever firing. This is the case for a core milestone hook (CORE-SEAMS #4).

## Method and caveats

- **Transcripts:** `~/.claude/projects/<slug>/<session>.jsonl` plus `<session>/subagents/agent-*.jsonl`
  for each project dir. This is Claude Code only, and only for the exact project path. Worktrees
  and clones under other paths are not included. One clone of a project was dropped because it
  duplicated another project's `.planning`. 12 projects have transcripts: 699M headline tokens
  from 2026-08-20 to 2026-09-29.
- **Dedup:** streamed chunks are deduplicated by `message.id`, first within each file and then
  across all files. The last chunk's usage wins.
- **Attribution** (`lib/transcripts.cjs`): subagents map to their `subagent_type`. Phase and plan
  come from the spawn description and prompt. Main-session tokens map to the `/gsd-*` command in
  effect. 80% of headline tokens are attributed to a phase or a quick task, and 82% to a GSD
  bucket. The 13% `general-purpose` bucket is mostly coordinator subagents that dispatch GSD commands.
  It is excluded from both the ceremony numerator and the denominator. Project F reaches only 3%
  attribution because its execution ran from a clone that has no transcripts.
- **Units:** *task* = executor tokens of one plan (retries summed) ÷ its task count, and it
  includes per-plan overhead. *Phase* = all attributed tokens of a phase that had at least one
  executor run. *Requirement* = phase ÷ requirement IDs on its ROADMAP line. *Quick task* =
  tokens attributed to one quick-task id. Plans archived or renamed out of `.planning` are
  excluded.
- **n-threshold:** a quantile is shown only when n ≥ 5 (`MIN_SAMPLES`). Pooled quantiles are
  taken over the concatenated samples, not over project medians.
- **Plan overhead is not separable.** The least-squares fit `executor = a + b·tasks` has r² from
  0.01 to 0.59 (pooled 0.14), and two projects give a negative intercept. Task count explains
  little of executor cost, so per-plan overhead cannot be split from per-task cost in this data.
  The estimate therefore uses the 60k prior.
- **Lean-eligible** = the phase's plans total ≤3 tasks. This uses the same rule as
  `audit.quick_eligible`, applied to every phase dir with plans. Merge candidates use `audit`'s
  rule (combined ≤3 tasks, same wave or linear chain). Artifact count = all files under the
  phase dir, recursively.
- Anonymised: projects are labelled by letter, language and phase count (all phase dirs,
  including archived and unplanned ones).
