'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, run } = require('./helpers.cjs');
const { priceCut, effectivePrices, PRIORS: P } = require('../lib/pricing.cjs');

test('pricing table', () => {
  const p = effectivePrices(null); // priors
  assert.equal(priceCut({ unit: 'flag', qty: 2 }, p).p50, 2 * P.per_task);
  assert.equal(priceCut({ unit: 'criterion' }, p).p50, Math.round(P.per_phase * 0.08));
  assert.equal(priceCut({ unit: 'feature', point: 'plan:pre' }, p).p50, P.per_task);
  assert.equal(priceCut({ unit: 'feature', point: 'discuss:pre' }, p).p50, P.per_req);
  assert.equal(priceCut({ unit: 'milestone-phase' }, p).p50, P.per_phase);
  assert.equal(priceCut({ unit: 'phase-merge' }, p).p50, P.per_phase * 0.35);
  assert.equal(priceCut({ unit: 'plan-merge' }, p).p50, P.per_plan_overhead);
  assert.equal(priceCut({ unit: 'reroute-quick' }, p).p50, P.per_phase - P.per_quick_task);
  assert.equal(priceCut({ unit: 'reroute-fast' }, p).p50, P.per_phase - 20000);
  assert.equal(priceCut({ unit: 'step-skip' }, p), null);
  assert.equal(priceCut({ unit: 'task' }, p).basis, 'prior');
});

test('stats: net = gross − pass cost; mixed bases label prior; proposed is potential only', () => {
  const ctx = setup('proj', { transcripts: true });
  run(ctx, ['calibrate']);
  run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--qty', '2', '--ref', 'T', '--reason', 'r', '--phase', '3', '--point', 'plan:pre']);
  run(ctx, ['log', '--class', 'scope', '--unit', 'req', '--ref', 'ALP-02', '--reason', 'r', '--phase', '3', '--point', 'discuss:pre']);
  run(ctx, ['log', '--class', 'ceremony', '--unit', 'step-skip', '--ref', 'research', '--reason', 'r', '--phase', '3']);
  run(ctx, ['log', '--class', 'impl', '--unit', 'dep', '--ref', 'lodash', '--reason', 'r', '--phase', '3', '--status', 'proposed']);

  const s = run(ctx, ['stats', '--phase', '3']);
  // per_task is harness (30k from the fit), per_req is a prior
  assert.equal(s.gross.p50, 2 * 30000 + P.per_req);
  assert.equal(s.gross.basis, 'prior');
  assert.equal(s.unpriced, 1);
  assert.equal(s.potential.p50, 30000);
  // fragments: discuss 400 chars = 100 tokens, plan 200 chars = 50 tokens, one run each (from the
  // ledger; transcript runs predate the first ledger row) + the musk-audit skill segment (3000)
  assert.deepEqual(s.pass_cost.injections, { discuss: 1, plan: 1 });
  assert.equal(s.pass_cost.fragment_tokens, 150);
  assert.equal(s.pass_cost.skill_tokens, 3000);
  assert.equal(s.pass_cost.tokens, 3150);
  for (const q of ['p25', 'p50', 'p75']) assert.equal(s.net[q], s.gross[q] - s.pass_cost.tokens);
  assert.match(run(ctx, ['stats', '--phase', '3'], { json: false }), /^net: p25 \S+ \/ p50 \S+ \/ p75 \S+ \(prior, n=2\)$/m);
});

test('stats: reinstated cut is subtracted from gross', () => {
  const ctx = setup('proj');
  run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--ref', 'A', '--reason', 'r']);
  run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--ref', 'B', '--reason', 'r']);
  run(ctx, ['reinstate', 'M-0001', '--reason', 'needed']);
  const s = run(ctx, ['stats']);
  assert.equal(s.gross_applied.p50, 2 * P.per_task);
  assert.equal(s.reinstated_value.p50, P.per_task);
  assert.equal(s.gross.p50, P.per_task);
  assert.equal(s.add_back_ratio, 0.5);
});

test('stats --record refreshes calibration and appends a snapshot row', () => {
  const ctx = setup('proj', { transcripts: true });
  run(ctx, ['log', '--class', 'ceremony', '--unit', 'plan-merge', '--ref', '3-02+3-04', '--reason', 'tiny', '--phase', '3', '--inferred']);
  const out = run(ctx, ['stats', '--record', '--phase', '3'], { json: false });
  // one line even under --raw: this lands in the orchestrator's context every phase
  assert.equal(out.trim().split('\n').length, 1);
  assert.match(out, /^musk: net .*1 inferred cut\(s\) unreviewed/);
  const rows = fs.readFileSync(path.join(ctx.cwd, '.planning/musk/ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const snap = rows[rows.length - 1];
  assert.equal(snap.type, 'snapshot');
  assert.equal(snap.phase, '3');
  assert.deepEqual(snap.measured, { plans: 4, tasks: 8, tokens: 6500, cache_read: 4000, basis: 'harness' });
  assert.equal(snap.estimated.gross.p50, 50000); // per_plan_overhead from the fit
  assert.ok(fs.existsSync(path.join(ctx.cwd, '.planning/musk/calibration.json')));
});

test('unknown subcommand is a usage error', () => {
  assert.throws(() => run(setup(), ['bogus']), /unknown subcommand/);
});

test('record names the manual step that is due, and only then', () => {
  const ctx = setup('proj', { transcripts: true });
  const pd = (p) => path.join(ctx.cwd, '.planning/phases', p);
  const rec = (phase) => run(ctx, ['stats', '--record', '--phase', phase], { json: false });

  // phase 5 unstarted and no milestone marker: the milestone pass is still worth running
  assert.match(rec('3'), /NEXT STEP for the user: \/gsd-musk-roadmap .*1 unstarted/);

  fs.writeFileSync(path.join(ctx.cwd, '.planning/config.json'), JSON.stringify({ musk: { milestone_pass: false } }));
  assert.doesNotMatch(rec('3'), /NEXT STEP/);

  // last phase verified while 3 and 4 already are: retro is due
  fs.writeFileSync(path.join(pd('03-alpha'), '03-VERIFICATION.md'), 'ok');
  fs.writeFileSync(path.join(pd('04-beta'), '04-VERIFICATION.md'), 'ok');
  assert.match(rec('5'), /NEXT STEP for the user: \/gsd-musk-retro/);

  // not the last one: nothing due
  fs.rmSync(path.join(pd('04-beta'), '04-VERIFICATION.md'));
  assert.doesNotMatch(rec('5'), /NEXT STEP/);

  // retro already written: nothing due
  fs.writeFileSync(path.join(pd('04-beta'), '04-VERIFICATION.md'), 'ok');
  fs.writeFileSync(path.join(ctx.cwd, '.planning/musk/RETRO-v1.1.md'), 'done');
  assert.doesNotMatch(rec('5'), /NEXT STEP/);
});
