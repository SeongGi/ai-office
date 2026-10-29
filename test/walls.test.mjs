// Cats move through doors and the corridor only. The layout and route code is TypeScript, so this test bundles the real
// modules (layout, trips, walls, toolRooms and the cat's own walking code) with rolldown (vite's bundler) into a temp file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let M;
let dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-floor-walls-'));
  const out = join(dir, 'routes.mjs');
  const bundle = await rolldown({ input: join(root, 'test/support/routes.entry.ts'), platform: 'node', logLevel: 'silent' });
  await bundle.write({ file: out, format: 'esm' });
  M = await import(pathToFileURL(out).href);
});

after(() => dir && rmSync(dir, { recursive: true, force: true }));

// ---------------------------------------------------------------- worlds

/** `counts[i]` agents in team i; every third team has a lead (a main agent with a child). */
function world(counts) {
  const teams = {};
  const agents = {};
  counts.forEach((n, i) => {
    const id = `t${i}`;
    teams[id] = { id, name: `팀${i}`, hue: (i * 47) % 360, order: i, createdAt: 0 };
    for (let k = 0; k < n; k++) {
      const aid = `${id}-a${k}`;
      agents[aid] = { id: aid, team: id, role: k === 0 && i % 3 === 0 ? 'lead' : 'dev', name: aid, status: 'idle', joinedAt: i * 100 + k };
    }
  });
  return { teams, agents, meeting: null };
}
const plan = (counts) => {
  const book = new M.SeatBook();
  return M.computeLayout(world(counts), book);
};

// 1, 3, 6 and 12 teams, with team sizes that make the two wings uneven.
const SIZES = [2, 7, 4, 1, 9, 5, 3, 6, 2, 8, 4, 1];
const CASES = [1, 3, 6, 12].map((n) => ({ name: `${n} teams`, counts: SIZES.slice(0, n) }));

/** Search a few uneven worlds for ones with a booths room and with a widened open room, so both rules are exercised. */
function extraCases() {
  const found = { booths: null, widened: null };
  for (let n = 1; n <= 14 && !(found.booths && found.widened); n++) {
    for (let shift = 0; shift < 12; shift++) {
      const counts = Array.from({ length: n }, (_, i) => 1 + ((i * 5 + shift * 3) % 9));
      const p = plan(counts);
      if (!found.booths && p.amenities.some((a) => a.kind === 'booths')) found.booths = { name: `booths world ${n}/${shift}`, counts };
      const sums = { north: 0, south: 0 };
      for (const a of p.amenities) sums[a.side] += a.rect.w;
      const open = p.amenities.filter((a) => ['lounge', 'games', 'kitchen'].includes(a.kind));
      const bases = { lounge: 9, games: 6.5, kitchen: 7.5 };
      if (!found.widened && open.some((a) => a.rect.w > bases[a.kind] + 0.01)) found.widened = { name: `widened world ${n}/${shift}`, counts };
    }
  }
  return found;
}
const EXTRA = { booths: null, widened: null };

/** Rooms cats are sent to (the interview room is for the decor cats only). */
const TRIPS = new Set(['meeting', 'lounge', 'games', 'kitchen', 'booths', 'library', 'server', 'search']);
const tripRooms = (P) => P.plan.amenities.filter((a) => TRIPS.has(a.kind));

const allCases = () => {
  const f = extraCases();
  EXTRA.booths = f.booths;
  EXTRA.widened = f.widened;
  return [...CASES, ...[f.booths, f.widened].filter(Boolean)];
};

// ---------------------------------------------------------------- geometry

const EPS = 1e-7;
const side = (v, c) => (Math.abs(v - c) < EPS ? 0 : Math.sign(v - c));

