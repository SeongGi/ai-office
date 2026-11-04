// The 2D "round cartoon" office. Canvas2D only. Same public surface as the 3D World.
import type { Agent, Effect, WorldState } from '../../shared/protocol';
import {
  bubbleLines,
  createToolState,
  desiredPlace,
  effectiveStatus,
  failureTool,
  idleAgeMs,
  initialPlace,
  initialToolState,
  isToolFailure,
  stepToolRoom,
  thinkingText,
  TOOL_FAIL_PREFIX,
  type Place,
  type ToolState,
} from '../../shared/places';
import type { FloorWorld, WorldPerf } from '../core/worldApi';
import { toolTag } from '../../shared/sidepanel';
import { displayName } from '../../shared/role';
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
import { claimSpot, isBreakKind, roomSpots, tripRoute, type TripKind } from '../world/trips';
import type { Anchor, WorldCallbacks } from '../world/World';
import { BreakLife } from './activities';
import { Agent2D, PARTY_S, type P, type SeatW } from './agent2d';
import { BASE_PX, Camera2D, MIN_ZOOM } from './camera';
import { drawCat, HEAD_TOP } from './cat';
import { Chatter2D, type ChatLine } from './chatter2d';
import { rgba } from './color';
import { deskCenter, drawChair, drawDesk, type DeskView } from './desk';
import { circle, rbox, setStyle, star, text, textWidth } from './draw';
import { drawServerLeds } from './furniture';
import { rosterOrigin } from './roster';
import { Npcs } from './npcs';
import { FarewellChat } from '../world/farewellChat';
import { PALETTES2D, type ThemeName } from './palette2d';
import { drawScene, ELEV, sceneBounds, sceneKey, type Rect4, type SceneData } from './scene';
import './world2d.css';

const ELEVATOR_OPEN_RANGE = 2.6;
/** The meeting room roster cuts long activities so a line stays about as wide as the room. */
const ROSTER_ACT_MAX = 22;
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

