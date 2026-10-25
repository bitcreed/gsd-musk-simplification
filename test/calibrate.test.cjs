'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, run } = require('./helpers.cjs');
const { attribute, projectSlug } = require('../lib/transcripts.cjs');
const { PRIORS } = require('../lib/pricing.cjs');

test('project slug replaces every non-alphanumeric char', () => {
  assert.equal(projectSlug('/home/u/projects/python/tt_book.x'), '-home-u-projects-python-tt-book-x');
});

test('calibrate: dedupes streamed chunks by message.id and buckets orchestrator segments', () => {
  const ctx = setup('proj', { transcripts: true });
  const c = run(ctx, ['calibrate']);
  assert.equal(c.basis, 'harness');
  assert.equal(c.sessions, 1);
  // msg_m1 appears twice (1000 each) but counts once: 1000 + 2000 + 500
  assert.equal(c.by_agent_type['orchestrator:/gsd-plan-phase'].tokens_total, 3500);
  assert.equal(c.by_agent_type['orchestrator:/gsd-plan-phase'].runs, 1);
  assert.equal(c.by_agent_type['orchestrator:/musk-audit'].tokens_total, 3000);
  assert.equal(c.by_agent_type['gsd-executor'].runs, 6);
  assert.equal(c.by_agent_type['gsd-executor'].tokens_total, 610000);
  assert.equal(c.totals.tokens, 3500 + 3000 + 4000 + 610000 + 30000 + 9000);
  assert.equal(c.totals.cache_read, 1000 * 14);
  const written = JSON.parse(fs.readFileSync(path.join(ctx.cwd, '.planning/musk/calibration.json'), 'utf8'));
  assert.equal(written.totals.tokens, c.totals.tokens);
});

test('calibrate: subagents attributed to phase/plan (meta, tool_result link, dispatch marker, parent inheritance)', () => {
  const c = run(setup('proj', { transcripts: true }), ['calibrate']);
  // gp1 has no meta.json: linked through the parent's tool_result agentId -> general-purpose, phase 1
  assert.equal(c.by_agent_type['general-purpose'].tokens_total, 4000 + 9000);
  // phase 1 = gp1 + e1 + e2a + e2b + e3 + planner p1 (inherits phase 1 from gp1)
  assert.equal(c.by_phase['1'].tokens_total, 4000 + 80000 + 110000 + 140000 + 30000);
  assert.equal(c.by_phase['1'].by_agent_type['gsd-planner'].tokens_total, 30000);
  assert.equal(c.by_phase['2'].tokens_total, 110000 + 170000); // e4 via [gsd:dispatch], e5 via description
  assert.equal(c.by_phase['3'].tokens_total, 6500); // main-session segments with <command-args>3
  assert.deepEqual(c.injections.plan.map((p) => p.phase), ['1']);
});

test('attribute: description beats prompt; unique PLAN path gives plan', () => {
  assert.deepEqual(attribute('Execute plan 04 of phase 11', 'phases/09-x'), { phase: '11', plan: '11-04', quick: null });
  assert.deepEqual(attribute('Execute plan 07.1-03', ''), { phase: '7.1', plan: '7.1-03', quick: null });
  assert.deepEqual(attribute('Plan it', 'see 01-01-PLAN.md and 01-02-PLAN.md'), { phase: null, plan: null, quick: null });
  assert.equal(attribute('Quick task: tidy', 'Run .planning/quick/260901-abc-tidy').quick, '260901-abc');
});

test('calibrate: regression fit gives per_task and per_plan_overhead', () => {
  const c = run(setup('proj', { transcripts: true }), ['calibrate']);
  // executor tokens per plan = 50k + 30k * tasks (1-02 is two runs summed)
  assert.deepEqual({ a: c.fit.a, b: c.fit.b, n: c.fit.n }, { a: 50000, b: 30000, n: 5 });
  assert.deepEqual(c.prices.per_task, { p25: 30000, p50: 30000, p75: 30000, n: 5, basis: 'harness' });
  assert.deepEqual(c.prices.per_plan_overhead, { p25: 50000, p50: 50000, p75: 50000, n: 5, basis: 'harness' });
  // two executed phases, one quick task: below n=5 -> null
  assert.equal(c.prices.per_phase, null);
  assert.equal(c.prices.per_quick_task, null);
  assert.equal(c.samples.per_phase, 2);
});

test('calibrate: --since drops older messages; --out redirects the file', () => {
  const ctx = setup('proj', { transcripts: true });
  const out = path.join(ctx.tmp, 'scratch', 'cal.json');
  const c = run(ctx, ['calibrate', '--since', '2027-01-01T00:00:00Z', '--out', out]);
  assert.equal(c.totals.tokens, 0);
  assert.ok(fs.existsSync(out));
  assert.equal(fs.existsSync(path.join(ctx.cwd, '.planning/musk/calibration.json')), false);
});

test('calibrate: no transcripts -> basis none; stats fall back to labelled priors', () => {
  const ctx = setup('proj');
  const c = run(ctx, ['calibrate']);
  assert.equal(c.basis, 'none');
  assert.equal(c.prices.per_task, null);
  const s = run(ctx, ['stats']);
  assert.deepEqual(s.prices.per_task, { p25: PRIORS.per_task, p50: PRIORS.per_task, p75: PRIORS.per_task, n: 0, basis: 'prior' });
  assert.equal(s.prices.per_phase.basis, 'prior');
});
