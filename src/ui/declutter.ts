// 이름표끼리 겹치지 않게 자리를 잡는 계산. DOM에 닿지 않는다.

/** declutter가 읽고 쓰는 태그의 값. 화면 요소 없이도 돌릴 수 있게 따로 뺐다. */
export interface TagBox {
  /** 호버나 선택으로 먼저 자리를 잡아야 하는 태그. */
  hot: boolean;
  /** 앵커 지점(화면 px), 배율, 가려지지 않았을 때 보이는 높이. */
  ax: number;
  ay: number;
  s: number;
  w: number;
  h: number;
  vh: number;
  /** 결과: 목표 오프셋, 부드럽게 따라가는 오프셋, 첫 배치 여부. */
  tx: number;
  ty: number;
  ox: number;
  oy: number;
  shown: boolean;
}

export const PAD = 3;

/**
 * Keep name tags from covering each other. Tags are placed one by one in a stable order (hovered and
 * selected first, then nearest to the viewer, left to right). A tag that would overlap an earlier one
 * moves to the closest free spot: up, or sideways. The shown position eases to the target.
 */
export function declutter(list: TagBox[], dt: number, R: number[], W: number) {
  list.sort((a, b) => Number(b.hot) - Number(a.hot) || b.ay - a.ay || a.ax - b.ax);
  R.length = 0;
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
