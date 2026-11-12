'use strict';

// Where musk reads planning artifacts and where it keeps its own state.
//
// - Planning reads (ROADMAP, STATE, phases, config) follow the checkout and the workstream the
//   command runs in: <cwd>/.planning, or <cwd>/.planning/workstreams/<ws> when GSD_WORKSTREAM is
//   set (gsd-tools sets it from --ws or the active-workstream pointer).
// - musk state (ledger, calibration, milestone/retro markers) lives where GSD writes its own
//   planning docs: <cwd>/.planning/musk. A linked git worktree with a checked-out .planning keeps
//   its rows on its own branch, committed with the plans they justify and merged with them; only a
//   worktree without .planning falls back to the main checkout, as gsd-tools does.
// - Transcripts are read for the main checkout (the parent of `git rev-parse --git-common-dir`),
//   whose project dir also covers its Claude Code worktrees.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

// -> { main, linked }: main checkout (cwd outside git, in a bare repo or when main has no
// .planning) and whether cwd is a linked worktree (its git dir differs from the common dir).
function gitInfo(deps, cwd) {
  let out;
  try {
    out = (deps.git || defaultGit)(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']);
  } catch { return { main: cwd, linked: false }; }
  const [gitDir, common] = String(out || '').trim().split('\n').map((s) => s.trim());
  if (!common || path.basename(common) !== '.git') return { main: cwd, linked: false }; // bare repo or unusual layout
  const linked = path.resolve(gitDir) !== path.resolve(common);
  const main = path.dirname(common);
  return { main: deps.fs.existsSync(path.join(main, '.planning')) ? main : cwd, linked };
}

function mainRoot(deps, cwd) {
  return gitInfo(deps, cwd).main;
}

function defaultGit(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
}

function planningDir(deps, cwd) {
  const ws = String((deps.env || process.env).GSD_WORKSTREAM || '').trim();
  const base = path.join(cwd, '.planning');
  return ws && !/[/\\]|\.\./.test(ws) ? path.join(base, 'workstreams', ws) : base;
}

// { root, mainRoot, stateRoot, linked, planDir, rootPlanDir, stateDir }: stateDir is the
// .planning dir that holds musk/, inside the checkout stateRoot.
function resolve(deps, cwd) {
  const g = gitInfo(deps, cwd);
  const own = deps.fs.existsSync(path.join(cwd, '.planning'));
  const stateRoot = own ? cwd : g.main;
  return {
    root: cwd,
    mainRoot: g.main,
    stateRoot,
    linked: own && g.linked,
    planDir: planningDir(deps, cwd),
    rootPlanDir: path.join(cwd, '.planning'),
    stateDir: path.join(stateRoot, '.planning'),
  };
}

module.exports = { gitInfo, mainRoot, planningDir, resolve };
