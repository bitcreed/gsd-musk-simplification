'use strict';

// musk must catch every phase and keep its state in one place: a pass marker per phase, a
// plan:pre safety net, ledger writes resolved to the main checkout from a linked git worktree,
// and planning reads that follow GSD_WORKSTREAM.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setup, run } = require('./helpers.cjs');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const ledgerOf = (dir) => {
  try { return fs.readFileSync(path.join(dir, '.planning/musk/ledger.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; }
};

// A git repo of the fixture project with one committed ledger row, plus a linked worktree.
function repoWithWorktree() {
  const ctx = setup('proj');
  git(ctx.cwd, 'init', '-q');
  git(ctx.cwd, 'config', 'user.email', 't@t');
  git(ctx.cwd, 'config', 'user.name', 't');
  run(ctx, ['pass', '--phase', '3']);
  git(ctx.cwd, 'add', '-A');
  git(ctx.cwd, 'commit', '-qm', 'init');
  const wt = path.join(ctx.tmp, 'wt');
  git(ctx.cwd, 'worktree', 'add', '-q', wt);
  return { ctx, wt };
}

test('phase-check: no record -> prints the pass; pass row -> recorded', () => {
  const ctx = setup('proj');
  const miss = run(ctx, ['phase-check', '--phase', '4']);
  assert.equal(miss.recorded, false);
  assert.equal(miss.action, 'run-pass');
  assert.match(miss.instructions, /no subtraction pass recorded for phase 4/);
  assert.match(miss.instructions, /d{20}/); // the discuss:pre fragment text rides along
  assert.match(miss.instructions, /musk pass --phase 4 --point plan:pre/);

  const row = run(ctx, ['pass', '--phase', '04', '--point', 'plan:pre']);
  assert.deepEqual([row.type, row.phase, row.point], ['pass', '4', 'plan:pre']);
  const hit = run(ctx, ['phase-check', '--phase', '4']);
  assert.equal(hit.recorded, true);
  assert.equal(hit.evidence, 'ledger');
  assert.equal(run(ctx, ['phase-check', '--phase', '4'], { json: false }).trim(), 'musk: pass recorded for phase 4');
});

test('phase-check: older evidence counts (discuss:pre cut, lean reroute, musk in CONTEXT.md)', () => {
  const ctx = setup('proj');
  run(ctx, ['log', '--class', 'scope', '--unit', 'req', '--ref', 'R-1', '--reason', 'x', '--phase', '4', '--point', 'discuss:pre']);
  assert.equal(run(ctx, ['phase-check', '--phase', '4']).recorded, true);
  run(ctx, ['log', '--class', 'ceremony', '--unit', 'reroute-quick', '--ref', 'phase 5', '--reason', 'lean', '--phase', '5']);
  assert.equal(run(ctx, ['phase-check', '--phase', '5']).recorded, true);
  // a plan:pre implementation cut is not evidence of the discuss pass
  run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--ref', 'T', '--reason', 'x', '--phase', '3', '--point', 'plan:pre']);
  assert.equal(run(ctx, ['phase-check', '--phase', '3']).recorded, false);
  fs.appendFileSync(path.join(ctx.cwd, '.planning/phases/03-alpha/03-CONTEXT.md'), '\nD-09 [deferred]: R-2 cut by musk M-0009\n');
  const r = run(ctx, ['phase-check', '--phase', '3']);
  assert.equal(r.recorded, true);
  assert.equal(r.evidence, 'context');
});

test('phase-check: quick tasks and opted-out projects are a no-op', () => {
  const ctx = setup('proj');
  assert.equal(run(ctx, ['phase-check', '--phase', 'quick']).action, 'none');
  fs.writeFileSync(path.join(ctx.cwd, '.planning/config.json'), JSON.stringify({ musk: { enabled: false } }));
  assert.equal(run(ctx, ['phase-check', '--phase', '4'], { json: false }).trim(), 'musk: disabled');
  assert.throws(() => run(ctx, ['pass']), /--phase/);
});

test('worktree: ledger writes and reads go to the main checkout, not the stale committed copy', () => {
  const { ctx, wt } = repoWithWorktree();
  // main checkout moves on with an uncommitted row the worktree cannot see in its own tree
  run(ctx, ['pass', '--phase', '4']);
  assert.equal(ledgerOf(wt).length, 1);

  assert.equal(run(ctx, ['phase-check', '--phase', '4'], { cwd: wt }).recorded, true);
  const cut = run(ctx, ['log', '--class', 'scope', '--unit', 'req', '--ref', 'R-1', '--reason', 'x', '--phase', '5', '--point', 'discuss:pre'], { cwd: wt });
  assert.equal(cut.id, 'M-0001');
  assert.equal(ledgerOf(ctx.cwd).length, 3);
  assert.equal(ledgerOf(wt).length, 1, 'the worktree copy is never written');

  const mc = run(ctx, ['milestone-check'], { cwd: wt });
  assert.equal(mc.marker, path.join(ctx.cwd, '.planning/musk/MILESTONE-v1.1.md'));
  assert.equal(run(ctx, ['milestone-check']).marker, path.join('.planning', 'musk', 'MILESTONE-v1.1.md'));
});

test('worktree: falls back to the checkout itself outside git or when main has no .planning', () => {
  const ctx = setup('proj');
  run(ctx, ['pass', '--phase', '3']);
  assert.equal(ledgerOf(ctx.cwd).length, 1);
});

test('workstream: planning reads follow GSD_WORKSTREAM, state stays at the project root', () => {
  const ctx = setup('proj');
  const ws = path.join(ctx.cwd, '.planning/workstreams/w1');
  fs.mkdirSync(ws, { recursive: true });
  for (const f of ['ROADMAP.md', 'STATE.md', 'phases']) fs.renameSync(path.join(ctx.cwd, '.planning', f), path.join(ws, f));
  fs.writeFileSync(path.join(ctx.cwd, '.planning/ROADMAP.md'), '# Roadmap\n');
  const env = { GSD_WORKSTREAM: 'w1' };

  const mc = run(ctx, ['milestone-check'], { env });
  assert.equal(mc.milestone, 'v1.1 Lean');
  assert.deepEqual(mc.phases, ['3', '4', '5']);
  assert.equal(run(ctx, ['milestone-check']).phases.length, 0);

  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ 'musk.scope_cuts': 'ask' }));
  fs.writeFileSync(path.join(ctx.cwd, '.planning/config.json'), JSON.stringify({ musk: { scope_cuts: 'propose', lean_lane: false } }));
  const cfg = run(ctx, ['milestone-check'], { env }).config;
  assert.equal(cfg.scope_cuts, 'ask');
  assert.equal(cfg.lean_lane, false);

  run(ctx, ['pass', '--phase', '3'], { env });
  assert.equal(ledgerOf(ctx.cwd).length, 1);
  assert.equal(run(ctx, ['audit', '--phase', '3'], { env }).plans, 4);
});

test('workstream: a single-milestone ROADMAP without a 🚧 marker owns all its phases', () => {
  const ctx = setup('fresh');
  const ws = path.join(ctx.cwd, '.planning/workstreams/w2');
  fs.mkdirSync(ws, { recursive: true });
  fs.writeFileSync(path.join(ws, 'ROADMAP.md'), '# Roadmap\n\n## v2.0 — Voice\n\n## Phases\n\n- [ ] **Phase 6: A** - x\n- [ ] **Phase 7: B** - added mid-milestone (v1.9 left it out)\n');
  fs.writeFileSync(path.join(ws, 'STATE.md'), '---\nmilestone: v2.0\n---\n');
  const r = run(ctx, ['milestone-check'], { env: { GSD_WORKSTREAM: 'w2' } });
  assert.equal(r.milestone, 'v2.0');
  assert.deepEqual(r.phases, ['6', '7']);
  assert.equal(r.run, true);
});
