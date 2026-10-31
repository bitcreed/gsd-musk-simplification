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

// The project's own dir plus the dirs of Claude Code worktrees under it (<cwd>/.claude/worktrees/*),
// which Claude Code files under their own slug.
function transcriptDirs(deps, cwd) {
  const main = transcriptDir(deps, cwd);
  const prefix = path.basename(main) + '--claude-worktrees-';
  let sib = [];
  try { sib = deps.fs.readdirSync(path.dirname(main)).filter((n) => n.startsWith(prefix)).sort(); } catch { /* none */ }
  return [main, ...sib.map((n) => path.join(path.dirname(main), n))];
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

// Opening tags of musk's own fragments (<musk>, <musk_lean>, ...). Seeing one in a transcript is
// the evidence that a fragment was injected there. `<musk ceremony="lean"/>` does not match.
const MUSK_TAG = /<(musk[a-z_]*)>/g;
const isMuskCmd = (cmd) => /^\/(gsd-)?musk-/.test(cmd || '');
const MUSK_WORK = /gsd-tools(\.cjs)?\S*\s+musk\s|\.planning\/musk\//;
// A message the user typed, not a skill body, compaction summary, task notification or command echo.
const isHuman = (o, t) => !o.isMeta && !o.isCompactSummary && !o.toolUseResult && t.trim() !== ''
  && !/^\s*<(task-notification|local-command|command-|system-reminder|bash-)/.test(t)
  && !/^This session is being continued from a previous conversation/.test(t);

function commandSwitch(name, args) {
  const n = String(name || '').replace(/^\//, '');
  if (!/^(gsd|musk)-/.test(n)) return null;
  const tok = String(args || '').split(/\s+/).find((t) => normPhase(t));
  return { cmd: '/' + n, phase: tok ? normPhase(tok) : null };
}

// One jsonl file -> { msgs, spawns, spawnSegs, links, prompt, events, tags, segTags }.
//
// Segments: a recognised command or skill starts a segment that lasts until the next one. A musk
// run is bounded instead: it ends after its `musk commit` call, or at a human message whose reply
// does no musk work (no `gsd-tools musk` call, nothing written under .planning/musk/). A reply that
// does musk work means the message answered musk's question, and the run continues. When the run
// ends, the segment it interrupted resumes (a musk skill invoked inside a command keeps that
// command's phase), so the host work after a musk run is not charged to musk.
function parseFile(deps, file, { since, isSub }) {
  let text;
  try { text = deps.fs.readFileSync(file, 'utf8'); } catch { return null; }
  const msgs = new Map(); // message.id -> record (last streamed chunk wins)
  const spawns = {}; // tool_use id -> Agent input
  const spawnSegs = {}; // tool_use id -> segment the spawn was made in
  const links = {}; // agentId -> tool_use id
  const events = []; // command/skill switches
  const tags = new Set(); // musk fragment tags seen anywhere in the file
  const segTags = {}; // segment idx -> Set of musk fragment tags seen in it
  let counter = 0;
  let pending = null; // after a human message in a musk run: { seg: the musk run, ids: messages since }
  let seg = { cmd: null, phase: null, idx: 0 };
  const enter = (sw, ts, viaSkill) => {
    const musk = isMuskCmd(sw.cmd);
    const outer = musk ? (isMuskCmd(seg.cmd) ? seg.outer : seg) : null;
    const inherit = musk && viaSkill && seg.cmd && !isMuskCmd(seg.cmd);
    seg = { cmd: sw.cmd, phase: sw.phase || (inherit ? seg.phase : null), idx: ++counter, outer };
    pending = null;
    events.push({ cmd: sw.cmd, phase: seg.phase, idx: seg.idx, ts });
  };
  const leave = () => { if (seg.outer) seg = seg.outer; };
  let prompt = null;
  let first = true;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const hasTag = line.includes('<musk');
    const human = (pending || isMuskCmd(seg.cmd)) && line.includes('"type":"user"') && !line.includes('"tool_use_id"');
    const want = first || hasTag || human || line.includes('"type":"assistant"') || line.includes('<command-name>') || line.includes('"agentId"');
    if (!want) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (isSub && first && o.type === 'user') prompt = textOf(o.message && o.message.content);
    first = false;
    const ts = o.timestamp || null;
    if (hasTag) {
      for (const m of line.matchAll(MUSK_TAG)) {
        tags.add(m[1]);
        (segTags[seg.idx] || (segTags[seg.idx] = new Set())).add(m[1]);
      }
    }
    if (o.type === 'user') {
      const t = textOf(o.message && o.message.content);
      const cn = t.match(/<command-name>([^<]+)<\/command-name>/);
      const sw = cn && commandSwitch(cn[1], (t.match(/<command-args>([^<]*)<\/command-args>/) || [])[1]);
      if (sw) enter(sw, ts, false);
      else if (human && isHuman(o, t)) {
        if (pending) pending = null; // two human messages without musk work: the run is over
        else if (seg.outer) { pending = { seg, ids: [] }; seg = seg.outer; }
      }
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
      if (pending && !prev) pending.ids.push(m.id);
    }
    let committed = false;
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (!c || c.type !== 'tool_use') continue;
      if (pending && MUSK_WORK.test(JSON.stringify(c.input || {}))) {
        for (const id of pending.ids) if (msgs.has(id)) msgs.get(id).seg = pending.seg;
        seg = pending.seg;
        pending = null;
      }
      if ((c.name === 'Agent' || c.name === 'Task') && c.input) { spawns[c.id] = c.input; spawnSegs[c.id] = { cmd: seg.cmd, idx: seg.idx }; }
      if (c.name === 'Skill' && c.input) {
        const sw = commandSwitch(c.input.skill, c.input.args);
        if (sw) enter(sw, ts, true);
      }
      if (c.name === 'Bash' && c.input && /\bmusk commit\b/.test(String(c.input.command || '')) && isMuskCmd(seg.cmd)) committed = true;
    }
    if (committed) leave(); // the commit call itself still belongs to the musk run
  }
  return { msgs: [...msgs.values()], spawns, spawnSegs, links, prompt, events, tags, segTags };
}

