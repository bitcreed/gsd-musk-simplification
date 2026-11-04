'use strict';

// Attribution and pass-cost regressions from the 0.5.4 review: nested musk skills, quick-task
// samples, worktree transcript dirs, and evidence-based fragment injection counts.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectSlug } = require('../lib/transcripts.cjs');
const { calibrate } = require('../lib/calibrate.cjs');
const { passCost } = require('../lib/stats.cjs');

let n = 0;
const usage = (tokens) => ({ input_tokens: tokens, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 });
const ts = () => `2026-09-01T10:${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}.000Z`;
const asst = (tokens, content = [{ type: 'text', text: 'ok' }]) => { n++; return { type: 'assistant', timestamp: ts(), message: { id: `msg_${n}`, role: 'assistant', content, usage: usage(tokens) } }; };
const cmd = (name, args = '') => { n++; return { type: 'user', timestamp: ts(), message: { role: 'user', content: `<command-name>${name}</command-name>\n<command-args>${args}</command-args>` } }; };
const human = (text) => { n++; return { type: 'user', timestamp: ts(), message: { role: 'user', content: text } }; };
const result = (id, text, agentId) => { n++; const o = { type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } }; if (agentId) o.toolUseResult = { agentId }; return o; };
const tool = (name, input, id = `toolu_${n + 1}`) => ({ type: 'tool_use', id, name, input });

function project() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musk-tx-'));
  const cwd = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(cwd, '.planning'), { recursive: true });
  const home = path.join(tmp, 'home');
  const dir = path.join(home, '.claude', 'projects', projectSlug(cwd));
  fs.mkdirSync(dir, { recursive: true });
  const deps = { fs, homedir: () => home, now: () => new Date('2026-09-02T00:00:00Z') };
  const write = (file, lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  };
  return { cwd, home, dir, deps, write };
}

test('a musk skill invoked inside a command ends at its musk commit; the command and its phase resume', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-discuss-phase', '4'),
    asst(100),
    asst(200, [tool('Skill', { skill: 'gsd-musk-roadmap', args: 'auto' })]),
    asst(300),
    asst(400, [tool('Bash', { command: 'node gsd-tools.cjs musk commit --message "musk: cuts"' })]),
    asst(500),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 300 + 400);
  assert.equal(c.by_agent_type['orchestrator:/gsd-discuss-phase'].tokens_total, 100 + 200 + 500);
  assert.equal(c.by_agent_type['orchestrator:/gsd-discuss-phase'].runs, 1, 'the resumed command is the same run');
});

test('a nested musk skill without a commit ends at the next human message', () => {
  const p = project();
  fs.writeFileSync(path.join(p.cwd, '.planning', 'ROADMAP.md'), '### Phase 4: Thing\n');
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-discuss-phase', '4'),
    asst(100, [tool('Skill', { skill: 'musk-roadmap', args: 'auto' })]),
    asst(300),
    human('sounds good, continue'),
    asst(500),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/musk-roadmap'].tokens_total, 300);
  assert.equal(c.by_agent_type['orchestrator:/gsd-discuss-phase'].tokens_total, 100 + 500);
  assert.equal(c.by_phase['4'].tokens_total, 900, 'the musk run keeps the enclosing phase');
});

test('a typed musk command: an answer followed by musk work stays in the run; notifications do not end it', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-execute-phase', '2'),
    asst(1000),
    cmd('/gsd-musk-roadmap'),
    asst(100, [{ type: 'text', text: 'Cut these three requirements?' }]),
    human('yes, all three'),
    asst(200, [tool('Bash', { command: 'node gsd-tools.cjs musk log --class scope --unit req --ref R1 --reason r' })]),
    { type: 'user', timestamp: ts(), message: { role: 'user', content: '<task-notification>\n<task-id>x</task-id>' } },
    asst(300, [{ type: 'text', text: 'Done: three cuts logged.' }]),
    human('now something unrelated'),
    asst(4000),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 100 + 200 + 300);
  assert.equal(c.by_agent_type['orchestrator:/gsd-execute-phase'].tokens_total, 1000 + 4000);
});

