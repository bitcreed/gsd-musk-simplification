'use strict';

// Transcripts -> calibration.json: derived prices, per-agent-type and per-phase token totals,
// and the discuss/plan runs that the pass-cost estimate multiplies fragment tokens by.

const path = require('node:path');
const { planIndex, reqsByPhase, knownPhases, cmpPhase } = require('./planning.cjs');
const { transcriptDir, transcriptDirs, scan } = require('./transcripts.cjs');

const MIN_SAMPLES = 5;

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summary(values) {
  if (values.length < MIN_SAMPLES) return null;
  const s = values.slice().sort((a, b) => a - b);
  return {
    p25: Math.round(quantile(s, 0.25)), p50: Math.round(quantile(s, 0.5)), p75: Math.round(quantile(s, 0.75)),
    n: s.length, basis: 'harness',
  };
}

// Least squares y = a + b·x.
function fit(points) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  return { a: Math.round(a), b: Math.round(b), r2: syy ? Number(((sxy * sxy) / (sxx * syy)).toFixed(3)) : 1, n };
}

function bump(obj, key, rec) {
  const e = obj[key] || (obj[key] = { runs: new Set(), tokens_total: 0, cache_read_total: 0, perRun: {} });
  e.runs.add(rec.run);
  e.tokens_total += rec.tokens;
  e.cache_read_total += rec.cache_read;
  e.perRun[rec.run] = (e.perRun[rec.run] || 0) + rec.tokens;
}

function finishBuckets(obj) {
  const out = {};
  for (const [k, e] of Object.entries(obj).sort((a, b) => b[1].tokens_total - a[1].tokens_total)) {
    const s = Object.values(e.perRun).sort((a, b) => a - b);
    out[k] = { runs: e.runs.size, tokens_total: e.tokens_total, cache_read_total: e.cache_read_total, p50_per_run: Math.round(quantile(s, 0.5)) };
  }
  return out;
}

// Discuss and planner runs that carried musk fragments. Only runs where a fragment tag shows up in
// the transcript count, each with the tags seen, so runs from before musk was installed and
// fragments whose `when` was off are not charged. `evidence: true` marks this format; older
// calibration files listed every run and are filtered by date instead (stats.passCost).
// A run copied into another file (resume, fork) is one run: runs are keyed by a stable identity
// (the command's timestamp, or an agent's first message id) and the copies' tags are merged.
function injectionRuns(files, known) {
  const ok = (p) => (p && known.has(p) ? p : null);
  const runs = { discuss: new Map(), plan: new Map() };
  let anon = 0;
  const add = (kind, id, run) => {
    const key = id || `#${anon++}`;
    const prev = runs[kind].get(key);
    if (!prev) { runs[kind].set(key, run); return; }
    prev.tags = [...new Set([...prev.tags, ...run.tags])].sort();
    prev.phase = prev.phase || run.phase;
  };
  for (const f of files) {
    const first = f.msgs.length ? f.msgs[0] : null;
    const firstTs = first ? first.ts : null;
    const evs = f.events.filter((e) => e.cmd === '/gsd-discuss-phase');
    for (const e of evs) {
      const tags = [...(f.segTags[e.idx] || [])].sort();
      if (tags.length) add('discuss', e.ts && `${e.cmd}@${e.ts}`, { phase: ok(e.phase) || (f.attr && f.attr.phase) || null, ts: e.ts, tags });
    }
    if (f.kind !== 'sub' || !f.tags.size) continue;
    const tags = [...f.tags].sort();
    const id = first && first.id;
    if (!evs.length && /\bdiscuss\b/i.test(f.description)) add('discuss', id && `agent:${id}`, { phase: f.attr.phase, ts: firstTs, tags });
    if (f.agentType === 'gsd-planner') add('plan', id && `agent:${id}`, { phase: f.attr.phase, ts: firstTs, tags });
  }
  return { evidence: true, discuss: [...runs.discuss.values()], plan: [...runs.plan.values()] };
}