function readJson(deps, file) {
  try { return JSON.parse(deps.fs.readFileSync(file, 'utf8')); } catch { return null; }
}

// Scan one project's transcript dir (or several: the project's and its worktrees'). Returns null
// when none of them exists.
function scan(deps, dirs, { since, known } = {}) {
  const files = [];
  let found = false;
  for (const dir of [].concat(dirs)) {
    let entries;
    try { entries = deps.fs.readdirSync(dir); } catch { continue; }
    found = true;
    scanDir(deps, dir, entries, files, since);
  }
  if (!found) return null;
  return link(files, known);
}

function scanDir(deps, dir, entries, files, since) {
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
}

const QUICK_CMD = '/gsd-quick';
const segmented = (f) => f.kind !== 'sub' || !/^gsd-/.test(f.agentType);

function link(files, known) {
  // Link subagents to their spawning Agent tool_use (fallback when meta.json lacks fields).
  const spawnById = {};
  const spawnOwner = {}; // tool_use id -> { key, seg } of the file and segment that spawned it
  const linkByAgent = {};
  for (const f of files) {
    Object.assign(spawnById, f.spawns);
    for (const [tu, seg] of Object.entries(f.spawnSegs)) spawnOwner[tu] = { key: f.key, seg };
    for (const [aid, tu] of Object.entries(f.links)) linkByAgent[`${f.session}/${aid}`] = tu;
  }
  const byKey = new Map(files.map((f) => [f.key, f]));
  const quickAlias = {}; // quick id from a prompt -> the /gsd-quick segment it ran in
  for (const f of files) {
    if (f.kind !== 'sub') continue;
    const tu = f.meta.toolUseId || linkByAgent[f.key];
    const spawn = (tu && spawnById[tu]) || {};
    f.agentType = f.meta.agentType || spawn.subagent_type || 'unknown';
    f.description = f.meta.description || spawn.description || '';
    f.attr = attribute(f.description, f.prompt || spawn.prompt || '');
    f.parentKey = f.meta.parentAgentId ? `${f.session}/${f.meta.parentAgentId}` : null;
    // An agent spawned inside a /gsd-quick segment belongs to that quick task, so the task's
    // orchestrator and executor tokens form one sample, not two.
    const owner = tu && spawnOwner[tu];
    // An agent spawned during a musk run does musk's work: charge it to that run.
    if (owner && isMuskCmd(owner.seg.cmd)) f.muskRun = { bucket: `orchestrator:${owner.seg.cmd}`, run: `${owner.key}#${owner.seg.idx}` };
    if (owner && owner.seg.cmd === QUICK_CMD) {
      const id = `${owner.key}#${owner.seg.idx}`;
      if (f.attr.quick && f.attr.quick !== id) quickAlias[f.attr.quick] = id;
      f.attr.quick = id;
    }
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
  for (const f of files) if (f.kind === 'sub' && quickAlias[f.attr.quick]) f.attr.quick = quickAlias[f.attr.quick];

  // Flatten to attributed message records.
  const seen = new Set();
  const records = [];
  for (const f of files) {
    const sub = f.kind === 'sub';
    for (const m of f.msgs) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const seg = segmented(f) && m.seg.cmd ? m.seg : null;
      const musk = !seg && f.muskRun;
      records.push({
        ts: m.ts,
        tokens: m.tokens,
        cache_read: m.cache_read,
        bucket: seg ? `orchestrator:${seg.cmd}` : (musk ? musk.bucket : (sub ? f.agentType : 'main')),
        run: seg ? `${f.key}#${seg.idx}` : (musk ? musk.run : f.key),
        agentType: sub ? f.agentType : null,
        phase: (sub && f.attr.phase) || valid(m.seg.phase),
        plan: sub ? f.attr.plan : null,
        quick: seg && seg.cmd === QUICK_CMD ? `${f.key}#${seg.idx}` : (sub ? f.attr.quick : null),
      });
    }
  }
  return { files, records };
}

module.exports = { projectSlug, transcriptDir, transcriptDirs, attribute, parseFile, scan, isMuskCmd };
