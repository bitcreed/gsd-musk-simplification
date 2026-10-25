'use strict';

// The manual musk steps the loop can't run by itself, detected at verify:post so the user is
// told exactly when one is due (and never otherwise).

const path = require('node:path');
const planning = require('./planning.cjs');
const { muskConfig } = require('./config.cjs');

function hasFile(deps, planDir, phase, re) {
  const d = planning.findPhaseDir(deps, planDir, phase);
  if (!d) return false;
  try { return deps.fs.readdirSync(d.dir).some((f) => re.test(f)); } catch { return false; }
}

// Returns { skill, why } for the one manual step that is due now, or null.
function dueStep(deps, planDir, phase, stateDir = planDir, rootPlanDir = planDir) {
  const mc = planning.milestoneCheck(deps, planDir, stateDir);
  if (!mc.milestone || !mc.phases.length) return null;
  const current = phase ? planning.normPhase(String(phase)) : null;
  const slug = path.basename(mc.marker).replace(/^MILESTONE-|\.md$/g, '');

  const done = (p) => p === current || hasFile(deps, planDir, p, /VERIFICATION\.md$/);
  const retroExists = deps.fs.existsSync(path.join(stateDir, 'musk', `RETRO-${slug}.md`));
  if (current && mc.phases.includes(current) && mc.phases.every(done) && !retroExists) {
    return { skill: '/gsd-musk-retro', why: 'last phase of the milestone verified: review cuts, savings and process before /gsd-complete-milestone' };
  }

  const unstarted = mc.phases.filter((p) => p !== current && !mc.phases_started.includes(p));
  if (!mc.marker_exists && unstarted.length && muskConfig(deps, planDir, rootPlanDir).milestone_pass !== false) {
    return { skill: '/gsd-musk-roadmap', why: `milestone pass never ran; it can still trim the ${unstarted.length} unstarted phase(s)` };
  }
  return null;
}

module.exports = { dueStep };
