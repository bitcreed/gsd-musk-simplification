'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, run } = require('./helpers.cjs');

const cut = (extra = []) => ['log', '--class', 'impl', '--unit', 'task', '--ref', 'T-1', '--reason', 'no source', ...extra];

test('log appends validated rows with a sequential id', () => {
  const ctx = setup();
  const a = run(ctx, cut(['--phase', '03', '--point', 'plan:pre', '--inferred']));
  const b = run(ctx, cut(['--qty', '3']));
  assert.equal(a.id, 'M-0001');
  assert.equal(b.id, 'M-0002');
  assert.equal(a.phase, '3');
  assert.equal(a.status, 'applied');
  assert.equal(a.inferred, true);
  assert.equal(b.qty, 3);
  const lines = fs.readFileSync(path.join(ctx.cwd, '.planning/musk/ledger.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).type, 'cut');
  assert.equal(run(ctx, cut(), { json: false }).trim(), 'M-0003');
});

test('log rejects bad vocabulary, status, qty and missing fields', () => {
  const ctx = setup();
  assert.throws(() => run(ctx, ['log', '--class', 'nope', '--unit', 'task', '--ref', 'x', '--reason', 'y']), /--class/);
  assert.throws(() => run(ctx, ['log', '--class', 'scope', '--unit', 'task', '--ref', 'x', '--reason', 'y']), /--unit for class scope/);
  assert.throws(() => run(ctx, cut(['--status', 'maybe'])), /--status/);
  assert.throws(() => run(ctx, cut(['--qty', '0'])), /--qty/);
  assert.throws(() => run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--reason', 'y']), /--ref/);
  assert.equal(fs.existsSync(path.join(ctx.cwd, '.planning/musk/ledger.jsonl')), false);
});

test('reinstate marks the cut and feeds the add-back ratio', () => {
  const ctx = setup();
  for (let i = 0; i < 4; i++) run(ctx, cut());
  run(ctx, cut(['--status', 'proposed']));
  const r = run(ctx, ['reinstate', 'M-0002', '--reason', 'needed for export']);
  assert.deepEqual([r.id, r.type], ['M-0002', 'reinstate']);
  assert.throws(() => run(ctx, ['reinstate', 'M-0002', '--reason', 'again']), /already reinstated/);
  assert.throws(() => run(ctx, ['reinstate', 'M-0099', '--reason', 'x']), /no cut/);
  assert.throws(() => run(ctx, ['reinstate', 'M-0001']), /--reason/);

  const list = run(ctx, ['list']);
  assert.equal(list.find((c) => c.id === 'M-0002').reinstated, true);
  assert.equal(list.find((c) => c.id === 'M-0001').reinstated, false);
  assert.match(run(ctx, ['list'], { json: false }), /M-0002 .*\[REINSTATED\]/);

  const s = run(ctx, ['stats']);
  assert.equal(s.cuts.applied, 4);
  assert.equal(s.cuts.reinstated, 1);
  assert.equal(s.add_back_ratio, 0.25);
});

test('list filters by phase and class', () => {
  const ctx = setup();
  run(ctx, cut(['--phase', '3']));
  run(ctx, ['log', '--class', 'scope', '--unit', 'req', '--ref', 'ALP-02', '--reason', 'no owner', '--phase', '3']);
  run(ctx, cut(['--phase', '4']));
  assert.equal(run(ctx, ['list', '--phase', '03']).length, 2);
  assert.deepEqual(run(ctx, ['list', '--class', 'scope']).map((c) => c.ref), ['ALP-02']);
});

test('confirm appends rows and clears unreviewed; legacy confirmed fields count too', () => {
  const ctx = setup('proj');
  const ledgerFile = path.join(ctx.cwd, '.planning/musk/ledger.jsonl');
  fs.rmSync(ledgerFile, { force: true });
  const a = run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--ref', 'x', '--reason', 'y', '--inferred']);
  const b = run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--ref', 'x2', '--reason', 'y', '--inferred']);
  const before = fs.readFileSync(ledgerFile, 'utf8');
  assert.deepEqual(run(ctx, ['list']).map((c) => c.unreviewed), [true, true]);
  const added = run(ctx, ['confirm', a.id, '--reason', 'ok']);
  assert.equal(added[0].type, 'confirm');
  assert.ok(fs.readFileSync(ledgerFile, 'utf8').startsWith(before), 'existing rows untouched');
  assert.deepEqual(run(ctx, ['list']).map((c) => [c.id, c.confirmed, c.unreviewed]), [[a.id, true, false], [b.id, false, true]]);
  assert.throws(() => run(ctx, ['confirm', 'M-9999']), /no cut/);
  fs.appendFileSync(ledgerFile, JSON.stringify({ id: 'M-0100', type: 'cut', class: 'impl', unit: 'task', status: 'applied', inferred: true, confirmed: '2026-10-24 retro' }) + '\n');
  assert.equal(run(ctx, ['list']).find((c) => c.id === 'M-0100').unreviewed, false);
});
