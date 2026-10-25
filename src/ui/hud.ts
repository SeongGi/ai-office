import type { Agent, WorldState } from '../../shared/protocol';
import type { ConnectionMode } from '../core/store';
import type { Anchor } from '../world/World';
import { looksFor, shirtFor, sourceLabel, STATUS_COLORS, teamAccent } from '../world/palette';
import { CARD_KO, PILL_KO, PILL_MEETING_KO, pillDetail, STATUS_LABEL_KO as STATUS_LABEL } from './labels';
import { meetingCovers } from '../../shared/places';
import { controlAllowed, dismissAgent, renameAgent, sendInstruction } from '../core/connection';
import pencil from '@phosphor-icons/core/assets/regular/pencil-simple.svg?raw';
import { icon } from './icons';
import { REPO_URL } from '../config';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}

interface Tag {
  root: HTMLDivElement;
  /** Last values written to the DOM, so unchanged frames cost nothing. */
  last: { t: string; o: string; z: string; near: boolean; sel: boolean };
  name: HTMLElement;
  role: HTMLElement;
  dot: HTMLElement;
  activity: HTMLElement;
  pill: HTMLElement;
  leader: HTMLElement;
  key: string;
  /** Layout box (unscaled px) and the part of it that is visible when the activity line is hidden. */
  w: number;
  h: number;
  visH: number;
  dirty: boolean;
  compact: boolean;
  /** Per frame: anchor point, scale, and the declutter result (target and smoothed offset). */
  show: boolean;
  shown: boolean;
  hot: boolean;
  near: boolean;
  ax: number;
  ay: number;
  s: number;
  vh: number;
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  leaderKey: string;
}

/** Tags switch to the name-only form beyond this depth (and back below the lower one). */
const COMPACT_ON = 20;
const COMPACT_OFF = 17;
const PAD = 3;

interface Bubble {
  root: HTMLDivElement;
  until: number;
}

export interface HudActions {
  select(id: string | null): void;
  focusTeam(id: string): void;
  frameAll(): void;
  toggleTheme(): void;
  startDemo(): void;
}

const SETUP: Record<string, { title: string; steps: { label: string; code: string }[]; note: string }> = {
  claude: {
    title: 'Claude Code',
    steps: [
      { label: '설치하기', code: 'npm i -g agent-floor' },
      { label: '~/.claude/settings.json에 훅 추가하기', code: 'agent-floor setup claude --write' },
    ],
    note: '세션이 시작되면 성기 주식회사가 저절로 열려요. 세션마다 프로젝트 폴더 이름의 사무실이 생기고, 서브에이전트는 들어와서 설명을 듣고 결과를 보고해요.',
  },
  codex: {
    title: 'Codex',
    steps: [
      { label: '설치하기', code: 'npm i -g agent-floor' },
      { label: '~/.codex/config.toml에 넣을 notify 줄 출력하기', code: 'agent-floor setup codex' },
    ],
    note: 'Codex는 매 차례가 끝날 때 알려 줘요. 그래서 책상은 답변 한 번에 한 번씩 바뀌어요.',
  },
  cursor: {
    title: 'Cursor',
    steps: [
      { label: '설치하기', code: 'npm i -g agent-floor' },
      { label: '~/.cursor/hooks.json에 훅 추가하기', code: 'agent-floor setup cursor --write' },
    ],
    note: '성기 주식회사는 듣기만 해요. 권한 요청에 대신 답하는 일은 절대 없어요.',
  },
  http: {
    title: '그 밖의 도구',
    steps: [
      { label: '오피스 켜기', code: 'npx agent-floor' },
      {
        label: '아무 언어로나 이벤트 보내기',
        code: `curl -X POST localhost:4317/events \\\n  -H 'content-type: application/json' \\\n  -d '{"type":"tool","agent":"bot-1","team":"Payments","tool":"Bash","activity":"테스트 돌리는 중"}'`,
      },
    ],
    note: '이벤트 종류: join, status, tool, message, task, leave. 자세한 내용은 docs/protocol.md를 봐 주세요.',
  },
};

