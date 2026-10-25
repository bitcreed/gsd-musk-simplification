#!/usr/bin/env node
'use strict';

// Regenerates the numbers in STATS.md from real GSD projects (read-only).
//   node scripts/real-world-stats.cjs <project-dir>... [--json]
// Output is anonymised: projects are labelled by letter, language and phase count, never by path.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const planning = require('../lib/planning.cjs');
const { scan, transcriptDir } = require('../lib/transcripts.cjs');
const { mergeCandidates } = require('../lib/audit.cjs');
const { quantile, summary, fit } = require('../lib/calibrate.cjs');
const { effectivePrices, priceCut } = require('../lib/pricing.cjs');

const deps = { fs, homedir: os.homedir, now: () => new Date() };
const LEAN_MAX = 3;

const MARKERS = [['pubspec.yaml', 'Dart'], ['Cargo.toml', 'Rust'], ['build.gradle', 'Kotlin'], ['build.gradle.kts', 'Kotlin'],
  ['pyproject.toml', 'Python'], ['setup.py', 'Python'], ['requirements.txt', 'Python'], ['tsconfig.json', 'TypeScript'],
  ['package.json', 'JavaScript'], ['extension.js', 'JavaScript']];
// Build marker in the project root, then one level down, then the conventional parent dir name (a
// project that is only planned has no build file yet).
function language(dir) {
  const find = (d) => (MARKERS.find(([f]) => fs.existsSync(path.join(d, f))) || [])[1];
  const subs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules');
  const byParent = { flutter: 'Dart', python: 'Python', rust: 'Rust', kotlin: 'Kotlin', web: 'TypeScript' };
  return find(dir) || subs.map((e) => find(path.join(dir, e.name))).find(Boolean) || byParent[path.basename(path.dirname(dir))] || 'other';
}

function countFiles(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? countFiles(path.join(dir, e.name)) : 1;
  return n;
}

// Ceremony shape from every phase dir (current and archived), including duplicate phase numbers.
function shape(planDir) {
  const phases = [];
  for (const d of planning.phaseDirs(deps, planDir)) {
    const plans = fs.readdirSync(d.dir).filter((f) => /-PLAN\.md$/.test(f)).sort()
      .map((f) => planning.parsePlan(deps, path.join(d.dir, f))).filter(Boolean);
    const known = plans.every((p) => Number.isFinite(p.tasks));
    const total = known ? plans.reduce((s, p) => s + p.tasks, 0) : null;
    phases.push({ plans: plans.length, tasks: plans.map((p) => p.tasks), total, files: countFiles(d.dir), merge: plans.length ? mergeCandidates(plans) : [] });
  }
  return phases;
}

