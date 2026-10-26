// Break-room life: what idle cats do in the kitchen, the games room and the lounge.
// Every choice is a pure function of the cat (its seed) and a counter, so the same cat behaves the same
// way each time. Nothing here runs when the user asks for reduced motion.
import { OFFICE_D, toLocal, toWorld, type BuildingLayout } from '../world/layout';
import type { Agent2D, P } from './agent2d';
import { HEAD_TOP, PADDLE } from './cat';
import { rbox, text } from './draw';

type Kind = 'kitchen' | 'games' | 'lounge';
type Ctx = CanvasRenderingContext2D;

interface Room {
  x: number;
  z: number;
  yaw: number;
  w: number;
}

interface Emote {
  id: string;
  room: Kind;
  text: string;
  born: number;
  /** -1 left of the head, 1 right. */
  side: 1 | -1;
}

interface Life {
  /** The cat is in a break room, standing (or sitting on a seat there). */
  on: boolean;
  room: Kind;
  rid: number;
  born: number;
  n: number;
  emoteAt: number;
  sipAt: number;
  sipT: number;
  /** 0 none, 1 walking out, 2 there, 3 walking back. */
  trip: 0 | 1 | 2 | 3;
  tripAt: number;
  until: number;
  target: string;
  homeLook: number;
  home: P;
  stretchAt: number;
  stretchT: number;
  cheerT: number;
  mugAt: number;
}

interface Rally {
  on: boolean;
  a: string;
  b: string;
  left: Agent2D | null;
  right: Agent2D | null;
  /** Flight progress 0..1 and flights since the serve. */
  p: number;
  flight: number;
  hits: number;
  goal: number;
  pause: number;
  ball: boolean;
  round: number;
}

export type Slots = Record<'meeting' | 'lounge' | 'games' | 'kitchen', Map<string, number>>;

const FLIGHT = 0.8;
const SIP_DUR = 1.5;
const EMOTE_LIFE = 1.5;
const MAX_EMOTES = 3;
const EMOTES: Record<Kind, string[]> = {
  kitchen: ['☕', '♪', 'ㅋㅋ', '☕'],
  games: ['ㅋㅋ', '!', '♪'],
  lounge: ['z', '♥', '♪', 'ㅋㅋ'],
};
const TV_COLORS = ['#8fd3ff', '#ffd27a', '#ff9eb5', '#b9a6ff', '#a6e3b5'];

