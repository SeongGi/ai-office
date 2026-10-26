// Decor cats that are not agents: the info cat at the lobby reception and the interview corner in the kitchen.
// They are not in WorldState, cannot be picked and cost the server nothing. Every move is a pure function of
// the clock, so nothing here allocates per frame. With reduced motion they hold one static pose and stay quiet.
import { LOBBY_WIDTH, toWorld, type BuildingLayout } from '../world/layout';
import { drawCat, HEAD_TOP, type CatAct, type CatView } from './cat';
import { rgba } from './color';
import { rbox, star, style, text, textWidth } from './draw';
import { INTERVIEW, INTERVIEW_MIN_W, reception } from './furniture';
import { EYE_IRIS, catFurFor, hash, shirtFor } from './palette2d';

type Ctx = CanvasRenderingContext2D;

/** Where the lobby reception desk stands. The lobby scene and the info cat both read this. */
export function receptionSpot(x0: number, z0: number) {
  return { x: x0 + LOBBY_WIDTH / 2 - 1.3, z: z0 + 3.6, w: 3.2 };
}

type Role = 'info' | 'boss' | 'guest' | 'wait';

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
}

const INFO_LINES = ['어서 오세요,\n성기 주식회사예요', '오늘도 다들\n열일 중이에요', '회의는\n저쪽이에요', '엘리베이터는\n이쪽이에요'];
const BUBBLE_LIFE = 3.6;
const WAVE_LIFE = 1.8;

/** One interview round: who speaks (0 interviewer, 1 candidate), when, what, and for how long. The last one is the verdict. */
const CYCLE = 34;
const TALK: { who: 0 | 1; at: number; text: string; dur: number }[] = [
  { who: 0, at: 1, text: '자기소개\n부탁드려요', dur: 3.4 },
  { who: 1, at: 6, text: '고양이 사료\n경력 3년입니다', dur: 3.6 },
  { who: 0, at: 12, text: '우리 회사를\n고른 이유는요?', dur: 3.4 },
  { who: 1, at: 17, text: '밥이\n맛있어서요', dur: 3.2 },
];
const VERDICT_AT = 23;
const VERDICT_FOR = 3.4;
const PASS = '합격이에요!';
const LATER = '연락\n드릴게요';
const THANKS = '감사합니다!';

const FAR = 1e9;

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
    act: { prop: 0, side: 1, sip: 0, swing: 0, stretch: 0, cheer: 0 },
    say: '',
    sayAt: 0,
    sayFor: 0,
    sayW: 0,
    sayOf: '',
  };
}

export class Npcs {
  /** info cat, interviewer, candidate in the chair, then the one waiting. */
  private cats = [make('npc-안내', 'info'), make('npc-면접관', 'boss'), make('npc-지원자-1', 'guest'), make('npc-지원자-2', 'wait')];
  private key = '';
  private desk = { x: 0, z: 0, w: 0 };
  private infoNext = 6;
  private infoN = 0;
  /** Seconds into the pass celebration, or -1. */
  private joyU = -1;
  private waveUntil = -1;
  private lastOpen = 0;
  private still = false;