/** The wall segments `p` to `q` crosses (touching a wall line at an end point is not crossing). */
function crossings(p, q, walls) {
  const hits = [];
  for (const [x1, z1, x2, z2] of walls) {
    if (Math.abs(x1 - x2) < EPS) {
      if (side(p.x, x1) * side(q.x, x1) >= 0) continue;
      const z = p.z + ((x1 - p.x) / (q.x - p.x)) * (q.z - p.z);
      if (z >= Math.min(z1, z2) - EPS && z <= Math.max(z1, z2) + EPS) hits.push([x1, z1, x2, z2]);
    } else {
      if (side(p.z, z1) * side(q.z, z1) >= 0) continue;
      const x = p.x + ((z1 - p.z) / (q.z - p.z)) * (q.x - p.x);
      if (x >= Math.min(x1, x2) - EPS && x <= Math.max(x1, x2) + EPS) hits.push([x1, z1, x2, z2]);
    }
  }
  return hits;
}

/** A polyline: consecutive points (the first segment starts at `from`). */
function segments(from, pts) {
  const out = [];
  let prev = from;
  for (const p of pts) {
    out.push([prev, p]);
    prev = p;
  }
  return out;
}

function checkPath(P, label, from, pts) {
  for (const [a, b] of segments(from, pts)) {
    const hit = crossings(a, b, P.walls);
    assert.equal(hit.length, 0, `${label}: (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) to (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) crosses wall ${JSON.stringify(hit[0])}`);
    for (const p of [a, b]) {
      assert.ok(p.x >= P.plan.x0 - EPS && p.x <= P.plan.x1 + EPS && p.z >= P.plan.z0 - EPS && p.z <= P.plan.z1 + EPS, `${label}: point outside the building`);
    }
  }
}

function setup(counts) {
  const p = plan(counts);
  return { plan: p, walls: M.wallSegments(p) };
}

const catFor = (room) => {
  const id = [...room.seats.keys()][0];
  return { id, role: 'dev', team: room.team.id };
};

/** A cat seated at its first seat, like World2D leaves it. */
function seatedCat(room) {
  const seat = room.seats.values().next().value;
  const cat = new M.Agent2D(catFor(room));
  cat.setSeat(M.seatWorld(room, seat), true);
  return cat;
}

// ---------------------------------------------------------------- tests

test('every case has a building with rooms; the extra worlds were found', () => {
  const cases = allCases();
  assert.ok(cases.length >= 4);
  assert.ok(EXTRA.booths, 'no uneven world with a booths room found');
  assert.ok(EXTRA.widened, 'no uneven world with a widened open room found');
});

test('entry starts in the elevator, exit ends in it, and neither crosses a wall', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    const [ex, ez] = P.plan.entrance;
    for (const room of P.plan.rooms.values()) {
      const entry = room.entry.map((p) => M.toWorld(room, p));
      assert.ok(Math.abs(entry[0][0] - ex) < 1e-6 && Math.abs(entry[0][1] - ez) < 1e-6, `${c.name}: entry of ${room.team.id} does not start at the elevator`);
      const exit = room.exit.map((p) => M.toWorld(room, p));
      const last = exit[exit.length - 1];
      assert.ok(Math.abs(last[0] - ex) < 1e-6 && Math.abs(last[1] - ez) < 1e-6, `${c.name}: exit of ${room.team.id} does not end at the elevator`);
      assert.ok(Math.abs(ex - M.ELEVATOR.x) < 1e-6 && ez < M.ELEVATOR.z + 1, `${c.name}: entrance is not at the elevator`);
      checkPath(P, `${c.name} entry ${room.team.id}`, { x: M.SPAWN.x, z: M.SPAWN.z }, entry.map(([x, z]) => ({ x, z })));
      checkPath(P, `${c.name} exit ${room.team.id}`, { x: entry[entry.length - 1][0], z: entry[entry.length - 1][1] }, M.exitFor(room));
    }
  }
});

