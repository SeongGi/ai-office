// HUD가 함께 쓰는 DOM 도우미.

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function ago(ts: number) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return '방금';
  if (s < 60) return `${s}초 전`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}분 전`;
  return `${Math.round(m / 60)}시간 전`;
}
