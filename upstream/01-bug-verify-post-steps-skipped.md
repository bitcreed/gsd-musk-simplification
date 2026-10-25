# Bug: `verify:post` step hooks run for only a fraction of verified phases

*Draft for open-gsd/gsd-core, bug_report template. Not filed yet.*

**GSD version:** 1.18.0 · **Runtime:** Claude Code · **OS:** Linux · **Node:** 24.21.0 · **Install:** global

## What happened?

A third-party capability declares one `verify:post` step (`ref.command`, `when` = its activation
key, `onError: skip`). The step appends one snapshot row to a ledger each time it runs, so how
often it ran can be counted after the fact. Over four weeks on two projects with musk enabled
throughout:

| Project | Phases verified (VERIFICATION.md written) | Step ran |
| --- | --- | --- |
| A | 24 | 3 (12%) |
| B | 40 | 20 (50%) |

In project A, five milestones were completed without the step running for any milestone's last phase.

## What did you expect?

Every active `verify:post` step hook runs once for each phase verification, whichever entry point
produced the VERIFICATION.md.

## Steps to reproduce

1. Install a capability with a `verify:post` step whose command appends a line to a file.
2. Verify phases through each entry point: `/gsd-execute-phase` (verify-phase-goal step),
   `/gsd-verify-work`, `/gsd-autonomous`, `/gsd-validate-phase`.
3. Compare the number of VERIFICATION.md files with the number of appended lines.

## Suspected causes (unconfirmed)

- `verify:post` is rendered in several workflows (`execute-phase/steps/verify-phase-goal.md:45`,
  `verify-work.md:601`, `autonomous.md:540`, `validate-phase.md:38`, `secure-phase.md:38`,
  `audit-milestone.md:167`). Dispatching step hooks is left to the orchestrating model, which
  skips it, especially late in long autonomous runs.
- `autonomous.md` and `verify-work.md` render with `--after-fingerprint`. If the fingerprint
  matches an earlier render, the hooks may be suppressed for a phase that was never dispatched.

## Impact

Capabilities that measure or remind at phase end can't rely on `verify:post`. Silent: nothing
reports that a hook was skipped.

## Workaround

None that's reliable. The capability duplicates detection at `discuss:pre`.

## Suggested fix

Have `loop render-hooks` record dispatch (or have the step runner confirm completion), and
let `/gsd-health` report rendered-but-undispatched step hooks.