// cwd names the project whose transcripts are read (the main checkout); planDir is the planning
// tree to attribute phases against (defaults to <cwd>/.planning).
function calibrate(deps, cwd, { since, planDir = path.join(cwd, '.planning') } = {}) {
  const dir = transcriptDir(deps, cwd);
  const dirs = transcriptDirs(deps, cwd);
  const sinceIso = since ? new Date(since).toISOString() : null;
  const base = {
    version: 1,
    generated_at: deps.now().toISOString(),
    runtime: 'claude-code',
    transcript_dir: dir,
    worktree_transcript_dirs: 0,
    since: sinceIso,
    min_samples: MIN_SAMPLES,
  };
  const known = knownPhases(deps, planDir);
  const scanned = scan(deps, dirs, { since: sinceIso, known, project: path.resolve(cwd) });
  if (!scanned) {
    return {
      ...base, basis: 'none', runtime: null,
      prices: { per_task: null, per_plan_overhead: null, per_phase: null, per_quick_task: null, per_req: null },
      notes: ['no Claude Code transcripts for this project; stats use priors'],
    };
  }
  const { files, records } = scanned;
  // Worktree dirs whose sessions passed the provenance check (scan()).
  base.worktree_transcript_dirs = scanned.dirsUsed.filter((d) => d !== dir).length;
  const notes = [];

  const byAgent = {};
  const byPhase = {};
  const phaseAgents = {};
  let tokens = 0;
  let cacheRead = 0;
  for (const r of records) {
    tokens += r.tokens;
    cacheRead += r.cache_read;
    bump(byAgent, r.bucket, r);
    if (r.phase) {
      bump(byPhase, r.phase, r);
      bump(phaseAgents[r.phase] || (phaseAgents[r.phase] = {}), r.bucket, r);
    }
  }

  // Executor tokens per plan (retries summed) vs the plan's task count.
  const plans = planIndex(deps, planDir);
  const perPlan = {};
  const executedPhases = new Set();
  for (const r of records) {
    if (r.agentType !== 'gsd-executor') continue;
    if (r.phase) executedPhases.add(r.phase);
    if (r.plan) perPlan[r.plan] = (perPlan[r.plan] || 0) + r.tokens;
  }
  const points = Object.entries(perPlan)
    .filter(([k]) => plans[k] && Number.isFinite(plans[k].tasks) && plans[k].tasks > 0)
    .map(([k, y]) => ({ plan: k, x: plans[k].tasks, y }));
  const unmatched = Object.keys(perPlan).length - points.length;
  if (unmatched) notes.push(`${unmatched} executed plan(s) not found in .planning (archived or renamed); excluded from the fit`);

  let perTask = null;
  let perPlanOverhead = null;
  const f = points.length >= MIN_SAMPLES ? fit(points) : null;
  if (f) {
    if (f.b > 0) perTask = summary(points.map((p) => (p.y - f.a) / p.x));
    else notes.push(`fit slope ${f.b} <= 0: per_task left null`);
    if (f.a > 0) perPlanOverhead = summary(points.map((p) => p.y - Math.max(f.b, 0) * p.x));
    else notes.push(`fit intercept ${f.a} <= 0: per_plan_overhead left null`);
  }

  // [inferred] Only phases with at least one executor run count as a phase sample, so a phase
  // that was merely discussed or planned does not drag the median down.
  const phaseTotals = [...executedPhases].map((p) => ({ phase: p, tokens: byPhase[p].tokens_total }));
  const reqs = reqsByPhase(deps, planDir);
  const perReqVals = phaseTotals.filter((p) => reqs[p.phase] && reqs[p.phase].length).map((p) => p.tokens / reqs[p.phase].length);

  const quick = {};
  for (const r of records) if (r.quick) quick[r.quick] = (quick[r.quick] || 0) + r.tokens;

  const injections = injectionRuns(files, known);
  const byPhaseOut = {};
  for (const p of Object.keys(byPhase).sort(cmpPhase)) {
    byPhaseOut[p] = {
      tokens_total: byPhase[p].tokens_total,
      cache_read_total: byPhase[p].cache_read_total,
      by_agent_type: finishBuckets(phaseAgents[p]),
    };
  }

  return {
    ...base,
    basis: 'harness',
    sessions: files.filter((x) => x.kind === 'main').length,
    subagents: files.filter((x) => x.kind === 'sub').length,
    messages: records.length,
    totals: { tokens, cache_read: cacheRead, attributed_to_phase: Object.values(byPhase).reduce((s, e) => s + e.tokens_total, 0) },
    prices: {
      per_task: perTask,
      per_plan_overhead: perPlanOverhead,
      per_phase: summary(phaseTotals.map((p) => p.tokens)),
      per_quick_task: summary(Object.values(quick)),
      per_req: summary(perReqVals),
    },
    samples: {
      per_task: points.length, per_plan_overhead: points.length, per_phase: phaseTotals.length,
      per_quick_task: Object.keys(quick).length, per_req: perReqVals.length,
    },
    fit: f,
    by_agent_type: finishBuckets(byAgent),
    by_phase: byPhaseOut,
    injections,
    notes,
  };
}

function calibrationPath(planDir) {
  return path.join(planDir, 'musk', 'calibration.json');
}

function readCalibration(deps, planDir) {
  try { return JSON.parse(deps.fs.readFileSync(calibrationPath(planDir), 'utf8')); } catch { return null; }
}

function writeCalibration(deps, file, cal) {
  deps.fs.mkdirSync(path.dirname(file), { recursive: true });
  deps.fs.writeFileSync(file, JSON.stringify(cal, null, 2) + '\n');
}

module.exports = { MIN_SAMPLES, quantile, summary, fit, calibrate, calibrationPath, readCalibration, writeCalibration };
