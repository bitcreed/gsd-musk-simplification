'use strict';

/**
 * musk-router.cjs — `gsd-tools musk <sub>` command family.
 *
 * routeMuskCommand({ args, cwd, raw, error, deps }): args[0] === 'musk', args[1] = subcommand.
 * Synchronous (the gsd-tools dispatcher rejects Promise-returning routers). Output is plain text,
 * or a single JSON document when --json / --raw / `raw` is given.
 *
 * deps (all optional, for tests): fs, homedir(), now(), stdout(str), capRoot, and for the ledger
 * lock pid, hostname(), pidAlive(pid).
 */

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
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

const VALUE_FLAGS = new Set(['class', 'unit', 'ref', 'reason', 'phase', 'point', 'status', 'qty', 'since', 'out', 'message']);
const SUBS = ['commit', 'record', 'log', 'reinstate', 'confirm', 'list', 'pass', 'phase-check', 'milestone-check', 'audit', 'calibrate', 'stats'];

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
    commit: deps.commit || gsdCommit,
    // ledger lock owner identity and liveness (lib/ledger.cjs defaults to the real ones)
    pid: deps.pid,
    hostname: deps.hostname,
    pidAlive: deps.pidAlive,
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

// Commit musk's own files the way every GSD step commits its docs: through `gsd-tools query
// commit`, which applies commit_docs and skips cleanly when there is nothing to commit. It can
// exit 0 and still report a failure, so the verdict comes from its JSON `reason`.
const COMMIT_OK = /^(committed|nothing_to_commit|skipped_)/;
function gsdCommit(cwd, message, files) {
  const main = require.main && require.main.filename;
  const tools = main && /gsd-tools\.cjs$/.test(main) ? main : path.join(os.homedir(), '.claude', 'gsd-core', 'bin', 'gsd-tools.cjs');
  const r = spawnSync(process.execPath, [tools, 'query', 'commit', message, '--files', ...files], { cwd, encoding: 'utf8', timeout: 60000 });
  return commitVerdict(r.status, `${r.stdout || ''}`, `${r.stderr || ''}`);
}

function commitVerdict(status, stdout, stderr = '') {
  let res = null;
  try { res = JSON.parse(stdout); } catch { /* text mode */ }
  const reason = (res && res.reason) || (stdout.match(/"reason":\s*"([^"]+)"/) || [])[1] || stdout.trim().split('\n').pop() || (status === 0 ? 'committed' : 'failed');
  const ok = status === 0 && COMMIT_OK.test(reason);
  const error = ok ? undefined : ((res && res.error) || stderr.trim().split('\n').pop() || undefined);
  return error ? { ok, reason, error } : { ok, reason };
}

// commit_docs as the INVOKING checkout sets it. musk state is committed in the main checkout, so
// gsd-tools sees the main checkout's policy; a worktree or workstream that turned docs commits off
// must not have musk commit them anyway. Resolved as gsd-core's loadConfig does: the workstream
// config deep-merged over the root one, then the flat key before `planning.commit_docs`.
function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? deepMerge(base[k], v) : v;
  }
  return out;
}
function commitDocsOff(d, P) {
  let cfg = {};
  for (const dir of new Set([P.rootPlanDir, P.planDir])) {
    try { cfg = deepMerge(cfg, JSON.parse(d.fs.readFileSync(path.join(dir, 'config.json'), 'utf8')) || {}); } catch { /* absent or unreadable: next */ }
  }
  const v = cfg.commit_docs !== undefined ? cfg.commit_docs : cfg.planning && cfg.planning.commit_docs;
  return v === false;
}

function commitMusk(d, P, message) {
  const rel = path.relative(P.mainRoot, path.join(P.stateDir, 'musk')) || '.planning/musk';
  if (!d.fs.existsSync(path.join(P.stateDir, 'musk'))) return { ok: true, reason: 'nothing_to_commit' };
  if (commitDocsOff(d, P)) return { ok: true, reason: 'skipped_commit_docs_false' };
  try { return d.commit(P.mainRoot, message, [rel + '/']); } catch (e) { return { ok: false, reason: 'failed', error: e.message }; }
}

