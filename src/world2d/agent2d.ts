// One agent: where the cat is, what it is doing, and how it moves. Mirrors src/world/Character.ts.
import type { Agent, Status } from '../../shared/protocol';
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
}

export type Mode = 'walking' | 'seated' | 'standing' | 'leaving' | 'gone';

const WALK_SPEED = 2.0;

export class Agent2D implements CatView {
  readonly id: string;
  team: string;
  role: string;
  status: Status = 'idle';
  mode: Mode = 'seated';
  x = 0;
  z = 0;
  seat: SeatW | null = null;
  place: 'desk' | 'meeting' | 'lounge' | 'games' | 'kitchen' | 'farewell' = 'desk';
  /** What the cat holds and does while it hangs out (mug, paddle, stretch). Driven by activities.ts. */
  readonly act: CatAct = { prop: 0, side: 1, sip: 0, swing: 0, stretch: 0, cheer: 0 };
  /** Bumped whenever the cat is sent somewhere new, so a side trip knows it was overruled. */
  routeId = 0;
  main = true;
  farewell = false;
  leaving = false;

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
  }

  /** Spawn at the first point and walk the whole way to the seat. */
  arrive(entry: P[], seat: SeatW, delay = 0) {
    this.wait = delay;
    this.seat = seat;
    const [start, ...rest] = entry;
    this.x = start.x;
    this.z = start.z;
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
    const old = this.awayRoute;
    const first: P[] =
      this.mode === 'seated' && this.seat ? [...this.seat.path].reverse().slice(1) : old && old.length > 1 ? [old[old.length - 2]] : [];
    this.routeId++;
    this.awayRoute = route;
    this.awayLook = look;
    this.awaySit = sitDown;
    this.endMode = 'standing';
    this.mode = 'walking';
    this.path = [...first, ...route];
    this.speed = this.paceFor(this.path);
  }

  returnToSeat() {
    if (!this.awayRoute || !this.seat || this.mode === 'leaving' || this.mode === 'gone') return;
    this.routeId++;
    const back = [...this.awayRoute].reverse();
    this.awayRoute = null;
    this.awaySit = false;
    this.endMode = 'seated';
    this.mode = 'walking';
    this.path = [...back, ...this.seat.path];
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
    let len = 0;
    let px = this.x;
    let pz = this.z;
    for (const p of path) {
      len += Math.hypot(p.x - px, p.z - pz);
      px = p.x;
      pz = p.z;
    }
    return Math.min(4.2, Math.max(WALK_SPEED, len / 9));
  }

  /** Stand up and walk out along `exit` (office door, corridor, elevator). */
  leave(exit: P[], onGone: () => void) {
    if (this.mode === 'leaving' || this.mode === 'gone') return;
    const outbound = this.mode === 'walking' && this.endMode === 'standing';
    this.mode = 'leaving';
    this.routeId++;
    this.onGone = onGone;
    this.awaySit = false;
    if (this.awayRoute) {
      const route = this.awayRoute;
      const corridor = route.length > 1 ? route[route.length - 2] : route[0];
      const at = outbound ? this.path.indexOf(corridor) : -1;
      const keep = outbound ? (at >= 0 ? this.path.slice(0, at + 1) : []) : [corridor];
      this.awayRoute = null;
      this.path = [...keep, ...exit.slice(2)];
      this.speed = this.paceFor(this.path);
      return;
    }
    const back = this.seat ? [...this.seat.path].reverse().slice(1) : [];
    this.path = [...back, ...exit];
    this.speed = this.paceFor(this.path);
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
        } else {
          this.x += (dx / dist) * step;
          this.z += (dz / dist) * step;
          moving = true;
          lookTarget = Math.max(-1, Math.min(1, (dx / dist) * 1.4));
        }
      }
      if (!this.path.length) {
        if (this.mode === 'walking') this.mode = this.endMode;
        else {
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
    this.selected = damp(this.selected, this.wantSelected ? 1 : 0, 12, dt);
    this.hover = damp(this.hover, this.wantHover ? 1 : 0, 14, dt);
    this.alpha = damp(this.alpha, this.status === 'offline' ? 0.55 : 1, 6, dt);
  }
}
