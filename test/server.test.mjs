import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.mjs';

test('server accepts events and serves state', async () => {
  const floor = await startServer({ port: 0, log: () => {} });
  const { port } = floor.server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const res = await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ type: 'join', agent: 'a', team: 'T' }, { type: 'bogus' }]),
    });
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: 1, rejected: 1 });
    const state = await (await fetch(`${base}/state`)).json();
    assert.ok(state.agents.a);

    const bad = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);

    const simple = await fetch(`${base}/events`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"type":"join","agent":"x"}' });
    assert.equal(simple.status, 415, 'non-JSON posts are refused');
  } finally {
    await floor.close();
  }
});
