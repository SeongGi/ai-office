// One agent: where the cat is, what it is doing, and how it moves. Mirrors src/world/Character.ts.
import type { Agent, Status } from '../../shared/protocol';
import { CORRIDOR } from '../world/layout';
import { damp } from '../world/motion';
import type { CatAct, CatView } from './cat';
import { EYE_IRIS, catFurFor, hash, shirtFor } from './palette2d';

export interface P {
  x: number;
  z: number;
}

export interface SeatW {
  x: number;
  z: number;
  /** Unit vector the cat faces while seated. */
  fx: number;
  fz: number;
  /** World path from the office door to the seat. Last point is the seat. */
  path: P[];
  /** Corridor point just outside the office door. */
  door: P;
}

export type Mode = 'walking' | 'seated' | 'standing' | 'leaving' | 'gone';

const WALK_SPEED = 2.0;
const HALL = CORRIDOR / 2 - 0.1;

/** In the corridor, where nothing stands between two points. */
const inHall = (p: P) => Math.abs(p.z) <= HALL;
const same = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z) < 0.05;

/** Any straight line inside the corridor is clear, so a run of corridor points keeps its ends and its centre-line points. */
function tidy(path: P[]): P[] {
  return path.filter((p, i) => !(i > 0 && i < path.length - 1 && inHall(path[i - 1]) && inHall(p) && inHall(path[i + 1]) && Math.abs(p.z) > 0.5));
}

export class Agent2D implements CatView {
  readonly id: string;
  team: string;
  role: string;
  status: Status = 'idle';
  mode: Mode = 'seated';
  x = 0;
  z = 0;
  seat: SeatW | null = null;
  place: 'desk' | 'meeting' | 'lounge' | 'games' | 'kitchen' | 'library' | 'server' | 'search' | 'farewell' = 'desk';
  /** What the cat holds and does while it hangs out (mug, paddle, stretch). Driven by activities.ts. */
  readonly act: CatAct = { prop: 0, side: 1, sip: 0, swing: 0, stretch: 0, cheer: 0, work: 0 };
  /** Bumped whenever the cat is sent somewhere new, so a side trip knows it was overruled. */
  routeId = 0;
  main = true;
  farewell = false;
  leaving = false;
  /** Put at its spot without walking; activities.ts starts such a cat already in its pose, then clears this. */
  snapped = false;

  // CatView
  sit = 1;
  moving = false;
  walkPhase = 0;
  look = 0;
  hop = 0;
  shake = 0;
  hover = 0;
  selected = 0;
  badge = 0;
  /** Speech bubble over the head: what it shows, how visible it is (0..1) and the text. Driven by World2D. */
  bubbleKind: 0 | 1 | 2 = 0; // 0 none, 1 thinking cloud, 2 tool failure
  bubble = 0;
  bubbleText = '';
  bubbleSub = '';
  bubbleWant = 0;
  /** The pose the cat takes at its spot in a tool room (CatAct.work), set when it is sent there. */
  workPose: 0 | 1 | 2 | 3 = 0;
  /** Which failure event the red bubble was started for (the agent's lastSeen). */
  failKey = -1;
  talk = 0;
  alpha = 1;
  atDesk = true;
  readonly fur: string;
  readonly belly: string;
  readonly stripe: string;
  readonly stripes: boolean;
  readonly scarf: string;
  readonly iris: string;
  readonly seed: number;

  private path: P[] = [];
  /** Waypoints walked since the cat last stood in the corridor (the first one is that point). Walked backwards they lead out through the same doors. */
  private trail: P[] = [];
  /** Seconds to stay in the elevator before stepping out. */
  private wait = 0;
  private speed = WALK_SPEED;
  private endMode: 'seated' | 'standing' = 'seated';
  private awayRoute: P[] | null = null;
  private awaySit = false;
  private awayLook = 0;
  private hopV = 0;
  private wantSelected = false;
  private wantHover = false;
  private onGone: (() => void) | null = null;

