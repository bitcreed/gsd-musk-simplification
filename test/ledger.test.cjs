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

test('musk commit and stats --record commit .planning/musk through gsd-tools', () => {
  const ctx = setup('proj');
  run(ctx, ['log', '--class', 'impl', '--unit', 'task', '--ref', 'x', '--reason', 'y']);
  assert.equal(run(ctx, ['commit'], { json: false }).trim(), 'musk: commit committed');
  run(ctx, ['stats', '--record', '--phase', '3'], { json: false });
  assert.deepEqual(ctx.commits.map((c) => [c.message, c.files]), [
    ['docs(musk): ledger and calibration', ['.planning/musk/']],
    ['docs(musk): phase 3 measurements', ['.planning/musk/']],
  ]);
});

test('record is the verify:post step: same as stats --record', () => {
  const ctx = setup('proj');
  const out = run(ctx, ['record', '--phase', '3'], { json: false });
  assert.match(out, /^musk: net /);
  const rows = fs.readFileSync(path.join(ctx.cwd, '.planning/musk/ledger.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.at(-1).type, 'snapshot');
  assert.equal(ctx.commits.at(-1).message, 'docs(musk): phase 3 measurements');
});

test('every manifest step command passes gsd-core\'s ref.command grammar and names a real subcommand', () => {
  // loop-hook-dispatch.md: a host skips any command not matching this; no flags allowed.
  const GRAMMAR = /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/;
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'capability.json'), 'utf8'));
  const subs = manifest.commands.find((c) => c.family === 'musk').subcommands;
  const cmds = manifest.steps.filter((s) => s.ref.command).map((s) => s.ref.command);
  assert.ok(cmds.length >= 2);
  for (const c of cmds) {
    assert.match(c, GRAMMAR, c);
    const [family, sub] = c.split(' ');
    assert.equal(family, 'musk');
    assert.ok(subs.includes(sub), `${sub} listed in manifest subcommands`);
  }
});

test('the lean lane writes every artifact plan-phase checks before it would spawn or stop', () => {
  // plan-phase: RESEARCH.md skips the researcher (§5), PATTERNS.md the pattern mapper (§7.8), and
  // the Nyquist gate (§7.5) stops for the user unless a VALIDATION.md exists.
  const frag = fs.readFileSync(path.join(__dirname, '..', 'fragments', 'discuss-pre-lean.md'), 'utf8');
  for (const f of ['RESEARCH', 'PATTERNS', 'VALIDATION']) assert.match(frag, new RegExp(`<padded>-${f}\\.md`));
  for (const k of ['phase', 'slug', 'status: draft', 'nyquist_compliant: false', 'wave_0_complete: false', 'created']) assert.ok(frag.includes(`\`${k}\``), k);
  assert.doesNotMatch(frag, /Validation Architecture/, 'a stub with that section would arm the checker\'s Dimension 8');
});

test('append after a torn last line keeps the new row readable', () => {
  const ctx = setup('proj');
  const ledgerFile = path.join(ctx.cwd, '.planning/musk/ledger.jsonl');
  fs.mkdirSync(path.dirname(ledgerFile), { recursive: true });
  fs.writeFileSync(ledgerFile, '{"id":"M-0001","type":"cut","cl');
  const r = run(ctx, cut());
  assert.deepEqual(run(ctx, ['list']).map((c) => c.id), [r.id]);
});

test('confirm checks every id before writing any row', () => {
  const ctx = setup('proj');
  const ledgerFile = path.join(ctx.cwd, '.planning/musk/ledger.jsonl');
  fs.rmSync(ledgerFile, { force: true });
  const a = run(ctx, cut(['--inferred']));
  const before = fs.readFileSync(ledgerFile, 'utf8');
  assert.throws(() => run(ctx, ['confirm', a.id, 'M-9999']), /no cut/);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), before);
});

test('parallel log processes get distinct ids (ledger lock)', async () => {
  const { spawn } = require('node:child_process');
  const ctx = setup('proj');
  fs.rmSync(path.join(ctx.cwd, '.planning/musk/ledger.jsonl'), { force: true });
  const router = path.join(__dirname, '..', 'musk-router.cjs');
  const N = 8;
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [router, ...cut([]).map((a) => (a === 'T-1' ? `T-${i}` : a)), '--cwd', ctx.cwd], { stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  })));
  const ids = run(ctx, ['list']).map((c) => c.id);
  assert.equal(ids.length, N);
  assert.equal(new Set(ids).size, N);
  assert.ok(!fs.existsSync(path.join(ctx.cwd, '.planning/musk/.ledger.lock')), 'lock released');
});