/** A repeatable number in [0, 1) from a seed and a counter. */
function rnd(seed: number, n: number) {
  let h = Math.imul(((seed * 1000) | 0) + 7919, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const sign = (v: number) => (v < 0 ? -1 : 1);

/** Room-local way between two spots in the games room: round the end of the table, along the aisle in front of it. */
function gamesWay(x0: number, z0: number, x1: number, z1: number): [number, number][] {
  const aisle = 1.2;
  const behind = (z: number) => z < -1.1;
  const out: [number, number][] = [];
  const a = behind(z0) ? sign(x0) * 1.7 : x0;
  const b = behind(z1) ? sign(x1) * 1.7 : x1;
  if (a !== x0) out.push([a, z0]);
  out.push([a, aisle], [b, aisle]);
  if (b !== x1) out.push([b, z1]);
  out.push([x1, z1]);
  return out;
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export class BreakLife {
  private rooms = new Map<Kind, Room>();
  private roomKey = '';
  private life = new Map<string, Life>();
  private emotes: Emote[] = [];
  private busy = new Map<string, string>();
  private active: Agent2D[] = [];
  private rally: Rally = { on: false, a: '', b: '', left: null, right: null, p: 0, flight: 0, hits: 0, goal: 5, pause: 0, ball: false, round: 0 };
  private watchers = 0;
  private stretchers = 0;

  setPlan(plan: BuildingLayout) {
    const key = plan.amenities.map((a) => `${a.kind}:${a.rect.x.toFixed(2)}:${a.rect.z.toFixed(2)}:${a.rect.w.toFixed(2)}:${a.side}`).join('|');
    if (key === this.roomKey) return;
    this.roomKey = key;
    this.rooms.clear();
    for (const a of plan.amenities) {
      if (a.kind === 'kitchen' || a.kind === 'games' || a.kind === 'lounge') {
        this.rooms.set(a.kind, { x: a.rect.x, z: a.rect.z, yaw: a.side === 'north' ? 0 : Math.PI, w: a.rect.w });
      }
    }
  }

  /** Put every prop down (reduced motion on, reset). */
  clear(agents: Map<string, Agent2D>) {
    for (const a of agents.values()) this.drop(a);
    this.life.clear();
    this.emotes.length = 0;
    this.busy.clear();
    this.rally.on = false;
    this.watchers = 0;
  }

  forget(id: string) {
    this.life.delete(id);
    this.emotes = this.emotes.filter((e) => e.id !== id);
    for (const [k, v] of this.busy) if (v === id) this.busy.delete(k);
  }

  private drop(a: Agent2D) {
    const act = a.act;
    act.prop = 0;
    act.sip = act.swing = act.stretch = act.cheer = 0;
  }

  private w(room: Room, lx: number, lz: number): P {
    const [x, z] = toWorld(room, [lx, lz]);
    return { x, z };
  }

  // ------------------------------------------------------------------ frame

  update(dt: number, t: number, agents: Map<string, Agent2D>, slots: Slots) {
    const act = this.active;
    act.length = 0;
    this.watchers = 0;
    this.stretchers = 0;
    for (const [id, a] of agents) {
      let L = this.life.get(id);
      const room = a.place === 'kitchen' || a.place === 'games' || a.place === 'lounge' ? a.place : null;
      const room_ok = room !== null && this.rooms.has(room);
      const tripping = !!L && L.on && L.trip !== 0 && L.trip !== 2 && a.mode === 'walking' && L.rid === a.routeId;
      if (!room_ok || a.leaving || (a.mode !== 'standing' && !tripping)) {
        if (L && L.on) this.release(a, L);
        continue;
      }
      if (!L) this.life.set(id, (L = this.fresh(a)));
      if (!L.on || L.room !== room || L.rid !== a.routeId) this.begin(a, L, room, t);
      if (L.stretchT >= 0) this.stretchers++;
      if (room === 'lounge') this.watchers++;
      act.push(a);
    }
    this.updateRally(dt, t, agents, slots);
    for (const a of act) {
      const L = this.life.get(a.id)!;
      const ac = a.act;
      ac.swing = Math.max(0, ac.swing - dt / 0.3);
      if (L.cheerT > 0) {
        L.cheerT -= dt;
        ac.cheer = Math.min(1, L.cheerT / 0.9 + 0.2);
      } else ac.cheer = 0;
      if (L.room === 'kitchen') this.kitchen(a, L, t);
      else if (L.room === 'games') this.games(a, L, t);
      else this.lounge(a, L, t, dt);
      this.sip(a, L, t, dt);
      this.chat(a, L, t);
    }
    // forget finished emotes
    for (let i = this.emotes.length - 1; i >= 0; i--) if (t - this.emotes[i].born > EMOTE_LIFE) this.emotes.splice(i, 1);
  }

  private fresh(a: Agent2D): Life {
    return {
      on: false, room: 'kitchen', rid: -1, born: 0, n: 0, emoteAt: 0, sipAt: 0, sipT: -1, trip: 0, tripAt: 0, until: 0, target: '',
      homeLook: 0, home: { x: a.x, z: a.z }, stretchAt: 0, stretchT: -1, cheerT: 0, mugAt: 0,
    };
  }

  private r(a: Agent2D, L: Life) {
    return rnd(a.seed, L.n++);
  }

  private begin(a: Agent2D, L: Life, room: Kind, t: number) {
    this.drop(a);
    for (const [k, v] of this.busy) if (v === a.id) this.busy.delete(k);
    L.on = true;
    L.room = room;
    L.rid = a.routeId;
    L.born = t;
    L.n = 0;
    L.trip = 0;
    L.sipT = -1;
    L.stretchT = -1;
    L.cheerT = 0;
    L.mugAt = t + 0.6 + this.r(a, L) * 1.6;
    L.sipAt = L.mugAt + 1.2 + this.r(a, L) * 3;
    L.emoteAt = t + 2 + this.r(a, L) * 4;
    L.tripAt = t + 5 + this.r(a, L) * 9;
    L.stretchAt = t + 8 + this.r(a, L) * 30;
    L.home = { x: a.x, z: a.z };
    L.homeLook = a.lookGoal;
    a.act.side = a.seed > 0.5 ? 1 : -1;
    // Placed on load: the mug is already in hand.
    if (a.snapped) {
      L.mugAt = t;
      a.snapped = false;
    }
  }

  private release(a: Agent2D, L: Life) {
    L.on = false;
    L.trip = 0;
    for (const [k, v] of this.busy) if (v === a.id) this.busy.delete(k);
    this.drop(a);
  }

  // ------------------------------------------------------------------ shared pieces

  private sip(a: Agent2D, L: Life, t: number, dt: number) {
    const ac = a.act;
    if (ac.prop !== 1 && ac.prop !== 2) {
      ac.sip = 0;
      return;
    }
    if (L.sipT >= 0) {
      L.sipT += dt;
      if (L.sipT >= SIP_DUR) {
        L.sipT = -1;
        L.sipAt = t + (L.room === 'lounge' ? 5 : 3.5) + this.r(a, L) * 4;
        ac.sip = 0;
      } else ac.sip = Math.min(1, Math.sin((Math.PI * L.sipT) / SIP_DUR) * 1.7);
    } else if (t >= L.sipAt && L.trip !== 1 && L.trip !== 3) L.sipT = 0;
  }

  /** Small bubbles over the head now and then (one per cat every 4 to 8 s, three at most per room). */
  private chat(a: Agent2D, L: Life, t: number) {
    if (t < L.emoteAt) return;
    const list = EMOTES[L.room];
    const text = list[Math.floor(this.r(a, L) * list.length) % list.length];
    if (this.say(a, L.room, text, t)) L.emoteAt = t + 4 + this.r(a, L) * 4;
    else L.emoteAt = t + 0.7;
  }

  private say(a: Agent2D, room: Kind, text: string, t: number) {
    let n = 0;
    for (const e of this.emotes) {
      if (e.room === room) n++;
      if (e.id === a.id) return false;
    }
    if (n >= MAX_EMOTES) return false;
    this.emotes.push({ id: a.id, room, text, born: t, side: a.seed > 0.5 ? -1 : 1 });
    return true;
  }

  /** Walk a side trip. `route` is in room-local metres and ends at the spot. */
  private trip(a: Agent2D, L: Life, room: Room, pts: [number, number][], target: string, sit: boolean, dwell: number) {
    const route = pts.map(([x, z]) => this.w(room, x, z));
    const end = route[route.length - 1];
    const look = sign(end.x - route[Math.max(0, route.length - 2)].x) * 0.8;
    L.home = { x: a.x, z: a.z };
    L.homeLook = a.lookGoal;
    if (!a.detour(route, look, sit)) return false;
    this.busy.set(target, a.id);
    L.trip = 1;
    L.target = target;
    L.until = dwell;
    return true;
  }

  /** Drive a side trip: arrive, stay a while, walk home. Returns true while the cat is away from its spot. */
  private driveTrip(a: Agent2D, L: Life, t: number, back: () => P[]) {
    if (L.trip === 1 && a.mode === 'standing') {
      L.trip = 2;
      L.until = t + L.until;
      this.arrived(a, L, t);
    } else if (L.trip === 2 && t >= L.until) {
      a.detour(back(), L.homeLook, false);
      L.trip = 3;
    } else if (L.trip === 3 && a.mode === 'standing') {
      L.trip = 0;
      L.tripAt = t + 9 + this.r(a, L) * 10;
      a.faceTo(L.homeLook);
      this.busy.delete(L.target);
    }
    return L.trip !== 0;
  }

  private arrived(a: Agent2D, L: Life, t: number) {
    const ac = a.act;
    if (L.target === 'fridge' || L.target === 'vending') {
      ac.prop = 2;
      L.sipAt = t + 1.5 + this.r(a, L) * 1.2;
      this.say(a, L.room, '!', t);
    } else if (L.target === 'beanbag') this.say(a, L.room, 'z', t);
  }

  // ------------------------------------------------------------------ rooms

  private kitchen(a: Agent2D, L: Life, t: number) {
    const ac = a.act;
    if (ac.prop === 0 && t >= L.mugAt) ac.prop = 1;
    const room = this.rooms.get('kitchen')!;
    if (this.driveTrip(a, L, t, () => this.backRoute(a, L, room)) || t < L.tripAt) return;
    // To the fridge or the vending machine, one cat at a time per spot.
    const pick = this.r(a, L) < 0.5 ? 'fridge' : 'vending';
    const other = pick === 'fridge' ? 'vending' : 'fridge';
    const target = this.busy.has(pick) ? (this.busy.has(other) ? '' : other) : pick;
    if (!target) {
      L.tripAt = t + 3;
      return;
    }
    const [lx, lz] = toLocal(room, [a.x, a.z]);
    const lane = 1.0;
    const stand = target === 'fridge' ? [room.w / 2 - 0.9, -2.7] : [-room.w / 2 + 1.0, -2.7];
    const via = target === 'fridge' ? stand[0] : -room.w / 2 + 1.55;
    const pts: [number, number][] = [];
    // Behind the island: round its west end first.
    const ax = lz < -1.0 ? -1.9 : lx;
    if (ax !== lx) pts.push([ax, lz]);
    if (lz < lane - 0.1) pts.push([ax, lane]);
    pts.push([via, lane], [via, stand[1]]);
    if (via !== stand[0]) pts.push([stand[0], stand[1]]);
    if (!this.trip(a, L, room, pts, target, false, 2.4 + this.r(a, L) * 1.2)) L.tripAt = t + 4;
  }

  /** Same way back, ending on the cat's own spot. */
  private backRoute(a: Agent2D, L: Life, room: Room): P[] {
    const [x, z] = toLocal(room, [a.x, a.z]);
    const lane = 1.0;
    const [hx, hz] = toLocal(room, [L.home.x, L.home.z]);
    const pts: [number, number][] = [];
    const wasVending = L.target === 'vending';
    if (wasVending) pts.push([x + 0.6, z]);
    pts.push([wasVending ? -room.w / 2 + 1.55 : x, lane]);
    if (hz < lane - 0.1) {
      const ax = hz < -1.0 ? -1.9 : hx;
      pts.push([ax, lane]);
      if (ax !== hx) pts.push([ax, hz]);
    }
    pts.push([hx, hz]);
    return pts.map(([px, pz]) => this.w(room, px, pz));
  }

  private games(a: Agent2D, L: Life, t: number) {
    const ac = a.act;
    const R = this.rally;
    const room = this.rooms.get('games')!;
    if (R.on && (a.id === R.a || a.id === R.b)) {
      const mate = this.rallyMate(a.id === R.a ? R.b : R.a);
      ac.prop = 3;
      if (mate) {
        ac.side = sign(mate.x - a.x) as 1 | -1;
        a.faceTo(ac.side * 0.8);
      }
      return;
    }
    // A cat that is not in the rally may sit on a beanbag for a while.
    if (L.trip === 0) {
      if (t >= L.tripAt) {
        if (this.busy.has('beanbag')) L.tripAt = t + 3;
        else {
          const bean: [number, number] = this.r(a, L) < 0.5 ? [-room.w / 2 + 1.0, OFFICE_D / 2 - 1.4] : [-room.w / 2 + 2.0, OFFICE_D / 2 - 1.1];
          const [lx, lz] = toLocal(room, [a.x, a.z]);
          if (!this.trip(a, L, room, gamesWay(lx, lz, bean[0], bean[1]), 'beanbag', true, 4 + this.r(a, L) * 3)) L.tripAt = t + 4;
        }
      }
    } else this.driveTrip(a, L, t, () => {
      const [x, z] = toLocal(room, [a.x, a.z]);
      const [hx, hz] = toLocal(room, [L.home.x, L.home.z]);
      return gamesWay(x, z, hx, hz).map(([px, pz]) => this.w(room, px, pz));
    });
    if (L.trip !== 0) {
      ac.prop = 0;
      return;
    }
    if (R.on) {
      // watching the rally
      ac.prop = a.seed > 0.5 ? 2 : 0;
      a.faceTo(sign(this.tableX(room) - a.x) * 0.5);
    } else ac.prop = 4;
  }

  private tableX(room: Room) {
    return this.w(room, 0, -0.4).x;
  }

  private rallyMate(id: string) {
    const r = this.rally;
    return r.left && r.left.id === id ? r.left : r.right && r.right.id === id ? r.right : null;
  }

  private lounge(a: Agent2D, L: Life, t: number, dt: number) {
    const ac = a.act;
    const room = this.rooms.get('lounge')!;
    if (ac.prop === 0 && t >= L.mugAt && a.seed < 0.75) ac.prop = a.seed < 0.45 ? 2 : 1;
    a.faceTo(clamp((this.w(room, 0.2, 1.7).x - a.x) * 0.5, -0.7, 0.7));
    if (L.stretchT < 0 && t >= L.stretchAt && this.stretchers === 0) {
      L.stretchT = 0;
      this.stretchers++;
    }
    if (L.stretchT >= 0) {
      L.stretchT += dt;
      const u = L.stretchT / 1.8;
      if (u >= 1) {
        L.stretchT = -1;
        L.stretchAt = t + 20 + this.r(a, L) * 30;
        ac.stretch = 0;
      } else ac.stretch = Math.sin(Math.PI * u);
    }
  }

  // ------------------------------------------------------------------ ping pong

  private updateRally(dt: number, t: number, agents: Map<string, Agent2D>, slots: Slots) {
    const R = this.rally;
    let ia = '';
    let ib = '';
    for (const [id, s] of slots.games) {
      if (s === 0) ia = id;
      else if (s === 1) ib = id;
    }
    const ready = (id: string) => {
      const a = agents.get(id);
      const L = this.life.get(id);
      return a && L && L.on && L.room === 'games' && L.trip === 0 && a.mode === 'standing' && t - L.born > 0.8 ? a : null;
    };
    const A = ia ? ready(ia) : null;
    const B = ib ? ready(ib) : null;
    if (!A || !B) {
      if (R.on) R.on = false;
      R.left = R.right = null;
      return;
    }
    R.left = A.x <= B.x ? A : B;
    R.right = A.x <= B.x ? B : A;
    if (!R.on || R.a !== A.id || R.b !== B.id) {
      R.on = true;
      R.a = A.id;
      R.b = B.id;
      R.flight = 0;
      R.hits = 0;
      R.p = 0;
      R.pause = 0.9;
      R.ball = false;
      R.goal = 4 + Math.floor(rnd(A.seed + B.seed, R.round) * 6);
    }
    if (R.pause > 0) {
      R.pause -= dt;
      if (R.pause <= 0) {
        R.ball = true;
        R.p = 0;
        this.server().act.swing = 1;
      }
      return;
    }
    R.p += dt / FLIGHT;
    if (R.p < 1) return;
    R.p -= 1;
    R.flight++;
    R.hits++;
    const hitter = this.flightToRight() ? R.right! : R.left!;
    hitter.act.swing = 1;
    if (R.hits % 3 === 0) hitter.kick(1.6);
    if (R.hits >= R.goal) {
      // a point: the last hitter wins
      R.ball = false;
      R.pause = 2.2;
      R.round++;
      R.hits = 0;
      R.flight = 0;
      R.goal = 4 + Math.floor(rnd(A.seed + B.seed, R.round) * 6);
      const loser = hitter === R.left ? R.right! : R.left!;
      hitter.kick(3);
      const L = this.life.get(hitter.id);
      if (L) L.cheerT = 1;
      this.say(hitter, 'games', rnd(hitter.seed, R.round) < 0.5 ? '★' : '!', t);
      this.say(loser, 'games', 'ㅋㅋ', t);
      for (const a of this.active) {
        const La = this.life.get(a.id)!;
        if (La.room !== 'games' || a.id === R.a || a.id === R.b || La.trip !== 0) continue;
        if (rnd(a.seed, R.round) < 0.75) {
          a.kick(2.6);
          La.cheerT = 1;
          this.say(a, 'games', rnd(a.seed, R.round + 50) < 0.5 ? '와!' : 'ㅋㅋ', t);
        }
      }
    }
  }

  private server() {
    const R = this.rally;
    return R.round % 2 === 0 ? R.left! : R.right!;
  }

  /** The ball is flying left to right. The server alternates per point. */
  private flightToRight() {
    const R = this.rally;
    return (R.flight + R.round) % 2 === 0;
  }

  // ------------------------------------------------------------------ drawing

  /** Under the cats: the TV screen flickers and throws light on the lounge floor. */
  drawFx(ctx: Ctx, t: number) {
    const room = this.rooms.get('lounge');
    if (!room || this.watchers === 0) return;
    const i = Math.floor(t * 1.7 + Math.sin(t * 0.7) * 2);
    const color = TV_COLORS[((i % 5) + 5) % 5];
    const flick = 0.72 + 0.28 * Math.sin(t * 23) * Math.sin(t * 7.3);
    ctx.save();
    ctx.translate(room.x, room.z);
    ctx.rotate(room.yaw);
    const g = ctx.createLinearGradient(0, 1.55, 0, -0.9);
    g.addColorStop(0, `rgba(170,215,255,${0.2 * flick})`);
    g.addColorStop(1, 'rgba(170,215,255,0)');
    ctx.beginPath();
    ctx.moveTo(0.2 - 0.7, 1.55);
    ctx.lineTo(0.2 + 0.7, 1.55);
    ctx.lineTo(0.2 + 1.8, -0.9);
    ctx.lineTo(0.2 - 1.8, -0.9);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(0.2 - 0.7, 1.58 - 0.04, 1.4, 0.08, 0.03);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55 + 0.45 * flick;
    ctx.fill();
    ctx.restore();
  }

  /** The ping-pong ball, as a depth-sorted item. Returns its sort key, or null when there is no ball. */
  rallyDepth(): number | null {
    const R = this.rally;
    if (!R.on || !R.ball || !R.left || !R.right) return null;
    return (R.left.z + R.right.z) / 2;
  }

  drawRally(ctx: Ctx, k: number) {
    const R = this.rally;
    if (!R.left || !R.right) return;
    const l = R.left;
    const r = R.right;
    const xl = l.x + PADDLE.x * k;
    const xr = r.x - PADDLE.x * k;
    const toRight = this.flightToRight();
    const e = toRight ? R.p : 1 - R.p;
    const x = xl + (xr - xl) * e;
    const zb = (l.z + r.z) / 2 + PADDLE.y * k;
    const arc = 4 * R.p * (1 - R.p) * 0.38 * k;
    // shadow on the table, then the ball
    ctx.beginPath();
    ctx.ellipse(x, (l.z + r.z) / 2 - 0.02, 0.09 * (1 - arc * 0.15), 0.045, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(30,60,55,0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, zb - arc, 0.075, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = '#d98a3d';
    ctx.stroke();
  }

  /** Small rounded bubbles beside the head: fade in, rise a little, fade out. */
  drawEmotes(ctx: Ctx, agents: Map<string, Agent2D>, t: number, k: number) {
    for (const e of this.emotes) {
      const a = agents.get(e.id);
      if (!a || a.mode === 'gone') continue;
      const u = (t - e.born) / EMOTE_LIFE;
      if (u < 0 || u > 1) continue;
      const alpha = Math.min(1, u / 0.15, (1 - u) / 0.3);
      const pop = u < 0.2 ? 0.6 + 0.4 * Math.sin((u / 0.2) * Math.PI * 0.5) : 1;
      const len = e.text.length;
      const bw = (0.34 + 0.2 * len) * k;
      const bh = 0.4 * k;
      const x = a.x + e.side * (0.55 * k + bw / 2);
      const y = a.z - (HEAD_TOP * 0.8 - 0.1 * a.sit + a.hop) * k - u * 0.3 * k;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      // tail toward the head
      ctx.beginPath();
      ctx.moveTo(-e.side * (bw / 2 - 0.1 * k), bh / 2 - 0.02 * k);
      ctx.lineTo(-e.side * (bw / 2 + 0.06 * k), bh / 2 + 0.1 * k);
      ctx.lineTo(-e.side * (bw / 2 - 0.22 * k), bh / 2 - 0.02 * k);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      rbox(ctx, 0, 0, bw, bh, '#ffffff', bh / 2, { lw: 0.035 * k, line: '#e2c9bd', shadow: false });
      text(ctx, e.text, 0, 0.02 * k, 0.27 * k, '#5a3a40', { weight: 800 });
      ctx.restore();
    }
  }
}
