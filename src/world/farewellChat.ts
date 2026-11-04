// Who says what while the cats gather in the corridor for a retiring employee. One scenario at a time, one
// line at a time (1.6 to 2.6 s), a pause between scenarios. Both worlds ask it who speaks; it draws nothing.
import { fillName, GOODBYES, pickFarewell } from '../../shared/farewellScripts.js';

const PAUSE_MIN = 1.2;
const PAUSE_MAX = 3.2;
const FIRST_DELAY = 2.2;
const HISTORY = 5;

interface Said {
  id: string;
  text: string;
  at: number;
  dur: number;
}

export class FarewellChat {
  private name = '';
  private last: Said | null = null;
  private bye: Said | null = null;
  private byeDone = false;
  private sc: readonly (readonly [number, string])[] | null = null;
  private cast: string[] = [];
  private li = 0;
  private lineEnd = 0;
  private next = 0;
  private active = false;
  private hist: number[] = [];
  private lastText = '';
  private seed: number;

  constructor(seed = 1) {
    this.seed = seed >>> 0 || 1;
  }

  private rng = () => {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  };

  /** The leaving cat's name, said inside some lines. */
  setLeaver(name: string) {
    this.name = name;
  }

  /** `ids` are the cats standing in the gathering, in a stable order. Call once a frame. */
  update(t: number, on: boolean, ids: readonly string[]) {
    if (!on) {
      if (this.active) this.stop();
      return;
    }
    if (!this.active) {
      this.active = true;
      this.byeDone = false;
      this.next = t + FIRST_DELAY;
    }
    if (this.last && t - this.last.at >= this.last.dur) this.last = null;
    if (this.bye && t - this.bye.at >= this.bye.dur) this.bye = null;
    if (!ids.length) return;
    if (!this.sc) {
      if (t < this.next) return;
      const pick = pickFarewell(this.rng, this.hist);
      this.hist.push(pick.id);
      if (this.hist.length > HISTORY) this.hist.shift();
      this.sc = pick.lines;
      this.cast = [];
      // each slot maps to its own cat while there are enough cats, then they double up
      const start = Math.floor(this.rng() * ids.length);
      for (let s = 0; s < 4; s++) this.cast.push(ids[(start + s) % ids.length]);
      this.li = 0;
      this.lineEnd = t;
    }
    if (t < this.lineEnd) return;
    if (this.li >= this.sc.length) {
      this.sc = null;
      this.last = null;
      this.next = t + PAUSE_MIN + this.rng() * (PAUSE_MAX - PAUSE_MIN);
      return;
    }
    const [slot, str] = this.sc[this.li++];
    const dur = 1.6 + this.rng();
    const id = ids.includes(this.cast[slot]) ? this.cast[slot] : ids[slot % ids.length];
    const text = fillName(str, this.name);
    this.lastText = text;
    this.last = { id, text, at: t, dur };
    this.lineEnd = t + dur;
  }

  /** The leaving cat says one goodbye line, once per gathering. Returns false when it was already said. */
  sayBye(id: string, t: number) {
    if (this.byeDone) return false;
    this.byeDone = true;
    const pool = GOODBYES.filter((g) => g !== this.lastText);
    this.bye = { id, text: pool[Math.floor(this.rng() * pool.length)], at: t, dur: 2.2 };
    return true;
  }

  /** The text this cat is saying now, '' when quiet. */
  textFor(id: string): string {
    if (this.last?.id === id) return this.last.text;
    if (this.bye?.id === id) return this.bye.text;
    return '';
  }

  /** Seconds since the cat's current line began (for fades), or -1. */
  ageOf(id: string, t: number): number {
    const s = this.last?.id === id ? this.last : this.bye?.id === id ? this.bye : null;
    return s ? t - s.at : -1;
  }

  durOf(id: string): number {
    return (this.last?.id === id ? this.last : this.bye?.id === id ? this.bye : null)?.dur ?? 0;
  }

  private stop() {
    this.active = false;
    this.sc = null;
    this.last = null;
    this.bye = null;
  }
}
