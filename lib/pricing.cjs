'use strict';

// Token price of a ledger cut, from calibration (basis "harness") or labelled priors.

// Priors: rounded pooled p50s from 14 real GSD projects (docs/stats.md), used until n >= 5 locally.
const PRIORS = { per_task: 110000, per_plan_overhead: 60000, per_phase: 7000000, per_quick_task: 450000, per_req: 1000000 };
const FAST_COST = 20000;
const PHASE_MERGE_SHARE = 0.35;
// A cut success criterion saves its share of the phase's execution, not of its fixed ceremony:
// median 5 criteria per phase (162 phases) x executors' ~40% share of phase tokens = 0.08.
const CRITERION_SHARE = 0.08;
// The lean lane's RESEARCH.md stub and PATTERNS.md make plan-phase skip the researcher and the
// pattern mapper; discuss, planning, execution, checking and verification all still run (the
// skipped questioning is not counted: discuss still writes CONTEXT.md). docs/stats.md measures
// gsd-phase-researcher at 3% and gsd-pattern-mapper at 1% of all tokens, of which GSD-attributed
// work is 82%: (3% + 1%) / 82% = 4.9%, so a lean phase saves ~5% of per_phase, not a whole phase.
const LEAN_SHARE = 0.05;
const Q = ['p25', 'p50', 'p75'];

function effectivePrices(calibration) {
  const cal = (calibration && calibration.prices) || {};
  const out = {};
  for (const [k, v] of Object.entries(PRIORS)) {
    out[k] = cal[k] ? { ...cal[k], basis: 'harness' } : { p25: v, p50: v, p75: v, n: 0, basis: 'prior' };
  }
  return out;
}

const map = (price, f) => Object.fromEntries(Q.map((q) => [q, Math.max(0, Math.round(f(price[q], q)))]));

// -> { p25, p50, p75, basis } or null (unpriced unit, e.g. step-skip).
function priceCut(cut, prices) {
  const qty = Number(cut.qty) || 1;
  // [inferred] Lean-lane rows logged before 0.5.3 used `reroute-quick` with reason "lean"; price
  // them as what actually happened.
  const u = cut.unit === 'reroute-quick' && cut.reason === 'lean' ? 'lean-lane' : cut.unit;
  let v;
  let basis;
  const use = (...keys) => { basis = keys.every((k) => prices[k].basis === 'harness') ? 'harness' : 'prior'; };
  if (['task', 'test', 'doc', 'file', 'flag', 'abstraction', 'layer', 'dep'].includes(u)) {
    use('per_task'); v = map(prices.per_task, (x) => x * qty);
  } else if (u === 'feature' && cut.point === 'plan:pre') {
    // A feature the planner left out is a task or so of work, not a whole requirement.
    use('per_task'); v = map(prices.per_task, (x) => x * qty);
  } else if (u === 'criterion') {
    use('per_phase'); v = map(prices.per_phase, (x) => x * CRITERION_SHARE * qty);
  } else if (['req', 'feature'].includes(u)) {
    use('per_req'); v = map(prices.per_req, (x) => x * qty);
  } else if (u === 'milestone-phase') {
    use('per_phase'); v = map(prices.per_phase, (x) => x * qty);
  } else if (u === 'phase-merge') {
    use('per_phase'); v = map(prices.per_phase, (x) => x * PHASE_MERGE_SHARE * qty);
  } else if (u === 'plan-merge') {
    use('per_plan_overhead'); v = map(prices.per_plan_overhead, (x) => x * qty);
  } else if (u === 'lean-lane') {
    use('per_phase'); v = map(prices.per_phase, (x) => x * LEAN_SHARE * qty);
  } else if (u === 'reroute-quick') {
    // Quantiles of a difference are not differences of quantiles; pair opposite ends instead so
    // the range stays ordered (a conservative low, the median gap, an optimistic high).
    use('per_phase', 'per_quick_task');
    const pq = prices.per_quick_task;
    const opp = { p25: 'p75', p50: 'p50', p75: 'p25' };
    v = map(prices.per_phase, (x, q) => (x - pq[opp[q]]) * qty);
  } else if (u === 'reroute-fast') {
    use('per_phase'); v = map(prices.per_phase, (x) => (x - FAST_COST) * qty);
  } else {
    return null;
  }
  return { ...v, basis };
}

module.exports = { PRIORS, Q, effectivePrices, priceCut };