/** Confetti colours of the task done burst. Module level so a frame allocates nothing. */
const CONFETTI = ['#ffd23f', '#ff7a9a', '#5ec8ff', '#7ee08a', '#ffffff'];

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
  private slots = { meeting: new Map<string, number>(), lounge: new Map<string, number>(), games: new Map<string, number>(), kitchen: new Map<string, number>(), booths: new Map<string, number>(), library: new Map<string, number>(), server: new Map<string, number>(), search: new Map<string, number>() };
  private toolStates = new Map<string, ToolState>();
  /** More than 12 cats on screen at low zoom: thinking clouds would only clutter, so they stay away. Checked once a second. */
  private crowded = false;
  private bubbleWidths = new Map<string, number>();
  private life = new BreakLife();
  private chatter = new Chatter2D();
  private npcs = new Npcs();
  private chat = new FarewellChat(20261028);
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
      this.applyStatus(s, agent);
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
        const away = s.place === 'farewell' || s.place === 'desk' ? null : this.tripTo(s.team, s.place, id);
        const trip = s.place === 'farewell' ? this.farewellSpot(s.team, id) : away;
        if (trip) {
          s.goTo(trip.route, trip.look, trip.sit);
          if (away) s.place = away.place;
        } else s.returnToSeat();
        continue;
      }
      s.rewalk(this.exitFor(s.team));
    }
  }

  // ---------------------------------------------------------------- places

  /** First sight of a cat on load: put it where its state says, with no walk. */
  private placeNow(s: Agent2D, agent: Agent, state: WorldState) {
    const now = Date.now();
    const want = initialPlace(agent, state.agents, now, state.meeting);
    this.toolStates.set(agent.id, initialToolState(agent, now));
    this.freeSlot(agent.id);
    s.place = 'desk';
    if (want === 'desk') return;
    const trip = this.tripTo(s.team, want, agent.id);
    if (!trip) return;
    s.placeAt(trip.route, trip.look, trip.sit);
    s.workPose = trip.work;
    s.place = trip.place;
    s.wanted = want;
  }

  private updatePlaces() {
    if (!this.state || !this.plan) return;
    const now = performance.now();
    const wall = Date.now();
    let shown = 0;
    if (this.camera.zoom < 1.0) for (const s of this.agents.values()) if (s.mode !== 'gone' && !s.leaving) shown++;
    this.crowded = shown > 12;
    for (const [id, s] of this.agents) {
      const agent = this.state.agents[id];
      if (!agent || s.leaving || s.mode === 'leaving' || s.mode === 'gone') continue;
      this.applyStatus(s, agent);
      if (s.mode === 'walking' && !s.isAway()) continue;
      let ts = this.toolStates.get(id);
      if (!ts) this.toolStates.set(id, (ts = createToolState()));
      const room = stepToolRoom(ts, agent, wall);
      const want: Place | 'farewell' = this.farewells > 0 ? 'farewell' : desiredPlace(agent, this.state.agents, this.idleSince.get(id) ?? null, now, this.state.meeting, room);
      // A resting cat that found its own break room full, or a meeting cat that found the chairs taken, sits in a break room:
      // that is still what it wants.
      if (want === s.place || (want === s.wanted && (isBreakKind(want) || want === 'meeting') && isBreakKind(s.place))) continue;
      if (want === 'farewell') {
        this.freeSlot(id);
        const trip = this.farewellSpot(s.team, id);
        if (!trip) continue;
        s.goTo(trip.route, trip.look, false);
        s.place = s.wanted = 'farewell';
        continue;
      }
      if (want === 'desk') {
        this.freeSlot(id);
        if (this.reduced) s.snapToSeat();
        else s.returnToSeat();
        s.place = s.wanted = 'desk';
        continue;
      }
      this.freeSlot(id);
      const trip = this.tripTo(s.team, want, id);
      if (!trip) continue;
      if (this.reduced) s.placeAt(trip.route, trip.look, trip.sit);
      else s.goTo(trip.route, trip.look, trip.sit);
      s.workPose = trip.work;
      s.place = trip.place;
      s.wanted = want;
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
    this.slots.booths.delete(id);
    this.slots.library.delete(id);
    this.slots.server.delete(id);
    this.slots.search.delete(id);
  }

  /** Status as drawn (a tool failure turns back to thinking after a few seconds), plus the bubble over the head. */
  private applyStatus(s: Agent2D, agent: Agent) {
    const status = effectiveStatus(agent, Date.now());
    s.setStatus(status);
    if (status === 'error' && isToolFailure(agent)) {
      if (s.failKey !== agent.lastSeen) {
        s.failKey = agent.lastSeen;
        s.bubbleKind = 2;
        s.bubbleText = TOOL_FAIL_PREFIX;
        s.bubbleSub = failureTool(agent);
      }
      s.bubbleWant = 1;
    } else if (status === 'thinking') {
      // After a failure the old activity is the failure text; say nothing about it again.
      const t = thinkingText(isToolFailure({ ...agent, status: 'error' }) ? '' : agent.activity);
      if (s.bubbleKind !== 1 || s.bubbleText !== t) {
        s.bubbleKind = 1;
        s.bubbleText = t;
        s.bubbleSub = '';
      }
      s.bubbleWant = this.reduced || this.crowded ? 0 : 1;
    } else if (this.reduced && s.party > 0) {
      // Reduced motion: no burst, only a small check bubble while the celebration lasts.
      s.bubbleKind = 1;
      s.bubbleText = '✓';
      s.bubbleSub = '';
      s.bubbleWant = 1;
    } else s.bubbleWant = 0;
  }

  /**
   * World route from the corridor outside an office door to a free spot of a shared room. One cat per spot: when every room
   * tripKinds offers is full this gives null (the cat stays at its desk).
   */
  private tripTo(team: string, want: TripKind, id: string) {
    const plan = this.plan;
    if (!plan) return null;
    const got = claimSpot(this.slots, want, id, (kind) => plan.amenities.find((a) => a.kind === kind)?.rect.w);
    if (!got) return null;
    const trip = tripRoute(plan, team, got.kind, got.slot);
    if (trip) return { route: trip.route, look: trip.look, sit: trip.sit, work: trip.work, place: got.kind };
    this.slots[got.kind].delete(id);
    return null;
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
      this.chat.setLeaver(this.state?.agents[id]?.name ?? '');
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
    this.chatter.forget(id);
    this.idleSince.delete(id);
    this.toolStates.delete(id);
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
    this.chatter.clear();
    this.book = new SeatBook();
    this.instantNext = true;
    this.hasFramed = false;
    this.autoFrame = true;
    this.toolStates.clear();
  }

  handleEffect(effect: Effect) {
    if (effect.kind === 'reset') return this.reset();
    if (effect.kind !== 'message') return;
    const from = this.agents.get(effect.from);
    const to = this.agents.get(effect.to);
    if (!from || !to) return;
    from.say(2.4);
    this.cb.onMessage(effect.from, effect.to, effect.text);
    this.chatter.noteRealMessage(effect.from, effect.to, [from.team, to.team], this.elapsed);
    this.sendLetter(from, to);
  }

  /** 보낸 고양이 팀 색의 종이비행기를 날린다. 움직임 줄이기에서는 받는 쪽에 물결만 낸다. */
  private sendLetter(from: Agent2D, to: Agent2D) {
    const team = this.state?.teams[from.team];
    const color = team ? PALETTES2D[this.theme].accent(team.hue) : '#ff7a59';
    if (this.reduced) this.ripples.push({ id: to.id, t: 0, color });
    else this.letters.push({ from: from.id, to: to.id, t: 0, color });
  }

  /** 지어낸 대화 한 줄을 띄운다. 서버나 직원 기록에는 남기지 않는다. */
  private showLine(l: ChatLine) {
    const from = this.agents.get(l.from);
    const to = this.agents.get(l.to);
    if (!from || !to) return;
    from.say(2.4);
    this.life.hush(l.from, this.elapsed + 5);
    this.cb.onMessage(l.from, l.to, l.text);
    if (l.plane) this.sendLetter(from, to);
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
        // Cats seated in the meeting room are listed outside its wall instead (drawMeetingRoster): their tags would cover each other's faces.
        resting: a.mode === 'standing' && (isBreakKind(a.place) || a.place === 'meeting'),
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
    // After the break room life, which sets the arms of cats it owns: the celebration raises them on top.
    for (const a of this.agents.values()) if (a.partyArms > 0) a.act.cheer = Math.max(a.act.cheer, a.partyArms);
    if (this.state) this.chatter.update(this.elapsed, this.state, this.agents, (l) => this.showLine(l));
    this.npcs.update(this.elapsed, this.elevOpen, this.reduced);
    this.updateFarewellTalk();
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
        const d: DeskView = { id: a.id, seatX: a.seat.x, seatZ: a.seat.z, fx: a.seat.fx, fz: a.seat.fz, status: effectiveStatus(agent, Date.now()), tool: agent.lastTool ?? agent.tool, still: this.reduced || this.crowded };
        desks.push(d);
        items.push({ y: deskCenter(d)[1], kind: 1, d });
      }
      items.push({ y: a.z, kind: 0, a });
    }
    for (const d of this.stationViews(state)) {
      desks.push(d);
      items.push({ y: deskCenter(d)[1], kind: 1, d });
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
    this.drawServerLights(ctx, t);
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

    this.drawBubbles(ctx, t, k);
    this.drawFarewellBubbles(ctx, k);
    this.drawToolTags(ctx, k);
    this.drawMeetingRoster(ctx, k);
    if (!this.reduced) this.drawParty(ctx, k);

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

  /** Desks and chairs of the server room, the search room and the booths: one per workstation, drawn like a team desk. A dark screen means nobody works there. */
  private stationViews(state: WorldState): DeskView[] {
    const plan = this.plan;
    const out: DeskView[] = [];
    if (!plan) return out;
    for (const am of plan.amenities) {
      if (am.kind !== 'server' && am.kind !== 'search' && am.kind !== 'booths') continue;
      const frame = { x: am.rect.x, z: am.rect.z, yaw: am.side === 'north' ? 0 : Math.PI };
      // The seat faces the back wall (-Z of the room), the desk stands in front of it.
      const fx = -Math.sin(frame.yaw);
      const fz = -Math.cos(frame.yaw);
      const slots = this.slots[am.kind];
      for (const [i, sp] of roomSpots(am.kind, am.rect.w).entries()) {
        if (!sp.desk) continue;
        const [x, z] = toWorld(frame, [sp.x, sp.z]);
        let agent: Agent | undefined;
        for (const [id, n] of slots) if (n === i && !this.agents.get(id)?.leaving) agent = state.agents[id];
        out.push({ id: `${am.kind}-${i}`, seatX: x, seatZ: z, fx, fz, status: agent ? effectiveStatus(agent, Date.now()) : 'offline', tool: agent ? agent.lastTool ?? agent.tool : undefined, still: this.reduced || this.crowded });
      }
    }
    return out;
  }

  /** Rack lights in the server room: red while a cat works there, green otherwise. */
  private drawServerLights(ctx: CanvasRenderingContext2D, t: number) {
    const am = this.plan?.amenities.find((a) => a.kind === 'server');
    if (!am) return;
    let busy = false;
    for (const a of this.agents.values()) if (a.place === 'server' && a.mode === 'standing') busy = true;
    ctx.save();
    ctx.translate(am.rect.x, am.rect.z);
    if (am.side === 'south') ctx.rotate(Math.PI);
    drawServerLeds(ctx, am.rect.w, this.reduced ? 0 : t, busy);
    ctx.restore();
  }

  /** A tiny tag under each cat standing in a tool room: the tool and what it does. Neighbours alternate in height so tags do not overlap. */
  private drawToolTags(ctx: CanvasRenderingContext2D, k: number) {
    const state = this.state;
    if (!state) return;
    const P = PALETTES2D[this.theme];
    const row: Agent2D[] = [];
    for (const a of this.agents.values()) if ((a.place === 'library' || a.place === 'server' || a.place === 'search') && a.mode === 'standing' && !a.leaving) row.push(a);
    row.sort((p, q) => p.place.localeCompare(q.place) || p.x - q.x);
    let prev = '';
    let n = 0;
    for (const a of row) {
      n = a.place === prev ? n + 1 : 0;
      prev = a.place;
      const ag = state.agents[a.id];
      const str = ag ? toolTag(ag.lastTool ?? ag.tool, ag.activity) : '';
      if (!str) continue;
      const sz = 0.17 * k;
      const w = this.bubbleWidth(ctx, str) * sz + 0.3 * k;
      const y = a.z + (0.3 + (n % 2) * 0.3) * k;
      rbox(ctx, a.x, y, w, 0.27 * k, P.plaque, 0.12 * k, { lw: 0.035 * k, line: P.outline, shadow: false });
      text(ctx, str, a.x, y + 0.01 * k, sz, P.plaqueText, { weight: 700 });
    }
  }

  /** Who sits in the meeting room, one line per cat outside its outer wall: name and what it does. Their head tags stay hidden (anchors). */
  private drawMeetingRoster(ctx: CanvasRenderingContext2D, k: number) {
    const state = this.state;
    const am = this.plan?.amenities.find((a) => a.kind === 'meeting');
    if (!state || !am) return;
    const row: Agent2D[] = [];
    for (const a of this.agents.values()) if (a.place === 'meeting' && a.mode === 'standing' && !a.leaving && state.agents[a.id]) row.push(a);
    if (!row.length) return;
    row.sort((p, q) => p.x - q.x || p.z - q.z);
    const P = PALETTES2D[this.theme];
    const sz = 0.2 * k;
    const lh = 0.36 * k;
    const { x: x0, wall, dir } = rosterOrigin(am);
    row.forEach((a, i) => {
      const ag = state.agents[a.id];
      const name = displayName(ag, state.agents);
      const act = (ag.activity || '').trim();
      const str = act ? `${name}: ${act.length > ROSTER_ACT_MAX ? `${act.slice(0, ROSTER_ACT_MAX - 1)}…` : act}` : name;
      const hot = a.id === this.hovered || a.id === this.selected;
      const w = this.bubbleWidth(ctx, str) * sz + 0.3 * k;
      const y = wall + dir * (0.45 * k + i * lh);
      rbox(ctx, x0 + w / 2, y, w, 0.3 * k, P.plaque, 0.12 * k, { lw: (hot ? 0.07 : 0.035) * k, line: P.outline, shadow: false });
      text(ctx, str, x0 + 0.15 * k, y + 0.01 * k, sz, P.plaqueText, { weight: 700, align: 'left' });
    });
  }

  private bubbleWidth(ctx: CanvasRenderingContext2D, str: string) {
    let w = this.bubbleWidths.get(str);
    if (w === undefined) {
      w = textWidth(ctx, str, 1);
      if (this.bubbleWidths.size > 400) this.bubbleWidths.clear();
      this.bubbleWidths.set(str, w);
    }
    return w;
  }

  /** Stars and confetti that burst over the head of a cat that just finished a task, and fall back. */
  private drawParty(ctx: CanvasRenderingContext2D, k: number) {
    for (const a of this.agents.values()) {
      if (a.party <= 0 || a.mode === 'gone' || a.leaving) continue;
      const p = 1 - a.party / PARTY_S;
      const cx = a.x;
      const cy = a.z + (-0.8 + 0.2 * a.sit) * k - a.hop - 0.6 * k;
      ctx.save();
      ctx.globalAlpha *= Math.min(1, (1 - p) * 3);
      for (let i = 0; i < 8; i++) {
        const dir = (i - 3.5) / 3.5;
        const v = 0.75 + 0.25 * ((i * 5) % 3);
        const x = cx + dir * (0.25 + p * 0.55) * k;
        const y = cy - Math.sin(Math.min(1, p * 1.6) * Math.PI * 0.5) * (0.7 + 0.12 * (i % 3)) * v * k + p * p * 0.7 * k;
        const color = CONFETTI[i % CONFETTI.length];
        if (i % 3 === 0) {
          star(ctx, x, y, 0.12 * k, p * 4 + i);
          ctx.fillStyle = '#ffd23f';
          ctx.fill();
          ctx.lineWidth = 0.025 * k;
          ctx.strokeStyle = '#f2a516';
          ctx.stroke();
        } else {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p * 9 + i);
          ctx.fillStyle = color;
          ctx.fillRect(-0.05 * k, -0.025 * k, 0.1 * k, 0.05 * k);
          ctx.restore();
        }
      }
      ctx.restore();
    }
  }

  /** Cats gathered for a leaver take turns talking; the leaver says one goodbye near the elevator. */
  private updateFarewellTalk() {
    const ids: string[] = [];
    for (const [id, a] of this.agents) if (a.place === 'farewell' && a.mode === 'standing' && !a.leaving) ids.push(id);
    ids.sort();
    this.chat.update(this.elapsed, this.farewells > 0, ids);
    if (this.farewells <= 0) return;
    for (const [id, a] of this.agents) {
      if (a.farewell && a.mode === 'leaving' && Math.hypot(a.x - ELEVATOR.x, a.z - (ELEVATOR.z + 1.2)) < 4.5) this.chat.sayBye(id, this.elapsed);
      if (this.chat.textFor(id)) a.say(0.15);
    }
  }

  /** The farewell lines as white speech bubbles over the talking cat, same look as the decor cats. */
  private drawFarewellBubbles(ctx: CanvasRenderingContext2D, k: number) {
    if (this.farewells <= 0) return;
    for (const [id, a] of this.agents) {
      const str = this.chat.textFor(id);
      if (!str || a.mode === 'gone') continue;
      const age = this.chat.ageOf(id, this.elapsed);
      const dur = this.chat.durOf(id);
      // reduced motion: one static line, no fade
      const u = this.reduced ? 0.5 : age / dur;
      if (u < 0 || u > 1) continue;
      const alpha = Math.min(1, u / 0.08, (1 - u) / 0.15);
      let shown = str;
      if (str.length > 9) {
        let at = -1;
        for (let i = 0; i < str.length; i++) if (str[i] === ' ' && (at < 0 || Math.abs(i - str.length / 2) < Math.abs(at - str.length / 2))) at = i;
        if (at > 0) shown = `${str.slice(0, at)}\n${str.slice(at + 1)}`;
      }
      const lines = shown.split('\n');
      let tw = 0;
      for (const line of lines) tw = Math.max(tw, textWidth(ctx, line, 0.22, 800));
      const bw = (tw + 0.34) * k;
      const lh = 0.27 * k;
      const bh = lh * lines.length + 0.2 * k;
      const bottom = a.z - (HEAD_TOP + 0.3 - 0.2 * a.sit + a.hop) * k;
      const y = bottom - bh / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(a.x - 0.1 * k, bottom - 0.02 * k);
      ctx.lineTo(a.x, bottom + 0.14 * k);
      ctx.lineTo(a.x + 0.1 * k, bottom - 0.02 * k);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      rbox(ctx, a.x, y, bw, bh, '#ffffff', 0.2 * k, { lw: 0.035 * k, line: '#e2c9bd', shadow: false });
      for (const [i, line] of lines.entries()) text(ctx, line, a.x, y + (i - (lines.length - 1) / 2) * lh + 0.01 * k, 0.22 * k, '#5a3a40', { weight: 800 });
      ctx.restore();
    }
  }

  /** Thinking cloud and red failure bubble beside each cat's head (the name tags sit right above it). One per cat. */
  private drawBubbles(ctx: CanvasRenderingContext2D, t: number, k: number) {
    for (const a of this.agents.values()) {
      if (a.bubbleKind === 0 || a.bubble < 0.02 || a.mode === 'gone' || a.leaving) continue;
      const fail = a.bubbleKind === 2;
      const pulse = fail || this.reduced ? 1 : 0.78 + 0.22 * Math.sin(t * 1.7 + a.seed * 6);
      const vis = Math.min(1, a.bubble);
      // Up to two lines: the thinking text breaks after 9 characters, a failure shows the message and the tool.
      const [l1, l2] = fail ? [a.bubbleText, a.bubbleSub] : bubbleLines(a.bubbleText);
      const sz = 0.24 * k;
      const w1 = this.bubbleWidth(ctx, l1) * sz;
      const w2 = l2 ? this.bubbleWidth(ctx, l2) * sz * (fail ? 0.85 : 1) : 0;
      const lineH = 0.3 * k;
      const w = Math.max(w1, w2) + 0.45 * k + (fail ? 0.3 * k : 0);
      const h = (l2 ? 2 : 1) * lineH + 0.22 * k;
      const hx = a.x + 0.38 * k;
      const hcy = a.z + (-0.8 + 0.2 * a.sit) * k - a.hop;
      const left = hx + 0.3 * k;
      // Beside the body, below the head top: the name tags above the head stay clear.
      const cy = hcy + 0.55 * k - h / 2 - (1 - vis) * 0.12 * k;
      const cx = left + w / 2;
      const fill = fail ? '#ff5a5a' : '#ffffff';
      const line = fail ? '#c93a3a' : '#8fb4d9';
      ctx.save();
      ctx.globalAlpha *= vis * pulse;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 0.04 * k;
      ctx.strokeStyle = line;
      ctx.fillStyle = fill;
      if (fail) {
        ctx.beginPath();
        ctx.moveTo(left + 0.04 * k, cy + h / 2 - 0.3 * k);
        ctx.lineTo(hx - 0.04 * k, hcy + 0.2 * k);
        ctx.lineTo(left + 0.04 * k, cy + h / 2 - 0.08 * k);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        for (const [dx, dy, r] of [[0.0, 0.22, 0.05], [0.15, 0.2, 0.08]] as const) {
          ctx.beginPath();
          ctx.arc(hx + dx * k, hcy + dy * k, r * k, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      const r = Math.min(h / 2, 0.32 * k);
      ctx.beginPath();
      ctx.roundRect(left, cy - h / 2, w, h, fail ? 0.16 * k : r);
      if (!fail) {
        // cloud: a few bumps along the top edge
        const n = Math.max(2, Math.round(w / (0.55 * k)));
        for (let i = 0; i < n; i++) {
          const bx = left + r * 0.6 + ((w - r * 1.2) * (i + 0.5)) / n;
          ctx.moveTo(bx + r * 0.5, cy - h / 2 + 0.02 * k);
          ctx.arc(bx, cy - h / 2 + 0.02 * k, r * 0.5, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      ctx.stroke();
      if (!fail) {
        // hide the outline where the body and the bumps meet
        ctx.beginPath();
        ctx.roundRect(left + 0.03 * k, cy - h / 2 + 0.03 * k, w - 0.06 * k, h - 0.06 * k, r);
        ctx.fill();
      }
      let tx = cx;
      if (fail) {
        // sweat drop
        const dx = left + 0.28 * k;
        ctx.beginPath();
        ctx.moveTo(dx, cy - 0.13 * k);
        ctx.bezierCurveTo(dx + 0.11 * k, cy + 0.02 * k, dx + 0.08 * k, cy + 0.13 * k, dx, cy + 0.13 * k);
        ctx.bezierCurveTo(dx - 0.08 * k, cy + 0.13 * k, dx - 0.11 * k, cy + 0.02 * k, dx, cy - 0.13 * k);
        ctx.fillStyle = '#bfe8ff';
        ctx.fill();
        ctx.lineWidth = 0.03 * k;
        ctx.strokeStyle = '#4aa8e0';
        ctx.stroke();
        tx += 0.15 * k;
      }
      const ink = fail ? '#ffffff' : '#46607f';
      if (l2) {
        text(ctx, l1, tx, cy - lineH / 2, sz, ink, { weight: 800 });
        text(ctx, l2, tx, cy + lineH / 2, sz * (fail ? 0.85 : 1), fail ? '#ffe5e5' : ink, { weight: 700 });
      } else text(ctx, l1, tx, cy + 0.01 * k, sz, ink, { weight: 700 });
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

