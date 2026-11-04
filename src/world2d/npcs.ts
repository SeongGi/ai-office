// Decor cats that are not agents: the info cat at the lobby reception and the interview corner in the kitchen.
// They are not in WorldState, cannot be picked and cost the server nothing. Every move is a pure function of
// the clock, so nothing here allocates per frame. With reduced motion they hold one static pose and stay quiet.
import { NPC_SCRIPTS, type NpcPlace, type NpcTag } from '../../shared/npcScripts.js';
import { LOBBY_WIDTH, toWorld, type BuildingLayout } from '../world/layout';
import { drawCat, HEAD_TOP, type CatAct, type CatView } from './cat';
import { rgba } from './color';
import { rbox, star, style, text, textWidth } from './draw';
import { INTERVIEW, INTERVIEW_MIN_W, NEWHIRES, NEWHIRE_MIN_W, reception } from './furniture';
import { EYE_IRIS, catFurFor, hash, shirtFor } from './palette2d';

type Ctx = CanvasRenderingContext2D;

/** Where the lobby reception desk stands. The lobby scene and the info cat both read this. */
export function receptionSpot(x0: number, z0: number) {
  return { x: x0 + LOBBY_WIDTH / 2 - 1.3, z: z0 + 3.6, w: 3.2 };
}

type Role = 'info' | 'boss' | 'guest' | 'hire';

interface Npc extends CatView {
  role: Role;
  on: boolean;
  /** Text now in the bubble ('' none), seconds since it began and how long it lasts. */
  say: string;
  sayAt: number;
  sayFor: number;
  /** Bubble width in metres, measured once per text. */
  sayW: number;
  sayOf: string;
  act: CatAct;
  /** Which way the cat faces: -1 left, 1 right. */
  face: number;
  /** World x the cat's bubble must stay inside. */
  bmin: number;
  bmax: number;
}

const FAR = 1e9;
const WAVE_LIFE = 1.8;
/** The one line shown when motion is reduced. */
const STILL_LINE = '어서 오세요!';

/** One line of a scenario with its bubble text already wrapped, built once at load. */
interface Line {
  slot: 0 | 1;
  text: string;
  tag: NpcTag | '';
}
const PLACES = ['info', 'interview', 'lounge', 'banter'] as const;
const SCN: Record<NpcPlace, Line[][]> = { info: [], interview: [], lounge: [], banter: [] };
for (const place of PLACES) {
  for (const sc of NPC_SCRIPTS[place]) {
    SCN[place].push(
      sc.map(([slot, str, tag]) => {
        // A long line breaks at the space nearest the middle so the bubble stays small.
        let text = str;
        if (str.length > 9) {
          let at = -1;
          for (let i = 0; i < str.length; i++) if (str[i] === ' ' && (at < 0 || Math.abs(i - str.length / 2) < Math.abs(at - str.length / 2))) at = i;
          if (at > 0) text = `${str.slice(0, at)}\n${str.slice(at + 1)}`;
        }
        return { slot, text, tag: tag ?? '' };
      }),
    );
  }
}
const HISTORY = 5;

/** A group of cats that act out scenarios one after another. */
interface Group {
  place: NpcPlace;
  a: Npc;
  b: Npc;
  /** Seconds when the next scenario starts. */
  next: number;
  sc: Line[] | null;
  li: number;
  lineAt: number;
  lineEnd: number;
  /** Scenarios played so far; it is also the RNG counter. */
  n: number;
  /** The last few scenario keys, so they are not picked again at once. */
  hist: Int16Array;
}