test('an agent spawned during a musk run is charged to that run', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-musk-roadmap'),
    asst(100, [tool('Agent', { subagent_type: 'general-purpose', description: 'Musk pass', prompt: 'cut the roadmap' }, 'toolu_mp')]),
    result('toolu_mp', 'done', 'mp'),
  ]);
  p.write(path.join(p.dir, 's1', 'subagents', 'agent-mp.jsonl'), [
    { type: 'user', timestamp: ts(), message: { role: 'user', content: 'cut the roadmap' } },
    asst(700),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 800);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].runs, 1);
});

test('quick task: orchestrator segment and the agents it spawns form one sample', () => {
  const p = project();
  const lines = [];
  const quicks = ['260901-ab1', '260901-ab2', '260901-ab3', '260901-ab4', '260901-ab5'];
  for (const q of quicks) {
    const id = `toolu_${q}`;
    lines.push(cmd('/gsd-quick', 'tidy'));
    lines.push(asst(100, [tool('Agent', { subagent_type: 'gsd-executor', description: 'run quick', prompt: `Run .planning/quick/${q}-tidy` }, id)]));
    lines.push(result(id, 'done', `ex-${q}`));
    p.write(path.join(p.dir, 's1', 'subagents', `agent-ex-${q}.jsonl`), [
      { type: 'user', timestamp: ts(), message: { role: 'user', content: `Run .planning/quick/${q}-tidy` } },
      asst(200),
    ]);
  }
  p.write(path.join(p.dir, 's1.jsonl'), lines);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.samples.per_quick_task, 5);
  assert.equal(c.prices.per_quick_task.p50, 300);
});

test('worktree transcript dirs are part of the project', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [asst(100)]);
  p.write(path.join(`${p.dir}--claude-worktrees-wf-1`, 's2.jsonl'), [{ ...asst(50), cwd: path.join(p.cwd, '.claude', 'worktrees', 'wf-1') }]);
  p.write(path.join(`${p.dir}-other`, 's3.jsonl'), [asst(7)]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.totals.tokens, 150);
  assert.equal(c.worktree_transcript_dirs, 1);
});

test('injections: only discuss/planner runs that show a musk fragment tag count, with the tags seen', () => {
  const p = project();
  fs.writeFileSync(path.join(p.cwd, '.planning', 'ROADMAP.md'), '### Phase 2: A\n### Phase 3: B\n');
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-discuss-phase', '2'),
    asst(10, [tool('Bash', { command: 'gsd-tools loop render-hooks discuss:pre' }, 'toolu_r1')]),
    result('toolu_r1', '<musk>\ncut first\n</musk>\n<musk_lean>\nlean\n</musk_lean>'),
    asst(10),
    cmd('/gsd-discuss-phase', '3'), // before musk was installed: no fragment
    asst(10),
    cmd('/gsd-discuss-phase', '2'),
    asst(10, [tool('Bash', { command: 'gsd-tools loop render-hooks discuss:pre' }, 'toolu_r2')]),
    result('toolu_r2', '<musk>\ncut first\n</musk>'),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.injections.evidence, true);
  assert.deepEqual(c.injections.discuss.map((r) => [r.phase, r.tags]), [['2', ['musk', 'musk_lean']], ['2', ['musk']]]);
});

function cap() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'musk-cap-'));
  fs.mkdirSync(path.join(root, 'fragments'));
  const frag = (name, tag, len) => fs.writeFileSync(path.join(root, 'fragments', name), `<${tag}>` + 'x'.repeat(len - tag.length - 2));
  frag('d.md', 'musk', 400); // 100 tokens
  frag('lean.md', 'musk_lean', 200); // 50
  frag('p.md', 'musk', 80); // 20
  fs.writeFileSync(path.join(root, 'capability.json'), JSON.stringify({ contributions: [
    { point: 'discuss:pre', fragment: { path: 'fragments/d.md' }, when: 'musk.enabled' },
    { point: 'discuss:pre', fragment: { path: 'fragments/lean.md' }, when: 'musk.lean_lane' },
    { point: 'plan:pre', fragment: { path: 'fragments/p.md' }, when: 'musk.enabled' },
  ] }));
  return { fs, capRoot: root };
}