export class Hud {
  private root = el('div', 'hud');
  private tagsLayer = el('div', 'tags');
  private bubblesLayer = el('div', 'bubbles');
  private tags = new Map<string, Tag>();
  private bubbles = new Map<string, Bubble>();
  private modePill = el('div', 'mode');
  private demoNote = el('div', 'demo-note glass');
  private teamsDock = el('nav', 'teams glass');
  private card = el('aside', 'card glass');
  private sheet = el('div', 'sheet-wrap');
  private empty = el('div', 'empty glass');
  private themeBtn: HTMLButtonElement;
  private teamsKey = '';
  private cardKey = '';
  private leaveArmedAt = 0;
  private sendArmedAt = 0;
  /** 직원마다 쓰던 지시 글, 결과 한 줄, 서버가 막은 이유. 카드를 다시 그려도 남는다. */
  private drafts = new Map<string, string>();
  private sendNotes = new Map<string, string>();
  private sendBlocked = new Map<string, string>();
  private sending = new Set<string>();
  /** 이름을 고치는 중인 직원. 고치는 동안에는 입력칸이 지워지지 않도록 카드를 다시 그리지 않는다. */
  private editing: string | null = null;
  private state: WorldState | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  private mode: ConnectionMode = 'connecting';
  private live: Tag[] = [];
  private rects: number[] = [];
  private frameAt = 0;

  constructor(container: HTMLElement, private actions: HudActions) {
    this.root.append(this.tagsLayer, this.bubblesLayer);

    // Top bar
    const top = el('header', 'topbar');
    const brand = el('div', 'brand glass');
    brand.innerHTML = `<span class="mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="brand-name">성기 주식회사</span>`;
    brand.append(this.modePill);
    const tools = el('div', 'tools glass');
    const btn = (name: Parameters<typeof icon>[0], label: string, fn: () => void) => {
      const b = el('button', 'icon-btn', icon(name)) as HTMLButtonElement;
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', fn);
      tools.append(b);
      return b;
    };
    btn('cornersOut', '모두 보기 (F)', () => actions.frameAll());
    this.themeBtn = btn('moon', '테마 바꾸기 (T)', () => actions.toggleTheme());
    btn('plug', '에이전트 연결하기', () => this.openSheet());
    const gh = el('a', 'icon-btn', icon('github')) as HTMLAnchorElement;
    gh.href = REPO_URL;
    gh.target = '_blank';
    gh.rel = 'noreferrer';
    gh.setAttribute('aria-label', 'GitHub에서 소스 보기');
    gh.title = 'GitHub에서 소스 보기';
    tools.append(gh);
    top.append(brand, tools);

    this.demoNote.innerHTML = `<span>지금은 데모 오피스를 보고 있어요.</span>`;
    const connect = el('button', 'link-btn', '에이전트 연결하기') as HTMLButtonElement;
    connect.type = 'button';
    connect.addEventListener('click', () => this.openSheet());
    this.demoNote.append(connect);

    const hint = el('div', 'hint', '<span>드래그해서 이동</span><span>오른쪽 드래그로 회전</span><span>스크롤해서 확대</span><span>누구든 클릭해 보세요</span>');

    this.empty.innerHTML = `<h2>오피스가 텅 비었어요</h2><p>훅을 설치한 에이전트를 시작하면 걸어 들어와서 책상에 앉아요.</p>`;
    const emptyActions = el('div', 'row');
    const e1 = el('button', 'btn primary', `${icon('plug')}<span>연결하기</span>`) as HTMLButtonElement;
    e1.type = 'button';
    e1.addEventListener('click', () => this.openSheet());
    const e2 = el('button', 'btn', `${icon('play')}<span>데모 보기</span>`) as HTMLButtonElement;
    e2.type = 'button';
    e2.addEventListener('click', () => actions.startDemo());
    emptyActions.append(e1, e2);
    this.empty.append(emptyActions);

    this.card.setAttribute('aria-live', 'polite');
    this.buildSheet();
    this.root.append(top, this.demoNote, this.teamsDock, this.card, this.empty, hint, this.sheet);
    container.append(this.root);

    this.bindKeys();
    // Tag sizes depend on the font: measure again once it has loaded.
    document.fonts?.ready.then(() => this.tags.forEach((t) => (t.dirty = true)));
  }

  // ---------------------------------------------------------------- state

  setTheme(dark: boolean) {
    this.themeBtn.innerHTML = icon(dark ? 'sun' : 'moon');
  }

  setMode(mode: ConnectionMode) {
    this.mode = mode;
    const label = { live: '실시간', demo: '데모', connecting: '연결 중', offline: '연결 끊김' }[mode];
    this.modePill.className = `mode ${mode}`;
    this.modePill.innerHTML = `<span class="pulse" aria-hidden="true"></span>${label}`;
    this.root.classList.toggle('is-demo', mode === 'demo');
    this.updateEmpty();
  }

  setState(state: WorldState, selected: string | null) {
    this.state = state;
    this.selected = selected;
    this.renderTeams();
    this.renderCard();
    this.updateEmpty();
  }

  setHovered(id: string | null) {
    this.hovered = id;
  }

  private updateEmpty() {
    const count = this.state ? Object.keys(this.state.agents).length : 0;
    this.empty.classList.toggle('show', this.mode === 'live' && count === 0);
  }

