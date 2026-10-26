// The 2D "round cartoon" office. Canvas2D only. Same public surface as the 3D World.
import type { Agent, Effect, WorldState } from '../../shared/protocol';
import { desiredPlace, idleAgeMs, initialPlace, type Place } from '../../shared/places';
import type { FloorWorld, WorldPerf } from '../core/worldApi';
import {
  computeLayout,
  ELEVATOR,
  SeatBook,
  toLocal,
  toWorld,
  type BuildingLayout,
  type RoomLayout,
  type Seat,
} from '../world/layout';
import { damp, prefersReducedMotion } from '../world/motion';
import type { Anchor, WorldCallbacks } from '../world/World';
import { BreakLife } from './activities';
import { Agent2D, type P, type SeatW } from './agent2d';
import { BASE_PX, Camera2D, MIN_ZOOM } from './camera';
import { drawCat, HEAD_TOP } from './cat';
import { rgba } from './color';
import { deskCenter, drawChair, drawDesk, type DeskView } from './desk';
import { circle, rbox, setStyle } from './draw';
import { Npcs } from './npcs';
import { PALETTES2D, type ThemeName } from './palette2d';
import { drawScene, ELEV, sceneBounds, sceneKey, type Rect4, type SceneData } from './scene';
import './world2d.css';

const ELEVATOR_OPEN_RANGE = 2.6;
const SPAWN: P = { x: ELEVATOR.x, z: ELEV.plane - 0.55 };

interface Letter {
  from: string;
  to: string;
  t: number;
  color: string;
}
interface Ripple {
  id: string;
  t: number;
  color: string;
}

const MEETING_CHAIRS = 8;

/** Where every office and shared room stands. Changes when the building is reshaped. */
function shapeKey(plan: BuildingLayout) {
  const rooms = [...plan.rooms.values()].map((r) => `${r.team.id}:${r.x.toFixed(2)}:${r.w.toFixed(2)}:${r.doorX.toFixed(2)}`);
  const am = plan.amenities.map((a) => `${a.kind}:${a.side}:${a.rect.x.toFixed(2)}:${a.rect.w.toFixed(2)}`);
  return `${rooms.join('|')}#${am.join('|')}`;
}

/** How far the office or shared room around `p` moved east between two plans (0 in the lobby). */
function shiftOf(prev: BuildingLayout, next: BuildingLayout, p: P) {
  const side = p.z < 0 ? 'north' : 'south';
  for (const r of prev.rooms.values()) {
    if (r.side !== side || Math.abs(p.x - r.x) > r.w / 2) continue;
    const n = next.rooms.get(r.team.id);
    if (!n) return 0;
    // The door itself can slide along the wall when the office grows.
    const door = (q: RoomLayout) => q.x + (q.side === 'north' ? q.doorX : -q.doorX);
    return Math.abs(p.x - door(r)) < 0.05 ? door(n) - door(r) : n.x - r.x;
  }
  for (const a of prev.amenities) {
    if (a.side !== side || Math.abs(p.x - a.rect.x) > a.rect.w / 2) continue;
    const n = next.amenities.find((b) => b.kind === a.kind && b.side === side);
    return n ? n.rect.x - a.rect.x : 0;
  }
  return 0;
}

export class World2D implements FloorWorld {
  readonly perf: WorldPerf = { frameMs: 0, fps: 0, syncMs: 0, worstSyncMs: 0, calls: 0, triangles: 0, agents: 0 };
  onFrame?: () => void;
  readonly agents = new Map<string, Agent2D>();
  /** 0 closed .. 1 open. Public so scripted checks can read it. */
  elevOpen = 0;
  readonly camera = new Camera2D();

  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private cache: HTMLCanvasElement | null = null;
  private cacheKey = '';
  private cacheScale = 1;
  private cacheBounds: Rect4 | null = null;
  private dpr = 1;
  private plan: BuildingLayout | null = null;
  private book = new SeatBook();
  private state: WorldState | null = null;
  private theme: ThemeName = 'light';
  private reduced = prefersReducedMotion();
  private idleSince = new Map<string, number>();
  private nextSpawnAt = 0;
  private slots = { meeting: new Map<string, number>(), lounge: new Map<string, number>(), games: new Map<string, number>(), kitchen: new Map<string, number>() };
  private life = new BreakLife();
  private npcs = new Npcs();
  private letters: Letter[] = [];
  private ripples: Ripple[] = [];
  private last = performance.now();
  private elapsed = 0;
  private placeCheckAt = 0;
  private farewells = 0;
  private instantNext = true;
  private hasFramed = false;
  private autoFrame = true;
  private framedKey = '';
  private selected: string | null = null;
  private hovered: string | null = null;
  private following: string | null = null;
  private userDriving = false;
  private catK = 1;
  private pointers = new Map<number, { x: number; y: number }>();
  private dragFrom: { x: number; y: number } | null = null;
  private downAt = { x: 0, y: 0 };
  private dragging = false;
  private pinch = 0;
  private items: { y: number; kind: 0 | 1 | 2 | 3 | 4; a?: Agent2D; d?: DeskView; n?: number }[] = [];

