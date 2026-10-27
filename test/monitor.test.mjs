import test from 'node:test';
import assert from 'node:assert/strict';
import { screenMode, toolHue, MONITOR_COLORS } from '../shared/monitor.js';

test('screenMode maps every status', () => {
  assert.equal(screenMode('working'), 'code');
  assert.equal(screenMode('thinking'), 'dots');
  assert.equal(screenMode('waiting'), 'cursor');
  assert.equal(screenMode('error'), 'error');
  assert.equal(screenMode('offline'), 'off');
  assert.equal(screenMode('idle'), 'dim');
  assert.equal(screenMode('done'), 'dim');
});

test('toolHue groups tools by colour family', () => {
  for (const t of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']) assert.equal(toolHue(t), 'green');
  for (const t of ['Bash', 'BashOutput']) assert.equal(toolHue(t), 'blue');
  for (const t of ['WebSearch', 'WebFetch', 'mcp__x__y']) assert.equal(toolHue(t), 'teal');
  for (const t of ['Read', 'Grep', 'Glob']) assert.equal(toolHue(t), 'amber');
  for (const t of [undefined, null, '', 'TodoWrite']) assert.equal(toolHue(t), 'green');
});

test('every hue has a colour', () => {
  for (const t of ['Edit', 'Bash', 'WebSearch', 'Read']) assert.match(MONITOR_COLORS[toolHue(t)], /^#[0-9a-f]{6}$/);
});