  // ---------------------------------------------------------------- teams dock

  private renderTeams() {
    const s = this.state!;
    const teams = Object.values(s.teams).sort((a, b) => a.order - b.order);
    const counts = new Map<string, number>();
    const attention = new Map<string, boolean>();
    for (const a of Object.values(s.agents)) {
      counts.set(a.team, (counts.get(a.team) || 0) + 1);
      if (a.status === 'waiting' || a.status === 'error') attention.set(a.team, true);
    }
    const key = teams.map((t) => `${t.id}:${t.name}:${counts.get(t.id)}:${attention.get(t.id) ? 1 : 0}`).join('|');
    if (key === this.teamsKey) return;
    this.teamsKey = key;
    this.teamsDock.innerHTML = '';
    this.teamsDock.classList.toggle('show', teams.length > 0);
    for (const t of teams) {
      const b = el('button', 'team-chip') as HTMLButtonElement;
      b.type = 'button';
      b.innerHTML = `<span class="swatch" style="background:${teamAccent(t.hue).getStyle()}"></span><span class="team-name">${esc(t.name)}</span><span class="count">${counts.get(t.id) || 0}</span>${attention.get(t.id) ? '<span class="flag" title="도움이 필요한 친구가 있어요"></span>' : ''}`;
      b.addEventListener('click', () => this.actions.focusTeam(t.id));
      this.teamsDock.append(b);
    }
  }

  // ---------------------------------------------------------------- agent card