test('commit verdict reads gsd-tools\' JSON reason, not just the exit status', () => {
  const { commitVerdict } = require('../musk-router.cjs');
  assert.deepEqual(commitVerdict(0, '{"committed":true,"reason":"committed"}'), { ok: true, reason: 'committed' });
  assert.deepEqual(commitVerdict(0, '{"committed":false,"reason":"nothing_to_commit"}'), { ok: true, reason: 'nothing_to_commit' });
  assert.deepEqual(commitVerdict(0, '{"committed":false,"reason":"skipped_commit_docs_false"}'), { ok: true, reason: 'skipped_commit_docs_false' });
  assert.deepEqual(commitVerdict(0, '{"committed":false,"reason":"commit_failed","error":"hook rejected"}'), { ok: false, reason: 'commit_failed', error: 'hook rejected' });
  assert.equal(commitVerdict(1, '', 'boom').ok, false);
});

test('musk commit honours commit_docs: false in the invoking checkout', () => {
  const ctx = setup('proj');
  run(ctx, cut());
  fs.writeFileSync(path.join(ctx.cwd, '.planning/config.json'), JSON.stringify({ planning: { commit_docs: false } }));
  assert.equal(run(ctx, ['commit']).reason, 'skipped_commit_docs_false');
  assert.equal((ctx.commits || []).length, 0);
});

test('musk commit resolves commit_docs as gsd-core does: workstream config over the root', () => {
  const ctx = setup('proj');
  run(ctx, cut());
  const env = { GSD_WORKSTREAM: 'w1' };
  const ws = path.join(ctx.cwd, '.planning/workstreams/w1');
  fs.mkdirSync(ws, { recursive: true });
  const both = (root, wsCfg) => {
    fs.writeFileSync(path.join(ctx.cwd, '.planning/config.json'), JSON.stringify(root));
    fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify(wsCfg));
    return run(ctx, ['commit'], { env }).reason;
  };
  assert.equal(both({ planning: { commit_docs: false } }, { planning: { commit_docs: true } }), 'committed');
  assert.equal(both({ planning: { commit_docs: true } }, { planning: { commit_docs: false } }), 'skipped_commit_docs_false');
  assert.equal(both({ commit_docs: true }, { commit_docs: false }), 'skipped_commit_docs_false');
  assert.equal(both({ commit_docs: false }, { musk: { enabled: true } }), 'skipped_commit_docs_false');
  // without the workstream, only the root config applies
  assert.equal(run(ctx, ['commit']).reason, 'skipped_commit_docs_false');
});

// Ledger lock: owner identity, liveness-based reclamation, token-checked release.
const ledgerLib = require('../lib/ledger.cjs');
const lockDeps = (extra = {}) => ({ fs, hostname: () => 'h1', pid: 1000, pidAlive: () => true, ...extra });
const lockSetup = () => {
  const ctx = setup('proj');
  const planDir = path.join(ctx.cwd, '.planning');
  const lock = path.join(planDir, 'musk', '.ledger.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  return { planDir, lock };
};
const writeOwner = (lock, o) => fs.writeFileSync(lock, JSON.stringify({ pid: 2000, host: 'h1', token: 'other', ts: new Date().toISOString(), ...o }));
// Runs fn with the clock jumping past the 10 s lock wait once polling starts, so a busy lock
// fails fast instead of after the real wait.
function fastClock(fn, after = 2) {
  const orig = Date.now;
  let calls = 0;
  Date.now = () => orig() + (++calls > after ? 60000 : 0);
  try { return fn(); } finally { Date.now = orig; }
}

test('lock: holder identity is recorded and released', () => {
  const { planDir, lock } = lockSetup();
  const seen = ledgerLib.withLock(lockDeps(), planDir, () => JSON.parse(fs.readFileSync(lock, 'utf8')));
  assert.deepEqual([seen.pid, seen.host, typeof seen.token, typeof seen.ts], [1000, 'h1', 'string', 'string']);
  assert.equal(fs.existsSync(lock), false);
});

test('lock: an old lock whose owner is alive (paused) is not reclaimed', () => {
  const { planDir, lock } = lockSetup();
  writeOwner(lock, { ts: '2020-01-01T00:00:00Z' });
  const old = new Date('2020-01-01');
  fs.utimesSync(lock, old, old);
  const asked = [];
  const deps = lockDeps({ pidAlive: (p) => { asked.push(p); return true; } });
  assert.throws(() => fastClock(() => ledgerLib.withLock(deps, planDir, () => 'ran')), /ledger lock busy.*pid 2000 on h1/);
  assert.ok(asked.includes(2000));
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'other', 'the live owner keeps its lock');
});

