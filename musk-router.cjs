'use strict';

/**
 * musk-router.cjs — `gsd-tools musk <sub>` command family.
 *
 * routeMuskCommand({ args, cwd, raw, error, deps }): args[0] === 'musk', args[1] = subcommand.
 * Synchronous (the gsd-tools dispatcher rejects Promise-returning routers). Output is plain text,
 * or a single JSON document when --json / --raw / `raw` is given.
 *
 * deps (all optional, for tests): fs, homedir(), now(), stdout(str), capRoot.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ledger = require('./lib/ledger.cjs');
const planning = require('./lib/planning.cjs');
const { auditPhase } = require('./lib/audit.cjs');
const cal = require('./lib/calibrate.cjs');
const { computeStats, snapshotRow } = require('./lib/stats.cjs');
const { dueStep } = require('./lib/reminders.cjs');
const { muskConfig } = require('./lib/config.cjs');
const paths = require('./lib/paths.cjs');

const VALUE_FLAGS = new Set(['class', 'unit', 'ref', 'reason', 'phase', 'point', 'status', 'qty', 'since', 'out']);
const SUBS = ['log', 'reinstate', 'confirm', 'list', 'pass', 'phase-check', 'milestone-check', 'audit', 'calibrate', 'stats'];

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const name = a.slice(2, eq === -1 ? undefined : eq);
    if (eq !== -1) flags[name] = a.slice(eq + 1);
    else if (VALUE_FLAGS.has(name)) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { flags, pos };
}

function makeDeps(deps = {}) {
  return {
    fs: deps.fs || fs,
    homedir: deps.homedir || os.homedir,
    now: deps.now || (() => new Date()),
    stdout: deps.stdout || ((s) => process.stdout.write(s)),
    capRoot: deps.capRoot || __dirname,
    env: deps.env || process.env,
    git: deps.git,
  };
}

const fmtTok = (n) => (n === null || n === undefined ? 'n/a' : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`);
const fmtQ = (q) => (q ? `p25 ${fmtTok(q.p25)} / p50 ${fmtTok(q.p50)} / p75 ${fmtTok(q.p75)} (${q.basis}, n=${q.n})` : 'null');

function textList(cuts) {
  if (!cuts.length) return 'No cuts recorded.';
  return cuts.map((c) => [
    c.id, c.class, c.unit, c.qty > 1 ? `x${c.qty}` : '', c.status, c.reinstated ? '[REINSTATED]' : '', c.unreviewed ? '[UNREVIEWED]' : '',
    c.phase ? `phase ${c.phase}` : '', c.ref, '-', c.reason,
  ].filter(Boolean).join(' ')).join('\n');
}

function textStats(s) {
  return [
    `musk stats${s.phase ? ` — phase ${s.phase}` : ''}`,
    `cuts: ${s.cuts.applied} applied, ${s.cuts.proposed} proposed, ${s.cuts.rejected} rejected, ${s.cuts.reinstated} reinstated`,
    `add-back ratio: ${s.add_back_ratio === null ? 'n/a' : (s.add_back_ratio * 100).toFixed(0) + '%'}`,
    `gross savings: ${fmtQ(s.gross)}`,
    `potential (proposed): ${fmtQ(s.potential)}`,
    `unpriced units: ${s.unpriced}`,
    `pass cost: ${fmtTok(s.pass_cost.tokens)} (fragments ${fmtTok(s.pass_cost.fragment_tokens)} over ${s.pass_cost.injections.discuss} discuss + ${s.pass_cost.injections.plan} plan runs, skills ${fmtTok(s.pass_cost.skill_tokens)})`,
    `net: ${fmtQ(s.net)}`,
  ].join('\n');
}

function textCalibration(c, file) {
  const lines = [`calibration (${c.basis}) -> ${file}`];
  if (c.basis === 'harness') lines.push(`${c.sessions} sessions, ${c.subagents} subagents, ${fmtTok(c.totals.tokens)} tokens (+${fmtTok(c.totals.cache_read)} cache read)`);
  for (const [k, v] of Object.entries(c.prices)) lines.push(`${k}: ${fmtQ(v)}${v ? '' : ` (n=${(c.samples || {})[k] ?? 0}; prior used)`}`);
  if (c.fit) lines.push(`fit executor tokens = ${c.fit.a} + ${c.fit.b}·tasks (r2 ${c.fit.r2}, n=${c.fit.n})`);
  (c.notes || []).forEach((n) => lines.push(`note: ${n}`));
  return lines.join('\n');
}

function routeMuskCommand({ args, cwd, raw, error, deps } = {}) {
  const d = makeDeps(deps);
  const fail = (msg) => {
    if (typeof error === 'function') return error(`musk: ${msg}`);
    throw new Error(`musk: ${msg}`);
  };
  const { flags, pos } = parseArgs((args || []).slice(2));
  const sub = (args || [])[1];
  const json = Boolean(raw || flags.json || flags.raw);
  const root = cwd || process.cwd();
  // planDir: planning reads (this checkout + workstream). stateDir: musk's ledger, calibration and
  // markers, always in the main checkout so a linked worktree's writes are not lost.
  const P = paths.resolve(d, root);
  const { planDir, stateDir, rootPlanDir } = P;
  const now = () => d.now().toISOString();
  const emit = (obj, text) => d.stdout((json ? JSON.stringify(obj, null, 2) : text) + '\n');

  if (!SUBS.includes(sub)) return fail(`unknown subcommand ${JSON.stringify(sub)}; expected one of ${SUBS.join(', ')}`);

  if (sub === 'log') {
    const rows = ledger.readLedger(d, stateDir);
    const { row, error: err } = ledger.buildCut(rows, flags, now());
    if (err) return fail(err);
    ledger.append(d, stateDir, row);
    return emit(row, row.id);
  }

  if (sub === 'confirm') {
    // Append-only, like reinstate: never rewrite a cut row.
    const rows = ledger.readLedger(d, planDir);
    if (!pos.length) return fail('usage: musk confirm <id>... [--reason <text>]');
    const added = [];
    for (const id of pos) {
      const { row, error: err } = ledger.buildConfirm(rows, id, flags.reason, now());
      if (err) return fail(err);
      ledger.append(d, planDir, row);
      rows.push(row);
      added.push(row);
    }
    return emit(added, added.map((r) => `${r.id} confirmed`).join('\n'));
  }

  if (sub === 'reinstate') {
    const rows = ledger.readLedger(d, stateDir);
    const { row, error: err } = ledger.buildReinstate(rows, pos[0], flags.reason, now());
    if (err) return fail(err);
    ledger.append(d, stateDir, row);
    return emit(row, `${row.id} reinstated`);
  }

  if (sub === 'list') {
    const phase = flags.phase !== undefined ? planning.normPhase(flags.phase) || String(flags.phase) : null;
    const cuts = ledger.cuts(ledger.readLedger(d, stateDir))
      .filter((c) => !phase || c.phase === phase)
      .filter((c) => !flags.class || c.class === flags.class);
    return emit(cuts, textList(cuts));
  }

  if (sub === 'pass') {
    const { row, error: err } = ledger.buildPass(flags, now());
    if (err) return fail(err);
    ledger.append(d, stateDir, row);
    return emit(row, `musk: pass recorded for phase ${row.phase}`);
  }

  if (sub === 'phase-check') {
    // Safety net run at plan:pre: a phase whose discuss skipped the pass (discuss skipped, a
    // hand-driven workflow, an older ledger in a worktree) gets the pass text now.
    const phase = planning.normPhase(flags.phase);
    const config = muskConfig(d, planDir, rootPlanDir);
    if (config.enabled === false) return emit({ phase, recorded: null, action: 'none' }, 'musk: disabled');
    if (!phase) return emit({ phase: flags.phase ?? null, recorded: null, action: 'none' }, `musk: no phase check for ${flags.phase ?? '(none)'}`);
    const rows = ledger.readLedger(d, stateDir);
    let evidence = ledger.passRecorded(rows, phase) ? 'ledger' : null;
    if (!evidence) {
      const pd = planning.findPhaseDir(d, planDir, phase);
      const ctxFile = pd && (() => { try { return d.fs.readdirSync(pd.dir).find((f) => /CONTEXT\.md$/.test(f)); } catch { return null; } })();
      if (ctxFile && /\bmusk\b/i.test(d.fs.readFileSync(path.join(pd.dir, ctxFile), 'utf8'))) evidence = 'context';
    }
    if (evidence) return emit({ phase, recorded: true, evidence, action: 'none' }, `musk: pass recorded for phase ${phase}`);
    let frag = '';
    try { frag = d.fs.readFileSync(path.join(d.capRoot, 'fragments', 'discuss-pre.md'), 'utf8').trim(); } catch { /* missing fragment: the instruction alone */ }
    const text = [
      `musk: no subtraction pass recorded for phase ${phase}. Run it now, before you plan: cut first, then plan only what survives. CONTEXT.md already exists, so add the D-NN [deferred] decisions to it. In \`ask\` mode nobody can be asked here: log the cuts with --status proposed and change nothing.`,
      frag,
      `When done (also when nothing was cut): gsd-tools musk pass --phase ${phase} --point plan:pre`,
    ].filter(Boolean).join('\n');
    return emit({ phase, recorded: false, evidence: null, action: 'run-pass', instructions: text }, text);
  }

  if (sub === 'milestone-check') {
    const r = { ...planning.milestoneCheck(d, planDir, stateDir, root), config: muskConfig(d, planDir, rootPlanDir) };
    return emit(r, Object.entries(r).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a}=${b}`).join(' ') : v}`).join('\n'));
  }

  if (sub === 'audit') {
    if (flags.phase === undefined) return fail('audit requires --phase N');
    const r = auditPhase(d, planDir, flags.phase);
    const text = [
      `phase ${r.phase}: ${r.plans} plans, ${r.total_tasks ?? '?'} tasks, ${r.waves} waves, quick_eligible=${r.quick_eligible}`,
      ...r.per_plan.map((p) => `  ${p.id} wave ${p.wave} tasks ${p.tasks} files ${p.files}`),
      ...r.merge_candidates.map((g) => `  merge candidate (${g.reason}): ${g.plans.join(' + ')} = ${g.tasks} tasks`),
    ].join('\n');
    return emit(r, text);
  }

  if (sub === 'calibrate') {
    const c = cal.calibrate(d, P.mainRoot, { since: flags.since, planDir });
    // --out writes elsewhere (e.g. a scratch dir) instead of the project's calibration.json.
    const file = flags.out ? path.resolve(flags.out) : cal.calibrationPath(stateDir);
    cal.writeCalibration(d, file, c);
    return emit(c, textCalibration(c, file));
  }

  // stats
  let calibration = cal.readCalibration(d, stateDir);
  if (flags.record) {
    // [inferred] verify:post refreshes calibration first so the snapshot measures the phase that
    // just finished; it costs CPU seconds, not model tokens.
    calibration = cal.calibrate(d, P.mainRoot, { planDir });
    cal.writeCalibration(d, cal.calibrationPath(stateDir), calibration);
  }
  const rows = ledger.readLedger(d, stateDir);
  const s = computeStats(d, rows, calibration, { phase: flags.phase });
  if (flags.record) {
    const snap = snapshotRow(s, s.phase ? auditPhase(d, planDir, s.phase) : null, calibration, now());
    ledger.append(d, stateDir, snap);
    // The verify:post step runs this with --raw into the orchestrator's context on every phase,
    // so it prints one line whatever the output mode.
    const pending = ledger.cuts(rows).filter((c) => c.unreviewed).length;
    const due = dueStep(d, planDir, s.phase, stateDir, rootPlanDir);
    let line = `musk: net ${fmtQ(s.net)}` + (pending ? `; ${pending} inferred cut(s) unreviewed` : '');
    if (due) line += `. NEXT STEP for the user: ${due.skill} (${due.why}). List it in the next steps you show.`;
    else if (pending) line += ', reviewed by /gsd-musk-retro at milestone end';
    d.stdout(line + '\n');
    return;
  }
  return emit(s, textStats(s));
}

module.exports = { routeMuskCommand, parseArgs };

if (require.main === module) {
  // Standalone: node musk-router.cjs <sub> [...] [--cwd <project>]
  const argv = process.argv.slice(2);
  let cwd = process.cwd();
  const i = argv.indexOf('--cwd');
  if (i !== -1) { cwd = path.resolve(argv[i + 1]); argv.splice(i, 2); }
  try {
    routeMuskCommand({ args: ['musk', ...argv], cwd });
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
