import type { WorldState } from '../../shared/protocol';
import type { ToolState } from '../../shared/places';
import { buildRoster, buildRows, createTally, GUIDE_PLACES, liveRoomCounts, observeTools, ROOM_INFO, TOOL_CLASSES, type GuidePlace, type ToolClass } from '../../shared/sidepanel';
import { teamAccent } from '../world/palette';
import { STATUS_LABEL_KO } from './labels';

const STORE_KEY = 'agent-floor.sidePanel';
const TIMELINE_KEY = 'agent-floor.sidePanel.timeline';
const NARROW_PX = 900;

export const PANEL_KO = {
  title: '오늘의 사무실',
  tools: '도구 사용 횟수',
  guide: '도구 방 안내',
  roster: '직원',
  rosterEmpty: '지금 일하는 직원이 없어요',
  moreSubs: (n: number) => `서브 ${n}명 더 있어요`,
  timeline: '최근 활동',
  empty: '아직 활동이 없어요',
  toggle: '오늘의 사무실 열고 닫기',
};

const TOOL_KO: Record<ToolClass, string> = { library: '자료실', server: '서버실', search: '정보검색실', other: '책상' };

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function loadTimelineOpen(): boolean {
  try {
    return localStorage.getItem(TIMELINE_KEY) === '1';
  } catch {
    return false;
  }
}

function loadOpen(): boolean {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    // 저장소를 못 읽으면 화면 너비로 정한다.
  }
  return window.innerWidth >= NARROW_PX;
}

/** 오른쪽 접이식 패널. 상태 갱신마다 도구 횟수만 세고, 그리기는 1초에 한 번만 한다. */
export class SidePanel {
  readonly root = document.createElement('aside');
  private tally = createTally();
  private state: WorldState | null = null;
  private toolsBox = document.createElement('div');
  private guide = document.createElement('details');
  private guideRows = document.createElement('div');
  private dwell = new Map<string, ToolState>();
  private live: Record<GuidePlace, number> = { library: 0, server: 0, search: 0, desk: 0 };
  private rosterBox = document.createElement('div');
  private timeline = document.createElement('details');
  private list = document.createElement('ol');
  private key = '';
  private open: boolean;

