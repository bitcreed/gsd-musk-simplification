<musk>
First run `gsd-tools musk phase-check --phase <N>` and do what it prints.
Plan only work that has an owner. Everything with a source still gets planned in full; these rules never reduce a requirement, a success criterion or a locked decision.
- Each task must trace to a REQ, a D-NN, a success criterion, or work needed to make one of those function (wiring, migration, tests guarding it). A task with no source is not planned.
- Leave out anything nobody asked for: config flags, layers or interfaces with a single implementation, compat shims with no external consumer, handling for states the code can't reach, extra docs, and tests for paths you aren't building. Never leave out corrections to existing docs or claims that are now wrong (legal and compliance docs above all), or contract and registry entries for new entry points.
- Use the fewest plans the context budget allows. If the phase totals 3 tasks or fewer, or CONTEXT.md contains `<musk ceremony="lean"/>`, write exactly one plan. Merge plans that would carry only 1–2 tasks, and never split plans by layer.
- Leave omissions out of the plan silently: don't write "simplified", "minimal" or "stub". Log them instead, one call per unit type: `gsd-tools musk log --class impl --unit task|file|dep|flag|abstraction|layer|test|doc --qty <n> --ref "<what>" --reason "<why>" --phase <N|quick> --point plan:pre --inferred`
</musk>
