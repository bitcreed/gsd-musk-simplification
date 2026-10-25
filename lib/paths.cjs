'use strict';

// Where musk reads planning artifacts and where it keeps its own state.
//
// - Planning reads (ROADMAP, STATE, phases, config) follow the checkout and the workstream the
//   command runs in: <cwd>/.planning, or <cwd>/.planning/workstreams/<ws> when GSD_WORKSTREAM is
//   set (gsd-tools sets it from --ws or the active-workstream pointer).
// - musk state (ledger, calibration, milestone/retro markers) lives ONCE per project, in the MAIN
//   checkout's .planning/musk. A linked git worktree (an isolated subagent) carries a committed,
//   possibly stale copy of .planning; writing there loses the rows when the worktree is reaped.
//   The main checkout is the parent of `git rev-parse --git-common-dir`.

const path = require('node:path');
const { execFileSync } = require('node:child_process');

function mainRoot(deps, cwd) {
  let common;
  try {
    common = (deps.git || defaultGit)(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  } catch { return cwd; }
  common = String(common || '').trim();
  if (path.basename(common) !== '.git') return cwd; // bare repo or unusual layout: stay put
  const main = path.dirname(common);
  return deps.fs.existsSync(path.join(main, '.planning')) ? main : cwd;
}

function defaultGit(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
}

function planningDir(deps, cwd) {
  const ws = String((deps.env || process.env).GSD_WORKSTREAM || '').trim();
  const base = path.join(cwd, '.planning');
  return ws && !/[/\\]|\.\./.test(ws) ? path.join(base, 'workstreams', ws) : base;
}

// { root, planDir, rootPlanDir, stateDir }: stateDir is the .planning dir that holds musk/.
function resolve(deps, cwd) {
  const main = mainRoot(deps, cwd);
  return {
    root: cwd,
    mainRoot: main,
    planDir: planningDir(deps, cwd),
    rootPlanDir: path.join(cwd, '.planning'),
    stateDir: path.join(main, '.planning'),
  };
}

module.exports = { mainRoot, planningDir, resolve };
