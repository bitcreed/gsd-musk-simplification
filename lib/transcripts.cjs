'use strict';

// Claude Code transcript reader: ~/.claude/projects/<slug>/<session>.jsonl plus
// <session>/subagents/agent-<id>.jsonl (+ agent-<id>.meta.json). Produces per-message token
// records attributed to a bucket (agent type or orchestrator:<command>), phase, plan and quick task.

const path = require('node:path');
const { normPhase, planKey } = require('./planning.cjs');

function projectSlug(cwd) {
  return path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, '-');
}

function transcriptDir(deps, cwd) {
  return path.join(deps.homedir(), '.claude', 'projects', projectSlug(cwd));
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.type === 'text' ? c.text : '')).join('\n');
  return '';
}

const PHASE_NUM = '(\\d+(?:\\.\\d+)*)';

// Phase / plan / quick id from a spawn description + prompt. The description is the most
// specific signal (e.g. "Execute plan 04 of phase 11"), so it wins over paths in the prompt.
function attribute(description, prompt) {
  const desc = description || '';
  const text = prompt || '';
  let phase = null;
  let plan = null;
  const disp = text.match(/\[gsd:dispatch phase="([^"]+)"(?: plan="([^"]+)")?/);
  if (disp) {
    phase = normPhase(disp[1]);
    const pm = disp[2] && disp[2].match(/^(\d+(?:\.\d+)*)-(\d+)$/);
    if (pm) plan = planKey(pm[1], pm[2]);
  }
  for (const src of [desc, text.slice(0, 4000)]) {
    if (!plan) {
      const a = src.match(new RegExp(`\\bplan\\s+(\\d+)\\s+of\\s+phase\\s+${PHASE_NUM}`, 'i'));
      const b = src.match(new RegExp(`\\bplan\\s+${PHASE_NUM}-(\\d+)\\b`, 'i'));
      if (a) plan = planKey(a[2], a[1]);
      else if (b) plan = planKey(b[1], b[2]);
    }
    if (!phase) {
      const m = src.match(new RegExp(`\\bphase\\s+${PHASE_NUM}\\b`, 'i'));
      if (m) phase = normPhase(m[1]);
    }
  }
  if (!plan) {
    const files = [...new Set([...text.matchAll(/\b(\d+(?:\.\d+)*)-(\d+)-PLAN\.md\b/g)].map((m) => planKey(m[1], m[2])))];
    if (files.length === 1) plan = files[0];
  }
  if (!phase) {
    const m = text.match(/phases\/(\d+(?:\.\d+)*)-/);
    if (m) phase = normPhase(m[1]);
  }
  if (plan && !phase) phase = plan.split('-')[0];
  const q = (desc + '\n' + text.slice(0, 4000)).match(/quick\/(\d{6}-[a-z0-9]{3})\b/) ||
    (desc + '\n' + text.slice(0, 4000)).match(/\bquick task:?\s+(\d{6}-[a-z0-9]{3}|[a-z0-9]{3})\b/i);
  return { phase, plan, quick: q ? q[1] : null };
}

function commandSwitch(name, args) {
  const n = String(name || '').replace(/^\//, '');
  if (!/^(gsd|musk)-/.test(n)) return null;
  const tok = String(args || '').split(/\s+/).find((t) => normPhase(t));
  return { cmd: '/' + n, phase: tok ? normPhase(tok) : null };
}

// One jsonl file -> { msgs, spawns, links, prompt, events }.
function parseFile(deps, file, { since, isSub }) {
  let text;
  try { text = deps.fs.readFileSync(file, 'utf8'); } catch { return null; }
  const msgs = new Map(); // message.id -> record (last streamed chunk wins)
  const spawns = {}; // tool_use id -> Agent input
  const links = {}; // agentId -> tool_use id
  const events = []; // command/skill switches
  let seg = { cmd: null, phase: null, idx: 0 };
  let prompt = null;
  let first = true;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const want = first || line.includes('"type":"assistant"') || line.includes('<command-name>') || line.includes('"agentId"');
    if (!want) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (isSub && first && o.type === 'user') prompt = textOf(o.message && o.message.content);
    first = false;
    const ts = o.timestamp || null;
    if (o.type === 'user') {
      const t = textOf(o.message && o.message.content);
      const cn = t.match(/<command-name>([^<]+)<\/command-name>/);
      const sw = cn && commandSwitch(cn[1], (t.match(/<command-args>([^<]*)<\/command-args>/) || [])[1]);
      if (sw) { seg = { ...sw, idx: seg.idx + 1 }; events.push({ ...sw, ts }); }
      const tur = o.toolUseResult;
      const c0 = Array.isArray(o.message && o.message.content) ? o.message.content.find((c) => c && c.type === 'tool_result') : null;
      if (tur && tur.agentId && c0) links[tur.agentId] = c0.tool_use_id;
      continue;
    }
    if (o.type !== 'assistant' || !o.message) continue;
    const m = o.message;
    const u = m.usage;
    if (u && m.id && !(since && ts && ts < since)) {
      const prev = msgs.get(m.id);
      msgs.set(m.id, {
        id: m.id,
        ts: prev ? prev.ts : ts,
        tokens: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0),
        cache_read: u.cache_read_input_tokens || 0,
        seg: prev ? prev.seg : seg,
      });
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (!c || c.type !== 'tool_use') continue;
      if ((c.name === 'Agent' || c.name === 'Task') && c.input) spawns[c.id] = c.input;
      if (c.name === 'Skill' && c.input) {
        const sw = commandSwitch(c.input.skill, c.input.args);
        if (sw) { seg = { ...sw, idx: seg.idx + 1 }; events.push({ ...sw, ts }); }
      }
    }
  }
  return { msgs: [...msgs.values()], spawns, links, prompt, events };
}