test('every seat path, the walk in from the elevator and the walk out from the seat stay inside doors and corridor', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const room of P.plan.rooms.values()) {
      for (const [id, seat] of room.seats) {
        const sw = M.seatWorld(room, seat);
        const cat = new M.Agent2D({ id, role: 'dev', team: room.team.id });
        cat.arrive([M.SPAWN, ...room.entry.map((p) => ({ x: M.toWorld(room, p)[0], z: M.toWorld(room, p)[1] }))], sw, 0);
        checkPath(P, `${c.name} arrive ${id}`, { x: cat.x, z: cat.z }, cat.path);
        const sat = new M.Agent2D({ id, role: 'dev', team: room.team.id });
        sat.setSeat(sw, true);
        sat.leave(M.exitFor(room), () => {});
        checkPath(P, `${c.name} leave ${id}`, { x: sat.x, z: sat.z }, sat.path);
        assert.ok(Math.hypot(sat.path[sat.path.length - 1].x - M.SPAWN.x, sat.path[sat.path.length - 1].z - M.SPAWN.z) < 1e-6, 'leave ends in the elevator');
      }
    }
  }
});

test('trip routes from every team room to every spot of every shared room, and the way back, cross no wall', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const room of P.plan.rooms.values()) {
      for (const am of tripRooms(P)) {
        const n = M.roomSpots(am.kind, am.rect.w).length;
        for (let slot = 0; slot < n; slot++) {
          const trip = M.tripRoute(P.plan, room.team.id, am.kind, slot);
          assert.ok(trip, `${c.name}: no route to ${am.kind} #${slot}`);
          const cat = seatedCat(room);
          cat.goTo(trip.route, trip.look, trip.sit);
          checkPath(P, `${c.name} ${room.team.id} to ${am.kind} #${slot}`, { x: cat.x, z: cat.z }, cat.path);
          // arrived: stand there, then walk back to the seat
          cat.placeAt(trip.route, trip.look, trip.sit);
          cat.returnToSeat();
          checkPath(P, `${c.name} ${am.kind} #${slot} back to ${room.team.id}`, { x: cat.x, z: cat.z }, cat.path);
        }
      }
    }
  }
});

test('a hop from a tool room spot to a lounge spot (or any other room) goes back to the corridor first and crosses no wall', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    const rooms = [...P.plan.rooms.values()];
    for (const room of [rooms[0], rooms[Math.floor(rooms.length / 2)], rooms[rooms.length - 1]]) {
      for (const from of ['library', 'server', 'search']) {
        const fam = P.plan.amenities.find((a) => a.kind === from);
        const fromN = M.roomSpots(from, fam.rect.w).length;
        for (let i = 0; i < fromN; i++) {
          const first = M.tripRoute(P.plan, room.team.id, from, i);
          for (const am of tripRooms(P)) {
            if (am.kind === from) continue;
            const n = M.roomSpots(am.kind, am.rect.w).length;
            for (let j = 0; j < n; j++) {
              const next = M.tripRoute(P.plan, room.team.id, am.kind, j);
              const cat = seatedCat(room);
              cat.placeAt(first.route, first.look, first.sit);
              cat.goTo(next.route, next.look, next.sit);
              checkPath(P, `${c.name} ${from} #${i} to ${am.kind} #${j}`, { x: cat.x, z: cat.z }, cat.path);
            }
          }
        }
      }
    }
  }
});

