import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Sprite, SpriteMaterial, TorusGeometry, Vector3, type Material } from 'three';
import { Kit } from './kit';
import type { Agent, Status } from '../../shared/protocol';
import { clay, G } from './materials';
import { catFurFor, looksFor, shirtFor, STATUS_COLORS } from './palette';
import type { Seat } from './layout';
import { makeCanvas } from './text';
import { Spring, damp, dampAngle } from './motion';

const SEAT_H = 0.5;
const STAND_H = 0.66;
const WALK_SPEED = 1.7;

type Mode = 'walking' | 'seated' | 'standing' | 'leaving' | 'gone';

// ---------------------------------------------------------------- badges
// Shared canvas textures for the floating attention badges.
const badgeCache = new Map<string, SpriteMaterial>();
function badge(kind: 'waiting' | 'error' | 'done' | 'thinking') {
  let m = badgeCache.get(kind);
  if (m) return m;
  const { ctx, texture } = makeCanvas(128, 128);
  const color = STATUS_COLORS[kind];
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = kind === 'thinking' ? '#ffffff' : color;
  ctx.beginPath();
  ctx.arc(64, 60, 46, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'done') {
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(42, 62);
    ctx.lineTo(58, 78);
    ctx.lineTo(88, 46);
    ctx.stroke();
  } else if (kind === 'thinking') {
    ctx.fillStyle = color;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(40 + i * 24, 60, 8, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillRect(58, 30, 12, 38);
    ctx.beginPath();
    ctx.arc(64, 84, 7.5, 0, Math.PI * 2);
    ctx.fill();
  }
  m = new SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  badgeCache.set(kind, m);
  return m;
}

const ringGeo = new RingGeometry(0.42, 0.56, 32);
const selectGeo = new TorusGeometry(0.66, 0.035, 6, 48);
const glassesGeo = new TorusGeometry(0.055, 0.012, 5, 14);
const headbandGeo = new TorusGeometry(0.27, 0.018, 6, 20, Math.PI);
const hitGeo = new BoxGeometry(0.7, 1.7, 0.7);
const hitMat = new MeshBasicMaterial({ visible: false });
/** Raycasts for picking only look at this layer. */
export const PICK_LAYER = 1;


/**
 * One agent. A small clay figure that walks in from the door, sits at its desk,
 * types, thinks, waves when it needs you, celebrates when done, and walks out.
 */
export class Character {
  readonly root = new Group();
  readonly id: string;
  private body = new Group();
  private torso = new Group();
  private head = new Group();
  private armL = new Group();
  private armR = new Group();
  private legL = new Group();
  private legR = new Group();
  private shinL = new Group();
  private shinR = new Group();
  private eyes = new Group();
  private tail = new Group();
  private hitbox: Mesh;
  private badge = new Sprite(badge('thinking'));
  private badgeKind: string | null = null;
  private badgeScale = new Spring(0, { response: 0.35, damping: 0.62 });
  private statusRing: Mesh;
  private statusMat: MeshBasicMaterial;
  private selectRing: Mesh;
  private selectScale = new Spring(0, { response: 0.3, damping: 0.7 });
  private fade = new Spring(1, { response: 0.4, damping: 1 });
  private hop = new Spring(0, { response: 0.28, damping: 0.45 });
  private shake = 0;
  private hoverLift = new Spring(0, { response: 0.25, damping: 0.8 });

  mode: Mode = 'seated';
  private path: Vector3[] = [];
  private speed = WALK_SPEED;
  private seat: Seat | null = null;
  private status: Status = 'idle';
  private sitAmount = 1; // 1 seated, 0 standing
  /** What the character does when `path` ends: sit at the seat or stand at a purpose room. */
  private endMode: 'seated' | 'standing' = 'seated';
  /** Room-local route from just inside the office door to the spot in a purpose room (null at the desk). */
  private awayRoute: Vector3[] | null = null;
  private awayYaw = 0;
  private walkPhase = 0;
  private blinkAt = 0;
  private lookTarget: Vector3 | null = null;
  private lookUntil = 0;
  private gestureUntil = 0;
  private phase: number;
  private onGone?: () => void;

  constructor(agent: Agent) {
    this.id = agent.id;
    const look = looksFor(agent.id);
    this.phase = (look.hairStyle + 1) * 1.7;
    const shirt = clay(shirtFor(agent.role));
    const cat = catFurFor(agent.id);
    const skin = clay(cat.fur, { roughness: 0.95 });
    const belly = clay(cat.belly, { roughness: 0.95 });
    const pink = clay('#ff9eb5', { roughness: 0.8 });
    const pants = skin;
    const dark = clay('#1d1f24', { roughness: 0.4 });

    // Every moving part is batched into a single mesh (colours baked into
    // vertices), so a character costs ~9 draws instead of ~35.
    const bake = (target: Group, describe: (k: Kit) => void) => {
      const k = new Kit();
      describe(k);
      target.add(k.build());
    };

    // Torso: shirt capsule with a little collar of skin.
    this.torso.position.y = 0.3;
    bake(this.torso, (k) => {
      k.add(G.capsule(0.2, 0.2), skin, 0, 0, 0);
      k.add(G.sphere(0.15, 12, 10), belly, 0, -0.02, -0.12, { sx: 1, sy: 1.5, sz: 0.55, cast: false });
      k.add(G.cyl(0.17, 0.19, 0.07, 16), shirt, 0, 0.23, 0);
      k.add(G.sphere(0.045, 8, 6), shirt, 0.09, 0.15, -0.18);
    });
    this.torso.scale.set(1.05, 0.9, 1.05);
    this.body.add(this.torso);

    // 머리: 크고 둥근 아기 고양이 비율. 눈은 크고 반짝이고, 볼은 분홍색이다.
    this.head.position.y = 0.6;
    this.head.scale.setScalar(1.5);
    bake(this.head, (k) => {
      k.add(G.sphere(0.25, 20, 16), skin, 0, 0, 0, { sx: 1.16, sy: 0.92, sz: 1 });
      for (const side of [-1, 1]) {
        // 둥글둥글한 귀(뾰족하지 않게)
        k.add(G.sphere(0.1, 12, 10), skin, side * 0.16, 0.21, 0.0, { sx: 0.95, sy: 1.25, sz: 0.5, rz: -side * 0.4 });
        k.add(G.sphere(0.06, 10, 8), pink, side * 0.158, 0.205, -0.03, { sx: 0.9, sy: 1.2, sz: 0.4, rz: -side * 0.4, cast: false });
        // 볼 홍조
        k.add(G.sphere(0.05, 10, 8), pink, side * 0.18, -0.07, -0.19, { sx: 1.2, sy: 0.7, sz: 0.4, cast: false });
        // 수염은 짧고 가늘게
        for (const dy of [-0.012, 0.024]) k.add(G.box(0.1, 0.005, 0.005), belly, side * 0.25, -0.075 + dy, -0.17, { ry: side * 0.5, rz: side * -0.1 + dy * 3, cast: false });
      }
      k.add(G.sphere(0.075, 12, 8), belly, 0, -0.095, -0.175, { sx: 1.3, sy: 0.8, sz: 0.8, cast: false });
      k.add(G.sphere(0.022, 8, 6), pink, 0, -0.065, -0.245, { sx: 1.3, sy: 0.8, sz: 0.7, cast: false });
      if (cat.stripes) for (const dx of [-0.06, 0, 0.06]) k.add(G.box(0.02, 0.08, 0.02), clay(cat.stripe), dx, 0.2, -0.1, { rx: -0.9, cast: false });
      if (look.glasses) this.addGlasses(k, dark);
      if (agent.role.toLowerCase() === 'lead') this.addHeadset(k, dark);
    });
    this.eyes.position.set(0, 0.0, -0.236);
    bake(this.eyes, (k) => {
      for (const side of [-1, 1]) {
        k.add(G.sphere(0.066, 14, 12), dark, side * 0.115, 0, 0, { sx: 0.85, sy: 1.15, sz: 0.6, cast: false });
        k.add(G.sphere(0.024, 8, 6), clay('#ffffff'), side * 0.115 + 0.018, 0.03, -0.03, { cast: false });
        k.add(G.sphere(0.011, 6, 5), clay('#ffffff'), side * 0.115 - 0.02, -0.025, -0.03, { cast: false });
      }
    });
    this.head.add(this.eyes);
    this.torso.add(this.head);

    // Arms hang from shoulder pivots.
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(side * 0.255, 0.14, 0);
      bake(arm, (k) => {
        k.add(G.capsule(0.075, 0.2), skin, 0, -0.14, 0);
        k.add(G.sphere(0.085, 10, 8), belly, 0, -0.27, 0);
      });
      this.torso.add(arm);
    }
    // Legs: thigh pivot at the hip, shin pivot at the knee.
    for (const [leg, shin, side] of [[this.legL, this.shinL, -1], [this.legR, this.shinR, 1]] as const) {
      leg.position.set(side * 0.1, 0.08, 0);
      leg.scale.set(1.1, 0.75, 1.1);
      bake(leg, (k) => k.add(G.capsule(0.078, 0.2), pants, 0, -0.14, 0));
      shin.position.y = -0.3;
      bake(shin, (k) => {
        k.add(G.capsule(0.07, 0.18), pants, 0, -0.12, 0);
        k.add(G.rbox(0.13, 0.08, 0.2, 0.035), belly, 0, -0.26, -0.04);
      });
      leg.add(shin);
      this.body.add(leg);
    }

    // 꼬리: 몸통 뒤쪽 아래에서 올라오며 살랑거린다.
    this.tail.position.set(0, -0.12, 0.17);
    bake(this.tail, (k) => {
      k.add(G.capsule(0.05, 0.2), skin, 0, 0.1, 0.08, { rx: -0.5 });
      k.add(G.capsule(0.048, 0.16), skin, 0, 0.3, 0.02, { rx: 0.25 });
      k.add(G.sphere(0.052, 8, 6), cat.stripes ? clay(cat.stripe) : belly, 0, 0.42, -0.02);
    });
    this.torso.add(this.tail);

    this.root.add(this.body);

    // Status ring on the floor (semantic: colour = status).
    this.statusMat = new MeshBasicMaterial({ color: STATUS_COLORS.idle, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
    this.statusRing = new Mesh(ringGeo, this.statusMat);
    this.statusRing.rotation.x = -Math.PI / 2;
    this.statusRing.position.y = 0.075;
    this.root.add(this.statusRing);

    this.selectRing = new Mesh(selectGeo, new MeshBasicMaterial({ color: '#ff5f2e', toneMapped: false }));
    this.selectRing.rotation.x = -Math.PI / 2;
    this.selectRing.position.y = 0.08;
    this.selectRing.scale.setScalar(0.001);
    this.selectRing.visible = false;
    this.root.add(this.selectRing);

    this.badge.position.y = 1.85;
    this.badge.scale.setScalar(0.001);
    this.badge.visible = false;
    this.badge.renderOrder = 10;
    this.root.add(this.badge);

    // An invisible hit box for picking, so hover tests one box, not every triangle.
    this.hitbox = new Mesh(hitGeo, hitMat);
    this.hitbox.position.y = 0.85;
    this.hitbox.layers.set(PICK_LAYER);
    this.root.add(this.hitbox);

    this.root.traverse((o) => {
      o.userData.agentId = agent.id;
    });
  }

  private addGlasses(k: Kit, dark: Material) {
    for (const side of [-1, 1]) k.add(glassesGeo, dark, side * 0.085, 0.02, -0.235, { cast: false });
    k.add(G.box(0.06, 0.012, 0.012), dark, 0, 0.03, -0.24, { cast: false });
  }

  private addHeadset(k: Kit, dark: Material) {
    k.add(headbandGeo, dark, 0, 0.02, 0);
    for (const side of [-1, 1]) k.add(G.cyl(0.07, 0.07, 0.06, 12), dark, side * 0.26, 0, 0, { rz: Math.PI / 2 });
    k.add(G.capsule(0.012, 0.16), dark, -0.2, -0.12, -0.12, { rx: 0.6, rz: 0.9 });
    k.add(G.sphere(0.025, 8, 6), clay('#ff5f2e'), -0.13, -0.17, -0.2);
  }

  // ---------------------------------------------------------------- commands

  setSeat(seat: Seat, instant = false) {
    this.seat = seat;
    if (instant && !this.awayRoute) {
      this.mode = 'seated';
      this.sitAmount = 1;
      this.root.position.set(seat.x, 0, seat.z);
      this.root.rotation.y = seat.yaw;
    }
  }

  /** Spawn at the building entrance and walk the whole way to the seat. */
  arrive(entry: [number, number][], seat: Seat) {
    this.seat = seat;
    const [start, ...rest] = entry;
    this.root.position.set(start[0], 0, start[1]);
    this.mode = 'walking';
    this.sitAmount = 0;
    this.fade.value = 0;
    this.fade.target = 1;
    this.path = [...rest, ...seat.path].map(([x, z]) => new Vector3(x, 0, z));
    this.speed = this.paceFor(this.path);
  }

  /** Away from the desk (walking to, standing in, or walking back from a purpose room). */
  isAway() {
    return this.awayRoute !== null;
  }

  /**
   * Walk to a purpose room and stand there. `route` is room-local: just inside the office door,
   * corridor points, then the spot. Ignored while arriving or leaving.
   */
  goTo(route: [number, number][], facingYaw: number) {
    if (this.mode === 'leaving' || this.mode === 'gone' || !route.length) return;
    // From the desk: out the office door. From another purpose room: back into the corridor first.
    const old = this.awayRoute;
    const first: [number, number][] =
      this.mode === 'seated' && this.seat
        ? [...this.seat.path].reverse().slice(1)
        : old && old.length > 1
          ? [[old[old.length - 2].x, old[old.length - 2].z]]
          : [];
    this.awayRoute = route.map(([x, z]) => new Vector3(x, 0, z));
    this.awayYaw = facingYaw;
    this.endMode = 'standing';
    this.mode = 'walking';
    this.path = [...first.map(([x, z]) => new Vector3(x, 0, z)), ...this.awayRoute];
    this.speed = this.paceFor(this.path);
  }

  /** Walk back from a purpose room and sit down again. */
  returnToSeat() {
    if (!this.awayRoute || !this.seat || this.mode === 'leaving' || this.mode === 'gone') return;
    const back = [...this.awayRoute].reverse();
    this.awayRoute = null;
    this.endMode = 'seated';
    this.mode = 'walking';
    this.path = [...back, ...this.seat.path.map(([x, z]) => new Vector3(x, 0, z))];
    this.speed = this.paceFor(this.path);
  }

  /** Long trips are walked briskly so arrivals never take more than ~9 s. */
  private paceFor(path: Vector3[]) {
    let len = 0;
    let prev = this.root.position;
    for (const p of path) {
      len += prev.distanceTo(p);
      prev = p;
    }
    return Math.min(4.2, Math.max(WALK_SPEED, len / 9));
  }

  /** Stand up and walk out along `exit` (office door, corridor, front door). */
  leave(exit: [number, number][], onGone: () => void) {
    if (this.mode === 'leaving' || this.mode === 'gone') return;
    const outbound = this.mode === 'walking' && this.endMode === 'standing';
    this.mode = 'leaving';
    this.onGone = onGone;
    if (this.awayRoute) {
      // Already in the corridor side of the building: rejoin the corridor, skip the office door.
      const route = this.awayRoute;
      const corridor = route.length > 1 ? route[route.length - 2] : route[0];
      const at = outbound ? this.path.indexOf(corridor) : -1;
      const keep = outbound ? (at >= 0 ? this.path.slice(0, at + 1) : []) : [corridor];
      this.awayRoute = null;
      this.path = [...keep, ...exit.slice(2).map(([x, z]) => new Vector3(x, 0, z))];
      this.speed = this.paceFor(this.path);
      return;
    }
    const back = this.seat ? [...this.seat.path].reverse().slice(1) : [];
    this.path = [...back, ...exit].map(([x, z]) => new Vector3(x, 0, z));
    this.speed = this.paceFor(this.path);
  }

  /** Turn to face a world-space point for a moment (talking / listening). */
  lookAtWorld(point: Vector3, seconds = 2.4, gesture = false) {
    this.lookTarget = point.clone();
    this.lookUntil = performance.now() / 1000 + seconds;
    if (gesture) this.gestureUntil = this.lookUntil;
  }

  setStatus(status: Status) {
    if (status === this.status) return;
    const prev = this.status;
    this.status = status;
    this.statusMat.color.set(STATUS_COLORS[status]);
    if (status === 'done' && prev !== 'done') this.hop.velocity = 5.5;
    if (status === 'error' && prev !== 'error') this.shake = 1;
    const kind = status === 'waiting' || status === 'error' || status === 'done' || status === 'thinking' ? status : null;
    if (kind !== this.badgeKind) {
      this.badgeKind = kind;
      if (kind) {
        this.badge.material = badge(kind);
        this.badgeScale.value = 0;
        this.badgeScale.target = kind === 'thinking' ? 0.34 : 0.44;
      } else this.badgeScale.target = 0;
    }
  }

  setSelected(on: boolean) {
    this.selectScale.target = on ? 1 : 0;
  }

  setHovered(on: boolean) {
    this.hoverLift.target = on ? 1 : 0;
  }

  headWorld(out = new Vector3()) {
    return this.head.getWorldPosition(out);
  }

  // ---------------------------------------------------------------- frame

  update(dt: number, t: number, reduced: boolean) {
    if (this.mode === 'gone') return;
    const now = performance.now() / 1000;

    // ---- locomotion
    let moving = false;
    if ((this.mode === 'walking' || this.mode === 'leaving') && this.sitAmount < 0.05) {
      const target = this.path[0];
      if (target) {
        const pos = this.root.position;
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        const step = this.speed * dt;
        if (dist <= step || dist < 0.01) {
          pos.x = target.x;
          pos.z = target.z;
          this.path.shift();
        } else {
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
          moving = true;
          // Face the direction of travel. Forward is -Z.
          this.root.rotation.y = dampAngle(this.root.rotation.y, Math.atan2(-dx, -dz), 12, dt);
        }
      }
      if (!this.path.length) {
        if (this.mode === 'walking') this.mode = this.endMode;
        else {
          this.fade.target = 0;
          if (this.fade.value < 0.03) {
            this.mode = 'gone';
            this.onGone?.();
            return;
          }
        }
      }
    }

    // Standing up / sitting down
    const wantSit = this.mode === 'seated' ? 1 : 0;
    if (this.mode === 'seated' && this.seat) {
      // Slide onto the chair and turn to the desk.
      const pos = this.root.position;
      pos.x = damp(pos.x, this.seat.x, 10, dt);
      pos.z = damp(pos.z, this.seat.z, 10, dt);
    }
    this.sitAmount = damp(this.sitAmount, wantSit, 7, dt);

    // ---- facing
    let yawTarget: number | null = null;
    if (this.mode === 'seated' && this.seat) yawTarget = this.seat.yaw;
    if (this.mode === 'standing') yawTarget = this.awayYaw;
    if (this.lookTarget && now < this.lookUntil && this.mode === 'seated') {
      const p = this.root.parent ? this.root.parent.worldToLocal(this.lookTarget.clone()) : this.lookTarget;
      yawTarget = Math.atan2(-(p.x - this.root.position.x), -(p.z - this.root.position.z));
    }
    if (yawTarget !== null) this.root.rotation.y = dampAngle(this.root.rotation.y, yawTarget, 6, dt);

    // ---- posture
    const s = this.sitAmount;
    const base = STAND_H + (SEAT_H - STAND_H) * s;
    this.hop.update(dt);
    const hop = Math.max(0, this.hop.value) * 0.25;
    this.body.position.y = base + hop;

    const st = this.status;
    const working = st === 'working' && this.mode === 'seated';
    const thinking = st === 'thinking' && this.mode === 'seated';
    const waiting = st === 'waiting';
    const idle = (st === 'idle' || st === 'done' || st === 'offline') && this.mode === 'seated';
    const talking = now < this.gestureUntil;
    const k = reduced ? 0.25 : 1;

    // Legs: bent while seated, swinging while walking.
    this.walkPhase += moving ? dt * (6 + this.speed * 2.2) : 0;
    const swing = moving ? Math.sin(this.walkPhase) * 0.65 : 0;
    this.legL.rotation.x = damp(this.legL.rotation.x, s * (Math.PI / 2) + swing, 14, dt);
    this.legR.rotation.x = damp(this.legR.rotation.x, s * (Math.PI / 2) - swing, 14, dt);
    this.shinL.rotation.x = damp(this.shinL.rotation.x, -s * (Math.PI / 2) - (moving ? Math.max(0, -Math.sin(this.walkPhase)) * 0.7 : 0), 14, dt);
    this.shinR.rotation.x = damp(this.shinR.rotation.x, -s * (Math.PI / 2) - (moving ? Math.max(0, Math.sin(this.walkPhase)) * 0.7 : 0), 14, dt);
    if (moving) this.body.position.y += Math.abs(Math.sin(this.walkPhase)) * 0.04;

    this.tail.rotation.x = Math.sin(t * (moving ? 7 : 2.2) + this.phase) * (moving ? 0.22 : 0.14) * k;
    this.tail.rotation.z = Math.sin(t * (moving ? 5 : 1.6) + this.phase) * 0.35 * k;

    // Arms
    let lx = 0, rx = 0, lz = 0, rz = 0;
    if (moving) {
      lx = -swing * 0.8;
      rx = swing * 0.8;
    } else if (working) {
      lx = 1.25 + Math.sin(t * 22 + this.phase) * 0.12 * k;
      rx = 1.25 + Math.sin(t * 22 + this.phase + 2.1) * 0.12 * k;
      lz = 0.25;
      rz = -0.25;
    } else if (thinking) {
      lx = 0.9;
      lz = 0.25;
      rx = 2.35;
      rz = -0.62;
    } else if (waiting) {
      rz = 2.7 + Math.sin(t * 9) * 0.28 * k;
      rx = 0.1;
      lx = 0.4;
    } else if (talking) {
      rx = 1.1 + Math.sin(t * 6) * 0.35 * k;
      rz = -0.2;
      lx = 0.5;
    } else if (idle) {
      lx = 0.45;
      rx = 0.45;
      lz = 0.12;
      rz = -0.12;
    }
    this.armL.rotation.x = damp(this.armL.rotation.x, lx, 12, dt);
    this.armR.rotation.x = damp(this.armR.rotation.x, rx, 12, dt);
    this.armL.rotation.z = damp(this.armL.rotation.z, lz, 12, dt);
    this.armR.rotation.z = damp(this.armR.rotation.z, rz, 12, dt);

    // Torso lean: forward when typing, back when idle.
    const breathe = Math.sin(t * 1.6 + this.phase) * 0.012 * k;
    const lean = working ? 0.16 : idle ? -0.14 : thinking ? 0.04 : 0;
    this.torso.rotation.x = damp(this.torso.rotation.x, -lean, 6, dt);
    this.torso.scale.y = 0.9 * (1 + breathe);

    // Head: nod while typing, tilt while thinking, shake on error.
    let hx = 0, hz = 0, hy = 0;
    if (working) hx = -0.1 + Math.sin(t * 3.1 + this.phase) * 0.03 * k;
    if (thinking) {
      hz = 0.22;
      hx = 0.18;
      hy = Math.sin(t * 0.8 + this.phase) * 0.25 * k;
    }
    if (idle) hy = Math.sin(t * 0.35 + this.phase) * 0.35 * k;
    if (this.shake > 0) {
      hy += Math.sin(this.shake * 30) * 0.35 * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    this.head.rotation.x = damp(this.head.rotation.x, hx, 8, dt);
    this.head.rotation.z = damp(this.head.rotation.z, hz, 8, dt);
    this.head.rotation.y = damp(this.head.rotation.y, hy, 8, dt);

    // Blink
    if (t > this.blinkAt) this.blinkAt = t + 2 + ((this.phase * 997) % 3) + Math.random() * 2;
    const blinking = this.blinkAt - t < 0.12;
    this.eyes.scale.y = blinking ? 0.15 : 1;

    // Badge bobs above the head.
    this.badgeScale.update(dt);
    const bs = Math.max(0.001, this.badgeScale.value);
    this.badge.scale.setScalar(bs);
    this.badge.visible = bs > 0.01;
    this.badge.position.y = 2.02 + (1 - s) * 0.14 + hop + Math.sin(t * 3 + this.phase) * 0.04 * k;

    // Rings
    this.selectScale.update(dt);
    const sel = Math.max(0.001, this.selectScale.value);
    this.selectRing.visible = sel > 0.01;
    this.selectRing.scale.setScalar(sel * (1 + Math.sin(t * 3) * 0.03 * k));
    this.statusRing.visible = this.mode !== 'leaving';
    this.statusMat.opacity = (0.35 + (st === 'working' || st === 'waiting' ? Math.sin(t * 4) * 0.15 * k + 0.15 : 0)) * this.fade.value;

    // Hover: a small lift so the cursor clearly lands on someone.
    this.hoverLift.update(dt);
    this.body.position.y += this.hoverLift.value * 0.05;

    // Fade in / out on arrival and departure.
    this.fade.update(dt);
    const f = Math.min(1, Math.max(0, this.fade.value));
    this.root.scale.setScalar(0.6 + 0.4 * f);
    this.root.visible = f > 0.02;
  }

  isSeated() {
    return this.mode === 'seated' && this.sitAmount > 0.6;
  }

  dispose() {
    this.statusMat.dispose();
    (this.selectRing.material as Material).dispose();
    this.root.removeFromParent();
  }
}

export function findAgentId(o: Object3D | null): string | undefined {
  while (o) {
    if (o.userData.agentId) return o.userData.agentId as string;
    o = o.parent;
  }
  return undefined;
}
