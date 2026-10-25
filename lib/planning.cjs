'use strict';

// Direct, tolerant parsers for a GSD .planning tree. Unknown -> null, never throw.

const path = require('node:path');

function read(deps, p) {
  try { return deps.fs.readFileSync(p, 'utf8'); } catch { return null; }
}

function list(deps, dir) {
  try { return deps.fs.readdirSync(dir); } catch { return []; }
}

// "07.1" -> "7.1", "09" -> "9". Non-numeric input -> null.
function normPhase(s) {
  if (s === undefined || s === null) return null;
  const m = String(s).trim().match(/^0*(\d+(?:\.\d+)*)$/);
  if (!m) return null;
  return m[1].split('.').map((seg) => seg.replace(/^0+(?=\d)/, '')).join('.');
}

function cmpPhase(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

// Plan key "<phase>-<PP>", e.g. ("09", "4") -> "9-04".
function planKey(phase, plan) {
  const ph = normPhase(phase);
  const m = String(plan).match(/^0*(\d+)$/);
  if (!ph || !m) return null;
  return `${ph}-${m[1].padStart(2, '0')}`;
}

function phaseDirs(deps, planDir) {
  const out = [];
  for (const sub of ['phases']) {
    const base = path.join(planDir, sub);
    for (const name of list(deps, base)) {
      const m = name.match(/^(\d+(?:\.\d+)*)-/);
      if (m) out.push({ phase: normPhase(m[1]), dir: path.join(base, name), name });
    }
  }
  // Archived milestone phase dirs (milestones/<v>-phases/NN-slug), when a project archives them.
  for (const name of list(deps, path.join(planDir, 'milestones'))) {
    if (!/-phases$/.test(name)) continue;
    const base = path.join(planDir, 'milestones', name);
    for (const d of list(deps, base)) {
      const m = d.match(/^(\d+(?:\.\d+)*)-/);
      if (m) out.push({ phase: normPhase(m[1]), dir: path.join(base, d), name: d, archived: true });
    }
  }
  return out;
}

function findPhaseDir(deps, planDir, phase) {
  const want = normPhase(phase);
  const hits = phaseDirs(deps, planDir).filter((d) => d.phase === want);
  return (hits.find((d) => !d.archived) || hits[0] || null);
}

// Minimal YAML frontmatter: scalars, inline [a, "b"] lists, block "- x" lists, one nested map level.
function parseFrontmatter(text) {
  const m = text && text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  let key = null;
  const unq = (v) => v.trim().replace(/^["']|["']$/g, '');
  const scalar = (v) => {
    v = v.trim();
    if (v.startsWith('[')) return v.replace(/^\[|\]$/g, '').split(',').map(unq).filter(Boolean);
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v === 'true' || v === 'false') return v === 'true';
    return unq(v);
  };
  for (const line of m[1].split(/\r?\n/)) {
    const top = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (top) {
      key = top[1];
      out[key] = top[2].trim() === '' ? null : scalar(top[2]);
      continue;
    }
    if (!key) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && (out[key] === null || Array.isArray(out[key]))) {
      (out[key] = out[key] || []).push(unq(item[1]));
      continue;
    }
    const nested = line.match(/^\s{1,4}([A-Za-z_][\w-]*):\s*(.*)$/);
    if (nested && (out[key] === null || (typeof out[key] === 'object' && !Array.isArray(out[key])))) {
      out[key] = out[key] || {};
      out[key][nested[1]] = nested[2].trim() === '' ? null : scalar(nested[2]);
    }
  }
  return out;
}

function countTasks(text, fm) {
  const xml = (text.match(/<task\b/g) || []).length;
  if (xml) return xml;
  const md = (text.match(/^#{2,4}\s+Task\s+\d+/gim) || []).length;
  if (md) return md;
  const est = fm.estimate && Number(fm.estimate.tasks);
  return Number.isFinite(est) && est > 0 ? est : null;
}

function asList(v) {
  if (v === null || v === undefined || v === '') return [];
  return Array.isArray(v) ? v.map(String) : [String(v)];
}

function parsePlan(deps, file) {
  const text = read(deps, file);
  if (text === null) return null;
  const fm = parseFrontmatter(text);
  const m = path.basename(file).match(/^(\d+(?:\.\d+)*)-(\d+)-PLAN\.md$/);
  const id = m ? planKey(m[1], m[2]) : null;
  return {
    id,
    file: path.basename(file),
    wave: Number.isFinite(Number(fm.wave)) && fm.wave !== null ? Number(fm.wave) : null,
    depends_on: asList(fm.depends_on).map((d) => {
      const dm = d.match(/^(\d+(?:\.\d+)*)-(\d+)$/);
      return dm ? planKey(dm[1], dm[2]) : d;
    }),
    files_modified: asList(fm.files_modified),
    requirements: asList(fm.requirements),
    tasks: countTasks(text, fm),
  };
}

function phasePlans(deps, planDir, phase) {
  const d = findPhaseDir(deps, planDir, phase);
  if (!d) return { dir: null, plans: [] };
  const plans = list(deps, d.dir)
    .filter((f) => /-PLAN\.md$/.test(f))
    .sort()
    .map((f) => parsePlan(deps, path.join(d.dir, f)))
    .filter(Boolean);
  return { dir: d.dir, plans };
}

// All plans in the tree: plan key -> task count.
function planIndex(deps, planDir) {
  const idx = {};
  for (const d of phaseDirs(deps, planDir)) {
    for (const f of list(deps, d.dir)) {
      if (!/-PLAN\.md$/.test(f)) continue;
      const p = parsePlan(deps, path.join(d.dir, f));
      if (p && p.id && idx[p.id] === undefined) idx[p.id] = p;
    }
  }
  return idx;
}

// Requirement ids per phase: ROADMAP "**Requirements**:" lines (current + archived roadmaps),
// falling back to the union of the phase's PLAN frontmatter `requirements`.
function reqsByPhase(deps, planDir) {
  const out = {};
  const roadmaps = [path.join(planDir, 'ROADMAP.md')].concat(
    list(deps, path.join(planDir, 'milestones'))
      .filter((f) => /ROADMAP\.md$/.test(f))
      .map((f) => path.join(planDir, 'milestones', f)),
  );
  for (const file of roadmaps) {
    const text = read(deps, file);
    if (!text) continue;
    let cur = null;
    for (const line of text.split(/\r?\n/)) {
      const h = line.match(/^#{2,4}\s+Phase\s+(\d+(?:\.\d+)*)\s*:/);
      if (h) { cur = normPhase(h[1]); continue; }
      if (/^#{1,3}\s/.test(line)) cur = null;
      const r = cur && line.match(/^\*\*Requirements\*?\*?:?\*?\*?\s*(.*)$/);
      if (r && !out[cur]) {
        const ids = r[1].match(/\b[A-Z][A-Z0-9]*-\d+[a-z]?\b/g);
        if (ids) out[cur] = [...new Set(ids)];
      }
    }
  }
  for (const d of phaseDirs(deps, planDir)) {
    if (out[d.phase]) continue;
    const ids = new Set();
    for (const p of phasePlans(deps, planDir, d.phase).plans) p.requirements.forEach((r) => ids.add(r));
    if (ids.size) out[d.phase] = [...ids];
  }
  return out;
}

// Current milestone: 🚧 milestone bullet/heading first (carries the phase range), then STATE.md
// `milestone:`. [inferred] Phase membership = phases whose major number falls in the bullet's
// "Phases X-Y" range; without a range, the phases listed under the 🚧 heading.
// Phases named on a milestone line after the word "phase(s)": ranges and single numbers, e.g.
// "(Phases 14-17)" or "(phases 9-11, 11.1; … procedures 12-15 added 2026-10-01; … phase 16 …)".
function phasesListed(line, all) {
  const i = line.search(/\bphases?\s+\d/i);
  if (i < 0) return [];
  let text = line.slice(i).replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\bv\d+(?:\.\d+)*\b/g, ' ');
  const out = new Set();
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/g)) {
    const lo = Math.floor(Number(m[1]));
    const hi = Math.floor(Number(m[2]));
    for (const p of all) { const n = Number(p.split('.')[0]); if (n >= lo && n <= hi) out.add(p); }
  }
  text = text.replace(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/g, ' ');
  // Single numbers only right after "phase(s)" or a list comma, so "Milestone 3" or "spikes 001" never count.
  for (const m of text.matchAll(/(?:\bphases?\s+|,\s*)(\d{1,3}(?:\.\d+)?)\b/gi)) { const p = normPhase(m[1]); if (all.has(p)) out.add(p); }
  return [...out];
}

function currentMilestone(deps, planDir) {
  const notes = [];
  const roadmap = read(deps, path.join(planDir, 'ROADMAP.md'));
  const state = read(deps, path.join(planDir, 'STATE.md')) || '';
  const stateVer = (state.match(/^milestone:\s*["']?([^"'\n]+?)["']?\s*$/m) || [])[1] || null;
  if (!roadmap) {
    return { version: stateVer, name: null, phases: [], notes: ['ROADMAP.md missing'] };
  }
  const lines = roadmap.split(/\r?\n/);
  const isBullet = (l) => /^\s*[-*]\s/.test(l);
  let src = lines.find((l) => /🚧/.test(l) && isBullet(l)) || lines.find((l) => /^#{2,4}\s.*🚧/.test(l));
  if (!src && stateVer) {
    const re = new RegExp(`\\b${stateVer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    src = lines.find((l) => re.test(l) && !/✅/.test(l) && (isBullet(l) || /^#{2,4}\s/.test(l) || /^\*\*/.test(l)) && !/Phase\s+\d/.test(l.split(':')[0]));
  }
  const version = (src && (src.match(/\bv\d+(?:\.\d+)*\b/) || [])[0]) || stateVer || null;
  let name = null;
  if (src) {
    name = src.replace(/^[\s\-*#]+/, '').replace(/🚧/g, '').replace(/\*\*/g, '')
      .replace(/\bv\d+(?:\.\d+)*\b/, '').replace(/\s[-–—]\s.*$/, '').replace(/\(.*$/, '').trim() || null;
  }

  const all = new Set();
  for (const m of roadmap.matchAll(/\bPhase\s+(\d+(?:\.\d+)*)\s*:/g)) all.add(normPhase(m[1]));
  for (const d of phaseDirs(deps, planDir)) if (!d.archived) all.add(d.phase);

  let phases = [];
  const listed = src ? phasesListed(src, all) : [];
  if (listed.length) {
    phases = listed;
  } else {
    const hIdx = lines.findIndex((l) => /^#{2,4}\s.*🚧/.test(l));
    if (hIdx >= 0) {
      const level = lines[hIdx].match(/^#+/)[0].length;
      for (let i = hIdx + 1; i < lines.length; i++) {
        const h = lines[i].match(/^(#+)\s/);
        if (h && h[1].length <= level) break;
        for (const m of lines[i].matchAll(/\bPhase\s+(\d+(?:\.\d+)*)\s*:/g)) phases.push(normPhase(m[1]));
      }
      notes.push('no phase range on milestone line; used phases under the 🚧 heading');
    } else if (version && new Set(lines.filter((l) => /^#{1,4}\s/.test(l))
      .flatMap((l) => l.match(/\bv\d+\.\d+(?:\.\d+)*\b/g) || [])).size <= 1) {
      // [inferred] A roadmap that names one milestone only (a workstream's own ROADMAP.md): every
      // phase in it belongs to that milestone.
      phases = [...all];
      notes.push('single-milestone roadmap; used all its phases');
    } else if (!version && !lines.some((l) => /^#{1,4}\s/.test(l) && /\bv\d+\.\d+/.test(l))) {
      // [inferred] A roadmap with no milestones at all is one implicit milestone named
      // after the roadmap title, so markers and retros get a stable slug instead of "unknown".
      phases = [...all];
      name = ((roadmap.match(/^#\s+(?:Roadmap:\s*)?(.+)$/m) || [])[1] || 'roadmap').trim();
      notes.push('roadmap has no milestones; treated as one milestone');
    } else {
      notes.push('no current milestone marker found');
    }
  }
  phases = [...new Set(phases)].filter(Boolean).sort(cmpPhase);
  return { version, name, phases, notes };
}

// Every phase number the project knows (dirs + current/archived ROADMAP headings and bullets).
function knownPhases(deps, planDir) {
  const out = new Set(phaseDirs(deps, planDir).map((d) => d.phase));
  const files = [path.join(planDir, 'ROADMAP.md')].concat(
    list(deps, path.join(planDir, 'milestones')).filter((f) => /ROADMAP\.md$/.test(f)).map((f) => path.join(planDir, 'milestones', f)),
  );
  for (const f of files) {
    for (const m of (read(deps, f) || '').matchAll(/\bPhase\s+(\d+(?:\.\d+)*)\s*:/g)) out.add(normPhase(m[1]));
  }
  return out;
}

function slugify(s) {
  return String(s || 'unknown').toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

// stateDir: the .planning dir holding musk/ (the main checkout's; defaults to planDir's project).
function milestoneCheck(deps, planDir, stateDir = planDir, cwd = null) {
  const ms = currentMilestone(deps, planDir);
  const started = ms.phases.filter((p) => {
    const d = findPhaseDir(deps, planDir, p);
    return d && list(deps, d.dir).some((f) => /(^|-)(CONTEXT|PLAN)\.md$/.test(f));
  });
  const slug = slugify(ms.version || ms.name);
  const markerAbs = path.join(stateDir, 'musk', `MILESTONE-${slug}.md`);
  // Relative to the checkout when the marker lives in it; absolute when it lives in the main
  // checkout and the command runs in a linked worktree.
  const base = cwd || path.dirname(stateDir);
  const rel = path.relative(base, markerAbs);
  const marker = rel.startsWith('..') || path.isAbsolute(rel) ? markerAbs : rel;
  const markerExists = deps.fs.existsSync(markerAbs);
  const milestone = ms.version || ms.name ? [ms.version, ms.name].filter(Boolean).join(' ') : null;
  return {
    milestone,
    phases: ms.phases,
    phases_started: started,
    first_of_milestone: started.length === 0,
    marker,
    marker_exists: markerExists,
    run: milestone !== null && ms.phases.length > 0 && started.length === 0 && !markerExists,
    notes: ms.notes,
  };
}

module.exports = {
  normPhase, cmpPhase, planKey, phaseDirs, findPhaseDir, parseFrontmatter, parsePlan, phasePlans,
  planIndex, reqsByPhase, knownPhases, currentMilestone, milestoneCheck,
};