test('every spot lies inside its room and keeps clear of furniture; routes to tool room seats cross no furniture', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const am of tripRooms(P)) {
      const w = am.rect.w;
      const spots = M.roomSpots(am.kind, w);
      for (const s of spots) {
        assert.ok(Math.abs(s.x) <= w / 2 - 0.4 && Math.abs(s.z) <= M.OFFICE_D / 2 - 0.4, `${c.name}: ${am.kind} spot (${s.x}, ${s.z}) is not inside the room`);
      }
      if (am.kind !== 'server' && am.kind !== 'search') continue;
      const boxes = M.toolObstacles(am.kind, w);
      const hits = (a, b, box) => {
        // segment against box (Liang-Barsky)
        const x0 = box.x - box.w / 2;
        const x1 = box.x + box.w / 2;
        const z0 = box.z - box.d / 2;
        const z1 = box.z + box.d / 2;
        let t0 = 0;
        let t1 = 1;
        for (const [p, q, lo, hi] of [[a.x, b.x, x0, x1], [a.z, b.z, z0, z1]]) {
          const d = q - p;
          if (Math.abs(d) < 1e-12) {
            if (p < lo || p > hi) return false;
          } else {
            let u0 = (lo - p) / d;
            let u1 = (hi - p) / d;
            if (u0 > u1) [u0, u1] = [u1, u0];
            t0 = Math.max(t0, u0);
            t1 = Math.min(t1, u1);
            if (t0 >= t1) return false;
          }
        }
        return true;
      };
      for (const [i, s] of spots.entries()) {
        const foot = s.desk ? 0.36 : 0.25;
        for (const box of boxes) {
          assert.ok(!hits({ x: s.x - foot, z: s.z }, { x: s.x + foot, z: s.z }, box) && !hits({ x: s.x, z: s.z - foot }, { x: s.x, z: s.z + foot }, box), `${c.name}: ${am.kind} seat #${i} overlaps furniture`);
        }
      }
      // routes in room-local coordinates: undo the frame
      const yaw = am.side === 'north' ? 0 : Math.PI;
      const local = (p) => {
        const dx = p.x - am.rect.x;
        const dz = p.z - am.rect.z;
        return { x: dx * Math.cos(yaw) - dz * Math.sin(yaw), z: dx * Math.sin(yaw) + dz * Math.cos(yaw) };
      };
      const room = [...P.plan.rooms.values()][0];
      for (let slot = 0; slot < spots.length; slot++) {
        const trip = M.tripRoute(P.plan, room.team.id, am.kind, slot);
        const pts = trip.route.map(local);
        for (let k = 1; k < pts.length; k++) {
          for (const box of boxes) assert.ok(!hits(pts[k - 1], pts[k], box), `${c.name}: route to ${am.kind} #${slot} crosses furniture`);
        }
      }
    }
  }
});

// A cat sprite at normal zoom is about 1.3 m wide and 1.4 m tall, the foot point at the bottom centre.
const SPRITE = { halfW: 0.65, h: 1.4 };
const WALL_HALF = 0.18; // the wall line is 0.36 thick
const MARGIN = 0.25;

/** Two standing places do not overlap: 1.9 apart in x, or 1.5 apart in z. */
const apart = (a, b) => Math.abs(a.x - b.x) >= 1.9 - 1e-9 || Math.abs(a.z - b.z) >= 1.5 - 1e-9;

/** The sprite box of a foot point in room-local coordinates; screen-up is -z in a north room and +z in a south room. */
const spriteBox = (x, z, side) => ({ x0: x - SPRITE.halfW, x1: x + SPRITE.halfW, z0: side === 'north' ? z - SPRITE.h : z, z1: side === 'north' ? z : z + SPRITE.h });

test('the cats on the meeting chairs do not overlap each other', () => {
  const chairs = M.roomSpots('meeting', 6.5).slice(0, M.MEETING_CHAIRS);
  for (let i = 0; i < chairs.length; i++) {
    for (let j = i + 1; j < chairs.length; j++) {
      const a = chairs[i];
      const b = chairs[j];
      const clear = Math.abs(a.x - b.x) >= SPRITE.halfW * 2 - 1e-9 || Math.abs(a.z - b.z) >= SPRITE.h - 1e-9;
      assert.ok(clear, `meeting chairs #${i} (${a.x.toFixed(2)}, ${a.z.toFixed(2)}) and #${j} (${b.x.toFixed(2)}, ${b.z.toFixed(2)}) overlap`);
    }
  }
});