// milestone-check plus the settings in effect and `pass_due`: the milestone pass never ran, it is
// enabled, and unstarted phases remain for it to trim.
function milestoneStatus(d, planDir, stateDir, rootPlanDir, root) {
  const mc = planning.milestoneCheck(d, planDir, stateDir, root);
  const config = muskConfig(d, planDir, rootPlanDir);
  // A phase ticked `[x]` in ROADMAP.md (done or superseded) has nothing left to trim.
  let roadmap = '';
  try { roadmap = d.fs.readFileSync(path.join(planDir, 'ROADMAP.md'), 'utf8'); } catch { /* none */ }
  const ticked = new Set([...roadmap.matchAll(/^\s*[-*]\s*\[[xX]\].*?\bPhase\s+(\d+(?:\.\d+)*)/gm)].map((m) => planning.normPhase(m[1])));
  const unstarted = mc.phases.filter((p) => !mc.phases_started.includes(p) && !ticked.has(p));
  const passDue = Boolean(mc.milestone) && !mc.marker_exists && unstarted.length > 0 && config.milestone_pass !== false && config.enabled !== false;
  return { ...mc, pass_due: passDue, config };
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

  if (sub === 'commit') {
    // execute:post step (phases and /gsd-quick): sweeps the ledger rows and calibration written
    // during planning and execution into history, as GSD does with its own artifacts.
    const r = commitMusk(d, P, flags.message || 'docs(musk): ledger and calibration');
    return emit(r, `musk: commit ${r.reason}`);
  }

  if (sub === 'log') {
    const { row, error: err } = ledger.withLock(d, stateDir, () => {
      const r = ledger.buildCut(ledger.readLedger(d, stateDir), flags, now());
      if (r.row) ledger.append(d, stateDir, r.row);
      return r;
    });
    if (err) return fail(err);
    return emit(row, row.id);
  }

  if (sub === 'confirm') {
    // Append-only, like reinstate: never rewrite a cut row.
    if (!pos.length) return fail('usage: musk confirm <id>... [--reason <text>]');
    // All ids are checked before any row is written, so a typo confirms nothing.
    const { added, error: err } = ledger.withLock(d, stateDir, () => {
      const rows = ledger.readLedger(d, stateDir);
      const out = [];
      for (const id of pos) {
        const r = ledger.buildConfirm(rows, id, flags.reason, now());
        if (r.error) return { error: r.error };
        rows.push(r.row);
        out.push(r.row);
      }
      out.forEach((row) => ledger.append(d, stateDir, row));
      return { added: out };
    });
    if (err) return fail(err);
    return emit(added, added.map((r) => `${r.id} confirmed`).join('\n'));
  }

  if (sub === 'reinstate') {
    const { row, error: err } = ledger.withLock(d, stateDir, () => {
      const r = ledger.buildReinstate(ledger.readLedger(d, stateDir), pos[0], flags.reason, now());
      if (r.row) ledger.append(d, stateDir, r.row);
      return r;
    });
    if (err) return fail(err);
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
    ledger.withLock(d, stateDir, () => ledger.append(d, stateDir, row));
    return emit(row, `musk: pass recorded for phase ${row.phase}`);
  }

  if (sub === 'phase-check') {
    // Safety net run at plan:pre: a phase whose discuss skipped the pass (discuss skipped, a
    // hand-driven workflow, an older ledger in a worktree) gets the pass text now.
    const phase = planning.normPhase(flags.phase);
    const config = muskConfig(d, planDir, rootPlanDir);
    if (config.enabled === false) return emit({ phase, recorded: null, action: 'none' }, 'musk: disabled');
    if (!phase) return emit({ phase: flags.phase ?? null, recorded: null, action: 'none' }, `musk: no phase check for ${flags.phase ?? '(none)'}`);
    // The milestone pass is due here too: discuss is optional, and a project planned straight from
    // its roadmap would otherwise never get it (the verify:post reminder only reaches the user).
    const ms = milestoneStatus(d, planDir, stateDir, rootPlanDir, root);
    // The host read this phase's requirement IDs before the planner started and hands the same
    // list to the plan checker and the coverage gate, so a requirement deferred from here would be
    // flagged as missing. At plan time this phase's requirement cuts are therefore proposals only.
    const msLine = ms.pass_due ? `musk: the milestone pass never ran. Before anything else, invoke skill \`gsd-musk-roadmap\` with \`auto\`, but leave phase ${phase}'s own requirements in place (log their cuts with --status proposed), then continue below.\n` : '';
    const rows = ledger.readLedger(d, stateDir);
    let evidence = ledger.passRecorded(rows, phase) ? 'ledger' : null;
    if (!evidence) {
      const pd = planning.findPhaseDir(d, planDir, phase);
      const ctxFile = pd && (() => { try { return d.fs.readdirSync(pd.dir).find((f) => /CONTEXT\.md$/.test(f)); } catch { return null; } })();
      if (ctxFile && /\bmusk\b/i.test(d.fs.readFileSync(path.join(pd.dir, ctxFile), 'utf8'))) evidence = 'context';
    }
    if (evidence) return emit({ phase, recorded: true, evidence, action: ms.pass_due ? 'run-milestone-pass' : 'none' }, `${msLine}musk: pass recorded for phase ${phase}`);
    // Not the discuss:pre text: that one defers cuts into CONTEXT.md's Deferred Ideas, which the
    // planner must leave out of its plans while the checker still demands every requirement ID.
    const text = [
      `musk: no subtraction pass recorded for phase ${phase}. Run it now, before you plan. The phase's requirement IDs are fixed and the plan checker demands each one, so scope cuts are proposals only:`,
      `1. Each requirement and success criterion needs an owner: a user statement, a PROJECT.md goal, a SPEC or ADR, or an owned item's dependency. Flag those that are ownerless, duplicated or nice-to-have; never security mitigations, locked decisions, anything the user asked for, tests guarding behaviour that remains, or api-coverage rows.`,
      `2. Log each: \`gsd-tools musk log --class scope --unit req|criterion --ref "<ID>: <full text>" --reason "<why>" --phase ${phase} --point plan:pre --status proposed --inferred\``,
      `3. Keep every flagged item in scope and plan it in full. Write it nowhere else: not to CONTEXT.md (no Deferred Ideas, no D-NN), REQUIREMENTS.md or ROADMAP.md.`,
      `4. In your return, list the proposals (M-id, ID, reason) for the user to approve.`,
      `Implementation cuts follow your musk planner rules as usual. When done (also when nothing was flagged): gsd-tools musk pass --phase ${phase} --point plan:pre`,
    ].join('\n');
    return emit({ phase, recorded: false, evidence: null, action: ms.pass_due ? 'run-milestone-pass' : 'run-pass', milestone_pass_due: ms.pass_due, instructions: msLine + text }, msLine + text);
  }

  if (sub === 'milestone-check') {
    const r = milestoneStatus(d, planDir, stateDir, rootPlanDir, root);
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

  // stats; `record` is the verify:post step (`stats --record` before 0.5.3: a manifest command
  // may not carry flags, so that form was rejected by conforming hosts).
  if (sub === 'record') flags.record = true;
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
    ledger.withLock(d, stateDir, () => ledger.append(d, stateDir, snap));
    // The verify:post step runs this with --raw into the orchestrator's context on every phase,
    // so it prints one line whatever the output mode.
    const pending = ledger.cuts(rows).filter((c) => c.unreviewed).length;
    const due = dueStep(d, planDir, s.phase, stateDir, rootPlanDir);
    let line = `musk: net ${fmtQ(s.net)}` + (pending ? `; ${pending} inferred cut(s) unreviewed` : '');
    if (due) line += `. NEXT STEP for the user: ${due.skill} (${due.why}). List it in the next steps you show.`;
    else if (pending) line += ', reviewed by /gsd-musk-retro at milestone end';
    // verify:post: commit this phase's measurements with the rest of the phase's docs.
    const c = commitMusk(d, P, `docs(musk): phase ${s.phase || '?'} measurements`);
    if (!c.ok) line += ` (musk files not committed: ${c.reason})`;
    d.stdout(line + '\n');
    return;
  }
  return emit(s, textStats(s));
}

module.exports = { routeMuskCommand, parseArgs, commitVerdict };

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
