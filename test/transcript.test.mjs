import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTranscriptTitle, readTranscriptTitle, shortTitle } from '../adapters/transcript.mjs';
import { fromClaude } from '../adapters/claude.mjs';
import { seedEvents } from '../adapters/seed.mjs';

const jl = (...rows) => rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';
const tmpFile = (text) => {
  const dir = mkdtempSync(join(tmpdir(), 'af-title-'));
  const file = join(dir, 's.jsonl');
  writeFileSync(file, text);
  return file;
};

test('parseTranscriptTitle prefers customTitle, falls back to the last aiTitle, skips broken lines', () => {
  const ai = jl({ type: 'ai-title', aiTitle: '첫 제목' }, { type: 'ai-title', aiTitle: '나중 제목' });
  assert.equal(parseTranscriptTitle(ai), '나중 제목');
  const custom = jl({ type: 'custom-title', customTitle: '내가 붙인 제목' }, { type: 'ai-title', aiTitle: '나중 제목' });
  assert.equal(parseTranscriptTitle(custom), '내가 붙인 제목');
  const broken = jl('{"type":"ai-title","aiTi', { type: 'ai-title', aiTitle: '살아남은 제목' }, 'not json', '{"customTitle":"  "}');
  assert.equal(parseTranscriptTitle(broken), '살아남은 제목');
  assert.equal(parseTranscriptTitle(jl({ type: 'user' })), undefined);
  assert.equal(parseTranscriptTitle(''), undefined);
  assert.equal(parseTranscriptTitle(undefined), undefined);
});

test('readTranscriptTitle reads the file tail and stays quiet on failure', () => {
  const pad = jl({ type: 'user', message: { content: 'x'.repeat(100) } });
  const file = tmpFile(jl({ type: 'ai-title', aiTitle: '밀려난 제목' }) + pad.repeat(800) + jl({ type: 'ai-title', aiTitle: '끝 제목' }));
  assert.equal(readTranscriptTitle(file), '끝 제목');
  const far = tmpFile(jl({ type: 'ai-title', aiTitle: '밀려난 제목' }) + pad.repeat(800));
  assert.equal(readTranscriptTitle(far), undefined);
  assert.equal(readTranscriptTitle('/no/such/file.jsonl'), undefined);
});

test('shortTitle collapses spaces and cuts at 14 characters', () => {
  assert.equal(shortTitle('  결제   버그 \n수정 '), '결제 버그 수정');
  assert.equal(shortTitle('가'.repeat(14)), '가'.repeat(14));
  assert.equal(shortTitle('가'.repeat(15)), '가'.repeat(13) + '…');
  assert.equal(shortTitle('   '), undefined);
  assert.equal(shortTitle(undefined), undefined);
});

test('fromClaude uses the session title as the name on start, prompt and stop hooks only', () => {
  const file = tmpFile(jl({ type: 'ai-title', aiTitle: '결제 버그 고치기' }));
  const base = { session_id: 'sess1234', cwd: '/x/shop', transcript_path: file };
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit', 'Stop']) {
    assert.equal(fromClaude({ ...base, hook_event_name, prompt: 'hi' })[0].name, '결제 버그 고치기', hook_event_name);
  }
  const tool = fromClaude({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } })[0];
  assert.equal(tool.name, 'Claude');
  assert.equal(fromClaude({ ...base, hook_event_name: 'Notification' })[0].name, 'Claude');
});

test('fromClaude name priority: env, opts, title, default; subagents never get the title', () => {
  const file = tmpFile(jl({ type: 'ai-title', aiTitle: '제목' }));
  const base = { hook_event_name: 'SessionStart', session_id: 'sess1234', cwd: '/x/shop', transcript_path: file };
  assert.equal(fromClaude(base, { name: '옵션 이름' })[0].name, '옵션 이름');
  const prev = process.env.AGENT_FLOOR_NAME;
  process.env.AGENT_FLOOR_NAME = '환경 이름';
  try {
    assert.equal(fromClaude(base, { name: '옵션 이름' })[0].name, '환경 이름');
  } finally {
    if (prev === undefined) delete process.env.AGENT_FLOOR_NAME;
    else process.env.AGENT_FLOOR_NAME = prev;
  }
  assert.equal(fromClaude({ ...base, transcript_path: '/no/such.jsonl' })[0].name, 'Claude');
  assert.equal(fromClaude({ ...base, transcript_path: 42 })[0].name, 'Claude');
  assert.equal(fromClaude({ ...base, transcript_path: undefined }, { source: 'codex' })[0].name, 'Codex');
  const subTool = fromClaude({ ...base, hook_event_name: 'PreToolUse', agent_id: 'ag_1', agent_type: 'reviewer', tool_name: 'Read', tool_input: {} });
  assert.equal(subTool[0].name, undefined);
});

test('seed names the agent from customTitle first, then aiTitle, shortened', () => {
  const root = mkdtempSync(join(tmpdir(), 'af-seed-'));
  mkdirSync(join(root, '-w-p'));
  const line = { type: 'user', cwd: '/w/p', message: { content: 'hi' } };
  writeFileSync(join(root, '-w-p', 'aaaaaaaa-1.jsonl'), jl(line, { aiTitle: 'AI 제목' }, { customTitle: '내가 붙인 아주 긴 제목입니다 정말' }));
  writeFileSync(join(root, '-w-p', 'bbbbbbbb-2.jsonl'), jl(line));
  const names = seedEvents({ root }).map((e) => e.name).sort();
  assert.deepEqual(names, ['Claude', '내가 붙인 아주 긴 제목…'].sort());
});
