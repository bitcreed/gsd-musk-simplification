'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, run } = require('./helpers.cjs');
const { parseFrontmatter, normPhase } = require('../lib/planning.cjs');

test('milestone-check: false once a phase of the milestone has CONTEXT/PLAN', () => {
  const r = run(setup('proj'), ['milestone-check']);
  assert.equal(r.milestone, 'v1.1 Lean');
  assert.deepEqual(r.phases, ['3', '4', '5']);
  assert.deepEqual(r.phases_started, ['3', '4']);
  assert.equal(r.first_of_milestone, false);
  assert.equal(r.run, false);
  assert.equal(r.marker, path.join('.planning', 'musk', 'MILESTONE-v1.1.md'));
});

test('milestone-check: true on a fresh milestone, false once the marker exists', () => {
  const ctx = setup('fresh');
  const r = run(ctx, ['milestone-check']);
  assert.deepEqual(r.phases_started, []);
  assert.equal(r.first_of_milestone, true);
  assert.equal(r.marker_exists, false);
  assert.equal(r.run, true);
  fs.mkdirSync(path.join(ctx.cwd, '.planning/musk'), { recursive: true });
  fs.writeFileSync(path.join(ctx.cwd, r.marker), '# done\n');
  const again = run(ctx, ['milestone-check']);
  assert.equal(again.marker_exists, true);
  assert.equal(again.first_of_milestone, true);
  assert.equal(again.run, false);
});

test('milestone-check never throws without a ROADMAP', () => {
  const ctx = setup('fresh');
  fs.rmSync(path.join(ctx.cwd, '.planning/ROADMAP.md'));
  const r = run(ctx, ['milestone-check']);
  assert.equal(r.run, false);
  assert.ok(r.notes.length);
});

test('audit: linear chain merge + quick_eligible', () => {
  const r = run(setup(), ['audit', '--phase', '4']);
  assert.equal(r.plans, 3);
  assert.equal(r.total_tasks, 3);
  assert.equal(r.waves, 3);
  assert.deepEqual(r.merge_candidates, [{ plans: ['4-01', '4-02', '4-03'], tasks: 3, reason: 'linear-chain', files_overlap: true }]);
  assert.equal(r.quick_eligible, true);
});

test('audit: same-wave merge; large phase not quick-eligible', () => {
  const r = run(setup(), ['audit', '--phase', '03']);
  assert.equal(r.plans, 4);
  assert.equal(r.total_tasks, 8);
  assert.deepEqual(r.per_plan.map((p) => p.tasks), [2, 1, 3, 2]);
  assert.deepEqual(r.merge_candidates, [{ plans: ['3-02', '3-04'], tasks: 3, reason: 'same-wave', files_overlap: true }]);
  assert.equal(r.quick_eligible, false);
});

test('audit: unplanned phase reports zero plans and null quick_eligible', () => {
  const r = run(setup(), ['audit', '--phase', '5']);
  assert.equal(r.plans, 0);
  assert.equal(r.quick_eligible, null);
  assert.throws(() => run(setup(), ['audit']), /--phase/);
});

test('frontmatter: inline, quoted and block lists, nested map', () => {
  const fm = parseFrontmatter('---\nwave: 2\ndepends_on: ["07.1-01", 07.1-02]\nfiles_modified:\n  - a.py\n  - "b.py"\nestimate:\n  tasks: 3\n---\n');
  assert.equal(fm.wave, 2);
  assert.deepEqual(fm.depends_on, ['07.1-01', '07.1-02']);
  assert.deepEqual(fm.files_modified, ['a.py', 'b.py']);
  assert.equal(fm.estimate.tasks, 3);
  assert.equal(normPhase('07.1'), '7.1');
  assert.equal(normPhase('Python'), null);
});

test('muskConfig: project keys (nested or flat) over capability.json defaults', () => {
  const { muskConfig } = require('../lib/config.cjs');
  const ctx = setup('proj');
  const deps = { fs, capRoot: path.join(__dirname, '..') };
  const planDir = path.join(ctx.cwd, '.planning');
  fs.writeFileSync(path.join(planDir, 'config.json'), '{}');
  assert.deepEqual(muskConfig(deps, planDir), { enabled: true, scope_cuts: 'defer', lean_lane: true, milestone_pass: true });
  fs.writeFileSync(path.join(planDir, 'config.json'), JSON.stringify({ musk: { scope_cuts: 'ask' }, 'musk.lean_lane': false }));
  assert.deepEqual(muskConfig(deps, planDir), { enabled: true, scope_cuts: 'ask', lean_lane: false, milestone_pass: true });
});

test('milestone-check: bold current-milestone line lists phases; a roadmap without milestones is one', () => {
  const ctx = setup('proj');
  const rm = path.join(ctx.cwd, '.planning/ROADMAP.md');
  const st = path.join(ctx.cwd, '.planning/STATE.md');
  fs.writeFileSync(st, '---\nmilestone: v0.12\n---\n');
  fs.writeFileSync(rm, '# App — Roadmap\n\n## Current Milestone\n\n**v0.12 — Routines** (phases 3-4, 4.1; more 5-5 added 2026-10-01; phase 6 added; Milestone 9 aside)\n\n### Phase 3: A\n### Phase 4: B\n### Phase 4.1: C\n### Phase 5: D\n### Phase 6: E\n### Phase 9: F\n');
  assert.deepEqual(run(ctx, ['milestone-check']).phases, ['3', '4', '4.1', '5', '6']);
  fs.writeFileSync(st, '');
  fs.writeFileSync(rm, '# Roadmap: tool\n\n### Phase 1: A\n### Phase 2: B\n');
  const r = run(ctx, ['milestone-check']);
  assert.deepEqual(r.phases, ['1', '2', '3', '4', '5']); // roadmap phases plus the fixture's phase dirs
  assert.match(r.marker, /MILESTONE-tool\.md$/);
});