// Token samples from this project's transcripts, attributed by lib/transcripts.cjs.
function tokens(dir, planDir) {
  const scanned = scan(deps, transcriptDir(deps, dir), { known: planning.knownPhases(deps, planDir) });
  if (!scanned || !scanned.records.length) return null;
  const recs = scanned.records;
  const byBucket = {}; const byPhase = {}; const phaseCR = {}; const byQuick = {}; const quickCR = {}; const perPlan = {}; const planCR = {};
  const executed = new Set();
  let total = 0; let cr = 0; let attributed = 0; let lo = null; let hi = null;
  for (const r of recs) {
    total += r.tokens; cr += r.cache_read;
    byBucket[r.bucket] = (byBucket[r.bucket] || 0) + r.tokens;
    if (r.phase || r.quick) attributed += r.tokens;
    if (r.phase) { byPhase[r.phase] = (byPhase[r.phase] || 0) + r.tokens; phaseCR[r.phase] = (phaseCR[r.phase] || 0) + r.cache_read; }
    if (r.quick) { byQuick[r.quick] = (byQuick[r.quick] || 0) + r.tokens; quickCR[r.quick] = (quickCR[r.quick] || 0) + r.cache_read; }
    if (r.agentType === 'gsd-executor') {
      if (r.phase) executed.add(r.phase);
      if (r.plan) { perPlan[r.plan] = (perPlan[r.plan] || 0) + r.tokens; planCR[r.plan] = (planCR[r.plan] || 0) + r.cache_read; }
    }
    if (r.ts) { if (!lo || r.ts < lo) lo = r.ts; if (!hi || r.ts > hi) hi = r.ts; }
  }
  const idx = planning.planIndex(deps, planDir);
  const reqs = planning.reqsByPhase(deps, planDir);
  const plans = Object.keys(perPlan).filter((k) => idx[k] && idx[k].tasks > 0);
  const ph = [...executed];
  return {
    total, cache_read: cr, attributed, phaseTotal: Object.values(byPhase).reduce((s, v) => s + v, 0), from: lo, to: hi, byBucket,
    task: plans.map((k) => perPlan[k] / idx[k].tasks), task_cr: plans.map((k) => planCR[k] / idx[k].tasks),
    points: plans.map((k) => ({ x: idx[k].tasks, y: perPlan[k] })),
    phase: ph.map((p) => byPhase[p]), phase_cr: ph.map((p) => phaseCR[p]),
    quick: Object.values(byQuick), quick_cr: Object.values(quickCR),
    req: ph.filter((p) => reqs[p] && reqs[p].length).map((p) => byPhase[p] / reqs[p].length),
  };
}

const isGsd = (b) => /^gsd-/.test(b) || /^orchestrator:\/gsd-/.test(b);
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(0)}%` : '–');
const tok = (n) => (n === null || n === undefined ? '–' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1e3)}k`);
const q = (vals) => { const s = summary(vals); return s ? `${tok(s.p25)} / **${tok(s.p50)}** / ${tok(s.p75)} (n=${s.n})` : `– (n=${vals.length})`; };
const med = (vals) => (vals.length ? tok(quantile(vals.slice().sort((a, b) => a - b), 0.5)) : '–');
const cat = (list, k) => list.flatMap((p) => (p.t ? p.t[k] : []));

function analyse(dirs) {
  const projects = dirs.map((dir) => {
    const planDir = path.join(dir, '.planning');
    const sh = shape(planDir);
    return { lang: language(dir), nPhases: new Set(planning.phaseDirs(deps, planDir).map((d) => d.phase)).size, shape: sh, t: tokens(dir, planDir) };
  }).sort((a, b) => b.nPhases - a.nPhases || (b.t ? b.t.total : 0) - (a.t ? a.t.total : 0));
  projects.forEach((p, i) => { p.label = `${String.fromCharCode(65 + i)} (${p.lang}, ${p.nPhases} phase${p.nPhases === 1 ? '' : 's'})`; });
  return projects;
}

