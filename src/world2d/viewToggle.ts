import './world2d.css';
import { readStored } from '../core/storage';

export type ViewName = '2d' | '3d';
const KEY = 'ai-office:view';

/** ?view=2d|3d wins, then the saved choice, then 2D. */
export function chosenView(): ViewName {
  const q = new URLSearchParams(location.search).get('view');
  if (q === '2d' || q === '3d') return q;
  const v = readStored(KEY);
  if (v === '2d' || v === '3d') return v;
  return '2d';
}

/** A round button that flips between the 2D and 3D view and reloads. */
export function createViewToggle(current: ViewName): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'view-toggle';
  b.title = '2D / 3D 바꾸기';
  b.setAttribute('aria-label', '2D / 3D 바꾸기');
  b.innerHTML = `<span><b>${current === '2d' ? '2D' : '3D'}</b><small>${current === '2d' ? '3D로' : '2D로'}</small></span>`;
  b.addEventListener('click', () => {
    const next: ViewName = current === '2d' ? '3d' : '2d';
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* the query below still switches this visit */
    }
    const url = new URL(location.href);
    url.searchParams.set('view', next);
    location.href = url.toString();
  });
  document.body.append(b);
  // Sit just left of the HUD tool buttons, whatever their width is.
  const place = () => {
    const tools = document.querySelector('.topbar .tools') as HTMLElement | null;
    if (!tools) return;
    const r = tools.getBoundingClientRect();
    if (r.width > 0) b.style.right = `${Math.round(innerWidth - r.left + 10)}px`;
    b.style.top = `${Math.round(r.top + (r.height - 44) / 2)}px`;
  };
  place();
  addEventListener('resize', place);
  setTimeout(place, 300);
  setTimeout(place, 1500);
  return b;
}