test('pass cost: injections before the first ledger row and repeat runs of a phase both count', () => {
  const deps = cap();
  const cal = { basis: 'harness', injections: { evidence: true,
    discuss: [{ phase: '2', ts: '2026-09-01T09:00:00Z', tags: ['musk', 'musk_lean'] }, { phase: '2', ts: '2026-09-01T11:00:00Z', tags: ['musk'] }],
    plan: [{ phase: '2', ts: '2026-09-01T12:00:00Z', tags: ['musk'] }] } };
  const rows = [{ ts: '2026-09-01T10:00:00Z', type: 'pass', phase: '2', point: 'discuss:pre' }];
  const c = passCost(deps, rows, cal, null);
  assert.deepEqual(c.injections, { discuss: 2, plan: 1 });
  assert.equal(c.fragment_tokens, 100 + 50 + 100 + 20, 'the lean fragment counts only where it was injected');
  assert.equal(passCost(deps, [], cal, null).fragment_tokens, 270, 'an empty ledger still counts transcript evidence');
});

test('pass cost: ledger runs fill in where transcripts are missing; one per pass row', () => {
  const deps = cap();
  const rows = [
    { ts: '2026-09-01T10:00:00Z', type: 'pass', phase: '2', point: 'discuss:pre' },
    { ts: '2026-09-02T10:00:00Z', type: 'pass', phase: '2', point: 'discuss:pre' },
    { ts: '2026-09-02T10:05:00Z', type: 'cut', id: 'M-0001', class: 'impl', unit: 'task', phase: '2', point: 'plan:pre' },
    { ts: '2026-09-03T10:00:00Z', type: 'cut', id: 'M-0002', class: 'ceremony', unit: 'lean-lane', phase: '5', point: 'discuss:pre' },
  ];
  const c = passCost(deps, rows, null, null);
  assert.deepEqual(c.injections, { discuss: 3, plan: 1 });
  assert.equal(c.fragment_tokens, 100 + 100 + (100 + 50) + 20);
});

test('pass cost: a pre-0.5.4 calibration (no evidence) keeps the cut-off at the first ledger row', () => {
  const deps = cap();
  const cal = { basis: 'harness', injections: { discuss: [{ phase: '2', ts: '2026-08-01T00:00:00Z' }, { phase: '3', ts: '2026-09-05T00:00:00Z' }], plan: [] } };
  const rows = [{ ts: '2026-09-01T10:00:00Z', type: 'pass', phase: '2', point: 'discuss:pre' }];
  assert.deepEqual(passCost(deps, rows, cal, null).injections, { discuss: 2, plan: 0 });
});

// Second review: ownership across nested skills and the spawn graph, gsd_run, worktree
// provenance, copied history, and the ledger fallback.

test('a non-musk skill nested in a musk run stays in the run; musk commit still resumes the host command', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-discuss-phase', '4'),
    asst(100, [tool('Skill', { skill: 'gsd-musk-roadmap', args: 'auto' })]),
    asst(200, [tool('Skill', { skill: 'gsd-capture', args: '--backlog "Phase 5: later"' })]),
    asst(300, [tool('Skill', { skill: 'gsd-phase', args: 'remove 5' })]),
    asst(400, [tool('Skill', { skill: 'gsd-musk-roadmap', args: 'auto' })]),
    asst(500, [tool('Bash', { command: 'gsd_run musk log --class scope --unit milestone-phase --ref P5 --reason r' })]),
    asst(600, [tool('Bash', { command: 'gsd_run musk commit --message "musk: cuts"' })]),
    asst(700),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 200 + 300 + 400 + 500 + 600);
  assert.equal(c.by_agent_type['orchestrator:/gsd-discuss-phase'].tokens_total, 100 + 700);
  assert.equal(c.by_agent_type['orchestrator:/gsd-discuss-phase'].runs, 1);
  assert.equal(c.by_agent_type['orchestrator:/gsd-phase'], undefined);
  assert.equal(c.by_agent_type['orchestrator:/gsd-capture'], undefined);
});

