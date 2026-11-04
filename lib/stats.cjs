'use strict';

// Ledger + calibration -> counts, add-back ratio, gross/net savings, pass cost.

const path = require('node:path');
const { cuts: foldCuts } = require('./ledger.cjs');
const { normPhase } = require('./planning.cjs');
const { Q, effectivePrices, priceCut } = require('./pricing.cjs');

const zero = () => ({ p25: 0, p50: 0, p75: 0 });

function sum(cuts, prices) {
  const out = { ...zero(), basis: 'harness', n: 0 };
  let unpriced = 0;
  for (const c of cuts) {
    const p = priceCut(c, prices);
    if (!p) { unpriced += c.qty; continue; }
    Q.forEach((q) => { out[q] += p[q]; });
    if (p.basis !== 'harness') out.basis = 'prior';
    out.n++;
  }
  return { total: out, unpriced };
}

// Fragment tokens per injection point, from this capability's own manifest. `tag` is the
// fragment's opening tag (<musk>, <musk_lean>, ...), which marks it in transcripts.
function fragments(deps) {
  let manifest;
  try { manifest = JSON.parse(deps.fs.readFileSync(path.join(deps.capRoot, 'capability.json'), 'utf8')); } catch { return []; }
  const out = [];
  for (const c of manifest.contributions || []) {
    const rel = c.fragment && c.fragment.path;
    if (!rel) continue;
    let text = '';
    try { text = deps.fs.readFileSync(path.join(deps.capRoot, rel), 'utf8'); } catch { /* missing fragment counts 0 */ }
    const tag = (text.match(/<(musk[a-z_]*)>/) || [])[1] || null;
    out.push({ point: c.point, path: rel, tokens: Math.ceil(text.length / 4), tag, when: c.when || null });
  }
  return out;
}

const LEAN = (r) => r.type === 'cut' && (r.unit === 'lean-lane' || (r.unit === 'reroute-quick' && r.reason === 'lean'));

// Fragment tokens = each injected fragment x the runs it was injected into. Runs come from the
// calibration's transcript evidence (runs where a musk fragment tag appeared, with the tags seen)
// and from the ledger (one run per pass row at that point; one per phase with cuts at that point
// and no pass row). Either source can miss runs: transcripts can be pruned, and a pass that cut
// nothing before pass rows existed left no ledger row. Per phase the evidenced runs are kept with
// their tags, and ledger runs fill in only where the ledger counts more.
function passCost(deps, rows, calibration, phase) {
  const frags = fragments(deps);
  const inPhase = (p) => !phase || p === phase;
  const inj = (calibration && calibration.injections) || {};
  // [inferred] Calibrations written before 0.5.4 list every discuss/planner run without tags,
  // including runs from before musk was installed; for those, keep the old cut-off at the first
  // ledger row and assume the always-on fragments.
  const start = rows.map((r) => r.ts).filter(Boolean).sort()[0] || null;
  const always = (kind) => frags.filter((f) => f.point.startsWith(kind + ':') && (!f.when || f.when === 'musk.enabled')).map((f) => f.tag);
  const leanTags = frags.filter((f) => f.when === 'musk.lean_lane').map((f) => f.tag);
  const leanPhases = new Set(rows.filter(LEAN).map((r) => r.phase));

  const fromTranscripts = (kind) => (inj[kind] || [])
    .filter((r) => inPhase(r.phase) && (inj.evidence === true || (start && r.ts && r.ts >= start)))
    .map((r) => ({ phase: r.phase || null, tags: Array.isArray(r.tags) ? r.tags : always(kind) }));
  const fromLedger = (kind) => {
    const out = [];
    const counted = new Set();
    const re = new RegExp(`^${kind}:`);
    for (const r of rows) {
      if (r.type !== 'pass' || !re.test(r.point || 'discuss:pre') || !inPhase(r.phase)) continue;
      out.push({ phase: r.phase, tags: [...always(kind), ...(kind === 'discuss' && leanPhases.has(r.phase) ? leanTags : [])] });
      counted.add(r.phase);
    }
    for (const r of rows) {
      if (r.type !== 'cut' || !r.point || !re.test(r.point) || !inPhase(r.phase) || counted.has(r.phase)) continue;
      out.push({ phase: r.phase, tags: [...always(kind), ...(kind === 'discuss' && leanPhases.has(r.phase) ? leanTags : [])] });
      counted.add(r.phase);
    }
    return out;
  };
  const merged = (kind) => {
    const group = (list) => list.reduce((m, r) => { const k = r.phase || ''; (m[k] || (m[k] = [])).push(r); return m; }, {});
    const t = group(fromTranscripts(kind));
    const l = group(fromLedger(kind));
    const out = [];
    for (const k of new Set([...Object.keys(t), ...Object.keys(l)])) {
      const a = t[k] || [];
      const b = l[k] || [];
      out.push(...a, ...b.slice(a.length));
    }
    return out;
  };
  const runs = { discuss: merged('discuss'), plan: merged('plan') };

  let fragmentTokens = 0;
  for (const f of frags) {
    const kind = f.point.split(':')[0];
    for (const r of runs[kind] || []) if (!f.tag || r.tags.includes(f.tag)) fragmentTokens += f.tokens;
  }
  let skillTokens = 0;
  const agents = phase
    ? (calibration && calibration.by_phase && calibration.by_phase[phase] && calibration.by_phase[phase].by_agent_type) || {}
    : (calibration && calibration.by_agent_type) || {};
  for (const [k, v] of Object.entries(agents)) if (/musk/.test(k)) skillTokens += v.tokens_total;
  return {
    tokens: fragmentTokens + skillTokens,
    fragment_tokens: fragmentTokens,
    skill_tokens: skillTokens,
    injections: { discuss: runs.discuss.length, plan: runs.plan.length },
    fragments: frags.map((f) => ({ point: f.point, tokens: f.tokens })),
    basis: calibration && calibration.basis === 'harness' ? 'harness' : 'prior',
  };
}