  constructor(agent: Agent) {
    this.id = agent.id;
    this.team = agent.team;
    this.role = agent.role;
    const cat = catFurFor(agent.id);
    this.fur = cat.fur;
    this.belly = cat.belly;
    this.stripe = cat.stripe;
    this.stripes = cat.stripes;
    this.scarf = shirtFor(agent.role);
    const h = hash(agent.id);
    this.iris = EYE_IRIS[(h >>> 6) % EYE_IRIS.length];
    this.seed = (h % 1000) / 1000;
  }

  // ---------------------------------------------------------------- commands

  setSeat(seat: SeatW, instant = false) {
    this.seat = seat;
    if (instant && !this.awayRoute) {
      this.mode = 'seated';
      this.sit = 1;
      this.x = seat.x;
      this.z = seat.z;
      this.look = seat.fx * 0.6;
    }
    if (this.mode === 'seated' && !this.awayRoute) this.trail = [seat.door, ...seat.path];
  }

  /** Stand (or sit) at the end of `route` right away, as if it had walked there. */
  placeAt(route: P[], look: number, sitDown: boolean) {
    const end = route[route.length - 1];
    if (!end || this.mode === 'leaving' || this.mode === 'gone') return;
    this.routeId++;
    this.awayRoute = route;
    this.awayLook = look;
    this.awaySit = sitDown;
    this.endMode = 'standing';
    this.mode = 'standing';
    this.path = [];
    this.x = end.x;
    this.z = end.z;
    this.sit = sitDown ? 1 : 0;
    this.look = look;
    this.snapped = true;
    this.trail = this.restTrail();
  }

  /** Back on the seat right away (reduced motion has no walk). */
  snapToSeat() {
    const seat = this.seat;
    if (!seat || this.mode === 'leaving' || this.mode === 'gone') return;
    this.routeId++;
    this.awayRoute = null;
    this.awaySit = false;
    this.endMode = 'seated';
    this.mode = 'seated';
    this.path = [];
    this.sit = 1;
    this.x = seat.x;
    this.z = seat.z;
    this.look = seat.fx * 0.6;
    this.snapped = false;
    this.trail = [seat.door, ...seat.path];
  }

  /** Spawn at the first point and walk the whole way to the seat. */
  arrive(entry: P[], seat: SeatW, delay = 0) {
    this.wait = delay;
    this.seat = seat;
    const [start, ...rest] = entry;
    this.x = start.x;
    this.z = start.z;
    this.trail = [start];
    this.mode = 'walking';
    this.endMode = 'seated';
    this.sit = 0;
    this.path = [...rest, ...seat.path];
    this.speed = this.paceFor(this.path);
  }

  /** Away from the desk (walking to, standing in, or walking back from a purpose room). */
  isAway() {
    return this.awayRoute !== null;
  }

  /** Walk to a purpose room and stand (or sit, for lounge seats). `route` starts just outside the office door. */
  goTo(route: P[], look: number, sitDown: boolean) {
    if (this.mode === 'leaving' || this.mode === 'gone' || !route.length) return;
    const out = this.toHall();
    this.routeId++;
    this.awayRoute = route;
    this.awayLook = look;
    this.awaySit = sitDown;
    this.endMode = 'standing';
    this.mode = 'walking';
    this.path = tidy([...out, ...route]);
    this.speed = this.paceFor(this.path);
  }

  returnToSeat() {
    if (!this.awayRoute || !this.seat || this.mode === 'leaving' || this.mode === 'gone') return;
    this.routeId++;
    const out = this.toHall();
    this.awayRoute = null;
    this.awaySit = false;
    this.endMode = 'seated';
    this.mode = 'walking';
    this.path = tidy([...out, this.seat.door, ...this.seat.path]);
    this.speed = this.paceFor(this.path);
  }

  /** Where a standing cat faces (-1 left .. 1 right). */
  get lookGoal() {
    return this.awayLook;
  }

  faceTo(look: number) {
    this.awayLook = look;
  }