function render(projects) {
  const withT = projects.filter((p) => p.t);
  const all = [{ label: '**Pooled**', t: null }, ...withT];
  const out = [];
  const row = (cells) => out.push(`| ${cells.join(' | ')} |`);
  const metric = (p, k) => (p.t ? p.t[k] : cat(withT, k));

  out.push('### Cost per unit (headline tokens, p25 / **p50** / p75)', '');
  row(['Project', 'Executed task', 'Phase', 'Quick task', 'Requirement', 'Fit r² (exec ~ tasks)']);
  row(['---', '---', '---', '---', '---', '---']);
  for (const p of all) {
    const f = fit(metric(p, 'points'));
    row([p.label, q(metric(p, 'task')), q(metric(p, 'phase')), q(metric(p, 'quick')), q(metric(p, 'req')), f ? `${f.r2} (n=${f.n})` : '–']);
  }
  out.push('', '### Cache reads (p50, reported separately)', '');
  row(['Project', 'Total tokens', 'Total cache read', 'Task', 'Phase', 'Quick task', 'Attributed to a phase/quick', 'Date range']);
  row(['---', '---', '---', '---', '---', '---', '---', '---']);
  const sum = (k) => withT.reduce((s, p) => s + p.t[k], 0);
  const range = (list) => `${list.map((p) => p.t.from).sort()[0].slice(0, 10)} – ${list.map((p) => p.t.to).sort().pop().slice(0, 10)}`;
  for (const p of all) {
    const t = p.t || { total: sum('total'), cache_read: sum('cache_read'), attributed: sum('attributed') };
    row([p.label, tok(t.total), tok(t.cache_read), med(metric(p, 'task_cr')), med(metric(p, 'phase_cr')), med(metric(p, 'quick_cr')), pct(t.attributed, t.total), range(p.t ? [p] : withT)]);
  }

  // Where the tokens go (pooled).
  const buckets = {};
  withT.forEach((p) => Object.entries(p.t.byBucket).forEach(([b, v]) => { buckets[b] = (buckets[b] || 0) + v; }));
  const total = sum('total');
  const gsd = Object.entries(buckets).filter(([b]) => isGsd(b)).reduce((s, [, v]) => s + v, 0);
  const exec = buckets['gsd-executor'] || 0;
  out.push('', '### Where the tokens go (pooled, share of all tokens)', '');
  row(['Bucket', 'Tokens', 'Share']); row(['---', '---', '---']);
  const sorted = Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  const top = sorted.filter(([, v]) => v / total >= 0.005);
  top.forEach(([b, v]) => row([`\`${b}\``, tok(v), pct(v, total)]));
  const rest = sorted.slice(top.length).reduce((s, [, v]) => s + v, 0);
  row([`other (${sorted.length - top.length} buckets < 0.5%)`, tok(rest), pct(rest, total)]);
  out.push('', `GSD-attributed buckets (\`gsd-*\` agents + \`orchestrator:/gsd-*\`): ${tok(gsd)} = ${pct(gsd, total)} of all tokens. ` +
    `Executor share of GSD tokens: ${pct(exec, gsd)}. **Ceremony share (upper bound): ${pct(gsd - exec, gsd)}.**`, '');
  row(['Project', 'Executed plans', 'Executor / GSD tokens', 'Ceremony share (upper bound)']); row(['---', '---', '---', '---']);
  for (const p of withT) {
    const g = Object.entries(p.t.byBucket).filter(([b]) => isGsd(b)).reduce((s, [, v]) => s + v, 0);
    const e = p.t.byBucket['gsd-executor'] || 0;
    row([p.label, p.t.points.length, pct(e, g), pct(g - e, g)]);
  }

  // Ceremony shape.
  out.push('', '### Ceremony shape (every phase dir with ≥1 plan)', '');
  row(['Project', 'Phases', 'Plans/phase p50', 'Tasks/plan p50', 'Plans with 1–2 tasks', 'Phases ≤3 tasks (lean-eligible)', 'Phases with merge candidates', 'Files/phase dir p25/p50/p75']);
  row(['---', '---', '---', '---', '---', '---', '---', '---']);
  const shp = (list) => {
    const ph = list.filter((x) => x.plans > 0);
    const tasks = ph.flatMap((x) => x.tasks).filter(Number.isFinite);
    const known = ph.filter((x) => x.total !== null);
    const files = ph.map((x) => x.files).sort((a, b) => a - b);
    const qq = (s, v) => Math.round(quantile(s, v));
    return {
      ph, tasks, lean: known.filter((x) => x.total <= LEAN_MAX), merge: ph.filter((x) => x.merge.length),
      cells: [ph.length, quantile(ph.map((x) => x.plans).sort((a, b) => a - b), 0.5), quantile(tasks.slice().sort((a, b) => a - b), 0.5),
        pct(tasks.filter((n) => n <= 2).length, tasks.length), pct(known.filter((x) => x.total <= LEAN_MAX).length, known.length),
        pct(ph.filter((x) => x.merge.length).length, ph.length), ph.length ? `${qq(files, 0.25)} / ${qq(files, 0.5)} / ${qq(files, 0.75)}` : '–'],
    };
  };
  const pooled = shp(projects.flatMap((p) => p.shape));
  row(['**Pooled**', ...pooled.cells]);
  for (const p of projects) { const s = shp(p.shape); if (s.ph.length) row([p.label, ...s.cells]); }
  const hist = {};
  pooled.tasks.forEach((n) => { const k = n >= 6 ? '6+' : String(n); hist[k] = (hist[k] || 0) + 1; });
  out.push('', `Plan size distribution (pooled, n=${pooled.tasks.length} plans): ` +
    ['1', '2', '3', '4', '5', '6+'].map((k) => `${k} task${k === '1' ? '' : 's'}: ${hist[k] || 0} (${pct(hist[k] || 0, pooled.tasks.length)})`).join(', ') + '.');

  // Illustrative estimate: musk pricing over the audited shape, priced with pooled measured prices.
  const cal = { prices: { per_phase: summary(cat(withT, 'phase')), per_quick_task: summary(cat(withT, 'quick')), per_task: summary(cat(withT, 'task')), per_req: summary(cat(withT, 'req')), per_plan_overhead: null } };
  const prices = effectivePrices(cal);
  const nLean = pooled.lean.length;
  const leanSet = new Set(pooled.lean);
  const nMerge = pooled.merge.filter((x) => !leanSet.has(x)).reduce((s, x) => s + x.merge.reduce((t, g) => t + g.plans.length - 1, 0), 0);
  const reroute = priceCut({ unit: 'reroute-quick', qty: nLean }, prices);
  const merge = priceCut({ unit: 'plan-merge', qty: nMerge }, prices);
  const nPh = pooled.ph.length;
  const base = prices.per_phase.p50 * nPh;
  const saved = reroute.p50 + merge.p50;
  const prep = (buckets['gsd-phase-researcher'] || 0) + (buckets['gsd-pattern-mapper'] || 0);
  const low = nLean * (prep / sum('phaseTotal')) * prices.per_phase.p50;
  out.push('', '### Illustrative estimate (not measured)', '',
    `- Prices (pooled): per_phase p50 ${tok(prices.per_phase.p50)} (${prices.per_phase.basis}), per_quick_task p50 ${tok(prices.per_quick_task.p50)} (${prices.per_quick_task.basis}), per_plan_overhead ${tok(prices.per_plan_overhead.p50)} (${prices.per_plan_overhead.basis}).`,
    `- Lean-eligible phases: ${nLean} × reroute-quick (per_phase − per_quick_task) = ${tok(reroute.p25)} / **${tok(reroute.p50)}** / ${tok(reroute.p75)} (p25/p50/p75).`,
    `- Plan merges in the other phases: ${nMerge} plans × plan-merge (${tok(prices.per_plan_overhead.p50)}) = **${tok(merge.p50)}**.`,
    `- Lower bound (lean lane drops only research + pattern mapping): those agents are ${pct(prep, sum('phaseTotal'))} of phase-attributed tokens; ${nLean} × ${pct(prep, sum('phaseTotal'))} × ${tok(prices.per_phase.p50)} = **${tok(low)}**.`,
    `- Baseline: ${nPh} phases × per_phase p50 ${tok(prices.per_phase.p50)} = ${tok(base)}. Upper estimate (p50): ${tok(saved)} = **${pct(saved, base)}**; lower bound: ${tok(low + merge.p50)} = **${pct(low + merge.p50, base)}** of baseline.`);
  return out.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dirs = args.filter((a) => !a.startsWith('--')).map((d) => path.resolve(d));
  if (!dirs.length) { process.stderr.write('usage: real-world-stats.cjs <project-dir>... [--json]\n'); process.exit(1); }
  const projects = analyse(dirs);
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(projects.map(({ label, shape: s, t }) => ({ label, shape: s, tokens: t && { ...t, points: undefined } })), null, 2) + '\n');
  } else {
    process.stdout.write(render(projects) + '\n');
  }
}

module.exports = { analyse, render };