function computeStats(deps, rows, calibration, { phase } = {}) {
  const ph = phase === undefined || phase === null ? null : normPhase(phase) || String(phase);
  const all = foldCuts(rows).filter((c) => !ph || c.phase === ph);
  const prices = effectivePrices(calibration);
  const applied = all.filter((c) => c.status === 'applied');
  const reinstated = applied.filter((c) => c.reinstated);
  const proposed = all.filter((c) => c.status === 'proposed');

  const grossApplied = sum(applied, prices);
  const reinstatedValue = sum(reinstated, prices);
  const gross = { basis: grossApplied.total.basis, n: grossApplied.total.n - reinstatedValue.total.n };
  Q.forEach((q) => { gross[q] = grossApplied.total[q] - reinstatedValue.total[q]; });
  const cost = passCost(deps, rows, calibration, ph);
  const net = { basis: gross.basis === 'harness' && cost.basis === 'harness' ? 'harness' : 'prior', n: gross.n };
  Q.forEach((q) => { net[q] = gross[q] - cost.tokens; });

  const byClass = {};
  const byUnit = {};
  for (const c of applied.filter((x) => !x.reinstated)) {
    byClass[c.class] = (byClass[c.class] || 0) + c.qty;
    byUnit[c.unit] = (byUnit[c.unit] || 0) + c.qty;
  }
  return {
    phase: ph,
    cuts: {
      total: all.length,
      applied: applied.length,
      proposed: proposed.length,
      rejected: all.filter((c) => c.status === 'rejected').length,
      reinstated: reinstated.length,
      active_by_class: byClass,
      active_by_unit: byUnit,
    },
    add_back_ratio: applied.length ? Number((reinstated.length / applied.length).toFixed(3)) : null,
    gross,
    gross_applied: grossApplied.total,
    reinstated_value: reinstatedValue.total,
    potential: sum(proposed, prices).total,
    unpriced: grossApplied.unpriced - reinstatedValue.unpriced,
    pass_cost: cost,
    net,
    prices,
    calibration: calibration ? { generated_at: calibration.generated_at || null, basis: calibration.basis || null } : null,
  };
}

function snapshotRow(stats, audit, calibration, ts) {
  const phaseCal = stats.phase && calibration && calibration.by_phase ? calibration.by_phase[stats.phase] : null;
  return {
    ts,
    type: 'snapshot',
    phase: stats.phase,
    measured: {
      plans: audit ? audit.plans : null,
      tasks: audit ? audit.total_tasks : null,
      tokens: phaseCal ? phaseCal.tokens_total : null,
      cache_read: phaseCal ? phaseCal.cache_read_total : null,
      basis: phaseCal ? 'harness' : 'none',
    },
    estimated: {
      cuts_applied: stats.cuts.applied,
      reinstated: stats.cuts.reinstated,
      add_back_ratio: stats.add_back_ratio,
      gross: stats.gross,
      pass_cost: stats.pass_cost.tokens,
      net: stats.net,
    },
  };
}

module.exports = { computeStats, snapshotRow, passCost, fragments };
