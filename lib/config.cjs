'use strict';

// The musk.* settings in effect for a project: .planning/config.json (nested or flat keys) over
// the defaults in capability.json. Skills read these from one command instead of hunting for them.

const path = require('node:path');

function readJson(deps, file) {
  try { return JSON.parse(deps.fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// planDir: the workstream's planning dir; rootPlanDir: the project's .planning (read first, so a
// workstream config overrides the root one, as GSD resolves it).
function muskConfig(deps, planDir, rootPlanDir = planDir) {
  const manifest = readJson(deps, path.join(deps.capRoot, 'capability.json'));
  const out = {};
  for (const [key, spec] of Object.entries(manifest.config || {})) out[key.replace(/^musk\./, '')] = spec.default;
  const dirs = rootPlanDir === planDir ? [planDir] : [rootPlanDir, planDir];
  for (const dir of dirs) {
    const project = readJson(deps, path.join(dir, 'config.json'));
    for (const [key, v] of Object.entries(project)) if (key.startsWith('musk.')) out[key.slice(5)] = v;
    if (project.musk && typeof project.musk === 'object') Object.assign(out, project.musk);
  }
  return out;
}

module.exports = { muskConfig };