  /** Place the cats for this building. The interview corner is left out when the kitchen is too narrow. */
  setPlan(plan: BuildingLayout) {
    const kitchen = plan.amenities.find((a) => a.kind === 'kitchen');
    const key = `${plan.x0.toFixed(2)}:${plan.z0.toFixed(2)}:${kitchen ? `${kitchen.rect.x.toFixed(2)}:${kitchen.rect.z.toFixed(2)}:${kitchen.rect.w.toFixed(2)}:${kitchen.side}` : ''}`;
    if (key === this.key) return;
    this.key = key;
    const [info, boss, guest, w1] = this.cats;
    const rc = (this.desk = receptionSpot(plan.x0, plan.z0));
    info.on = true;
    info.x = rc.x - 0.2;
    info.z = rc.z + 0.12;
    const fits = !!kitchen && kitchen.rect.w >= INTERVIEW_MIN_W;
    for (const c of [boss, guest, w1]) c.on = fits;
    if (!fits || !kitchen) return;
    const frame = { x: kitchen.rect.x, z: kitchen.rect.z, yaw: kitchen.side === 'north' ? 0 : Math.PI };
    const put = (c: Npc, p: { x: number; z: number }, look: number) => {
      const [x, z] = toWorld(frame, [p.x, p.z]);
      c.x = x;
      c.z = z + 0.1;
      c.look = look;
    };
    put(boss, INTERVIEW.boss, -0.7);
    put(guest, INTERVIEW.candidate, 0.7);
    put(w1, INTERVIEW.waiting[0], 0.6);
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
    const [info, boss, guest, w1] = this.cats;
    if (reduced) {
      if (!this.still) {
        this.still = true;
        for (const c of this.cats) {
          c.say = '';
          c.talk = c.hop = 0;
          c.status = 'working';
          c.act.cheer = 0;
        }
        this.joyU = -1;
      }
      return;
    }
    this.still = false;
    // ---- info cat: sways a little, waves now and then or when the elevator opens, speaks every 20 to 40 s
    if (elevOpen > 0.6 && this.lastOpen <= 0.6 && t > this.waveUntil + 4) this.waveUntil = t + WAVE_LIFE;
    this.lastOpen = elevOpen;
    if (t >= this.infoNext) {
      const n = this.infoN++;
      this.say(info, INFO_LINES[n % INFO_LINES.length], t, BUBBLE_LIFE);
      if (n % 2 === 0) this.waveUntil = t + WAVE_LIFE;
      this.infoNext = t + 20 + rnd(n, 3) * 20;
    }
    info.look = Math.sin(t * 0.45) * 0.55;
    info.status = t < this.waveUntil ? 'waiting' : 'working';
    this.fade(info, t);
    if (!boss.on) return;
    // ---- interview
    const cycle = Math.floor(t / CYCLE);
    const p = t - cycle * CYCLE;
    boss.say = guest.say = '';
    let speaker = -1;
    for (const e of TALK) {
      if (p >= e.at && p < e.at + e.dur) {
        this.say(e.who ? guest : boss, e.text, t - (p - e.at), e.dur);
        speaker = e.who;
      }
    }
    const pass = cycle % 2 === 0;
    const verdict = p >= VERDICT_AT && p < VERDICT_AT + VERDICT_FOR;
    if (verdict) {
      const u = p - VERDICT_AT;
      if (u < 1.8) this.say(boss, pass ? PASS : LATER, t - u, 1.8);
      else this.say(guest, pass ? THANKS : '', t - (u - 1.8), VERDICT_FOR - 1.8);
      speaker = u < 1.8 ? 0 : 1;
    }
    this.fade(boss, t);
    this.fade(guest, t);
    // The listener nods; the speaker's mouth moves.
    const nod = (c: Npc, on: boolean, phase: number) => {
      c.hop = on ? Math.max(0, Math.sin(t * 3.2 + phase)) * 0.03 : 0;
    };
    nod(boss, speaker === 1, 0);
    nod(guest, speaker === 0, 1);
    const joy = verdict && pass && p - VERDICT_AT > 1.6;
    const u = p - VERDICT_AT - 1.6;
    this.joyU = joy ? u : -1;
    guest.act.cheer = joy ? 1 : 0;
    if (joy) guest.hop = Math.abs(Math.sin(u * 7)) * 0.16 * Math.max(0, 1 - u * 0.5);
    // The waiting candidate glances at the table now and then and claps for a pass.
    w1.look = Math.sin(t * 0.35 + w1.seed * 6) > 0.4 ? 0.9 : 0.4;
    w1.hop = joy ? Math.abs(Math.sin(u * 6)) * 0.07 : 0;
    w1.act.cheer = joy ? 0.5 : 0;
    boss.look = speaker === 1 ? -0.8 : -0.6 + Math.sin(t * 0.5) * 0.2;
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
    else if (c.role === 'guest' || c.role === 'wait') this.paper(ctx, c, tt);
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
      const u = (t - c.sayAt) / c.sayFor;
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
      // The two at the table keep their bubbles above and away from each other, and inside the wall.
      const x = c.role === 'boss' ? c.x - (bw / 2 - 0.3 * k) : c.role === 'guest' ? c.x + (bw / 2 - 0.5 * k) : c.x;
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
