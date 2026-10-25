# Feature: `milestone:pre` / `milestone:post` loop points

*Draft for open-gsd/gsd-core, feature_request template. Not filed yet.*

**Type:** new hook point · **Area:** capability loop · **Runtimes:** all

## The solo developer problem

Capabilities that act once per milestone (a scope pass before work starts, a retrospective
before archiving) have no hook. They have to guess milestone boundaries from phase hooks: the
first `discuss:pre` with no started phase, or the `verify:post` of what looks like the last phase.
Both guesses are fragile. Roadmap formats vary, and `verify:post` doesn't always run (see the
companion bug). In four weeks of use on 10 projects, one project completed five milestones
without the end-of-milestone reminder firing once.

## What this feature adds

- `milestone:pre`: dispatched by `/gsd-new-milestone` after the roadmap is written, before the
  first phase.
- `milestone:post`: dispatched by `/gsd-complete-milestone` before archiving, so a capability can
  still read the milestone's phase artifacts.

Both accept `step` and `contribution` (into the orchestrator), like `discuss:pre`.

## Full scope of changes

- loop point registry and `getWiredKinds`
- render and dispatch blocks in `new-milestone.md` and `complete-milestone.md`
- capability docs and tests

## Acceptance criteria

- A capability step at `milestone:post` runs exactly once per `/gsd-complete-milestone`,
  before the phase directories are archived.
- A capability step at `milestone:pre` runs once per `/gsd-new-milestone`, after ROADMAP.md is
  written.
- Existing capabilities are unaffected.

## Breaking changes

None; additive.

## Maintenance burden

Two render/dispatch blocks following the existing pattern.

## Alternatives considered

Detection heuristics at `discuss:pre` and `verify:post`. In practice these missed most milestone
ends (above).

## Prior art

The musk capability (https://github.com/bitcreed/gsd-musk-simplification), `CORE-SEAMS.md` #4.
