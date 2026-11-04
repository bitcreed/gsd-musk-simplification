<musk_lean>
**Lean lane.** Use it when, after cuts, the phase is 3 tasks or fewer in one subsystem, adds no new dependency, and leaves no question only the user can answer. In that case:
- Skip the gray-area questions. Write CONTEXT.md from the roadmap, the prior decisions and your scout, tagging your guesses `[inferred]`, and add `<musk ceremony="lean"/>`.
- So planning skips the researcher and pattern mapper, also write `<padded>-RESEARCH.md` (one section, "Research not needed (musk lean lane)"), `<padded>-PATTERNS.md` (a `## File Classification` table: each file to change, its closest existing analog) and `<padded>-VALIDATION.md` (frontmatter `phase`, `slug`, `status: draft`, `nyquist_compliant: false`, `wave_0_complete: false`, `created`; then the quick and full test commands).
- Log it: `gsd-tools musk log --class ceremony --unit lean-lane --ref "phase <N>" --reason lean --phase <N>`.
</musk_lean>