  constructor(private container: HTMLElement, private cb: WorldCallbacks) {
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    container.classList.add('stage2d');
    container.appendChild(this.canvas);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this.reduced = e.matches;
      if (e.matches) this.life.clear(this.agents);
    });
    this.loop();
  }

  // ---------------------------------------------------------------- theme

  setTheme(theme: ThemeName) {
    this.theme = theme;
    this.cacheKey = '';
  }

  // ---------------------------------------------------------------- sync

  sync(state: WorldState) {
    const t0 = performance.now();
    this.syncInner(state);
    const ms = performance.now() - t0;
    this.perf.syncMs = ms;
    this.perf.worstSyncMs = Math.max(this.perf.worstSyncMs * 0.995, ms);
  }

  private syncInner(state: WorldState) {
    this.state = state;
    const instant = this.instantNext;
    this.instantNext = false;
    const prev = this.plan;
    const plan = (this.plan = computeLayout(state, this.book));
    this.life.setPlan(plan);
    this.npcs.setPlan(plan);
    const reshaped = prev !== null && shapeKey(prev) !== shapeKey(plan);
    if (reshaped) for (const s of this.agents.values()) s.relocate((p) => shiftOf(prev, plan, p));

    for (const agent of Object.values(state.agents)) {
      const room = plan.rooms.get(agent.team);
      const seat = room?.seats.get(agent.id);
      if (!room || !seat) continue;
      let s = this.agents.get(agent.id);
      if (s && s.team !== agent.team) {
        this.dropAgent(agent.id);
        s = undefined;
      }
      const seatW = this.seatWorld(room, seat);
      if (!s) {
        s = new Agent2D(agent);
        s.main = !agent.parent;
        this.agents.set(agent.id, s);
        if (instant || this.reduced) {
          s.setSeat(seatW, true);
          this.placeNow(s, agent, state);
        } else {
          // Cats step out of the elevator one after another, not all at once.
          const now = performance.now();
          const at = Math.max(now, this.nextSpawnAt);
          this.nextSpawnAt = at + 900;
          s.arrive([SPAWN, ...room.entry.map((p) => this.w(room, p))], seatW, (at - now) / 1000);
        }
      } else s.setSeat(seatW);
      s.setStatus(agent.status);
      if (agent.status !== 'idle') this.idleSince.delete(agent.id);
      // Idle time counts from the server's status change on load, from now afterwards.
      else if (!this.idleSince.has(agent.id)) this.idleSince.set(agent.id, performance.now() - (instant ? idleAgeMs(agent, Date.now()) : 0));
      if (agent.status === 'offline' && !s.leaving) this.depart(agent.id);
    }
    if (reshaped) this.rewalk();
    this.updatePlaces();
    for (const id of this.agents.keys()) if (!state.agents[id]) this.depart(id);

    if (!this.hasFramed && Object.keys(state.agents).length) {
      this.hasFramed = true;
      this.frameAll(true);
    } else if (this.autoFrame && !this.selected) {
      if (this.footprintKey() !== this.framedKey) this.frameAll();
    }
  }

  private w(room: RoomLayout | { x: number; z: number; yaw: number }, p: [number, number]): P {
    const [x, z] = toWorld(room, p);
    return { x, z };
  }

  private seatWorld(room: RoomLayout, seat: Seat): SeatW {
    const p = this.w(room, [seat.x, seat.z]);
    const c = Math.cos(room.yaw);
    const s = Math.sin(room.yaw);
    const lx = -Math.sin(seat.yaw);
    const lz = -Math.cos(seat.yaw);
    return {
      x: p.x,
      z: p.z,
      fx: lx * c + lz * s,
      fz: -lx * s + lz * c,
      path: seat.path.map((q) => this.w(room, q)),
      door: this.w(room, room.entry[room.entry.length - 1]),
    };
  }

  /** Cats under way when the building was reshaped take their routes again, through the doors where they are now. */
  private rewalk() {
    for (const [id, s] of this.agents) {
      if (s.mode === 'gone' || s.mode === 'seated') continue;
      if (s.mode !== 'leaving' && s.isAway()) {
        this.freeSlot(id);
        const trip = s.place === 'farewell' ? this.farewellSpot(s.team, id) : s.place === 'desk' ? null : this.tripTo(s.team, s.place, id);
        if (trip) s.goTo(trip.route, trip.look, trip.sit);
        else s.returnToSeat();
        continue;
      }
      s.rewalk(this.exitFor(s.team));
    }
  }

  // ---------------------------------------------------------------- places

  /** First sight of a cat on load: put it where its state says, with no walk. */
  private placeNow(s: Agent2D, agent: Agent, state: WorldState) {
    const want = initialPlace(agent, state.agents, Date.now(), state.meeting);
    this.freeSlot(agent.id);
    s.place = 'desk';
    if (want === 'desk') return;
    const trip = this.tripTo(s.team, want, agent.id);
    if (!trip) return;
    s.placeAt(trip.route, trip.look, trip.sit);
    s.place = want;
  }

  private updatePlaces() {
    if (!this.state || !this.plan) return;
    const now = performance.now();
    for (const [id, s] of this.agents) {
      const agent = this.state.agents[id];
      if (!agent || s.leaving || s.mode === 'leaving' || s.mode === 'gone') continue;
      if (s.mode === 'walking' && !s.isAway()) continue;
      const want: Place | 'farewell' = this.farewells > 0 ? 'farewell' : desiredPlace(agent, this.state.agents, this.idleSince.get(id) ?? null, now, this.state.meeting);
      if (want === s.place) continue;
      if (want === 'farewell') {
        this.freeSlot(id);
        const trip = this.farewellSpot(s.team, id);
        if (!trip) continue;
        s.goTo(trip.route, trip.look, false);
        s.place = 'farewell';
        continue;
      }
      if (want === 'desk') {
        this.freeSlot(id);
        if (this.reduced) s.snapToSeat();
        else s.returnToSeat();
        s.place = 'desk';
        continue;
      }
      this.freeSlot(id);
      const trip = this.tripTo(s.team, want, id);
      if (!trip) continue;
      if (this.reduced) s.placeAt(trip.route, trip.look, trip.sit);
      else s.goTo(trip.route, trip.look, trip.sit);
      s.place = want;
    }
  }

  /** Where an agent stands to wave off a leaver: the corridor beside the elevator, in rows. */
  private farewellSpot(team: string, id: string) {
    const room = this.plan?.rooms.get(team);
    if (!room) return null;
    const ids = [...this.agents.entries()].filter(([, a]) => !a.leaving).map(([k]) => k).sort();
    const i = Math.max(0, ids.indexOf(id));
    const col = Math.floor(i / 4);
    const row = i % 4;
    const side = row % 2 ? 1 : -1;
    const sx = ELEVATOR.x + side * (1.5 + 0.8 * col);
    const sz = row < 2 ? -0.55 : 0.55;
    const door = this.w(room, room.entry[room.entry.length - 1]);
    return { route: [door, { x: sx, z: 0 }, { x: sx, z: sz }] as P[], look: -side, sit: false };
  }

  private freeSlot(id: string) {
    this.slots.meeting.delete(id);
    this.slots.lounge.delete(id);
    this.slots.games.delete(id);
    this.slots.kitchen.delete(id);
  }

  private takeSlot(map: Map<string, number>, id: string, max: number) {
    const used = new Set(map.values());
    let n = 0;
    while (used.has(n) && n < max) n++;
    map.set(id, n);
    return n;
  }

  /** World route from the corridor outside an office door to a spot inside a shared room. */
  private tripTo(team: string, kind: 'meeting' | 'lounge' | 'games' | 'kitchen', id: string) {
    const room = this.plan?.rooms.get(team);
    const am = this.plan?.amenities.find((a) => a.kind === kind);
    if (!room || !am) return null;
    const frame = { x: am.rect.x, z: am.rect.z, yaw: am.side === 'north' ? 0 : Math.PI };
    const aw = (x: number, z: number) => this.w(frame, [x, z]);
    const door = this.w(room, room.entry[room.entry.length - 1]);
    const lane = { x: am.rect.x, z: 0 };
    const w = am.rect.w;
    const front = am.rect.d / 2 - 0.7;
    if (kind === 'meeting') {
      const slot = this.takeSlot(this.slots.meeting, id, 14);
      const cx = 0;
      const cz = -0.3;
      const chair = slot < MEETING_CHAIRS;
      const ang = chair ? (slot / MEETING_CHAIRS) * Math.PI * 2 + Math.PI / MEETING_CHAIRS : ((slot - MEETING_CHAIRS) / 6) * Math.PI * 2 + 0.3;
      const rx = chair ? 2.05 : 2.75;
      const rz = chair ? 1.35 : 2.05;
      // Walk round the outside of the table (outer ring) from the door side to the target angle.
      const outer = (a: number) => aw(cx + Math.cos(a) * 2.75, cz + Math.sin(a) * 2.05);
      const route: P[] = [door, lane, aw(0, front)];
      let a0 = Math.PI / 2;
      let da = ((ang - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / 0.6));
      da /= steps;
      for (let i = 1; i <= steps; i++) {
        a0 += da;
        route.push(outer(a0));
      }
      route.push(aw(cx + Math.cos(ang) * rx, cz + Math.sin(ang) * rz));
      return { route, look: 0, sit: chair };
    }
    if (kind === 'games' || kind === 'kitchen') {
      const table = w > 5.2;
      const spots: { x: number; z: number; look: number }[] =
        kind === 'games'
          ? table
            ? [
                { x: -1.7, z: -0.4, look: 1 },
                { x: 1.7, z: -0.4, look: -1 },
                { x: -0.6, z: 0.65, look: 0.5 },
                { x: 0.6, z: 0.65, look: -0.5 },
                { x: -0.6, z: -1.45, look: 0.5 },
                { x: 0.6, z: -1.45, look: -0.5 },
                { x: -2.5, z: 0.6, look: 1 },
                { x: 2.5, z: 0.6, look: -1 },
              ]
            : [
                { x: -0.8, z: 0.2, look: 1 },
                { x: 0.8, z: 0.2, look: -1 },
              ]
          : [
              { x: -1.9, z: -0.5, look: 1 },
              { x: 1.3, z: -0.5, look: -1 },
              { x: -0.9, z: 0.45, look: 0.6 },
              { x: 0.3, z: 0.45, look: -0.6 },
              { x: -0.3, z: -1.45, look: 0 },
              { x: -w / 2 + 1.5, z: 1.3, look: 1 },
              { x: w / 2 - 1.5, z: 1.3, look: -1 },
            ];
      const map = this.slots[kind];
      const slot = this.takeSlot(map, id, spots.length - 1);
      const spot = spots[Math.min(slot, spots.length - 1)];
      // In down the middle, along the aisle in front of the island (or the table), and round its end to the spots behind it.
      const aisle = kind === 'kitchen' ? 1.0 : 1.2;
      const behind = kind === 'kitchen' ? spot.z < -1.0 : table && spot.z < -1.1;
      const x = !behind ? spot.x : kind === 'kitchen' ? -1.9 : Math.sign(spot.x) * 1.7;
      const route = [door, lane, aw(0, front), aw(0, aisle), aw(x, aisle), aw(x, spot.z), aw(spot.x, spot.z)];
      return { route, look: spot.look, sit: false };
    }
    // lounge: sofa, armchairs and beanbags first (sit), then standing spots
    const spots: { x: number; z: number; sit: boolean }[] = [
      { x: -0.7, z: -1.9, sit: true },
      { x: 0.2, z: -1.9, sit: true },
      { x: 1.1, z: -1.9, sit: true },
      { x: -2.3, z: -0.1, sit: true },
      { x: 2.7, z: -0.1, sit: true },
      { x: w / 2 - 1.0, z: 2.2, sit: true },
      { x: w / 2 - 2.0, z: 2.7, sit: true },
      { x: -1.4, z: 1.2, sit: false },
      { x: 0.2, z: 1.0, sit: false },
      { x: 1.6, z: 1.2, sit: false },
      { x: -1.0, z: 2.4, sit: false },
      { x: 1.4, z: 2.6, sit: false },
    ];
    const slot = this.takeSlot(this.slots.lounge, id, spots.length - 1);
    const spot = spots[Math.min(slot, spots.length - 1)];
    // In west of the TV to the aisle between the TV and the coffee table; the sofa is reached round the table.
    const aisle = 0.6;
    const route = [door, lane, aw(-1.4, front), aw(-1.4, aisle)];
    if (spot.z < -1.0) {
      const x = spot.x <= 0.2 ? -1.2 : 1.3;
      route.push(aw(x, aisle), aw(x, -1.3), aw(spot.x, -1.3));
    } else route.push(aw(spot.x, aisle));
    route.push(aw(spot.x, spot.z));
    return { route, look: 0, sit: spot.sit };
  }

  // ---------------------------------------------------------------- arrivals and departures

  private depart(id: string) {
    const s = this.agents.get(id);
    if (!s || s.leaving) return;
    s.leaving = true;
    this.freeSlot(id);
    if (s.main && !this.reduced) {
      s.farewell = true;
      this.farewells++;
      this.updatePlaces();
    }
    if (this.reduced) return this.dropAgent(id);
    s.leave(this.exitFor(s.team), () => this.dropAgent(id));
  }

  private exitFor(team: string): P[] {
    const room = this.plan?.rooms.get(team);
    const inside: P = SPAWN;
    return room ? [...room.exit.map((p) => this.w(room, p)), inside] : [{ x: ELEVATOR.x, z: ELEVATOR.z + 1.3 }, { x: ELEVATOR.x, z: ELEVATOR.z + 1.3 }, { x: ELEVATOR.x, z: ELEVATOR.z + 0.6 }, inside];
  }

  private dropAgent(id: string) {
    const gone = this.agents.get(id);
    if (!gone) return;
    if (gone.farewell) {
      gone.farewell = false;
      this.farewells = Math.max(0, this.farewells - 1);
      queueMicrotask(() => this.updatePlaces());
    }
    this.agents.delete(id);
    this.life.forget(id);
    this.idleSince.delete(id);
    this.freeSlot(id);
    if (this.hovered === id) this.setHover(null);
    if (this.following === id) this.following = null;
    if (this.selected === id) this.cb.onPick(null, null);
  }

  reset() {
    for (const id of [...this.agents.keys()]) this.dropAgent(id);
    this.letters = [];
    this.ripples = [];
    this.life.clear(this.agents);
    this.book = new SeatBook();
    this.instantNext = true;
    this.hasFramed = false;
    this.autoFrame = true;
  }

  handleEffect(effect: Effect) {
    if (effect.kind === 'reset') return this.reset();
    if (effect.kind !== 'message') return;
    const from = this.agents.get(effect.from);
    const to = this.agents.get(effect.to);
    if (!from || !to) return;
    from.say(2.4);
    this.cb.onMessage(effect.from, effect.to, effect.text);
    const team = this.state?.teams[from.team];
    const color = team ? PALETTES2D[this.theme].accent(team.hue) : '#ff7a59';
    if (this.reduced) this.ripples.push({ id: effect.to, t: 0, color });
    else this.letters.push({ from: effect.from, to: effect.to, t: 0, color });
  }

  // ---------------------------------------------------------------- selection and camera

  setSelected(id: string | null) {
    if (this.selected) this.agents.get(this.selected)?.setSelected(false);
    this.selected = id;
    if (id) {
      this.agents.get(id)?.setSelected(true);
      this.focusAgent(id);
    }
  }

  private setHover(id: string | null) {
    if (id === this.hovered) return;
    if (this.hovered) this.agents.get(this.hovered)?.setHovered(false);
    this.hovered = id;
    if (id) this.agents.get(id)?.setHovered(true);
    this.canvas.style.cursor = id ? 'pointer' : '';
    this.cb.onHover(id);
  }

  agentIds() {
    return [...this.agents.keys()];
  }

  private footprintKey() {
    const p = this.plan;
    return p ? `${(p.x1 - p.x0).toFixed(1)}x${(p.z1 - p.z0).toFixed(1)}` : '';
  }

  /** Screen area the HUD leaves free: top bar and team dock take room. */
  private pads() {
    const w = this.camera.w;
    return { top: w < 700 ? 76 : 84, bottom: w < 700 ? 120 : 104, side: 28 };
  }

  /** Fly so that a world rectangle fills the free screen area. */
  private fit(cx: number, cz: number, w: number, d: number, maxZoom: number, instant: boolean) {
    const pad = this.pads();
    const cam = this.camera;
    const availW = Math.max(100, cam.w - pad.side * 2);
    const availH = Math.max(100, cam.h - pad.top - pad.bottom);
    const zoom = Math.max(MIN_ZOOM, Math.min(maxZoom, availW / (w * BASE_PX), availH / (d * BASE_PX)));
    const z = cz - (pad.top - pad.bottom) / 2 / (BASE_PX * zoom);
    cam.flyTo(cx, z, zoom, instant || this.reduced);
  }

  frameAll(instant = false) {
    const p = this.plan;
    this.framedKey = this.footprintKey();
    this.autoFrame = true;
    this.following = null;
    if (!p) return;
    const z0 = ELEV.top - 1.1;
    const z1 = p.z1 + 0.8;
    this.fit((p.x0 + p.x1) / 2, (z0 + z1) / 2, p.x1 - p.x0 + 1.4, z1 - z0, 1.6, instant);
  }

  focusTeam(id: string) {
    const r = this.plan?.rooms.get(id);
    if (!r) return;
    this.autoFrame = false;
    this.following = null;
    this.fit(r.x, r.z - 0.3, r.w + 1.5, r.d + 2.4, 2.4, false);
  }

  focusAgent(id: string) {
    const a = this.agents.get(id);
    if (!a) return;
    this.autoFrame = false;
    const pad = this.pads();
    const zoom = Math.max(this.camera.zoom, Math.min(2.0, (this.camera.h - pad.top - pad.bottom) / (5.2 * BASE_PX)));
    this.following = id;
    this.camera.flyTo(a.x, a.z - 0.5 - (pad.top - pad.bottom) / 2 / (BASE_PX * zoom), zoom);
  }

  // ---------------------------------------------------------------- pointer

  private bindPointer() {
    const el = this.canvas;
    const local = (e: PointerEvent | WheelEvent | MouseEvent) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const grab = () => {
      this.userDriving = true;
      this.camera.grab();
      this.following = null;
      this.autoFrame = false;
    };
    el.addEventListener('pointerdown', (e) => {
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      this.downAt = p;
      this.dragFrom = p;
      this.dragging = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        grab();
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = local(e);
      if (!this.pointers.has(e.pointerId)) {
        this.setHover(this.pick(p.x, p.y).agent);
        return;
      }
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0 && dist > 0) this.camera.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / this.pinch);
        this.pinch = dist;
        this.dragging = true;
        return;
      }
      if (!this.dragging && Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 5) {
        this.dragging = true;
        grab();
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
        this.dragFrom = this.downAt;
      }
      if (this.dragging && this.dragFrom) {
        this.camera.panBy(p.x - this.dragFrom.x, p.y - this.dragFrom.y);
        this.dragFrom = p;
      }
    });
    const up = (e: PointerEvent) => {
      const p = local(e);
      const had = this.pointers.delete(e.pointerId);
      if (!had) return;
      if (this.pointers.size === 0) {
        this.userDriving = false;
        this.pinch = 0;
        if (!this.dragging) {
          const hit = this.pick(p.x, p.y);
          this.cb.onPick(hit.agent, hit.team);
        }
        el.style.cursor = this.hovered ? 'pointer' : '';
        this.dragging = false;
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.userDriving = false;
      this.dragging = false;
    });
    el.addEventListener('pointerleave', () => this.setHover(null));
    el.addEventListener('dblclick', (e) => {
      const p = local(e);
      const hit = this.pick(p.x, p.y);
      if (!hit.agent && !hit.team) this.frameAll();
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = local(e);
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        grab();
        this.userDriving = false;
        this.camera.zoomAt(p.x, p.y, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0016)));
      },
      { passive: false },
    );
  }

  private pick(sx: number, sy: number): { agent: string | null; team: string | null } {
    const [wx, wz] = this.camera.toWorld(sx, sy);
    const k = this.catK;
    let best: Agent2D | null = null;
    for (const a of this.agents.values()) {
      if (a.mode === 'gone') continue;
      const top = a.z - (HEAD_TOP - 0.2 * a.sit) * k - 0.1;
      if (Math.abs(wx - a.x) < 0.55 * k && wz > top && wz < a.z + 0.2 * k && (!best || a.z > best.z)) best = a;
    }
    if (best) return { agent: best.id, team: best.team };
    if (this.plan)
      for (const r of this.plan.rooms.values()) {
        const [lx, lz] = toLocal(r, [wx, wz]);
        if (Math.abs(lx) <= r.w / 2 && Math.abs(lz) <= r.d / 2) return { agent: null, team: r.team.id };
      }
    return { agent: null, team: null };
  }

  // ---------------------------------------------------------------- anchors

  anchors(): Anchor[] {
    const out: Anchor[] = [];
    const cam = this.camera;
    const S = cam.scale;
    const base = Math.max(6, Math.min(60, 14 / Math.pow(cam.zoom, 1.15)));
    for (const [id, a] of this.agents) {
      const [sx, sy] = cam.toScreen(a.x, a.z);
      const y = sy - ((HEAD_TOP - 0.2 * a.sit) * this.catK + a.hop + 0.28) * S;
      out.push({
        id,
        x: sx,
        y,
        depth: base - a.z * 0.08,
        visible: a.mode !== 'gone' && !a.leaving && sx > -40 && sx < cam.w + 40 && y > -40 && y < cam.h + 80,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------- frame

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const keepZoom = this.camera.zoom;
    this.camera.w = w;
    this.camera.h = h;
    if (this.state && this.autoFrame && this.hasFramed) this.frameAll(true);
    else this.camera.zoom = keepZoom;
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.elapsed += dt;
    if (this.elapsed >= this.placeCheckAt) {
      this.placeCheckAt = this.elapsed + 1;
      this.updatePlaces();
    }
    let near = false;
    for (const a of this.agents.values()) {
      a.update(dt, this.reduced);
      if (a.mode === 'walking' || a.mode === 'leaving') {
        if (Math.hypot(a.x - ELEVATOR.x, a.z - (ELEVATOR.z + 1.2)) < ELEVATOR_OPEN_RANGE) near = true;
      }
    }
    if (!this.reduced) this.life.update(dt, this.elapsed, this.agents, this.slots);
    this.npcs.update(this.elapsed, this.elevOpen, this.reduced);
    this.elevOpen = damp(this.elevOpen, near ? 1 : 0, 5, dt);
    for (const l of this.letters) l.t += dt / 1.1;
    this.letters = this.letters.filter((l) => {
      if (l.t >= 1) {
        this.ripples.push({ id: l.to, t: 0, color: l.color });
        return false;
      }
      return true;
    });
    for (const r of this.ripples) r.t += dt / 0.7;
    this.ripples = this.ripples.filter((r) => r.t < 1);

    // camera: follow the selected cat, else fly
    if (this.following && !this.userDriving) {
      const a = this.agents.get(this.following);
      if (a) {
        const pad = this.pads();
        const tz = a.z - 0.5 - (pad.top - pad.bottom) / 2 / this.camera.scale;
        if (this.camera.flying) this.camera.nudgeGoal(a.x, tz);
        else {
          this.camera.x += (a.x - this.camera.x) * (1 - Math.exp(-5 * dt));
          this.camera.z += (tz - this.camera.z) * (1 - Math.exp(-5 * dt));
        }
      }
    }
    this.camera.update(dt);
    this.catK = Math.max(1.15, Math.min(1.9, 1.15 * Math.pow(1 / this.camera.zoom, 0.45)));

    const r0 = performance.now();
    this.render();
    this.onFrame?.();
    const p = this.perf;
    p.frameMs = p.frameMs * 0.9 + (performance.now() - r0) * 0.1;
    p.fps = p.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    p.agents = this.agents.size;
  };

  // ---------------------------------------------------------------- drawing

  private ensureCache(data: SceneData, need: number) {
    const b = sceneBounds(data.plan);
    const bw = b.x1 - b.x0;
    const bh = b.z1 - b.z0;
    const scale = Math.min(this.dpr * BASE_PX * 1.6, Math.sqrt(1.2e7 / (bw * bh)));
    if (scale < need * 0.85) return false;
    const key = sceneKey(data);
    if (!this.cache || key !== this.cacheKey || Math.abs(scale - this.cacheScale) > 0.01) {
      const c = this.cache ?? (this.cache = document.createElement('canvas'));
      c.width = Math.ceil(bw * scale);
      c.height = Math.ceil(bh * scale);
      const cx = c.getContext('2d')!;
      cx.setTransform(scale, 0, 0, scale, -b.x0 * scale, -b.z0 * scale);
      drawScene(cx, data, null);
      this.cacheKey = key;
      this.cacheScale = scale;
      this.cacheBounds = b;
    }
    return true;
  }

  private render() {
    const ctx = this.ctx;
    const cam = this.camera;
    const dpr = this.dpr;
    const P = PALETTES2D[this.theme];
    const sc = cam.scale * dpr;
    const tx = (cam.w / 2 - cam.x * cam.scale) * dpr;
    const tz = (cam.h / 2 - cam.z * cam.scale) * dpr;
    setStyle(P);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = P.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const plan = this.plan;
    const state = this.state;
    if (!plan || !state) return;
    const data: SceneData = { plan, teams: state.teams, theme: this.theme };
    if (this.ensureCache(data, sc) && this.cache && this.cacheBounds) {
      const b = this.cacheBounds;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.cache, 0, 0, this.cache.width, this.cache.height, b.x0 * sc + tx, b.z0 * sc + tz, (b.x1 - b.x0) * sc, (b.z1 - b.z0) * sc);
      ctx.setTransform(sc, 0, 0, sc, tx, tz);
    } else {
      ctx.setTransform(sc, 0, 0, sc, tx, tz);
      const [x0, z0] = cam.toWorld(0, 0);
      const [x1, z1] = cam.toWorld(cam.w, cam.h);
      drawScene(ctx, data, { x0, z0, x1, z1 });
      setStyle(P);
    }
    this.drawDynamic(ctx, P.dark);
  }

  private drawDynamic(ctx: CanvasRenderingContext2D, dark: boolean) {
    const state = this.state!;
    const t = this.elapsed;
    const k = this.catK;
    const theme = this.theme;
    const items = this.items;
    items.length = 0;
    const desks: DeskView[] = [];
    for (const a of this.agents.values()) {
      if (a.mode === 'gone') continue;
      const agent = state.agents[a.id];
      if (a.seat && agent) {
        const d: DeskView = { id: a.id, seatX: a.seat.x, seatZ: a.seat.z, fx: a.seat.fx, fz: a.seat.fz, status: agent.status };
        desks.push(d);
        items.push({ y: deskCenter(d)[1], kind: 1, d });
      }
      items.push({ y: a.z, kind: 0, a });
    }
    items.push({ y: ELEV.plane, kind: 2 });
    for (let i = 0; i < this.npcs.count(); i++) {
      const y = this.npcs.depth(i);
      if (y < 1e8) items.push({ y, kind: 4, n: i });
    }
    const ballY = this.reduced ? null : this.life.rallyDepth();
    if (ballY !== null) items.push({ y: ballY, kind: 3 });
    items.sort((p, q) => p.y - q.y);

    for (const d of desks) drawChair(ctx, d, theme);
    if (!this.reduced) this.life.drawFx(ctx, t);
    for (const it of items) {
      if (it.kind === 3) this.life.drawRally(ctx, k);
      else if (it.kind === 4) this.npcs.draw(ctx, it.n!, t, k, this.reduced);
      else if (it.kind === 1) drawDesk(ctx, it.d!, t, theme);
      else if (it.kind === 2) this.drawDoors(ctx, dark);
      else {
        const a = it.a!;
        const inCab = a.z < ELEV.plane + 0.05 && Math.abs(a.x - ELEV.x) < 1.3;
        if (inCab) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(ELEV.x - ELEV.halfW, ELEV.top, ELEV.halfW * 2, ELEV.plane - ELEV.top);
          ctx.clip();
          drawCat(ctx, a, t, k);
          ctx.restore();
        } else drawCat(ctx, a, t, k);
      }
    }

    if (!this.reduced) {
      this.life.drawEmotes(ctx, this.agents, t, k);
      this.npcs.drawBubbles(ctx, t, k);
    }

    // letters and ripples
    for (const r of this.ripples) {
      const a = this.agents.get(r.id);
      if (!a) continue;
      ctx.beginPath();
      ctx.ellipse(a.x, a.z, (0.3 + r.t * 1.0) * k, (0.13 + r.t * 0.42) * k, 0, 0, Math.PI * 2);
      ctx.lineWidth = 0.08 * (1 - r.t);
      ctx.strokeStyle = rgba(r.color, 1 - r.t);
      ctx.stroke();
    }
    for (const l of this.letters) {
      const from = this.agents.get(l.from);
      const to = this.agents.get(l.to);
      if (!from || !to) continue;
      const hy = (a: Agent2D) => a.z - (HEAD_TOP - 0.2 * a.sit) * k * 0.8;
      const e = l.t * l.t * (3 - 2 * l.t);
      const x = from.x + (to.x - from.x) * e;
      const y = hy(from) + (hy(to) - hy(from)) * e - Math.sin(Math.PI * e) * (0.8 + Math.abs(to.x - from.x) * 0.1);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(l.t * 9) * 0.25);
      const s = 0.8 + Math.sin(Math.PI * e) * 0.35;
      ctx.scale(s, s);
      rbox(ctx, 0, 0, 0.5, 0.34, '#ffffff', 0.07, { lw: 0.045, line: l.color });
      ctx.beginPath();
      ctx.moveTo(-0.23, -0.12);
      ctx.lineTo(0, 0.04);
      ctx.lineTo(0.23, -0.12);
      ctx.lineWidth = 0.04;
      ctx.strokeStyle = l.color;
      ctx.lineJoin = 'round';
      ctx.stroke();
      circle(ctx, 0.2, 0.17, 0.06, '#ff7a9a', { shadow: false, noLine: true });
      ctx.restore();
    }
  }

  private drawDoors(ctx: CanvasRenderingContext2D, dark: boolean) {
    const o = this.elevOpen;
    const x = ELEV.x;
    const h = ELEV.plane - ELEV.top;
    const zc = (ELEV.top + ELEV.plane) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - ELEV.halfW, ELEV.top, ELEV.halfW * 2, h);
    ctx.clip();
    const steel = dark ? '#8b98c0' : '#d3dae6';
    for (const s of [-1, 1]) {
      const cx = x + s * (ELEV.halfW / 2) + s * o * (ELEV.halfW - 0.1);
      rbox(ctx, cx, zc, ELEV.halfW - 0.02, h - 0.1, steel, 0.12, { lw: 0.04, shadow: false });
      rbox(ctx, cx, zc, ELEV.halfW - 0.3, h - 0.5, dark ? '#a3b0d8' : '#eef2f8', 0.1, { lw: 0.02, shadow: false });
    }
    ctx.restore();
    // call button lamp
    const lit = o > 0.15;
    circle(ctx, x + 1.5, ELEV.plane - 0.68, 0.07, lit ? '#ff7a45' : dark ? '#6b4a45' : '#e7b8a8', { shadow: false, lw: 0.03 });
    if (lit && dark) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, zc, 0, x, zc, 3);
      g.addColorStop(0, 'rgba(255,210,140,0.35)');
      g.addColorStop(1, 'rgba(255,210,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 3, zc - 3, 6, 6);
      ctx.restore();
    }
  }
}

