'use strict';

// Deterministic plan-ceremony metrics for one phase.

const path = require('node:path');
const { normPhase, phasePlans } = require('./planning.cjs');

const MERGE_MAX_TASKS = 3;

function overlap(plans) {
  const seen = new Set();
  for (const p of plans) for (const f of p.files_modified) {
    if (seen.has(f)) return true;
    seen.add(f);
  }
  return false;
}

function group(plans, reason) {
  return {
    plans: plans.map((p) => p.id),
    tasks: plans.reduce((s, p) => s + p.tasks, 0),
    reason,
    files_overlap: overlap(plans),
  };
}

// Linear chains first (A <- B where B depends only on A and nothing else depends on A), then
// same-wave packing of what is left. Each plan joins at most one group. Files may be disjoint
// or overlapping — merging never needs a file constraint.
function mergeCandidates(plans) {
  const known = plans.filter((p) => p.id && Number.isFinite(p.tasks));
  known.sort((a, b) => (a.id < b.id ? -1 : 1));
  const byId = new Map(known.map((p) => [p.id, p]));
  const dependents = new Map();
  for (const p of known) for (const d of p.depends_on) {
    if (!dependents.has(d)) dependents.set(d, []);
    dependents.get(d).push(p.id);
  }
  const used = new Set();
  const out = [];

  for (const start of known) {
    if (used.has(start.id)) continue; // plans arrive sorted by id, so heads come before their tails
    const chain = [start];
    let cur = start;
    for (;;) {
      const kids = dependents.get(cur.id) || [];
      if (kids.length !== 1) break;
      const next = byId.get(kids[0]);
      if (!next || used.has(next.id) || next.depends_on.length !== 1) break;
      if (chain.reduce((s, p) => s + p.tasks, 0) + next.tasks > MERGE_MAX_TASKS) break;
      chain.push(next);
      cur = next;
    }
    if (chain.length > 1) {
      chain.forEach((p) => used.add(p.id));
      out.push(group(chain, 'linear-chain'));
    }
  }

  const waves = new Map();
  for (const p of known) {
    if (used.has(p.id) || p.wave === null) continue;
    if (!waves.has(p.wave)) waves.set(p.wave, []);
    waves.get(p.wave).push(p);
  }
  for (const [, members] of [...waves.entries()].sort((a, b) => a[0] - b[0])) {
    const pool = members.slice().sort((a, b) => a.tasks - b.tasks);
    while (pool.length > 1) {
      const g = [pool.shift()];
      let sum = g[0].tasks;
      for (let i = 0; i < pool.length;) {
        if (sum + pool[i].tasks <= MERGE_MAX_TASKS) { sum += pool[i].tasks; g.push(pool.splice(i, 1)[0]); }
        else i++;
      }
      if (g.length > 1) out.push(group(g, 'same-wave'));
      else break;
    }
  }
  return out;
}

function auditPhase(deps, planDir, phase) {
  const { dir, plans } = phasePlans(deps, planDir, phase);
  const totalTasks = plans.every((p) => Number.isFinite(p.tasks)) ? plans.reduce((s, p) => s + p.tasks, 0) : null;
  return {
    phase: normPhase(phase),
    phase_dir: dir ? path.relative(path.dirname(planDir), dir) : null,
    plans: plans.length,
    waves: [...new Set(plans.map((p) => p.wave).filter((w) => w !== null))].length,
    per_plan: plans.map((p) => ({
      id: p.id, wave: p.wave, tasks: p.tasks, files: p.files_modified.length, depends_on: p.depends_on,
    })),
    total_tasks: totalTasks,
    merge_candidates: mergeCandidates(plans),
    // [inferred] "one plan's worth" read as: at least one plan exists and all tasks fit one small plan.
    quick_eligible: plans.length > 0 && totalTasks !== null ? totalTasks <= MERGE_MAX_TASKS : null,
  };
}

module.exports = { auditPhase, mergeCandidates };