test('no two spots of a room are closer than 1.0 m; standing spots of break rooms, booths and the outer meeting ring do not overlap', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const am of tripRooms(P)) {
      const spots = M.roomSpots(am.kind, am.rect.w);
      for (let i = 0; i < spots.length; i++) {
        for (let j = i + 1; j < spots.length; j++) {
          const d = Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z);
          assert.ok(d >= 1.0 - 1e-9, `${c.name}: ${am.kind} spots #${i} and #${j} are ${d.toFixed(2)} m apart`);
          const rule = M.BREAK_KINDS.includes(am.kind) || (am.kind === 'meeting' && i >= M.MEETING_CHAIRS);
          if (rule) assert.ok(apart(spots[i], spots[j]), `${c.name}: ${am.kind} spots #${i} (${spots[i].x}, ${spots[i].z}) and #${j} (${spots[j].x}, ${spots[j].z}) overlap`);
        }
      }
    }
  }
});

test('no cat sprite reaches a wall or a door plaque, in a north or a south room', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const am of tripRooms(P)) {
      const w = am.rect.w;
      const tool = ['library', 'server', 'search'].includes(am.kind);
      for (const side of ['north', 'south']) {
        // inside the inner face of the walls; the door plaque (0.82 tall) hangs on the front wall, the tool room's use plaque on the back wall
        const lo = tool && side === 'north' ? -M.OFFICE_D / 2 + 0.34 + 0.44 : -M.OFFICE_D / 2 + WALL_HALF + MARGIN;
        const hi = M.OFFICE_D / 2 - 0.41 - 0.05;
        for (const [i, s] of M.roomSpots(am.kind, w).entries()) {
          const b = spriteBox(s.x, s.z, side);
          assert.ok(b.x0 >= -w / 2 + WALL_HALF + MARGIN - 1e-9 && b.x1 <= w / 2 - WALL_HALF - MARGIN + 1e-9, `${c.name}: ${am.kind} #${i} sprite reaches a side wall (${side})`);
          assert.ok(b.z0 >= lo - 1e-9 && b.z1 <= hi + 1e-9, `${c.name}: ${am.kind} #${i} sprite reaches a wall or plaque (${side}), z ${b.z0.toFixed(2)}..${b.z1.toFixed(2)}`);
        }
      }
    }
  }
});

test('kitchen and games spots do not stand on furniture', () => {
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const am of tripRooms(P).filter((a) => a.kind === 'kitchen' || a.kind === 'games')) {
      const boxes = M.roomObstacles(am.kind, am.rect.w);
      assert.ok(boxes.length);
      for (const [i, s] of M.roomSpots(am.kind, am.rect.w).entries()) {
        for (const b of boxes) {
          const inside = Math.abs(s.x - b.x) < b.w / 2 + 0.25 && Math.abs(s.z - b.z) < b.d / 2 + 0.25;
          assert.ok(!inside, `${c.name}: ${am.kind} spot #${i} (${s.x}, ${s.z}) stands on furniture`);
        }
      }
    }
  }
});

test('a booths room is at least BOOTHS_MIN_W wide and its booths stay inside the walls; a narrower gap widens an open room', () => {
  assert.equal(M.BOOTHS_MIN_W, 3.4);
  for (const c of allCases()) {
    const P = setup(c.counts);
    for (const am of P.plan.amenities.filter((a) => a.kind === 'booths')) {
      assert.ok(am.rect.w >= M.BOOTHS_MIN_W - 1e-9, `${c.name}: booths room ${am.rect.w.toFixed(2)} m wide`);
      const n = M.boothCount(am.rect.w);
      assert.ok(n >= 1, `${c.name}: no booth fits`);
      // outer partitions (0.1 thick) against the inside face of the wall (the wall line is 0.36 thick)
      assert.ok((n * M.BOOTH_PITCH) / 2 + 0.05 <= am.rect.w / 2 - 0.18, `${c.name}: a booth partition reaches the wall`);
      const xs = M.boothSeats(am.rect.w);
      assert.equal(xs.length, n);
      assert.ok(Math.abs(xs[0] + xs[n - 1]) < 1e-9, 'booths are centred');
    }
    // both wings end at the same x
    const ends = { north: P.plan.x0 + 10, south: P.plan.x0 + 10 };
    for (const r of P.plan.rooms.values()) ends[r.side] = Math.max(ends[r.side], r.x + r.w / 2);
    for (const a of P.plan.amenities) ends[a.side] = Math.max(ends[a.side], a.rect.x + a.rect.w / 2);
    assert.ok(Math.abs(ends.north - ends.south) < 1e-6 && Math.abs(ends.north - P.plan.x1) < 1e-6, `${c.name}: wings do not end together`);
  }
});

