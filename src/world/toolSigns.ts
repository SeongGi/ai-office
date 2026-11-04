// The placards in the tool rooms (자료실, 서버실, 정보검색실): what the room is for, and how many cats are in it now.
// One canvas texture per room. Furniture rebuilds reuse the same material, so a repaint reaches every copy.
import { MeshBasicMaterial } from 'three';
import { ROOM_INFO } from '../../shared/sidepanel';
import { PALETTES2D } from '../world2d/palette2d';
import type { ToolRoomKind } from './toolRooms';
import { makeCanvas, UI_FONT } from './text';
import type { ThemeName } from './palette';

const KINDS: ToolRoomKind[] = ['library', 'server', 'search'];

interface Sign {
  tex: ReturnType<typeof makeCanvas>;
  mat: MeshBasicMaterial;
  count: number;
}

export class ToolSigns {
  private theme: ThemeName = 'light';
  private signs = new Map<ToolRoomKind, Sign>();

  constructor() {
    // The first paint may happen before the font is ready; paint again when it is.
    document.fonts?.ready.then(() => KINDS.forEach((k) => this.paint(k)));
  }

  material(kind: ToolRoomKind) {
    return this.get(kind).mat;
  }

  setTheme(theme: ThemeName) {
    if (theme === this.theme) return;
    this.theme = theme;
    for (const k of this.signs.keys()) this.paint(k);
  }

  /** Head count per room; repaints only the signs whose number changed. */
  setCounts(counts: Partial<Record<ToolRoomKind, number>>) {
    for (const k of KINDS) {
      const s = this.get(k);
      const n = counts[k] ?? 0;
      if (n !== s.count) {
        s.count = n;
        this.paint(k);
      }
    }
  }

  private get(kind: ToolRoomKind) {
    let s = this.signs.get(kind);
    if (!s) {
      const tex = makeCanvas(1024, 480);
      s = { tex, mat: new MeshBasicMaterial({ map: tex.texture }), count: 0 };
      this.signs.set(kind, s);
      this.paint(kind);
    }
    return s;
  }

  private paint(kind: ToolRoomKind) {
    const s = this.signs.get(kind);
    if (!s) return;
    const P = PALETTES2D[this.theme];
    const info = ROOM_INFO[kind];
    const { ctx, canvas, texture } = s.tex;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = P.plaque;
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 48);
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = P.outline;
    ctx.stroke();
    ctx.fillStyle = P.plaqueText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 64px ${UI_FONT}`;
    ctx.fillText(info.name, W / 2, 92);
    ctx.font = `700 78px ${UI_FONT}`;
    ctx.fillText(info.use, W / 2, 218, W - 80);
    ctx.font = `600 54px ${UI_FONT}`;
    ctx.globalAlpha = 0.85;
    ctx.fillText(info.tools, W / 2, 322, W - 80);
    ctx.globalAlpha = 1;
    ctx.font = `800 50px ${UI_FONT}`;
    ctx.fillText(s.count > 0 ? `지금 ${s.count}마리` : '지금 비어 있어요', W / 2, 410);
    texture.needsUpdate = true;
  }
}