  constructor(private onSelect: (id: string) => void, private onToggle: (open: boolean) => void) {
    this.root.className = 'side-panel glass';
    this.root.setAttribute('aria-label', PANEL_KO.title);
    this.toolsBox.className = 'sp-tools';
    this.list.className = 'sp-list';
    this.rosterBox.className = 'sp-roster';
    this.root.innerHTML = `<h2>${PANEL_KO.title}</h2><h3>${PANEL_KO.roster}</h3>`;
    this.root.append(this.rosterBox);
    this.root.insertAdjacentHTML('beforeend', `<h3>${PANEL_KO.tools}</h3>`);
    this.timeline.className = 'sp-timeline';
    this.timeline.open = loadTimelineOpen();
    const ts = document.createElement('summary');
    ts.textContent = PANEL_KO.timeline;
    this.timeline.append(ts, this.list);
    this.timeline.addEventListener('toggle', () => {
      try {
        localStorage.setItem(TIMELINE_KEY, this.timeline.open ? '1' : '0');
      } catch {
        // 저장하지 못해도 이번 화면에서는 바뀐다.
      }
    });
    this.guide.className = 'sp-guide';
    this.guide.open = true;
    const gs = document.createElement('summary');
    gs.textContent = PANEL_KO.guide;
    this.guideRows.className = 'sp-guide-rows';
    this.guide.append(gs, this.guideRows);
    this.guideRows.innerHTML = GUIDE_PLACES.map(
      (p) => `<div class="sp-tool sp-place"><span class="sp-tool-name">${ROOM_INFO[p].name}</span><span class="sp-plain">${ROOM_INFO[p].plain}</span><b data-place="${p}">0</b></div>`,
    ).join('');
    this.root.append(this.toolsBox, this.guide, this.timeline);
    const pick = (e: Event) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-id]');
      if (b?.dataset.id) this.onSelect(b.dataset.id);
    };
    this.list.addEventListener('click', pick);
    this.rosterBox.addEventListener('click', pick);
    this.open = loadOpen();
    this.apply();
    window.setInterval(() => this.render(), 1000);
  }

  isOpen() {
    return this.open;
  }

  toggle() {
    this.open = !this.open;
    try {
      localStorage.setItem(STORE_KEY, this.open ? '1' : '0');
    } catch {
      // 저장하지 못해도 이번 화면에서는 바뀐다.
    }
    this.apply();
    this.render();
  }

  private apply() {
    this.root.classList.toggle('show', this.open);
    this.onToggle(this.open);
  }

  /** 상태가 바뀔 때마다 부른다. 세기만 하고 그리지는 않는다. */
  observe(state: WorldState) {
    this.state = state;
    observeTools(this.tally, state.agents);
    this.live = liveRoomCounts(this.dwell, state.agents, Date.now());
    if (!this.key) this.render();
  }

  private render() {
    if (!this.open || !this.state) return;
    const counts = this.tally.counts;
    this.live = liveRoomCounts(this.dwell, this.state.agents, Date.now());
    const rows = buildRows(this.state, Date.now());
    const roster = buildRoster(this.state, Date.now());
    const key = roster.map((m) => [m, ...m.subs].map((r) => `${r.id}:${r.name}:${r.status}:${r.role}:${r.doing}:${r.rel}`).join('~') + m.moreSubs).join(',') + '#' + TOOL_CLASSES.map((c) => counts[c]).join(',') + '|' + GUIDE_PLACES.map((p) => this.live[p]).join(',') + '|' + rows.map((r) => `${r.agentId}:${r.ts}:${r.rel}:${r.name}:${r.hue}`).join(',');
    if (key === this.key) return;
    this.key = key;
    const pill = (st: keyof typeof STATUS_LABEL_KO) => `<span class="sp-pill sp-st-${st}">${esc(STATUS_LABEL_KO[st])}</span>`;
    this.rosterBox.innerHTML = roster.length
      ? roster
          .map(
            (m) =>
              `<div class="sp-person"><button type="button" class="sp-row" data-id="${esc(m.id)}"><span class="sp-dot" style="background:${teamAccent(m.hue).getStyle()}"></span><span class="sp-main"><span class="sp-head"><span class="sp-who">${esc(m.name)}</span><span class="sp-chip">${esc(m.role)}</span>${pill(m.status)}</span><span class="sp-text">${esc(m.doing)}</span></span></button>${m.subs
                .map(
                  (s) =>
                    `<button type="button" class="sp-row sp-sub" data-id="${esc(s.id)}"><span class="sp-main"><span class="sp-head"><span class="sp-who">${esc(s.name)}</span>${pill(s.status)}</span><span class="sp-text">${esc(s.doing)}</span></span></button>`,
                )
                .join('')}${m.moreSubs ? `<div class="sp-more">${esc(PANEL_KO.moreSubs(m.moreSubs))}</div>` : ''}</div>`,
          )
          .join('')
      : `<div class="sp-empty">${PANEL_KO.rosterEmpty}</div>`;
    const max = Math.max(1, ...TOOL_CLASSES.map((c) => counts[c]));
    this.toolsBox.innerHTML = TOOL_CLASSES.map(
      (c) => `<div class="sp-tool"><span class="sp-tool-name">${TOOL_KO[c]}</span><span class="sp-bar"><i style="width:${Math.round((counts[c] / max) * 100)}%"></i></span><b>${counts[c]}</b></div>`,
    ).join('');
    for (const b of this.guideRows.querySelectorAll<HTMLElement>('b[data-place]')) b.textContent = String(this.live[b.dataset.place as GuidePlace]);
    this.list.innerHTML = rows.length
      ? rows
          .map(
            (r) =>
              `<li><button type="button" data-id="${esc(r.agentId)}"><span class="sp-dot" style="background:${teamAccent(r.hue).getStyle()}"></span><span class="sp-main"><span class="sp-who">${esc(r.name)}</span><span class="sp-text">${esc(r.text)}</span></span><time>${r.rel}</time></button></li>`,
          )
          .join('')
      : `<li class="sp-empty">${PANEL_KO.empty}</li>`;
  }
}