function readJson(deps, file) {
  try { return JSON.parse(deps.fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Scan one project's transcript dir. Returns null when the dir does not exist.
function scan(deps, dir, { since, known } = {}) {
  let entries;
  try { entries = deps.fs.readdirSync(dir); } catch { return null; }
  const files = [];
  for (const e of entries.filter((n) => n.endsWith('.jsonl')).sort()) {
    const session = e.replace(/\.jsonl$/, '');
    const main = parseFile(deps, path.join(dir, e), { since, isSub: false });
    if (main) files.push({ kind: 'main', session, key: session, ...main });
    const subDir = path.join(dir, session, 'subagents');
    let subs = [];
    try { subs = deps.fs.readdirSync(subDir); } catch { /* no subagents */ }
    for (const s of subs.filter((n) => /^agent-.+\.jsonl$/.test(n)).sort()) {
      const agentId = s.replace(/^agent-|\.jsonl$/g, '');
      const parsed = parseFile(deps, path.join(subDir, s), { since, isSub: true });
      if (!parsed) continue;
      const meta = readJson(deps, path.join(subDir, `agent-${agentId}.meta.json`)) || {};
      files.push({ kind: 'sub', session, agentId, key: `${session}/${agentId}`, meta, ...parsed });
    }
  }

  // Link subagents to their spawning Agent tool_use (fallback when meta.json lacks fields).
  const spawnById = {};
  const linkByAgent = {};
  for (const f of files) {
    Object.assign(spawnById, f.spawns);
    for (const [aid, tu] of Object.entries(f.links)) linkByAgent[`${f.session}/${aid}`] = tu;
  }
  const byKey = new Map(files.map((f) => [f.key, f]));
  for (const f of files) {
    if (f.kind !== 'sub') continue;
    const tu = f.meta.toolUseId || linkByAgent[f.key];
    const spawn = (tu && spawnById[tu]) || {};
    f.agentType = f.meta.agentType || spawn.subagent_type || 'unknown';
    f.description = f.meta.description || spawn.description || '';
    f.attr = attribute(f.description, f.prompt || spawn.prompt || '');
    f.parentKey = f.meta.parentAgentId ? `${f.session}/${f.meta.parentAgentId}` : null;
  }
  // Nested agents inherit what their own spawn prompt does not say.
  const resolve = (f, depth = 0) => {
    if (f.resolved || depth > 20) return f.attr;
    const parent = f.parentKey && byKey.get(f.parentKey);
    if (parent) {
      const pa = resolve(parent, depth + 1);
      f.attr = { phase: f.attr.phase || pa.phase, plan: f.attr.plan || (f.attr.phase ? null : pa.plan), quick: f.attr.quick || pa.quick };
    }
    f.resolved = true;
    return f.attr;
  };
  // A phase the project does not know ("Python 3.11", "ADR 702") is a false match, not a phase.
  const valid = (p) => (p && (!known || known.has(p)) ? p : null);
  for (const f of files) {
    if (f.kind !== 'sub') continue;
    f.attr.phase = valid(f.attr.phase);
    if (f.attr.plan && !valid(f.attr.plan.split('-')[0])) f.attr.plan = null;
  }
  files.filter((f) => f.kind === 'sub').forEach((f) => resolve(f));

  // Flatten to attributed message records.
  const seen = new Set();
  const records = [];
  for (const f of files) {
    const sub = f.kind === 'sub';
    for (const m of f.msgs) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const segmented = !sub || !/^gsd-/.test(f.agentType);
      const bucket = segmented && m.seg.cmd ? `orchestrator:${m.seg.cmd}` : (sub ? f.agentType : 'main');
      records.push({
        ts: m.ts,
        tokens: m.tokens,
        cache_read: m.cache_read,
        bucket,
        run: segmented && m.seg.cmd ? `${f.key}#${m.seg.idx}` : f.key,
        agentType: sub ? f.agentType : null,
        phase: (sub && f.attr.phase) || valid(m.seg.phase),
        plan: sub ? f.attr.plan : null,
        quick: sub ? f.attr.quick : (m.seg.cmd === '/gsd-quick' ? `${f.key}#${m.seg.idx}` : null),
      });
    }
  }
  return { files, records };
}

module.exports = { projectSlug, transcriptDir, attribute, parseFile, scan };
