# gsd-core seams this capability would use

These are deliberately **not** implemented. Propose them upstream only once the ledger shows the
overlay earns its keep: a healthy add-back ratio and positive net savings over 1–2 milestones.
Each seam names the workaround the overlay uses today.

| # | Seam | Why | Workaround today |
|---|---|---|---|
| 1 | **Checker contribution slot**: inject `into: checker` contributions into the plan-checker prompt (plan-phase §10) and the revision prompt (§12) | A plan-time subtraction check could then use the existing revision loop. Today `into: checker` validates but is never injected anywhere. | Planner-side rules at `plan:pre` |
| 2 | **`removed` decision tag** honoured by gap-analysis, the decision-coverage gate and the verifier | Lets a deliberate cut live in CONTEXT.md without editing REQUIREMENTS.md or ROADMAP.md | Move the REQ to v2 / Future, set its traceability row to `—`, drop it from the phase's `Requirements:` line, and add a `[deferred]` decision |
| 3 | **Ceremony tier per phase** (e.g. `**Ceremony**: lean` in ROADMAP) honoured by plan-phase (skip research, one plan) and `/gsd-next` / autonomous routing to `/gsd-quick` | Real rerouting instead of shaping the full flow | A `<musk ceremony="lean"/>` marker in CONTEXT.md plus a "research not needed" RESEARCH.md, which trips plan-phase's `has_research` skip |
| 4 | **Milestone hook points** (`milestone:pre`, `roadmap:post`) | The milestone pass would not need detection heuristics | `musk milestone-check` at `discuss:pre` with a one-shot marker, plus the manual `/gsd-musk-roadmap` |
| 5 | **Harness token accounting** in SUMMARY/STATE (per-agent usage from the runtime, next to the chars/4 `actuals`) | Savings could be priced without reading transcripts, on every runtime | `musk calibrate` parses Claude Code transcripts; other runtimes use priors |
| 6 | **`execute:pre` call site** | A cheap last-chance subtraction right before execution | none |
| 7 | **Merge-small-plans guidance in core sizing**: context-budget.md and the planner only ever split | Core would stop producing 1-task plans in the first place | `plan:pre` guidance |
| 8 | **`plan:pre` in `/gsd-quick-batch`**: render and inject `into: planner` contributions into each item's planner, as `/gsd-quick` already does (`workflows/quick.md` step 5) | Batch items get the same planner rules as single quick tasks; today they get no capability guidance at all | none |