test('the reply to a musk question that calls musk through gsd_run or $GSD_TOOLS stays in the musk run', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-execute-phase', '2'),
    asst(1000, [tool('Skill', { skill: 'gsd-musk-roadmap' })]),
    asst(100, [{ type: 'text', text: 'Cut these?' }]),
    human('yes'),
    asst(200, [tool('Bash', { command: 'gsd_run musk log --class scope --unit req --ref R1 --reason r' })]),
    asst(300),
    human('ok'),
    asst(50, [tool('Bash', { command: '"$GSD_TOOLS" musk list --json' })]),
    human('next'),
    asst(4000),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 100 + 200 + 300 + 50);
  assert.equal(c.by_agent_type['orchestrator:/gsd-execute-phase'].tokens_total, 1000 + 4000);
});

test('a gsd-* agent that invokes the musk skill charges that run to musk', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-plan-phase', '2'),
    asst(10, [tool('Agent', { subagent_type: 'gsd-planner', description: 'Plan phase 2', prompt: 'plan' }, 'toolu_pl')]),
    result('toolu_pl', 'done', 'pl'),
  ]);
  p.write(path.join(p.dir, 's1', 'subagents', 'agent-pl.jsonl'), [
    { type: 'user', timestamp: ts(), message: { role: 'user', content: 'plan' } },
    asst(100, [tool('Skill', { skill: 'gsd-musk-roadmap', args: 'auto' })]),
    asst(200, [tool('Bash', { command: 'gsd-tools musk commit' })]),
    asst(300),
  ]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 200);
  assert.equal(c.by_agent_type['gsd-planner'].tokens_total, 100 + 300);
});

test('grandchildren of a musk run are charged to it; a quick task is one sample down the spawn graph', () => {
  const p = project();
  p.write(path.join(p.dir, 's1.jsonl'), [
    cmd('/gsd-musk-roadmap'),
    asst(10, [tool('Agent', { subagent_type: 'general-purpose', description: 'Musk pass', prompt: 'cut' }, 'toolu_a')]),
    result('toolu_a', 'done', 'a'),
    cmd('/gsd-quick', 'tidy'),
    asst(20, [tool('Agent', { subagent_type: 'gsd-executor', description: 'run quick', prompt: 'Run .planning/quick/260901-ab1-tidy' }, 'toolu_q')]),
    result('toolu_q', 'done', 'q'),
  ]);
  const sub = (id, lines) => p.write(path.join(p.dir, 's1', 'subagents', `agent-${id}.jsonl`), lines);
  sub('a', [
    { type: 'user', timestamp: ts(), message: { role: 'user', content: 'cut' } },
    asst(100, [tool('Agent', { subagent_type: 'gsd-planner', description: 'check', prompt: 'check' }, 'toolu_b')]),
    result('toolu_b', 'done', 'b'),
  ]);
  sub('b', [{ type: 'user', timestamp: ts(), message: { role: 'user', content: 'check' } }, asst(1000)]);
  sub('q', [
    { type: 'user', timestamp: ts(), message: { role: 'user', content: 'Run .planning/quick/260901-ab1-tidy' } },
    asst(300, [tool('Agent', { subagent_type: 'general-purpose', description: 'look', prompt: 'Compare with .planning/quick/260801-zz9-old' }, 'toolu_r')]),
    result('toolu_r', 'done', 'r'),
  ]);
  sub('r', [{ type: 'user', timestamp: ts(), message: { role: 'user', content: 'Compare with .planning/quick/260801-zz9-old' } }, asst(300)]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].tokens_total, 10 + 100 + 1000);
  assert.equal(c.by_agent_type['orchestrator:/gsd-musk-roadmap'].runs, 1);
  assert.equal(c.samples.per_quick_task, 1);
});

