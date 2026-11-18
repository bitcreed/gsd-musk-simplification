'use strict';
// Every command an agent runs from musk's prompt text goes through gsd-core's `gsd_run` launcher.
// A bare `gsd-tools` can resolve to another package's CLI that rejects musk's options, and then
// every log/pass/phase-check call fails without the agent noticing.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const prompts = [
  ...fs.readdirSync(path.join(root, 'fragments')).map((f) => path.join('fragments', f)),
  ...fs.readdirSync(path.join(root, 'skills')).map((d) => path.join('skills', d, 'SKILL.md')),
  'musk-router.cjs',
];
const bare = /(^|[\s`(])gsd-tools (musk|config|query|loop)\b/m;

for (const rel of prompts) {
  test(`${rel} calls gsd_run, not bare gsd-tools`, () => {
    const text = fs.readFileSync(path.join(root, rel), 'utf8')
      .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n'); // code comments may name the CLI
    assert.doesNotMatch(text, bare);
  });
}
