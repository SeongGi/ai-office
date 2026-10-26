import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breakPlace, desiredPlace, idleAgeMs, initialPlace, LOUNGE_AFTER_MS } from '../shared/places.js';

const a = (id, status, parent) => ({ id, status, parent });
const world = (...list) => Object.fromEntries(list.map((x) => [x.id, x]));

test('live helper sends the parent to the meeting room, the helper stays at its desk', () => {
  const agents = world(a('p', 'working'), a('h', 'working', 'p'));
  assert.equal(desiredPlace(agents.p, agents, null, 0), 'meeting');
  assert.equal(desiredPlace(agents.h, agents, null, 0), 'desk');
});

test('done or offline helpers do not count', () => {
  const agents = world(a('p', 'working'), a('h', 'done', 'p'), a('g', 'offline', 'p'));
  assert.equal(desiredPlace(agents.p, agents, null, 0), 'desk');
  agents.g.status = 'thinking';
  assert.equal(desiredPlace(agents.p, agents, null, 0), 'meeting');
});

test('idle for a while goes to a break room, not before', () => {
  const agents = world(a('p', 'idle'));
  assert.equal(desiredPlace(agents.p, agents, 1000, 1000 + LOUNGE_AFTER_MS - 1), 'desk');
  assert.equal(desiredPlace(agents.p, agents, 1000, 1000 + LOUNGE_AFTER_MS), breakPlace('p'));
  assert.ok(['lounge', 'games', 'kitchen'].includes(breakPlace('p')));
  assert.equal(desiredPlace(agents.p, agents, null, 999999), 'desk');
});

test('non-idle status never goes to the lounge; done and offline stay put', () => {
  for (const status of ['working', 'thinking', 'waiting', 'error', 'done', 'offline']) {
    const agents = world(a('p', status));
    assert.equal(desiredPlace(agents.p, agents, 0, 10 * LOUNGE_AFTER_MS), 'desk', status);
  }
});

test('meeting wins over lounge', () => {
  const agents = world(a('p', 'idle'), a('h', 'working', 'p'));
  assert.equal(desiredPlace(agents.p, agents, 0, 10 * LOUNGE_AFTER_MS), 'meeting');
});

test('meeting covers: whole floor or one team, done agents too, offline stays at desk', () => {
  const x = { id: 'x', status: 'working', team: 't1' };
  const y = { id: 'y', status: 'done', team: 't2' };
  const z = { id: 'z', status: 'offline', team: 't1' };
  const agents = world(x, y, z);
  const all = { team: '*', startedAt: 0, endsAt: 1 };
  assert.equal(desiredPlace(x, agents, null, 0, all), 'meeting');
  assert.equal(desiredPlace(y, agents, null, 0, all), 'meeting');
  assert.equal(desiredPlace(z, agents, null, 0, all), 'desk');
  const t1 = { team: 't1', startedAt: 0, endsAt: 1 };
  assert.equal(desiredPlace(x, agents, null, 0, t1), 'meeting');
  assert.equal(desiredPlace(y, agents, null, 0, t1), 'desk');
  assert.equal(desiredPlace(x, agents, null, 0, undefined), 'desk');
});

test('first load: idle long enough by server time goes straight to its break room', () => {
  const now = 1_000_000;
  const agents = world({ id: 'p', status: 'idle', statusSince: now - LOUNGE_AFTER_MS - 1 });
  assert.equal(initialPlace(agents.p, agents, now), breakPlace('p'));
  agents.p.statusSince = now - LOUNGE_AFTER_MS + 1;
  assert.equal(initialPlace(agents.p, agents, now), 'desk');
});

test('first load: older saved states without statusSince fall back to lastSeen', () => {
  const now = 1_000_000;
  const agents = world({ id: 'p', status: 'idle', lastSeen: now - 60_000 });
  assert.equal(initialPlace(agents.p, agents, now), breakPlace('p'));
  assert.equal(idleAgeMs(agents.p, now), 60_000);
});

test('first load: meeting, helper and offline follow the same rules', () => {
  const now = 1_000_000;
  const agents = world({ id: 'p', status: 'working', team: 't' }, { id: 'h', status: 'working', parent: 'p', team: 't' }, { id: 'o', status: 'offline', team: 't' });
  assert.equal(initialPlace(agents.p, agents, now), 'meeting');
  assert.equal(initialPlace(agents.h, agents, now), 'desk');
  const all = { team: '*', startedAt: 0, endsAt: 1 };
  assert.equal(initialPlace(agents.h, agents, now, all), 'meeting');
  assert.equal(initialPlace(agents.o, agents, now, all), 'desk');
});

test('idleAgeMs is 0 for a busy agent', () => {
  assert.equal(idleAgeMs({ status: 'working', statusSince: 0 }, 99999), 0);
});
