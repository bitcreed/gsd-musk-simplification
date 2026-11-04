# musk — design and interface contract

A third-party GSD capability that adds a **subtraction pass** to GSD's planning loop, based on
Musk's five-step algorithm: (1) make requirements less dumb, (2) delete, (3) simplify,
(4) accelerate, (5) automate — in that order. It also steers GSD toward the **least ceremony**
that gets a phase done.

Every GSD mechanism pushes toward *more*: gap-analysis wants every REQ covered, nyquist fills
test gaps, planners add defensive code, flags, abstractions. Nothing asks "should this exist?"
This capability asks that question at every planning level where GSD exposes a hook, and it
records the answer so the savings can be measured.

## Where it acts (verified against gsd-core since 1.15)

| Level | Point / surface | Kind | What happens |
|---|---|---|---|
| Milestone | `discuss:pre` and the `plan:pre` safety net (gated by `musk.milestone_pass`; run when `milestone-check` reports `pass_due`) + manual `/gsd-musk-roadmap` | contribution → orchestrator, skill | Challenge every remaining phase and REQ of the milestone: delete, defer, merge. |
| Requirements | `discuss:pre` | contribution → orchestrator | Owner check: every REQ in the phase traces to a source (user, PROJECT.md, ADR). Ownerless → scope cut, recorded in CONTEXT.md as a `[deferred]` decision when CONTEXT.md is written. Ends with `musk pass --phase N` (a `pass` row, cuts or not). |
| Safety net | `plan:pre` | contribution → planner (first line of the planner rules; `plan:pre` has no orchestrator role) | `musk phase-check --phase N`: one line when the phase has a pass record; otherwise it prints the discuss:pre text so the planner runs the pass before it plans. Requirement cuts are only proposed here: the host read the phase's requirement IDs before the planner started and gives that list to the plan checker and the coverage gate (core seam 9). In `ask` mode every cut is only proposed. When the milestone pass is due, it first tells the planner to run `gsd-musk-roadmap auto`. Catches phases planned without discuss, or whose discuss never rendered hooks. |
| Phase ceremony | `discuss:pre` (gated by `musk.lean_lane`) | contribution → orchestrator | Small phase → lean lane: no gray-area questioning, a "research not needed" RESEARCH.md, one plan. |
| Implementation + plan count | `plan:pre` | contribution → planner | Add nothing without a source. Fewest plans (≤3 tasks → one). Log omissions. (Also reaches `/gsd-quick`'s planner; `/gsd-quick-batch` renders no hooks, see CORE-SEAMS #8.) |
| Commit | `execute:post` (phases and `/gsd-quick`) | step → command `musk commit` | Commit `.planning/musk/` through `gsd-tools query commit`, which applies `commit_docs`, so musk's files land in history when GSD commits its own. |
| Measurement | `verify:post` | step → command `musk record` | Snapshot the phase's measured cost, commit it, print one line (net, unreviewed inferred cuts, a due manual step). |
| Process (steps 4–5) | manual `/gsd-musk-retro` | skill | Add-back ratio, net savings, which gates/steps cost tokens and never caught anything → config suggestions. |

### Why not the places the original notes proposed

- `plan:post` → `checker` contribution: **dead letter.** `plan:post` fires after the
  checker/revision loop (plan-phase §13e), and no host injects `into: checker` anywhere.
- Deleting inside the planner: `gsd-planner.md` authority limits ("it gets planned. Period.")
  and plan-checker Dimension 7b (`simplified`/`minimal`/`stub`/`skip for now` = BLOCKER) fight
  it. So scope cuts are settled **before** planning as recorded decisions; the planner only
  gets *implementation* guidance that never reduces a sourced requirement.
- `verify:post` contribution: `verify:post` dispatches `step` only.
- A `D-NN: removed REQ-12` decision does **not** satisfy gap-analysis/verifier. A scope cut must
  move the REQ out of the phase (ROADMAP `Requirements:` line + REQUIREMENTS.md v2/Out of Scope).
- Third-party `agents[]` are never staged, so all LLM work runs through skills or host roles.

### Left out on purpose

No `discuss:post` fragment (the discuss:pre text already governs the CONTEXT.md
write), the `plan:post` `musk-audit` skill step (a skill load plus tool calls every phase to fix
what the planner rule prevents; `/gsd-musk-retro` reports tiny plans via `musk audit` instead),
and no `advise` ceremony mode. The milestone and lean-lane text are separate contributions
gated by config, so a disabled branch costs nothing, and the `verify:post` step prints one line
instead of the stats JSON. musk applied to itself cut its injected text from 6.1k to 3.6k chars
per phase.

## Rules the prompt surfaces encode

1. **Two classes of cut.** *Scope* (drop/defer a REQ, phase, or success criterion) follows
   `musk.scope_cuts`: `defer` (default: apply reversibly, mark inferred, never delete text),
   `propose` (write proposals, change nothing), `ask` (ask the user). *Implementation*
   (fewer tasks/files/layers/deps/flags/abstractions not demanded by any source) is always
   applied — it never removes a sourced requirement.
2. **Recorded, never silent.** Every cut → one ledger row via `gsd-tools musk log`.
3. **Never cut:** threat-model / security mitigations, locked decisions (`D-NN` in CONTEXT.md
   the user made), tests that guard behaviour that remains, corrections to docs that have become
   wrong, contract or registry entries for new entry points, api-coverage rows (emit `OPT-OUT`
   with reason instead), anything the user explicitly asked for in this milestone.
4. **Order:** delete before simplify. Never optimise what should have been deleted.
5. **Add-back:** a reinstated cut is logged with `musk reinstate`. ~10% add-back is healthy;
   0% means the pass is too timid, >30% too aggressive.
6. **Budget:** the pass must cost less than it removes. Fragments stay short; `musk stats`
   reports net = gross − pass cost.

## Config keys

Declared with types in `capability.json`; what each does is in the README's *Configure* table.

## Data files (in the project)

**Location.** musk state (ledger, calibration, `MILESTONE-*`/`RETRO-*` markers) lives once per project, in the MAIN checkout's `.planning/musk/`: the parent of `git rev-parse --git-common-dir`, when that dir has a `.planning/`. gsd-tools only remaps a linked worktree to the main checkout when the worktree has no `.planning/`; a worktree with a committed `.planning/` would otherwise read a stale ledger and write rows that are lost when it is reaped. Planning reads (ROADMAP, STATE, phases, config) follow the checkout the command runs in and `GSD_WORKSTREAM` (`.planning/workstreams/<ws>/`, its config.json over the root one). A workstream ROADMAP.md that names one milestone and has no 🚧 marker owns all its phases.

- `.planning/musk/ledger.jsonl` — one JSON object per line, append-only. Rows:
  ```json
  {"id":"M-0007","ts":"2026-09-29T14:00:00Z","type":"cut","class":"scope|impl|ceremony",
   "unit":"<unit>","ref":"REQ-12","reason":"no owner; inferred by researcher",
   "phase":"3","point":"discuss:pre","status":"applied|proposed|rejected","qty":1,"inferred":true}
  {"id":"M-0007","ts":"...","type":"reinstate","reason":"needed for export"}
  {"ts":"...","type":"pass","phase":"3","point":"discuss:pre|plan:pre"}
  {"ts":"...","type":"snapshot","phase":"3", ...measured + estimated numbers...}
  ```
  `unit` vocabulary:
  - scope: `milestone-phase`, `req`, `criterion`, `feature`
  - impl: `task`, `file`, `dep`, `flag`, `abstraction`, `layer`, `test`, `doc`
  - ceremony: `lean-lane`, `reroute-quick`, `reroute-fast`, `plan-merge`, `phase-merge`, `step-skip`
  `qty` (default 1) lets one row stand for several identical units (e.g. 3 tasks).
- `.planning/musk/calibration.json` — written by `musk calibrate` (see below).
- `.planning/musk/MILESTONE-<slug>.md` — one-shot marker + report of the milestone pass.

## Command family: `gsd-tools musk <sub>`

Router: `musk-router.cjs`, export `routeMuskCommand({ args, cwd, raw, error, deps })`, where
`args[0] === 'musk'`, `args[1]` is the subcommand. Pure CommonJS, Node ≥ 20, zero dependencies.
All output is plain text unless `--json` (or `raw`) is given, then a single JSON document.

| Sub | Args | Effect |
|---|---|---|
| `log` | `--class --unit --ref --reason [--phase] [--point] [--status applied] [--qty 1] [--inferred]` | Append a cut row; print its id. Validates class/unit vocabulary. |
| `reinstate` | `<id> --reason` | Append a reinstate row. |
| `confirm` | `<id>... [--reason]` | Append a confirm row per id: a cut applied without approval (`inferred`) is reviewed and kept. `list` shows `confirmed` and `unreviewed`; the ledger is never rewritten. |
| `list` | `[--phase N] [--class C] [--json]` | Current state of cuts (reinstated ones marked). |
| `pass` | `--phase N [--point discuss:pre]` | Append a `pass` row: the per-phase pass ran for N. |
| `phase-check` | `--phase N [--json]` | `recorded` when the ledger has a pass row for N (or, for older ledgers, a discuss:pre cut or lean-lane row), or N's CONTEXT.md mentions musk. Otherwise prints the discuss:pre fragment and the `pass` command to finish with. Non-numeric phase or `musk.enabled: false` → no-op. |
| `milestone-check` | `[--json]` | `{milestone, phases, phases_started, first_of_milestone, marker, marker_exists, run, config}` — `config` holds the `musk.*` settings in effect (project over defaults), so skills never look them up separately. `run` is true when no phase of the current milestone has a CONTEXT.md or PLAN.md and the marker does not exist. |
| `audit` | `--phase N [--json]` | Deterministic plan metrics for the phase: plans, tasks per plan, waves, files per plan, `merge_candidates` (groups whose combined task count ≤ 3, same wave or linear chain, disjoint-or-overlapping files), `total_tasks`, `quick_eligible` (total_tasks ≤ 3 and one plan's worth). |
| `calibrate` | `[--since <ISO>] [--json]` | Read Claude Code transcripts for this project only; write `calibration.json`. |
| `stats` | `[--phase N] [--json] [--record]` | Report counts, add-back ratio, estimated gross savings (p25/p50/p75), pass cost, net. `--record` appends a `snapshot` row. |
| `record` | | The `verify:post` step: refresh calibration, append a `snapshot` row, commit `.planning/musk/`, print one line. Same as `stats --record` (manifest commands may not carry flags). |
| `commit` | `[--message]` | The `execute:post` step: commit `.planning/musk/` through `gsd-tools query commit`. Skips when the invoking checkout sets `commit_docs: false`. |

### Calibration (Claude Code runtime)

- Transcript dir: `~/.claude/projects/<slug>/` where slug = absolute project path with every
  non-alphanumeric char replaced by `-`. This project's dir is read, plus the dirs of Claude Code
  worktrees under it (`<slug>--claude-worktrees-*`), which Claude Code files separately. The slug
  is lossy (`/a/.claude/worktrees/x` and `/a--claude-worktrees-x` share it), so a session counts
  only when its recorded `cwd` is in the project (own dir) or under `<project>/.claude/worktrees/`
  (worktree dirs). Other runtimes →
  `calibration.json` with `basis: "none"`, stats fall back to priors.
- Tokens per assistant message = `input_tokens + cache_creation_input_tokens + output_tokens`;
  `cache_read_input_tokens` reported separately (it is cheap, never mixed into the headline).
  Dedupe streamed chunks by `message.id`, within a file and across files (history copied by a
  resume or fork): the most complete usage wins, the first copy keeps its attribution.
- Attribute subagent transcripts (`<session>/subagents/agent-<id>.jsonl`, linked from the
  parent's `Agent` tool_use / tool_result) to `subagent_type` and — by parsing the spawn prompt —
  to phase (`phases/<NN>-…`) and plan (`<NN>-<PP>-PLAN.md`).
- Attribute main-session tokens to the GSD command in effect (`<command-name>/gsd-…` user
  messages or a `Skill` call), to catch orchestrator cost per phase. A musk run is bounded: it
  ends after its `musk commit` call, or at a human message whose reply does no musk work (no
  `gsd-tools musk`, `gsd_run musk` or `"$GSD_TOOLS" musk` call, nothing written under
  `.planning/musk/`). Task notifications and compaction summaries are not human messages. The
  interrupted command then resumes (a musk skill invoked inside a command keeps its phase), so
  host work after a musk run is not charged to musk. A non-musk skill the run invokes
  (`/gsd-phase`, `/gsd-capture`: applying a cut) stays in the run.
- Ownership follows the spawn graph, whatever the agent's role or its prompt says: agents spawned
  during a musk run, and their children, are charged to it, also when a `gsd-*` agent invoked the
  musk skill. A quick task is one sample: the `/gsd-quick` segment plus every agent spawned inside
  it, down to grandchildren, whatever quick id their prompts carry.
- Derived prices (only when n ≥ 5 samples in this project, else `null`):
  `per_task`, `per_plan_overhead` (least-squares fit of executor tokens = a + b·tasks),
  `per_phase` (all attributed tokens of a phase), `per_quick_task`, `per_req`
  (per_phase / reqs in phase), each as `{p25,p50,p75,n}`.
- Priors (used when a price is `null`, always labelled `basis: "prior"`; rounded pooled p50s from 14 real GSD projects, see [stats.md](stats.md)): per_task 110k,
  per_plan_overhead 60k (not separable in real data yet), per_phase 7M, per_quick_task 450k, per_req 1M. These are rough
  and exist only so a fresh project shows an order of magnitude.

### Pricing a cut

| Unit | Price |
|---|---|
| `task`, `test`, `doc`, `file`, `flag`, `abstraction`, `layer`, `dep` | `per_task × qty` (a file/flag/layer/dep counted as one task's worth unless the row gives `qty`) |
| `req`, `feature` (scope) | `per_req × qty` |
| `feature` logged at `plan:pre` | `per_task × qty`: a left-out feature is about a task of work |
| `criterion` | `per_phase × 0.08 × qty`: median 5 criteria per phase × executors' ~40% share; the phase's fixed ceremony stays |
| `milestone-phase`, `phase-merge` | `per_phase × qty` (phase-merge saves one phase's overhead: use `per_phase × 0.35`) |
| `plan-merge` | `per_plan_overhead × qty` |
| `lean-lane` | `per_phase` × 0.06 (the researcher and pattern mapper it skips; older `reroute-quick` rows with reason `lean` are priced the same) |
| `reroute-quick` | `per_phase` p25/p50/p75 − `per_quick_task` p75/p50/p25 (floor 0, so the range stays ordered) |
| `reroute-fast` | `per_phase` − 20k |
| `step-skip` | `null` (reported as a count) |

Only `status: applied` and not-reinstated cuts count toward savings; proposed cuts are shown
separately as "potential". A reinstated cut's price is subtracted from gross and counted in the
add-back ratio (`reinstated / applied`).

**Pass cost** = Σ fragment tokens (chars/4) × the runs each fragment was injected into, plus
measured tokens of `musk-*` skill runs where attributable. A discuss or planner run counts when a
musk fragment tag (`<musk>`, `<musk_lean>`, `<musk_milestone>`) appears in its transcript, and
only the fragments whose tags appear are charged, so runs from before musk was installed and
fragments whose `when` was off cost nothing. A run copied into several transcripts (resume, fork)
counts once. The ledger fills in where transcripts are missing: one discuss run per `pass` row
(or per phase with discuss-point cuts and no pass row), one plan run per phase with plan-point
rows. Per phase the larger count wins. Calibrations written before 0.5.4 have no tags; for those,
runs before the first ledger row are ignored.
Net = gross − pass cost. Every number carries its `basis` (`harness` | `prior`) and `n`.

## Known limitations

- **Workstream identity.** Pass rows match a phase by number and milestone markers by version or
  name, without the workstream. Two workstreams that reuse a phase number or a milestone version
  share them. Projects seen so far number phases across workstreams, so this has not happened.
- **Roadmap formats.** Bracketed phase ids (`[DEMO.01] 01`) and requirement lists continued on the
  lines below `**Requirements**:` are not parsed. Such phases get no pass detection or phase
  attribution, and per-requirement prices use a smaller denominator.
- **Phase-level `commit_docs`.** `musk commit` honours `commit_docs: false` in the checkout's and the
  workstream's config, not a phase-level override, because `.planning/musk/` carries no phase.
