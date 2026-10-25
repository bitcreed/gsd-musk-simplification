'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeMuskCommand } = require('../musk-router.cjs');
const { projectSlug } = require('../lib/transcripts.cjs');

const FIX = path.join(__dirname, 'fixtures');

// Fresh temp copy of a fixture project (+ optional transcripts under a fake home).
function setup(name = 'proj', { transcripts = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'musk-test-'));
  const cwd = path.join(tmp, name);
  fs.cpSync(path.join(FIX, name), cwd, { recursive: true });
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  if (transcripts) fs.cpSync(path.join(FIX, 'transcripts'), path.join(home, '.claude', 'projects', projectSlug(cwd)), { recursive: true });
  return { tmp, cwd, home };
}

// Run the router; returns parsed JSON output (or text when json=false).
function run(ctx, argv, { json = true, now = '2026-09-02T12:00:00.000Z', env = {}, cwd = ctx.cwd } = {}) {
  let out = '';
  routeMuskCommand({
    args: ['musk', ...argv],
    cwd,
    raw: json,
    error: (msg) => { throw new Error(msg); },
    deps: {
      homedir: () => ctx.home,
      now: () => new Date(now),
      stdout: (s) => { out += s; },
      capRoot: path.join(FIX, 'cap'),
      env,
    },
  });
  return json ? JSON.parse(out) : out;
}

module.exports = { FIX, setup, run };