  /** A hop, unless one is under way. */
  kick(v = 2.6) {
    if (this.hop <= 0 && this.hopV === 0) this.hopV = v;
  }

  /** A short walk inside the room (to the fridge, a beanbag) that keeps the cat's place. */
  detour(route: P[], look: number, sit = false) {
    if (this.mode !== 'standing' || !route.length) return false;
    this.path = [...route];
    this.mode = 'walking';
    this.endMode = 'standing';
    this.awayLook = look;
    this.awaySit = sit;
    this.speed = Math.min(2.4, this.paceFor(this.path));
    return true;
  }

  private paceFor(path: P[]) {
    return Math.min(4.2, Math.max(WALK_SPEED, this.lengthOf(path) / 9));
  }

  /** Stand up and walk out along `exit` (office door, corridor, elevator). */
  leave(exit: P[], onGone: () => void) {
    if (this.mode === 'leaving' || this.mode === 'gone') return;
    const out = this.wayOut(exit);
    this.mode = 'leaving';
    this.routeId++;
    this.onGone = onGone;
    this.awaySit = false;
    this.awayRoute = null;
    this.path = out;
    this.speed = this.paceFor(this.path);
  }

  private wayOut(exit: P[]) {
    // Still on the way out of the elevator: turn round and go back in.
    const back = [...this.trail].reverse();
    if (back.length > 0 && !inHall(back[back.length - 1])) return back;
    return tidy([...this.toHall(), ...exit]);
  }

  /**
   * The building was reshaped: carry the cat and its walked and planned waypoints along with the room each one
   * is in. `dx` gives that shift for a point off the corridor's centre line; a centre-line point moves with its
   * neighbour off the line.
   */
  relocate(dx: (p: P) => number) {
    const move = (pts: P[]) => {
      const d = pts.map((p) => (Math.abs(p.z) > 0.5 ? dx(p) : null));
      for (let i = 0; i < pts.length; i++) {
        const k = d[i] ?? d[i + 1] ?? d[i - 1] ?? 0;
        if (k) pts[i] = { x: pts[i].x + k, z: pts[i].z };
      }
    };
    if (Math.abs(this.z) > 0.5) this.x += dx(this);
    move(this.path);
    move(this.trail);
    if (this.awayRoute) {
      this.awayRoute = [...this.awayRoute];
      move(this.awayRoute);
    }
  }

  /** After a reshape: walk on to the seat, or out to the elevator, along the new doors. */
  rewalk(exit: P[]) {
    if (this.mode === 'leaving') this.path = this.wayOut(exit);
    else if (this.mode === 'walking' && !this.awayRoute && this.seat) this.path = tidy([...this.toHall(), this.seat.door, ...this.seat.path]);
    else return;
    this.speed = this.paceFor(this.path);
  }

  /**
   * The way from here to the nearest corridor point: on along the planned waypoints, or back along the walked
   * ones, whichever is shorter. Either way the cat only passes doors it would pass anyway.
   */
  private toHall(): P[] {
    const ahead: P[] = [];
    let aheadOk = false;
    if (this.mode === 'walking' || this.mode === 'leaving') {
      for (const p of this.path) {
        ahead.push(p);
        if (inHall(p)) {
          aheadOk = true;
          break;
        }
      }
    }
    const back = [...this.trail].reverse();
    const backOk = back.length > 0 && inHall(back[back.length - 1]);
    if (aheadOk && (!backOk || this.lengthOf(ahead) <= this.lengthOf(back))) return ahead;
    return back;
  }