test('the gap rule: widen lounge, then games, then kitchen, else the last room of that wing', () => {
  const f = allCases();
  assert.ok(f.length);
  const widened = EXTRA.widened;
  const p = plan(widened.counts);
  assert.ok(!p.amenities.some((a) => a.kind === 'booths'), 'a widened world has no booths room');
  const wide = p.amenities.filter((a) => ({ lounge: 9, games: 6.5, kitchen: 7.5 })[a.kind] !== undefined && a.rect.w > ({ lounge: 9, games: 6.5, kitchen: 7.5 })[a.kind] + 0.01);
  assert.equal(wide.length, 1, 'exactly one open room takes the gap');
  const gap = wide[0].rect.w - ({ lounge: 9, games: 6.5, kitchen: 7.5 })[wide[0].kind];
  assert.ok(gap > 0 && gap < M.BOOTHS_MIN_W);
  // if the short side has a lounge, the lounge must be the one
  const sameSide = p.amenities.filter((a) => a.side === wide[0].side).map((a) => a.kind);
  if (sameSide.includes('lounge')) assert.equal(wide[0].kind, 'lounge');
  else if (sameSide.includes('games')) assert.equal(wide[0].kind, 'games');
  else assert.equal(wide[0].kind, 'kitchen');
});

test('the new-hire bench and its cats stay clear of the walls and the door plaque and of each other', () => {
  const b = M.NEWHIRE_BENCH;
  const w = 9; // the narrowest lounge
  assert.ok(w >= M.NEWHIRE_MIN_W);
  assert.ok(b.z - b.d / 2 >= -M.OFFICE_D / 2 + WALL_HALF + 0.1 && b.z + b.d / 2 <= M.OFFICE_D / 2 - 0.46);
  assert.ok(b.x - b.w / 2 >= -w / 2 + WALL_HALF && b.x + b.w / 2 <= w / 2 - WALL_HALF);
  for (const side of ['south']) {
    // the lounge is always in the south wing
    for (const h of M.NEWHIRES) {
      const box = spriteBox(h.x, h.z, side);
      assert.ok(box.x0 >= -w / 2 + WALL_HALF + MARGIN && box.x1 <= w / 2 - WALL_HALF - MARGIN, `${side}: new hire reaches a side wall`);
      assert.ok(box.z0 >= -M.OFFICE_D / 2 + WALL_HALF + MARGIN && box.z1 <= M.OFFICE_D / 2 - 0.46, `${side}: new hire reaches a wall or the plaque`);
      assert.ok(h.z >= b.z - b.d / 2 && h.z <= b.z + b.d / 2 && h.x >= b.x - b.w / 2 && h.x <= b.x + b.w / 2, 'cat is not on the bench');
    }
  }
  assert.ok(apart(M.NEWHIRES[0], M.NEWHIRES[1]), 'the two new hires overlap');
  for (const s of M.roomSpots('lounge', w)) for (const h of M.NEWHIRES) assert.ok(apart(s, h), `lounge spot (${s.x}, ${s.z}) overlaps a new hire`);
});