test('lock: a dead owner on this host is reclaimed at once; a foreign host only after the long timeout', () => {
  const { planDir, lock } = lockSetup();
  writeOwner(lock, {});
  assert.equal(ledgerLib.withLock(lockDeps({ pidAlive: () => false }), planDir, () => 'ran'), 'ran');
  assert.equal(fs.existsSync(lock), false);

  writeOwner(lock, { host: 'h2', ts: new Date(Date.now() - 20 * 60 * 1000).toISOString() });
  assert.equal(ledgerLib.withLock(lockDeps(), planDir, () => 'ran'), 'ran');
  // a recent foreign lock is respected: another host's pid says nothing about liveness here
  writeOwner(lock, { host: 'h2' });
  assert.throws(() => fastClock(() => ledgerLib.withLock(lockDeps({ pidAlive: () => false }), planDir, () => 'ran')), /busy/);
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'other');
});

test('lock: a reclaimer that moved a newer lock puts it back and does not take it', () => {
  const { planDir, lock } = lockSetup();
  writeOwner(lock, { token: 'dead' });
  // Another reclaimer wins between our judgement and our rename, and takes a fresh lock.
  let raced = false;
  const racyFs = {
    ...fs,
    renameSync(from, to) {
      if (!raced && from === lock) {
        raced = true;
        fs.rmSync(lock);
        writeOwner(lock, { token: 'winner', pid: 3000 });
      }
      return fs.renameSync(from, to);
    },
  };
  const ran = [];
  const deps = lockDeps({ fs: racyFs, pidAlive: (p) => p !== 2000 });
  assert.throws(() => fastClock(() => ledgerLib.withLock(deps, planDir, () => ran.push(1)), 3), /busy.*pid 3000/);
  assert.deepEqual(ran, []);
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'winner', 'the winner\'s lock is restored');
  assert.deepEqual(fs.readdirSync(path.dirname(lock)).filter((f) => f.includes('stale')), []);
});

test('lock: release never removes a lock that is no longer ours', () => {
  const { planDir, lock } = lockSetup();
  ledgerLib.withLock(lockDeps(), planDir, () => {
    fs.rmSync(lock);
    writeOwner(lock, { token: 'someone-else' });
  });
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).token, 'someone-else');
});

test('lock: a pre-0.5.5 lock directory is reclaimed only after the long timeout', () => {
  const { planDir, lock } = lockSetup();
  fs.mkdirSync(lock);
  assert.throws(() => fastClock(() => ledgerLib.withLock(lockDeps(), planDir, () => 'ran')), /busy/);
  const old = new Date(Date.now() - 20 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  assert.equal(ledgerLib.withLock(lockDeps(), planDir, () => 'ran'), 'ran');
  assert.equal(fs.existsSync(lock), false);
});

test('lock: concurrent processes reclaiming one dead owner\'s lock still get distinct ids', async () => {
  const { spawn, spawnSync } = require('node:child_process');
  const os = require('node:os');
  const ctx = setup('proj');
  fs.rmSync(path.join(ctx.cwd, '.planning/musk/ledger.jsonl'), { force: true });
  const lock = path.join(ctx.cwd, '.planning/musk/.ledger.lock');
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const deadPid = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(lock, JSON.stringify({ pid: deadPid, host: os.hostname(), token: 'dead', ts: new Date().toISOString() }));
  const router = path.join(__dirname, '..', 'musk-router.cjs');
  const N = 8;
  await Promise.all(Array.from({ length: N }, (_, i) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [router, ...cut([]).map((a) => (a === 'T-1' ? `T-${i}` : a)), '--cwd', ctx.cwd], { stdio: 'ignore' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  })));
  const ids = run(ctx, ['list']).map((c) => c.id);
  assert.equal(ids.length, N);
  assert.equal(new Set(ids).size, N);
  assert.deepEqual(fs.readdirSync(path.dirname(lock)).filter((f) => f.startsWith('.ledger.lock')), []);
});
