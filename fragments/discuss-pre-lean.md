<musk_lean>
**Lean lane.** Use it when, after cuts, the phase is 3 tasks or fewer in one subsystem, adds no new dependency, and leaves no question only the user can answer. In that case:
- Skip the gray-area questions. Write CONTEXT.md from the roadmap, the prior decisions and your scout, tagging your guesses `[inferred]`, and add `<musk ceremony="lean"/>`.
- Write `<padded>-RESEARCH.md` with a single section, "Research not needed (musk lean lane)", listing the patterns and files to reuse. This file lets planning skip the researcher.
- Log it: `gsd-tools musk log --class ceremony --unit reroute-quick --ref "phase <N>" --reason lean --phase <N>`.
</musk_lean>
