'use strict';

// .planning/musk/ledger.jsonl — append-only cut / reinstate / pass / snapshot rows.

const path = require('node:path');
const { normPhase } = require('./planning.cjs');

const UNITS = {
  scope: ['milestone-phase', 'req', 'criterion', 'feature'],
  impl: ['task', 'file', 'dep', 'flag', 'abstraction', 'layer', 'test', 'doc'],
  ceremony: ['lean-lane', 'reroute-quick', 'reroute-fast', 'plan-merge', 'phase-merge', 'step-skip'],
};
const STATUSES = ['applied', 'proposed', 'rejected'];

function ledgerPath(planDir) {
  return path.join(planDir, 'musk', 'ledger.jsonl');
}

function readLedger(deps, planDir) {
  let text;
  try { text = deps.fs.readFileSync(ledgerPath(planDir), 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ }
  }
  return rows;
}

// Appends one row. An interrupted earlier write can leave a torn last line without its newline;
// start on a fresh line so this row is not glued to it and skipped along with it.
function append(deps, planDir, row) {
  deps.fs.mkdirSync(path.join(planDir, 'musk'), { recursive: true });
  const file = ledgerPath(planDir);
  let sep = '';
  try {
    const { size } = deps.fs.statSync(file);
    if (size > 0) {
      const fd = deps.fs.openSync(file, 'r');
      try {
        const b = Buffer.alloc(1);
        deps.fs.readSync(fd, b, 0, 1, size - 1);
        if (b[0] !== 0x0a) sep = '\n';
      } finally { deps.fs.closeSync(fd); }
    }
  } catch { /* no ledger yet */ }
  deps.fs.appendFileSync(file, sep + JSON.stringify(row) + '\n');
}

// Runs fn() holding the ledger lock, so read -> allocate id -> append is atomic across parallel
// planners. The lock is a directory (mkdir is atomic); one older than STALE_MS is a crashed
// holder's and is broken. Synchronous on purpose: the gsd-tools dispatcher rejects async routers.
const LOCK_WAIT_MS = 10000;
const STALE_MS = 30000;
function withLock(deps, planDir, fn) {
  const dir = path.join(planDir, 'musk');
  deps.fs.mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, '.ledger.lock');
  const start = Date.now();
  for (;;) {
    try { deps.fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - deps.fs.statSync(lock).mtimeMs > STALE_MS) { deps.fs.rmSync(lock, { recursive: true, force: true }); continue; }
      } catch { continue; /* released meanwhile */ }
      if (Date.now() - start > LOCK_WAIT_MS) throw new Error(`ledger lock busy: ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { try { deps.fs.rmSync(lock, { recursive: true, force: true }); } catch { /* gone */ } }
}

function nextId(rows) {
  let max = 0;
  for (const r of rows) {
    const m = r.type === 'cut' && String(r.id || '').match(/^M-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `M-${String(max + 1).padStart(4, '0')}`;
}

// Returns { row } or { error }.
function buildCut(rows, opts, ts) {
  const cls = opts.class;
  if (!UNITS[cls]) return { error: `--class must be one of ${Object.keys(UNITS).join('|')}` };
  if (!UNITS[cls].includes(opts.unit)) return { error: `--unit for class ${cls} must be one of ${UNITS[cls].join('|')}` };
  if (!opts.ref) return { error: '--ref is required' };
  if (!opts.reason) return { error: '--reason is required' };
  const status = opts.status || 'applied';
  if (!STATUSES.includes(status)) return { error: `--status must be one of ${STATUSES.join('|')}` };
  const qty = opts.qty === undefined ? 1 : Number(opts.qty);
  if (!Number.isInteger(qty) || qty < 1) return { error: '--qty must be a positive integer' };
  const row = { id: nextId(rows), ts, type: 'cut', class: cls, unit: opts.unit, ref: opts.ref, reason: opts.reason };
  if (opts.phase !== undefined) row.phase = normPhase(opts.phase) || String(opts.phase);
  if (opts.point) row.point = opts.point;
  row.status = status;
  row.qty = qty;
  row.inferred = Boolean(opts.inferred);
  return { row };
}

function buildReinstate(rows, id, reason, ts) {
  if (!id) return { error: 'usage: musk reinstate <id> --reason <text>' };
  if (!reason) return { error: '--reason is required' };
  const cut = cuts(rows).find((c) => c.id === id);
  if (!cut) return { error: `no cut with id ${id}` };
  if (cut.reinstated) return { error: `${id} is already reinstated` };
  return { row: { id, ts, type: 'reinstate', reason } };
}

function buildConfirm(rows, id, reason, ts) {
  if (!id) return { error: 'usage: musk confirm <id>... [--reason <text>]' };
  const cut = cuts(rows).find((c) => c.id === id);
  if (!cut) return { error: `no cut with id ${id}` };
  if (cut.reinstated) return { error: `${id} is reinstated; nothing to confirm` };
  return { row: { id, ts, type: 'confirm', reason: reason || 'confirmed by the user' } };
}

// Current state: each cut with `reinstated` / `confirmed` folded in. `unreviewed` = applied
// without user approval and neither confirmed nor reinstated since.
// [inferred] Retros run before `musk confirm` existed wrote a `confirmed` field onto the cut row
// or flipped `inferred` off beside a confirm row; both read as confirmed.
function cuts(rows) {
  const byId = new Map();
  for (const r of rows) {
    if (r.type === 'cut' && r.id && !byId.has(r.id)) byId.set(r.id, { ...r, qty: Number(r.qty) || 1, reinstated: false, confirmed: Boolean(r.confirmed) });
    else if (r.type === 'confirm' && byId.has(r.id)) {
      const c = byId.get(r.id);
      c.confirmed = true;
      c.confirm_reason = r.reason || null;
    } else if (r.type === 'reinstate' && byId.has(r.id)) {
      const c = byId.get(r.id);
      c.reinstated = true;
      c.reinstate_reason = r.reason || null;
      c.reinstate_ts = r.ts || null;
    }
  }
  const out = [...byId.values()];
  for (const c of out) c.unreviewed = Boolean(c.inferred) && c.status === 'applied' && !c.confirmed && !c.reinstated;
  return out;
}

// A `pass` row says the per-phase subtraction pass ran, cuts or not, so a skipped pass is visible.
function buildPass(opts, ts) {
  const phase = normPhase(opts.phase);
  if (!phase) return { error: 'pass requires --phase N' };
  return { row: { ts, type: 'pass', phase, point: opts.point || 'discuss:pre' } };
}

// Evidence that the per-phase pass ran: a pass row, or (ledgers older than pass rows) a
// discuss:pre cut or a lean-lane reroute logged for the phase.
function passRecorded(rows, phase) {
  const want = normPhase(phase);
  return rows.some((r) => normPhase(r.phase) === want && (
    r.type === 'pass'
    || (r.type === 'cut' && (r.point === 'discuss:pre' || /^(reroute-|lean-lane$)/.test(r.unit)))));
}

module.exports = { UNITS, STATUSES, ledgerPath, readLedger, append, withLock, nextId, buildCut, buildReinstate, buildConfirm, buildPass, passRecorded, cuts };