/** A repeatable number in [0, 1) from two integers. */
function rnd(a: number, b: number) {
  let h = Math.imul(a + 7919, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function make(id: string, role: Role): Npc {
  const fur = catFurFor(id);
  const h = hash(id);
  return {
    role,
    on: false,
    x: 0,
    z: 0,
    status: 'working',
    sit: role === 'info' ? 0 : 1,
    moving: false,
    walkPhase: 0,
    look: 0,
    hop: 0,
    shake: 0,
    hover: 0,
    selected: 0,
    badge: 0,
    talk: 0,
    fur: fur.fur,
    belly: fur.belly,
    stripe: fur.stripe,
    stripes: fur.stripes,
    scarf: role === 'boss' ? '#2b3a55' : role === 'info' ? '#ff5f2e' : shirtFor(id),
    iris: EYE_IRIS[(h >>> 6) % EYE_IRIS.length],
    seed: (h % 1000) / 1000,
    alpha: 1,
    atDesk: false,
    act: { prop: 0, side: 1, sip: 0, swing: 0, stretch: 0, cheer: 0, work: 0 },
    say: '',
    sayAt: 0,
    sayFor: 0,
    sayW: 0,
    sayOf: '',
    face: 0,
    bmin: -FAR,
    bmax: FAR,
  };
}

export class Npcs {
  /** info cat, interviewer, candidate, then the two new hires who wait in the lounge. */
  private cats = [make('npc-안내', 'info'), make('npc-면접관', 'boss'), make('npc-지원자-1', 'guest'), make('npc-신입-1', 'hire'), make('npc-신입-2', 'hire')];
  private key = '';
  private desk = { x: 0, z: 0, w: 0 };
  private groups: Group[] = [];
  /** Seconds into a cheer, or -1. */
  private joyU = -1;
  private waveUntil = -1;
  private lastOpen = 0;
  private still = false;

  constructor() {
    const [info, boss, guest, h1, h2] = this.cats;
    const g = (place: NpcPlace, a: Npc, b: Npc, next: number): Group => ({ place, a, b, next, sc: null, li: 0, lineAt: 0, lineEnd: 0, n: 0, hist: new Int16Array(HISTORY).fill(-1) });
    this.groups.push(g('info', info, info, 6), g('interview', boss, guest, 3), g('lounge', h1, h2, 9));
  }

  /** Place the cats for this building. The interview room and the lounge bench are left out when too narrow. */
  setPlan(plan: BuildingLayout) {
    const room = plan.amenities.find((a) => a.kind === 'interview');
    const lounge = plan.amenities.find((a) => a.kind === 'lounge');
    const sig = (a?: { rect: { x: number; z: number; w: number }; side: string }) => (a ? `${a.rect.x.toFixed(2)}:${a.rect.z.toFixed(2)}:${a.rect.w.toFixed(2)}:${a.side}` : '');
    const key = `${plan.x0.toFixed(2)}:${plan.z0.toFixed(2)}:${sig(room)}:${sig(lounge)}`;
    if (key === this.key) return;
    this.key = key;
    const [info, boss, guest, h1, h2] = this.cats;
    const rc = (this.desk = receptionSpot(plan.x0, plan.z0));
    info.on = true;
    info.x = rc.x - 0.2;
    info.z = rc.z + 0.12;
    const put = (c: Npc, a: NonNullable<typeof room>, p: { x: number; z: number }, face: number) => {
      const [x, z] = toWorld({ x: a.rect.x, z: a.rect.z, yaw: a.side === 'north' ? 0 : Math.PI }, [p.x, p.z]);
      c.x = x;
      c.z = z + 0.1;
      c.bmin = a.rect.x - a.rect.w / 2 + 0.15;
      c.bmax = a.rect.x + a.rect.w / 2 - 0.15;
      c.face = face;
      c.look = face * 0.7;
    };
    const fits = !!room && room.rect.w >= INTERVIEW_MIN_W;
    boss.on = guest.on = fits;
    if (fits && room) {
      put(boss, room, INTERVIEW.boss, 0);
      put(guest, room, INTERVIEW.candidate, 0);
      const f = Math.sign(guest.x - boss.x) || 1;
      boss.face = f;
      guest.face = -f;
      boss.look = f * 0.7;
      guest.look = -f * 0.7;
    }
    const hires = !!lounge && lounge.rect.w >= NEWHIRE_MIN_W;
    h1.on = h2.on = hires;
    if (hires && lounge) {
      put(h1, lounge, NEWHIRES[0], 1);
      put(h2, lounge, NEWHIRES[1], -1);
      const f = Math.sign(h2.x - h1.x) || 1;
      h1.face = f;
      h2.face = -f;
      h1.look = f * 0.5;
      h2.look = -f * 0.5;
    }
  }

  /** Sort keys: feet depth of each cat, or a far-away value when it is not shown. */
  depth(i: number) {
    const c = this.cats[i];
    return c.on ? c.z : FAR;
  }

  count() {
    return this.cats.length;
  }

  // ---------------------------------------------------------------- frame

  update(t: number, elevOpen: number, reduced: boolean) {
    const [info, boss, guest, h1, h2] = this.cats;
    if (reduced) {
      if (!this.still) {
        this.still = true;
        for (const c of this.cats) {
          c.say = '';
          c.talk = c.hop = 0;
          c.status = 'working';
          c.act.cheer = c.act.sip = c.act.stretch = c.act.prop = 0;
        }
        for (const g of this.groups) g.sc = null;
        this.joyU = -1;
        // one short static line from the info cat, kept up by drawBubbles
        info.say = STILL_LINE;
        info.sayFor = 1;
      }
      return;
    }
    if (this.still) {
      this.still = false;
      info.say = '';
    }
    // ---- info cat: sways a little, waves now and then or when the elevator opens
    if (elevOpen > 0.6 && this.lastOpen <= 0.6 && t > this.waveUntil + 4) this.waveUntil = t + WAVE_LIFE;
    this.lastOpen = elevOpen;
    for (const g of this.groups) if (g.a.on) this.play(g, t);
    info.look = Math.sin(t * 0.45) * 0.55;
    info.status = t < this.waveUntil ? 'waiting' : 'working';
    this.fade(info, t);
    // ---- new hires on the lounge bench: glance around and fidget between lines
    if (h1.on) {
      for (const h of [h1, h2]) {
        h.look = h.face * 0.25 + Math.sin(t * 0.55 + h.seed * 7) * 0.7;
        h.hop = Math.max(h.hop, Math.max(0, Math.sin(t * 2.3 + h.seed * 11) - 0.92) * 0.35);
        this.fade(h, t);
      }
    }
    if (!boss.on) return;
    this.fade(boss, t);
    this.fade(guest, t);
    const g = this.groups[1];
    const speaker = g.sc && g.li > 0 ? g.sc[g.li - 1].slot : -1;
    boss.look = boss.face * (speaker === 1 ? 0.8 : 0.6 + Math.sin(t * 0.5) * 0.2);
    guest.look = guest.face * (speaker === 0 ? 0.8 : 0.5);
  }

  /** Run one group: wait, pick a scenario, then say its lines one by one at a human pace. */
  private play(g: Group, t: number) {
    const { a, b } = g;
    if (!g.sc) {
      if (t < g.next) return;
      const list = SCN[g.place];
      const alt = g.place !== 'info' && rnd(g.n, 5) < 0.25 ? SCN.banter : list;
      const base = alt === list ? PLACES.indexOf(g.place) : 3;
      let k = 0;
      let idx = 0;
      for (let tries = 0; tries < 8; tries++) {
        idx = Math.floor(rnd(g.n * 8 + tries, base + 11) * alt.length) % alt.length;
        k = base * 100 + idx;
        if (!g.hist.includes(k)) break;
      }
      g.hist[g.n % HISTORY] = k;
      g.sc = alt[idx];
      g.li = 0;
      g.lineEnd = t;
      g.n++;
    }
    if (t >= g.lineEnd) {
      // next line, or the scenario is over and a pause of 6 to 20 s follows
      if (g.li >= g.sc.length) {
        g.sc = null;
        g.next = t + 6 + rnd(g.n, 13) * 14;
        a.say = b.say = '';
        a.hop = b.hop = 0;
        a.act.cheer = b.act.cheer = a.act.sip = b.act.sip = a.act.stretch = b.act.stretch = a.act.prop = b.act.prop = 0;
        if (g.place === 'interview') this.joyU = -1;
        return;
      }
      const ln = g.sc[g.li];
      const dur = 1.6 + rnd(g.n, g.li + 17) * 1;
      const c = ln.slot ? b : a;
      c.say = '';
      this.say(c, ln.text, t, dur);
      g.lineAt = t;
      g.lineEnd = t + dur;
      g.li++;
    }
    // The line now being said: its action tag moves the speaker, the other cat nods along.
    const ln = g.sc[g.li - 1];
    const sp = ln.slot ? b : a;
    const li = sp === a ? b : a;
    const u = t - g.lineAt;
    a.hop = b.hop = 0;
    a.act.cheer = b.act.cheer = a.act.sip = b.act.sip = a.act.stretch = b.act.stretch = a.act.prop = b.act.prop = 0;
    if (sp !== li) li.hop = Math.max(0, Math.sin(t * 3.2)) * 0.03;
    if (g.place === 'interview') this.joyU = -1;
    switch (ln.tag) {
      case 'nod':
        sp.hop = Math.max(0, Math.sin(u * 7)) * 0.03;
        break;
      case 'hop':
        sp.hop = Math.abs(Math.sin(u * 7)) * 0.12 * Math.max(0, 1 - u * 0.4);
        break;
      case 'sip':
        sp.act.prop = 1;
        sp.act.sip = 1;
        break;
      case 'stretch':
        sp.act.stretch = 1;
        break;
      case 'cheer':
        sp.act.cheer = 1;
        sp.hop = Math.abs(Math.sin(u * 7)) * 0.16 * Math.max(0, 1 - u * 0.5);
        if (g.place === 'interview' && sp === b) this.joyU = u;
        break;
    }
  }

  /** Start a bubble unless one with the same text is already running. */
  private say(c: Npc, str: string, at: number, life: number) {
    if (c.say === str && at === c.sayAt) return;
    c.say = str;
    c.sayAt = at;
    c.sayFor = life;
  }

  /** Let an ended bubble go and drive the mouth. */
  private fade(c: Npc, t: number) {
    if (c.say && t - c.sayAt >= c.sayFor) c.say = '';
    c.talk = c.say ? 1 : 0;
  }

  // ---------------------------------------------------------------- drawing

  draw(ctx: Ctx, i: number, t: number, k: number, reduced: boolean) {
    const c = this.cats[i];
    if (!c.on) return;
    const tt = reduced ? 0 : t;
    drawCat(ctx, c, tt, k);
    ctx.save();
    ctx.translate(c.x, c.z - c.hop * k);
    ctx.scale(k, k);
    ctx.lineJoin = 'round';
    const headCY = -0.8 + 0.2 * c.sit;
    if (c.role === 'boss') this.formal(ctx, c, headCY);
    else if (c.role === 'guest' || c.role === 'hire') this.paper(ctx, c, tt);
    if (c.role === 'hire') this.tag(ctx);
    ctx.restore();
    if (c.role === 'info') this.counter(ctx);
  }

  /** Round glasses, a red tie and a clipboard. */
  private formal(ctx: Ctx, c: Npc, headCY: number) {
    const lx = c.look * 0.075;
    ctx.strokeStyle = '#3a3347';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    for (const s of [-1, 1]) {
      ctx.moveTo(s * 0.2 + lx + 0.12, headCY + 0.04);
      ctx.arc(s * 0.2 + lx, headCY + 0.04, 0.12, 0, Math.PI * 2);
    }
    ctx.moveTo(-0.08 + lx, headCY + 0.04);
    ctx.lineTo(0.08 + lx, headCY + 0.04);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.07, headCY + 0.46);
    ctx.lineTo(0.07, headCY + 0.46);
    ctx.lineTo(0.05, headCY + 0.7);
    ctx.lineTo(0, headCY + 0.76);
    ctx.lineTo(-0.05, headCY + 0.7);
    ctx.closePath();
    ctx.fillStyle = '#d6404f';
    ctx.fill();
    ctx.lineWidth = 0.025;
    ctx.strokeStyle = '#8f2433';
    ctx.stroke();
    // clipboard in the right hand
    ctx.save();
    ctx.translate(0.34, -0.1);
    ctx.rotate(-0.12);
    ctx.beginPath();
    ctx.roundRect(-0.13, -0.18, 0.26, 0.34, 0.03);
    ctx.fillStyle = '#b9835a';
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = '#7a5434';
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(-0.09, -0.13, 0.18, 0.26, 0.02);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.05, -0.05);
    ctx.lineTo(0.05, -0.05);
    ctx.moveTo(-0.05, 0.01);
    ctx.lineTo(0.05, 0.01);
    ctx.moveTo(-0.05, 0.07);
    ctx.lineTo(0.02, 0.07);
    ctx.lineWidth = 0.015;
    ctx.strokeStyle = '#9aa6bd';
    ctx.stroke();
    ctx.restore();
  }

  /** A sheet of paper in the lap that the candidate fidgets with. */
  private paper(ctx: Ctx, c: Npc, t: number) {
    ctx.save();
    ctx.translate(-0.3 + Math.sin(t * 1.3 + c.seed * 5) * 0.015, -0.1);
    ctx.rotate(0.2 + Math.sin(t * 1.9 + c.seed * 9) * 0.07);
    ctx.beginPath();
    ctx.roundRect(-0.09, -0.12, 0.18, 0.24, 0.02);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = '#c9b7a8';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.05, -0.05);
    ctx.lineTo(0.05, -0.05);
    ctx.moveTo(-0.05, 0.01);
    ctx.lineTo(0.05, 0.01);
    ctx.lineWidth = 0.015;
    ctx.strokeStyle = '#9aa6bd';
    ctx.stroke();
    ctx.restore();
  }

  /** A tiny name tag on the chest. */
  private tag(ctx: Ctx) {
    rbox(ctx, 0, -0.02, 0.4, 0.18, '#fff7e6', 0.07, { lw: 0.025, shadow: false });
    text(ctx, '신입', 0, -0.015, 0.13, '#5a3a40', { weight: 800 });
  }

  /** The desk is drawn again over the info cat's legs, with its name plate on top. */
  private counter(ctx: Ctx) {
    const d = this.desk;
    ctx.save();
    ctx.beginPath();
    ctx.rect(d.x - d.w / 2, d.z - 0.1, d.w, 0.6);
    ctx.clip();
    reception(ctx, d.x, d.z, d.w);
    ctx.restore();
    const dark = style.dark;
    rbox(ctx, d.x - 0.2, d.z + 0.3, 0.74, 0.28, dark ? '#3a3f55' : '#fff7e6', 0.1, { lw: 0.03, shadow: false });
    text(ctx, '안내', d.x - 0.2, d.z + 0.31, 0.2, dark ? '#ffe3a8' : '#5a3a40', { weight: 800 });
  }

  /** Speech bubbles and the pass sparkle, over everything. */
  drawBubbles(ctx: Ctx, t: number, k: number) {
    for (const c of this.cats) {
      if (!c.on || !c.say) continue;
      const u = this.still ? 0.5 : (t - c.sayAt) / c.sayFor;
      if (u < 0 || u > 1) continue;
      const alpha = Math.min(1, u / 0.08, (1 - u) / 0.15);
      if (c.sayOf !== c.say) {
        c.sayOf = c.say;
        c.sayW = 0;
        for (const line of c.say.split('\n')) c.sayW = Math.max(c.sayW, textWidth(ctx, line, 0.22, 800));
      }
      const lines = c.say.split('\n');
      const bw = (c.sayW + 0.34) * k;
      const lh = 0.27 * k;
      const bh = lh * lines.length + 0.2 * k;
      // Above the head, pulled in so it stays inside its room.
      const x = Math.max(Math.min(c.x, c.bmax - bw / 2), c.bmin + bw / 2);
      const bottom = c.z - (HEAD_TOP + 0.3 - 0.2 * c.sit + c.hop) * k;
      const y = bottom - bh / 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      const tx = c.x;
      ctx.moveTo(tx - 0.1 * k, bottom - 0.02 * k);
      ctx.lineTo(tx, bottom + 0.14 * k);
      ctx.lineTo(tx + 0.1 * k, bottom - 0.02 * k);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      rbox(ctx, x, y, bw, bh, '#ffffff', 0.2 * k, { lw: 0.035 * k, line: '#e2c9bd', shadow: false });
      for (const [i, line] of lines.entries()) text(ctx, line, x, y + (i - (lines.length - 1) / 2) * lh + 0.01 * k, 0.22 * k, '#5a3a40', { weight: 800 });
      ctx.restore();
    }
    // a few stars pop over the candidate who got the job
    const guest = this.cats[2];
    if (guest.on && this.joyU >= 0) {
      const u = Math.min(1, this.joyU / 1.6);
      for (let i = 0; i < 3; i++) {
        const a = -0.9 + i * 0.9 + u * 0.3;
        const r = (0.45 + u * 0.5) * k;
        ctx.globalAlpha = Math.max(0, 1 - u);
        star(ctx, guest.x + Math.sin(a) * r, guest.z - (1.0 + Math.cos(a) * 0.5 + u * 0.4) * k, 0.1 * k, a);
        ctx.fillStyle = rgba(i % 2 ? '#ffd23f' : '#ff9eb5', 1);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
}