  private lengthOf(path: P[]) {
    let len = 0;
    let px = this.x;
    let pz = this.z;
    for (const p of path) {
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    return len;
  }

  /** The walked waypoints a cat resting at its seat or its spot came by. */
  private restTrail(): P[] {
    if (this.mode === 'seated' && this.seat) return [this.seat.door, ...this.seat.path];
    const route = this.awayRoute;
    if (this.mode !== 'standing' || !route) return [];
    let i = route.length - 1;
    while (i > 0 && !inHall(route[i])) i--;
    return route.slice(i);
  }

  /** A waypoint was reached: grow the trail, shrink it when walking back over it, restart it in the corridor. */
  private passed(p: P) {
    const tr = this.trail;
    if (inHall(p)) this.trail = [p];
    else if (tr.length && same(tr[tr.length - 1], p)) return;
    else if (tr.length > 1 && same(tr[tr.length - 2], p)) tr.pop();
    else tr.push(p);
  }

  setStatus(status: Status) {
    if (status === this.status) return;
    const prev = this.status;
    this.status = status;
    if (status === 'done' && prev !== 'done') this.hopV = 3.3;
    if (status === 'error' && prev !== 'error') this.shake = 1;
  }

  setSelected(on: boolean) {
    this.wantSelected = on;
  }

  setHovered(on: boolean) {
    this.wantHover = on;
  }

  say(seconds = 2) {
    this.talk = seconds;
  }

  // ---------------------------------------------------------------- frame

  update(dt: number, reduced: boolean) {
    if (this.mode === 'gone') return;
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    let moving = false;
    let lookTarget = this.mode === 'seated' && this.seat ? this.seat.fx * 0.6 : this.mode === 'standing' ? this.awayLook : 0;
    if ((this.mode === 'walking' || this.mode === 'leaving') && this.sit < 0.05) {
      const target = this.path[0];
      if (target) {
        const dx = target.x - this.x;
        const dz = target.z - this.z;
        const dist = Math.hypot(dx, dz);
        const step = this.speed * dt;
        if (dist <= step || dist < 0.01) {
          this.x = target.x;
          this.z = target.z;
          this.path.shift();
          this.passed(target);
        } else {
          this.x += (dx / dist) * step;
          this.z += (dz / dist) * step;
          moving = true;
          lookTarget = Math.max(-1, Math.min(1, (dx / dist) * 1.4));
        }
      }
      if (!this.path.length) {
        if (this.mode === 'walking') {
          this.mode = this.endMode;
          // Home again (seat or spot): forget side trips, keep only the way in.
          const rest = this.restTrail();
          if (rest.length && same(rest[rest.length - 1], this)) this.trail = rest;
        } else {
          this.mode = 'gone';
          this.onGone?.();
          return;
        }
      }
    }

    if (this.mode === 'seated' && this.seat) {
      this.x = damp(this.x, this.seat.x, 10, dt);
      this.z = damp(this.z, this.seat.z, 10, dt);
    }
    const wantSit = this.mode === 'seated' || (this.mode === 'standing' && this.awaySit) ? 1 : 0;
    this.sit = damp(this.sit, wantSit, 7, dt);
    this.moving = moving;
    this.atDesk = this.mode === 'seated';
    this.look = damp(this.look, lookTarget, 8, dt);
    if (moving) this.walkPhase += dt * (6 + this.speed * 2.2);

    if (this.hopV !== 0 || this.hop > 0) {
      this.hop += this.hopV * dt;
      this.hopV -= 14 * dt;
      if (this.hop <= 0) {
        this.hop = 0;
        this.hopV = 0;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 1.1);
    this.talk = Math.max(0, this.talk - dt);
    const wantBadge = this.status === 'thinking' || this.status === 'waiting' || this.status === 'done' || this.status === 'error' ? 1 : 0;
    this.badge = damp(this.badge, wantBadge, reduced ? 30 : 12, dt);
    this.act.work = this.mode === 'standing' && this.workPose && (this.place === 'library' || this.place === 'server' || this.place === 'search') ? this.workPose : 0;
    this.bubble = damp(this.bubble, this.bubbleWant, reduced ? 30 : 6, dt);
    if (this.bubble < 0.01 && this.bubbleWant === 0) this.bubbleKind = 0;
    this.selected = damp(this.selected, this.wantSelected ? 1 : 0, 12, dt);
    this.hover = damp(this.hover, this.wantHover ? 1 : 0, 14, dt);
    this.alpha = damp(this.alpha, this.status === 'offline' ? 0.55 : 1, 6, dt);
  }
}
