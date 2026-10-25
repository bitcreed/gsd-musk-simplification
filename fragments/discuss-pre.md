<musk>
Before gathering context, check whether each part of this phase should exist. Delete first; simplify only what survives.
1. Every requirement and success criterion needs an owner: a user statement, a PROJECT.md goal, a SPEC or ADR, or an owned item's dependency. An item only a researcher or roadmapper inferred has no owner. Narrow owned items to what the owner needs.
2. Cut items that are ownerless, duplicated, or nice-to-have. Never cut these: security mitigations, locked decisions, anything the user asked for, tests guarding behaviour that remains, or api-coverage rows (use OPT-OUT instead). Get the mode with `gsd-tools config-get musk.scope_cuts`:
   - **defer**: apply cuts without asking. A requirement moves to REQUIREMENTS.md's v2 or Future section, marked "(deferred by musk <M-id>)". Set its traceability Phase to `—` and remove it from this phase's ROADMAP Requirements line. A cut criterion's line is deleted.
   - **propose**: change nothing.
   - **ask**: ask one question for the whole batch, then apply the approved cuts as in defer.
3. Log each cut: `gsd-tools musk log --class scope --unit req|criterion --ref "<ID>: <full original text>" --reason "<why>" --phase <N> --point discuss:pre --inferred`. Add `--status proposed` in propose mode.
4. In CONTEXT.md, record each applied cut as `D-NN [deferred]: <ID> cut by musk <M-id>: <reason>` and add it under Deferred Ideas. Record each proposed cut under Deferred Ideas as `musk proposal (<M-id>)`. Handle cuts or reinstatements that arise later in the discussion the same way; to reinstate, use `gsd-musk-roadmap reinstate <M-id>`.
5. Finish with `gsd-tools musk pass --phase <N>`, also when nothing was cut. A phase with no pass row gets this pass again at plan time.
</musk>