  private renderCard() {
    const s = this.state!;
    const a = this.selected ? s.agents[this.selected] : undefined;
    // 다른 직원을 고르거나 카드가 닫히면 고치기는 끝난다.
    if (this.editing && this.editing !== a?.id) this.editing = null;
    if (!a) {
      this.card.classList.remove('show');
      this.cardKey = '';
      return;
    }
    if (this.editing === a.id && this.card.querySelector('.name-input')) return;
    const canSend = this.mode === 'live' && controlAllowed();
    const key = `${a.id}|${a.name}|${a.status}|${a.activity}|${a.history.length}|${a.history.at(-1)?.ts}|${a.lastPrompt}|${a.lastReply}|${canSend}|${Math.floor(Date.now() / 10000)}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const team = s.teams[a.team];
    const parent = a.parent ? s.agents[a.parent] : undefined;
    const crew = Object.values(s.agents).filter((x) => x.parent === a.id);
    const hist = [...a.history].reverse().slice(0, 7);
    const color = STATUS_COLORS[a.status];
    const look = looksFor(a.id);
    const isMain = a.role === 'Lead' && !a.parent;
    const shortSession = (a.id.includes(':') ? a.id.split(':')[1] : a.id) || a.id;
    const kind = isMain ? CARD_KO.mainSession : `${CARD_KO.subagent} (${a.role})`;
    const lastTask = [...a.history].reverse().find((h) => h.kind === 'task' && h.text)?.text;
    const job = (isMain ? lastTask || team?.task : undefined) || a.activity || '아직 아무것도 없어요';
    const nowText = a.activity || '아직 아무것도 없어요';
    const canRename = isMain && canSend && a.status !== 'offline';
    const facts: [string, string][] = [[CARD_KO.kind, kind]];
    if (!isMain && a.parent) facts.push([CARD_KO.parent, parent ? `${parent.name} (${a.parent.split(':')[1] || a.parent})` : a.parent]);
    facts.push([CARD_KO.source, sourceLabel(a.source)], [CARD_KO.session, shortSession], [CARD_KO.project, team?.name || a.team]);
    facts.push([CARD_KO.model, a.model || CARD_KO.unknown]);
    if (a.branch) facts.push([CARD_KO.branch, a.branch]);
    if (a.cwd) facts.push([CARD_KO.cwd, a.cwd]);

    // 다시 그리면 쓰던 글이 사라지므로, 먼저 글과 커서 자리를 챙긴다.
    const oldBox = this.card.querySelector<HTMLTextAreaElement>('.send-text');
    if (oldBox?.dataset.agent) this.drafts.set(oldBox.dataset.agent, oldBox.value);
    const hadFocus = oldBox !== null && document.activeElement === oldBox;
    const caret = oldBox?.selectionStart ?? 0;
    const busy = ['thinking', 'working', 'waiting'].includes(a.status);
    const blocked = this.sendBlocked.get(a.id);
    const sendReason = !isMain ? CARD_KO.sendSub : busy ? CARD_KO.sendBusy : blocked || '';
    const convo =
      isMain && (a.lastPrompt || a.lastReply)
        ? `<div class="convo">
        <p class="job-label">${CARD_KO.convo}</p>
        ${a.lastPrompt ? `<p class="convo-label">${CARD_KO.asked}</p><p class="convo-text">${esc(a.lastPrompt)}</p>` : ''}
        ${a.lastReply ? `<p class="convo-label">${CARD_KO.answered}</p><p class="convo-text">${esc(a.lastReply)}</p>` : ''}
      </div>`
        : '';
    const sendBox = canSend
      ? `<div class="send-box">
        <p class="job-label">${CARD_KO.sendTitle}</p>
        <textarea class="send-text" rows="3" maxlength="2000" data-agent="${esc(a.id)}" placeholder="${CARD_KO.sendPlaceholder}"></textarea>
        <button type="button" class="send-btn"${sendReason || this.sending.has(a.id) ? ' disabled' : ''}>${CARD_KO.send}</button>
        <p class="send-note">${esc(sendReason || this.sendNotes.get(a.id) || '')}</p>
      </div>`
      : '';

    this.card.innerHTML = `
      <div class="card-head">
        <span class="avatar" style="--shirt:${shirtFor(a.role)};--skin:${look.skin};--hair:${look.hair}" aria-hidden="true"><i></i></span>
        <div class="who">
          <div class="name-row">
            <h2>${esc(a.name)}</h2>
            ${canRename ? `<button type="button" class="icon-btn name-edit" aria-label="${CARD_KO.rename}" title="${CARD_KO.rename}">${pencil.replace('<svg ', '<svg aria-hidden="true" focusable="false" class="icon" ')}</button>` : ''}
          </div>
          <p>${esc(team?.name || a.team)}의 ${esc(a.role)}</p>
        </div>
        <button type="button" class="icon-btn close" aria-label="닫기">${icon('x')}</button>
      </div>
      <div class="status-row">
        <span class="status-chip" style="--c:${color}"><span class="dot"></span>${STATUS_LABEL[a.status]}</span>
        <span class="source">${esc(sourceLabel(a.source))}</span>
      </div>
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="now">
        <p class="job-label">${CARD_KO.job}</p>
        <p class="job-text">${esc(job)}</p>
        ${nowText !== job ? `<p class="now-text">${esc(nowText)}</p>` : ''}
        ${a.tool ? `<p class="now-tool">${esc(a.tool)}</p>` : ''}
      </div>
      ${convo}
      ${sendBox}
      ${
        parent || crew.length
          ? `<div class="links">${parent ? `<button type="button" class="person" data-id="${esc(parent.id)}">${esc(parent.name)}에게 보고해요</button>` : ''}${crew
              .map((c) => `<button type="button" class="person" data-id="${esc(c.id)}"><span class="mini-dot" style="background:${STATUS_COLORS[c.status]}"></span>${esc(c.name)}</button>`)
              .join('')}</div>`
          : ''
      }
      <ol class="history">
        ${hist
          .map(
            (h) =>
              `<li><span class="h-kind k-${h.kind}"></span><span class="h-text">${esc(h.kind === 'message' ? `말했어요: "${h.text}"` : h.text)}</span><time>${ago(h.ts)}</time></li>`,
          )
          .join('')}
      </ol>
      <div class="leave-box">
        <button type="button" class="leave-btn">${CARD_KO.leave}</button>
        <p class="leave-note">${CARD_KO.leaveNote}</p>
      </div>`;
    this.card.querySelector('.name-edit')?.addEventListener('click', () => this.startRename(a));
    const leaveBtn = this.card.querySelector<HTMLButtonElement>('.leave-btn')!;
    leaveBtn.addEventListener('click', () => {
      const now = Date.now();
      if (now - this.leaveArmedAt < 3000) {
        this.leaveArmedAt = 0;
        dismissAgent(a.id, CARD_KO.leaveActivity);
        this.actions.select(null);
        return;
      }
      this.leaveArmedAt = now;
      leaveBtn.textContent = CARD_KO.leaveConfirm;
      leaveBtn.classList.add('armed');
      window.setTimeout(() => {
        if (leaveBtn.isConnected && this.leaveArmedAt === now) {
          this.leaveArmedAt = 0;
          leaveBtn.textContent = CARD_KO.leave;
          leaveBtn.classList.remove('armed');
        }
      }, 3000);
    });
    const sendText = this.card.querySelector<HTMLTextAreaElement>('.send-text');
    if (sendText) {
      sendText.value = this.drafts.get(a.id) ?? '';
      if (hadFocus) {
        sendText.focus();
        sendText.setSelectionRange(caret, caret);
      }
      const sendBtn = this.card.querySelector<HTMLButtonElement>('.send-btn')!;
      const sendNote = this.card.querySelector<HTMLElement>('.send-note')!;
      sendText.addEventListener('input', () => {
        this.drafts.set(a.id, sendText.value);
        if (this.sendBlocked.delete(a.id) && isMain && !busy) {
          sendBtn.disabled = false;
          sendNote.textContent = '';
        }
      });
      sendBtn.addEventListener('click', () => {
        const text = sendText.value.trim();
        if (!text) return;
        const now = Date.now();
        if (now - this.sendArmedAt >= 3000) {
          // 첫 번째 누름: 누구에게 가는지 보여 주고 3초 동안 한 번 더 누르기를 기다린다.
          this.sendArmedAt = now;
          sendBtn.textContent = CARD_KO.sendConfirm;
          sendBtn.classList.add('armed');
          sendNote.textContent = CARD_KO.sendTarget(a.name);
          window.setTimeout(() => {
            if (sendBtn.isConnected && this.sendArmedAt === now) {
              this.sendArmedAt = 0;
              sendBtn.textContent = CARD_KO.send;
              sendBtn.classList.remove('armed');
              sendNote.textContent = this.sendNotes.get(a.id) || '';
            }
          }, 3000);
          return;
        }
        this.sendArmedAt = 0;
        sendBtn.disabled = true;
        sendBtn.classList.remove('armed');
        sendBtn.textContent = CARD_KO.send;
        sendNote.textContent = CARD_KO.sendWorking;
        this.sending.add(a.id);
        void sendInstruction(a.id, text).then((r) => {
          this.sending.delete(a.id);
          if (r.sent) {
            this.drafts.delete(a.id);
            this.sendNotes.set(a.id, r.sent === 'queued' ? CARD_KO.sendQueued : CARD_KO.sendSent);
          } else {
            this.sendBlocked.set(a.id, r.reason || '보내지 못했어요');
          }
          // 카드가 그대로 떠 있으면 바로 고쳐 보이고, 다시 그려질 때도 같은 글이 나오도록 키를 비운다.
          if (sendNote.isConnected) {
            sendNote.textContent = this.sendBlocked.get(a.id) || this.sendNotes.get(a.id) || '';
            sendText.value = this.drafts.get(a.id) ?? '';
            sendBtn.disabled = Boolean(this.sendBlocked.get(a.id));
          }
          this.cardKey = '';
        });
      });
    }
    this.card.querySelector('.close')!.addEventListener('click', () => this.actions.select(null));
    this.card.querySelectorAll<HTMLButtonElement>('.person').forEach((b) => b.addEventListener('click', () => this.actions.select(b.dataset.id!)));
    this.card.classList.add('show');
  }

  /** 이름 글자 자리를 입력칸, 저장, 취소로 바꾼다. Enter는 저장, Esc는 취소, 빈 칸 저장은 고친 이름 지우기. */
  private startRename(a: Agent) {
    const row = this.card.querySelector<HTMLElement>('.name-row');
    if (!row) return;
    this.editing = a.id;
    row.innerHTML = '';
    const input = el('input', 'name-input') as HTMLInputElement;
    input.type = 'text';
    input.maxLength = 40;
    input.value = a.name;
    input.placeholder = CARD_KO.renamePlaceholder;
    input.setAttribute('aria-label', CARD_KO.rename);
    const save = el('button', 'name-save', CARD_KO.renameSave) as HTMLButtonElement;
    save.type = 'button';
    const cancel = el('button', 'name-cancel', CARD_KO.renameCancel) as HTMLButtonElement;
    cancel.type = 'button';
    const note = el('p', 'name-note');
    row.append(input, save, cancel, note);
    const finish = () => {
      this.editing = null;
      this.cardKey = '';
      this.renderCard();
    };
    input.addEventListener('input', () => {
      note.textContent = input.value.trim() ? '' : CARD_KO.renameClear;
    });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return; // 한글 조합 중의 Enter는 글자를 확정하는 키다.
      if (e.key === 'Enter') save.click();
      else if (e.key === 'Escape') finish();
    });
    cancel.addEventListener('click', finish);
    save.addEventListener('click', () => {
      input.disabled = save.disabled = cancel.disabled = true;
      note.textContent = CARD_KO.renameWorking;
      void renameAgent(a.id, input.value).then((r) => {
        if (this.editing !== a.id || !input.isConnected) return; // 그 사이 다른 직원을 골랐다
        if (r.ok) return finish();
        input.disabled = save.disabled = cancel.disabled = false;
        note.textContent = `${CARD_KO.renameFail}: ${r.reason || ''}`;
        input.focus();
      });
    });
    input.focus();
    input.select();
  }

  // ---------------------------------------------------------------- tags & bubbles (every frame)

  frame(anchors: Anchor[]) {
    const s = this.state;
    if (!s) return;
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0.001, (now - this.frameAt) / 1000));
    this.frameAt = now;
    const seen = new Set<string>();
    const live = this.live;
    live.length = 0;
    for (const an of anchors) {
      const agent = s.agents[an.id];
      if (!agent) continue;
      seen.add(an.id);
      let tag = this.tags.get(an.id);
      if (!tag) tag = this.makeTag(agent);
      this.updateTag(tag, agent, agent.status !== 'offline' && meetingCovers(s.meeting, agent));
      const hot = an.id === this.hovered || an.id === this.selected;
      // Far away the full tag would be tiny and pile up: show the name only (full tag on hover or select).
      const compact = !hot && an.depth > (tag.compact ? COMPACT_OFF : COMPACT_ON);
      const near = !compact && (an.depth < 15 || hot);
      const sel = an.id === this.selected;
      const show = an.visible && (an.depth < 70 || sel);
      const L = tag.last;
      const o = show ? '1' : '0';
      if (o !== L.o) {
        tag.root.style.opacity = o;
        tag.root.style.visibility = show ? '' : 'hidden';
        L.o = o;
      }
      if (compact !== tag.compact) {
        tag.compact = compact;
        tag.root.classList.toggle('compact', compact);
        tag.dirty = true;
      }
      if (near !== L.near) {
        tag.root.classList.toggle('near', near);
        L.near = near;
      }
      if (sel !== L.sel) {
        tag.root.classList.toggle('selected', sel);
        L.sel = sel;
      }
      tag.show = show;
      if (show) {
        if (tag.dirty) this.measure(tag);
        tag.hot = hot;
        tag.near = near;
        tag.ax = an.x;
        tag.ay = an.y;
        tag.s = compact ? 0.9 : Math.max(0.62, Math.min(1, 16 / an.depth));
        tag.vh = near || compact ? tag.h : tag.visH;
        const z = String(hot ? 1500 : 1000 - Math.round(an.depth * 4));
        if (z !== L.z) {
          tag.root.style.zIndex = z;
          L.z = z;
        }
        live.push(tag);
      } else tag.shown = false;
    }
    this.declutter(live, dt);
    for (const tag of live) {
      const x = tag.ax + tag.ox;
      const y = tag.ay + tag.oy;
      const t = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${tag.s.toFixed(3)})`;
      if (t !== tag.last.t) {
        tag.root.style.transform = t;
        tag.last.t = t;
      }
      this.drawLeader(tag);
    }
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.root.remove();
        this.tags.delete(id);
        continue;
      }
      const bubble = this.bubbles.get(id);
      if (bubble) {
        // The bubble rides on top of the (moved) tag.
        const y = tag.ay + tag.oy - tag.vh * tag.s - 6;
        bubble.root.style.transform = `translate3d(${(tag.ax + tag.ox).toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${tag.s.toFixed(3)})`;
        bubble.root.style.opacity = tag.show ? '' : '0';
        bubble.root.style.zIndex = String(2000 - Math.round(tag.ay));
      }
    }
    for (const [id, b] of this.bubbles) {
      if (now > b.until || !seen.has(id)) {
        b.root.classList.add('out');
        const r = b.root;
        setTimeout(() => r.remove(), 260);
        this.bubbles.delete(id);
      }
    }
  }

  /** Read the tag's layout size. Only runs when its text or its form changed. */
  private measure(tag: Tag) {
    tag.w = tag.root.offsetWidth;
    tag.h = tag.root.offsetHeight;
    tag.visH = tag.compact ? tag.h : tag.pill.offsetTop + tag.pill.offsetHeight;
    tag.dirty = false;
  }

  /**
   * Keep name tags from covering each other. Tags are placed one by one in a stable order (hovered and
   * selected first, then nearest to the viewer, left to right). A tag that would overlap an earlier one
   * moves to the closest free spot: up, or sideways. The shown position eases to the target.
   */
  private declutter(list: Tag[], dt: number) {
    list.sort((a, b) => Number(b.hot) - Number(a.hot) || b.ay - a.ay || a.ax - b.ax);
    const R = this.rects;
    R.length = 0;
    const W = innerWidth;
    const hit = (x0: number, y0: number, x1: number, y1: number) => {
      for (let i = 0; i < R.length; i += 4) if (x0 < R[i + 2] && R[i] < x1 && y0 < R[i + 3] && R[i + 1] < y1) return true;
      return false;
    };
    const k = 1 - Math.exp(-dt * 14);
    for (const t of list) {
      const w = t.w * t.s;
      const h = t.vh * t.s;
      const left = t.ax - w / 2;
      const top = t.ay - t.h * t.s;
      let dx = 0;
      let dy = 0;
      if (hit(left - PAD, top - PAD, left + w + PAD, top + h + PAD)) {
        let best = Infinity;
        for (const bounded of [true, false]) {
          for (let i = 0; i < R.length; i += 4) {
            const q0 = R[i] + PAD;
            const q1 = R[i + 1] + PAD;
            const q2 = R[i + 2] - PAD;
            // Spots next to this earlier tag: above it, left of it, right of it.
            for (let c = 0; c < 3; c++) {
              const cx = c === 1 ? q0 - PAD * 2 - 0.25 - (left + w) : c === 2 ? q2 + PAD * 2 + 0.25 - left : 0;
              const cy = c === 0 ? Math.min(0, q1 - PAD * 2 - 0.25 - (top + h)) : 0;
              const cost = Math.abs(cx) + 1.35 * Math.abs(cy);
              if (cost >= best) continue;
              const x0 = left + cx;
              const y0 = top + cy;
              if (bounded && (y0 < 4 || x0 < 4 || x0 + w > W - 4)) continue;
              if (hit(x0 - PAD, y0 - PAD, x0 + w + PAD, y0 + h + PAD)) continue;
              best = cost;
              dx = cx;
              dy = cy;
            }
          }
          if (best < Infinity) break;
        }
      }
      R.push(left + dx, top + dy, left + dx + w, top + dy + h);
      t.tx = dx;
      t.ty = dy;
      if (!t.shown) {
        t.shown = true;
        t.ox = dx;
        t.oy = dy;
      } else {
        t.ox += (dx - t.ox) * k;
        t.oy += (dy - t.oy) * k;
        if (Math.abs(dx - t.ox) < 0.2) t.ox = dx;
        if (Math.abs(dy - t.oy) < 0.2) t.oy = dy;
      }
    }
  }

  /** A thin line from a moved tag back to the head it belongs to. */
  private drawLeader(t: Tag) {
    const far = Math.hypot(t.ox, t.oy) > 14;
    let key = '';
    if (far) {
      const px = t.w / 2;
      const tx = px - t.ox / t.s;
      const ty = t.h - t.oy / t.s;
      const len = Math.hypot(tx - px, ty - t.vh);
      const ang = Math.atan2(ty - t.vh, tx - px);
      key = `${px.toFixed(0)},${t.vh.toFixed(0)},${len.toFixed(1)},${ang.toFixed(3)}`;
      if (key !== t.leaderKey) {
        const st = t.leader.style;
        st.left = `${px}px`;
        st.top = `${t.vh}px`;
        st.width = `${len.toFixed(1)}px`;
        st.transform = `rotate(${ang.toFixed(3)}rad)`;
      }
    }
    if (key !== t.leaderKey) {
      if (!!key !== !!t.leaderKey) t.leader.style.display = key ? 'block' : '';
      t.leaderKey = key;
    }
  }

  private makeTag(agent: Agent): Tag {
    const root = el('div', 'tag');
    root.innerHTML = `<div class="tag-line"><span class="dot"></span><b></b><span class="role"></span></div><div class="pill"></div><div class="activity"></div><i class="leader"></i>`;
    root.addEventListener('click', () => this.actions.select(agent.id));
    this.tagsLayer.append(root);
    const tag: Tag = {
      root,
      name: root.querySelector('b')!,
      role: root.querySelector('.role')!,
      dot: root.querySelector('.dot')!,
      activity: root.querySelector('.activity')!,
      pill: root.querySelector('.pill')!,
      leader: root.querySelector('.leader')!,
      key: '',
      last: { t: '', o: '', z: '', near: false, sel: false },
      w: 0,
      h: 0,
      visH: 0,
      dirty: true,
      compact: false,
      show: false,
      shown: false,
      hot: false,
      near: false,
      ax: 0,
      ay: 0,
      s: 1,
      vh: 0,
      tx: 0,
      ty: 0,
      ox: 0,
      oy: 0,
      leaderKey: '',
    };
    this.tags.set(agent.id, tag);
    return tag;
  }

  private updateTag(tag: Tag, a: Agent, inMeeting: boolean) {
    const key = `${a.name}|${a.role}|${a.status}|${a.activity}|${inMeeting}`;
    if (key === tag.key) return;
    tag.key = key;
    tag.dirty = true;
    tag.name.textContent = a.name;
    tag.role.textContent = a.role.toLowerCase() === a.name.toLowerCase() ? '' : a.role;
    tag.dot.style.background = STATUS_COLORS[a.status];
    tag.root.dataset.status = a.status;
    const label = inMeeting ? PILL_MEETING_KO : PILL_KO[a.status];
    const raw = pillDetail(a.activity);
    const detail = a.status === 'idle' || [label, STATUS_LABEL[a.status], PILL_KO[a.status]].includes(raw) ? '' : raw;
    tag.pill.textContent = label + (detail ? `: ${detail}` : '');
    tag.pill.dataset.kind = inMeeting ? 'meeting' : a.status;
    tag.activity.textContent = a.activity || STATUS_LABEL[a.status];
  }

  say(id: string, text: string, toName?: string) {
    if (!text) return;
    let b = this.bubbles.get(id);
    if (!b) {
      const root = el('div', 'bubble') as HTMLDivElement;
      this.bubblesLayer.append(root);
      b = { root, until: 0 };
      this.bubbles.set(id, b);
    }
    b.root.innerHTML = `${toName ? `<span class="to">${esc(toName)}에게</span>` : ''}<span class="said">${esc(text)}</span>`;
    b.root.classList.remove('out');
    // Restart the entrance animation for a fresh line.
    b.root.classList.remove('in');
    void b.root.offsetWidth;
    b.root.classList.add('in');
    b.until = performance.now() + Math.min(6500, 2600 + text.length * 45);
  }

  // ---------------------------------------------------------------- connect sheet

  private buildSheet() {
    this.sheet.innerHTML = `
      <div class="scrim"></div>
      <section class="sheet glass" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <div class="sheet-head">
          <h2 id="sheet-title">에이전트 연결하기</h2>
          <button type="button" class="icon-btn close" aria-label="닫기">${icon('x')}</button>
        </div>
        <p class="sheet-lede">성기 주식회사는 내 컴퓨터에서 돌아가요. 에이전트는 훅으로 지금 하는 일을 알려 주고, 어떤 정보도 localhost 밖으로 나가지 않아요.</p>
        <div class="tabs" role="tablist">
          ${Object.entries(SETUP)
            .map(([k, v], i) => `<button type="button" role="tab" class="tab${i === 0 ? ' active' : ''}" data-tab="${k}" aria-selected="${i === 0}">${v.title}</button>`)
            .join('')}
        </div>
        <div class="tab-body"></div>
      </section>`;
    const body = this.sheet.querySelector<HTMLDivElement>('.tab-body')!;
    const show = (k: string) => {
      const v = SETUP[k];
      body.innerHTML = `${v.steps
        .map(
          (s) => `<div class="step"><p>${esc(s.label)}</p><div class="code"><pre><code>${esc(s.code)}</code></pre><button type="button" class="icon-btn copy" aria-label="복사">${icon('copy')}</button></div></div>`,
        )
        .join('')}<p class="note">${esc(v.note)}</p>`;
      body.querySelectorAll<HTMLButtonElement>('.copy').forEach((b) =>
        b.addEventListener('click', async () => {
          const code = b.parentElement!.querySelector('code')!.textContent || '';
          try {
            await navigator.clipboard.writeText(code);
            b.innerHTML = icon('check');
            setTimeout(() => (b.innerHTML = icon('copy')), 1400);
          } catch {
            /* clipboard blocked: the text is still selectable */
          }
        }),
      );
      this.sheet.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === k);
        t.setAttribute('aria-selected', String(t.dataset.tab === k));
      });
    };
    show('claude');
    this.sheet.querySelectorAll<HTMLButtonElement>('.tab').forEach((t) => t.addEventListener('click', () => show(t.dataset.tab!)));
    this.sheet.querySelector('.close')!.addEventListener('click', () => this.closeSheet());
    this.sheet.querySelector('.scrim')!.addEventListener('click', () => this.closeSheet());
  }

  openSheet() {
    this.sheet.classList.add('show');
    this.sheet.querySelector<HTMLButtonElement>('.tab.active')?.focus();
  }

  closeSheet() {
    this.sheet.classList.remove('show');
  }

  // ---------------------------------------------------------------- keys

  private bindKeys() {
    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (this.sheet.classList.contains('show')) this.closeSheet();
        else this.actions.select(null);
      } else if (e.key === 'f' || e.key === 'F') this.actions.frameAll();
      else if (e.key === 't' || e.key === 'T') this.actions.toggleTheme();
      else if (e.key === ']' || e.key === '[') {
        const ids = Object.values(this.state?.agents || {})
          .sort((a, b) => (this.state!.teams[a.team]?.order ?? 0) - (this.state!.teams[b.team]?.order ?? 0) || a.joinedAt - b.joinedAt)
          .map((a) => a.id);
        if (!ids.length) return;
        const i = this.selected ? ids.indexOf(this.selected) : -1;
        const next = ids[(i + (e.key === ']' ? 1 : -1) + ids.length) % ids.length];
        this.actions.select(next);
      }
    });
  }
}
