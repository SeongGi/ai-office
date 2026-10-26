// 실제 오피스에서 고양이들이 나누는 지어낸 대화의 짝과 시각을 고른다. 대사는 shared/chatter가 만든다.
// 화면에만 띄우고 서버나 직원 기록에는 남기지 않는다.
import type { WorldState } from '../../shared/protocol';
import { makeChat } from '../../shared/chatter';
import type { Agent2D } from './agent2d';

export interface ChatLine {
  from: string;
  to: string;
  text: string;
  /** 책상 대화는 종이비행기가 함께 날아간다. 쉬는 방은 바로 옆이라 말풍선만 띄운다. */
  plane: boolean;
}

interface Group {
  key: string;
  team: string | null;
  where: 'desk' | 'break';
  cats: Agent2D[];
}

/** 둘째 줄을 내보내기를 기다리는 대화. */
interface Pending {
  at: number;
  a: string;
  b: string;
  place: Agent2D['place'];
  line: ChatLine;
}

const SECOND_LINE_DELAY = 2.8;
const SPOKE_COOLDOWN = 40;
const REAL_QUIET = 30;
const MAX_ACTIVE = 2;
const FIRST_SEEN: [number, number] = [4, 10];
const DESK_EVERY: [number, number] = [30, 50];
const BREAK_EVERY: [number, number] = [18, 30];
const BREAK_ROOMS = new Set(['kitchen', 'games', 'lounge']);

export class Chatter2D {
  private nextAt = new Map<string, number>();
  private quietUntil = new Map<string, number>();
  private spoke = new Map<string, number>();
  private pending: Pending[] = [];
  private checkAt = 0;

  constructor(private rnd: () => number = Math.random) {}

  private between([lo, hi]: [number, number]) {
    return lo + (hi - lo) * this.rnd();
  }

  /** 1초에 한 번 후보를 보고, 시각이 된 줄을 emit으로 내보낸다. t는 World2D의 elapsed(초). */
  update(t: number, state: WorldState, agents: Map<string, Agent2D>, emit: (line: ChatLine) => void) {
    this.flush(t, state, agents, emit);
    if (t < this.checkAt) return;
    this.checkAt = t + 1;

    const groups = this.groups(t, state, agents);
    const seen = new Set<string>();
    for (const g of groups) {
      seen.add(g.key);
      if (!this.nextAt.has(g.key)) {
        this.nextAt.set(g.key, t + this.between(FIRST_SEEN));
        continue;
      }
      if (t < this.nextAt.get(g.key)!) continue;
      if (this.pending.length >= MAX_ACTIVE) continue;
      const quiet = g.team ? this.quietUntil.get(g.team) : undefined;
      if (g.where === 'desk' && quiet !== undefined && t < quiet) {
        this.nextAt.set(g.key, quiet);
        continue;
      }
      this.nextAt.set(g.key, t + this.between(g.where === 'desk' ? DESK_EVERY : BREAK_EVERY));
      this.start(g, t, state, emit);
    }
    for (const key of [...this.nextAt.keys()]) if (!seen.has(key)) this.nextAt.delete(key);
  }

  /** 실제 message가 오가면 부른다. 보낸 팀과 받는 팀의 책상 대화를 잠시 쉬고, 두 고양이를 방금 말한 것으로 친다. */
  noteRealMessage(fromId: string, toId: string, teams: string[], t: number) {
    for (const team of teams) this.quietUntil.set(team, t + REAL_QUIET);
    this.spoke.set(fromId, t);
    this.spoke.set(toId, t);
  }

  /** 떠난 고양이를 잊는다. 진행 중인 대화에 끼어 있으면 그 대화를 버린다. */
  forget(id: string) {
    this.spoke.delete(id);
    this.pending = this.pending.filter((p) => p.a !== id && p.b !== id);
  }

  clear() {
    this.nextAt.clear();
    this.quietUntil.clear();
    this.spoke.clear();
    this.pending = [];
    this.checkAt = 0;
  }

  /** 대화할 수 있는 고양이를 책상 무리(팀과 장소별)와 쉬는 방 무리로 묶는다. 둘 이상인 무리만 돌려준다. */
  private groups(t: number, state: WorldState, agents: Map<string, Agent2D>): Group[] {
    const busy = new Set<string>();
    for (const p of this.pending) {
      busy.add(p.a);
      busy.add(p.b);
    }
    const map = new Map<string, Group>();
    for (const [id, cat] of agents) {
      const data = state.agents[id];
      if (!data || data.status === 'offline' || cat.leaving || cat.farewell || busy.has(id)) continue;
      if (cat.mode !== 'seated' && cat.mode !== 'standing') continue;
      if (t - (this.spoke.get(id) ?? -Infinity) < SPOKE_COOLDOWN) continue;
      let key: string;
      let where: 'desk' | 'break';
      let team: string | null = null;
      if (cat.place === 'desk' || (cat.place === 'meeting' && !state.meeting)) {
        where = 'desk';
        team = cat.team;
        key = `desk:${cat.team}:${cat.place}`;
      } else if (BREAK_ROOMS.has(cat.place)) {
        where = 'break';
        key = `break:${cat.place}`;
      } else continue;
      let g = map.get(key);
      if (!g) map.set(key, (g = { key, team, where, cats: [] }));
      g.cats.push(cat);
    }
    return [...map.values()].filter((g) => g.cats.length >= 2);
  }

  private start(g: Group, t: number, state: WorldState, emit: (line: ChatLine) => void) {
    const i = Math.min(g.cats.length - 1, Math.floor(this.rnd() * g.cats.length));
    const rest = g.cats.filter((_, k) => k !== i);
    const a = g.cats[i];
    const b = rest[Math.min(rest.length - 1, Math.floor(this.rnd() * rest.length))];
    const chat = makeChat(state.agents[a.id], state.agents[b.id], {
      rnd: this.rnd,
      teamTaskA: state.teams[a.team]?.task,
      teamTaskB: state.teams[b.team]?.task,
      where: g.where,
    });
    if (!chat) return;
    const plane = g.where === 'desk';
    emit({ ...chat[0], plane });
    this.spoke.set(a.id, t);
    this.spoke.set(b.id, t);
    this.pending.push({ at: t + SECOND_LINE_DELAY, a: a.id, b: b.id, place: a.place, line: { ...chat[1], plane } });
  }

  /** 때가 된 둘째 줄을 내보낸다. 두 고양이가 그대로 있을 때만이고, 아니면 대화를 버린다. */
  private flush(t: number, state: WorldState, agents: Map<string, Agent2D>, emit: (line: ChatLine) => void) {
    if (!this.pending.length) return;
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (t < p.at) {
        keep.push(p);
        continue;
      }
      const ok = [p.a, p.b].every((id) => {
        const cat = agents.get(id);
        return cat && !cat.leaving && !cat.farewell && cat.place === p.place && state.agents[id]?.status !== 'offline';
      });
      if (ok) emit(p.line);
    }
    this.pending = keep;
  }
}