test('worktree transcript dirs count only when their sessions ran in this project', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musk-wt-'));
  const cwd = path.join(tmp, 'demo');
  fs.mkdirSync(path.join(cwd, '.planning'), { recursive: true });
  const home = path.join(tmp, 'home');
  const deps = { fs, homedir: () => home, now: () => new Date('2026-09-02T00:00:00Z') };
  const write = (dir, file, at, lines) => {
    const d = path.join(home, '.claude', 'projects', dir);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, file), lines.map((l) => JSON.stringify({ ...l, cwd: at })).join('\n') + '\n');
  };
  const wt = path.join(cwd, '.claude', 'worktrees', 'other');
  const sibling = `${cwd}--claude-worktrees-other`;
  assert.equal(projectSlug(wt), projectSlug(sibling), 'the slug is lossy');
  write(projectSlug(cwd), 's1.jsonl', cwd, [asst(100)]);
  write(projectSlug(wt), 's2.jsonl', wt, [asst(50)]);
  write(projectSlug(sibling), 's3.jsonl', sibling, [asst(7)]);
  write(`${projectSlug(cwd)}--claude-worktrees-x`, 's4.jsonl', path.join(tmp, 'demo--claude-worktrees-x'), [asst(9)]);
  const c = calibrate(deps, cwd);
  assert.equal(c.totals.tokens, 150);
  assert.equal(c.worktree_transcript_dirs, 1);
});

test('copied history (resume/fork): one message keeps its final usage, one discuss run counts once', () => {
  const p = project();
  fs.writeFileSync(path.join(p.cwd, '.planning', 'ROADMAP.md'), '### Phase 2: A\n');
  const head = [
    cmd('/gsd-discuss-phase', '2'),
    asst(10, [tool('Bash', { command: 'gsd_run loop render-hooks discuss:pre' }, 'toolu_r1')]),
    result('toolu_r1', '<musk>\ncut first\n</musk>'),
  ];
  const partial = asst(100);
  const final = JSON.parse(JSON.stringify(partial));
  final.message.usage = usage(150);
  p.write(path.join(p.dir, 'a.jsonl'), [...head, partial]);
  p.write(path.join(p.dir, 'b.jsonl'), [...head, final, asst(5)]);
  const c = calibrate(p.deps, p.cwd);
  assert.equal(c.totals.tokens, 10 + 150 + 5);
  assert.equal(c.injections.discuss.length, 1);
});

test('pass cost: a plan pass row counts without transcripts; ledger runs only fill the shortfall', () => {
  const deps = cap();
  const plan = passCost(deps, [{ ts: '2026-09-01T10:00:00Z', type: 'pass', phase: '2', point: 'plan:pre' }], null, null);
  assert.deepEqual(plan.injections, { discuss: 0, plan: 1 });
  assert.equal(plan.fragment_tokens, 20);
  const cal = { basis: 'harness', injections: { evidence: true, discuss: [{ phase: '2', ts: '2026-09-01T09:00:00Z', tags: ['musk', 'musk_lean'] }], plan: [] } };
  const rows = [
    { ts: '2026-09-01T10:00:00Z', type: 'pass', phase: '2', point: 'discuss:pre' },
    { ts: '2026-09-02T10:00:00Z', type: 'pass', phase: '2', point: 'discuss:pre' },
  ];
  const c = passCost(deps, rows, cal, null);
  assert.deepEqual(c.injections, { discuss: 2, plan: 0 });
  assert.equal(c.fragment_tokens, (100 + 50) + 100, 'the evidenced run keeps its lean tag');
});
