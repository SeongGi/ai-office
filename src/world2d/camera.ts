// 2D camera: pan, zoom, and smooth flights (critically damped springs, like the 3D one).
export const BASE_PX = 44;
export const MIN_ZOOM = 0.12;
export const MAX_ZOOM = 4.5;
const RESPONSE = 0.9;

export class Camera2D {
  /** World point at the centre of the screen. */
  x = 0;
  z = 0;
  zoom = 1;
  w = 1;
  h = 1;
  private vx = 0;
  private vz = 0;
  private vl = 0;
  private goal: { x: number; z: number; zoom: number } | null = null;

  /** Screen pixels per metre. */
  get scale() {
    return BASE_PX * this.zoom;
  }

  toScreen(wx: number, wz: number): [number, number] {
    const s = this.scale;
    return [(wx - this.x) * s + this.w / 2, (wz - this.z) * s + this.h / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const s = this.scale;
    return [(sx - this.w / 2) / s + this.x, (sy - this.h / 2) / s + this.z];
  }

  /** The user took the camera. */
  grab() {
    this.goal = null;
    this.vx = this.vz = this.vl = 0;
  }

  panBy(dxPx: number, dyPx: number) {
    this.x -= dxPx / this.scale;
    this.z -= dyPx / this.scale;
  }

  /** Zoom keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number) {
    const [wx, wz] = this.toWorld(sx, sy);
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * factor));
    const s = this.scale;
    this.x = wx - (sx - this.w / 2) / s;
    this.z = wz - (sy - this.h / 2) / s;
  }

  flyTo(x: number, z: number, zoom: number, instant = false) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    if (instant) {
      this.x = x;
      this.z = z;
      this.zoom = zoom;
      this.goal = null;
      this.vx = this.vz = this.vl = 0;
    } else this.goal = { x, z, zoom };
  }

  /** Move the goal without restarting the flight (used to follow a walking cat). */
  nudgeGoal(x: number, z: number) {
    if (this.goal) {
      this.goal.x = x;
      this.goal.z = z;
    }
  }

  get flying() {
    return this.goal !== null;
  }

  /** Returns true when the view changed. */
  update(dt: number): boolean {
    const g = this.goal;
    if (!g) return false;
    const k = Math.pow((2 * Math.PI) / RESPONSE, 2);
    const c = (4 * Math.PI) / RESPONSE;
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = Math.min(dt, 0.1) / steps;
    let l = Math.log(this.zoom);
    const gl = Math.log(g.zoom);
    for (let i = 0; i < steps; i++) {
      this.vx += (-k * (this.x - g.x) - c * this.vx) * h;
      this.vz += (-k * (this.z - g.z) - c * this.vz) * h;
      this.vl += (-k * (l - gl) - c * this.vl) * h;
      this.x += this.vx * h;
      this.z += this.vz * h;
      l += this.vl * h;
    }
    this.zoom = Math.exp(l);
    const near = Math.hypot(this.x - g.x, this.z - g.z) * this.scale < 0.5 && Math.abs(l - gl) < 0.002 && Math.hypot(this.vx, this.vz) * this.scale < 2;
    if (near) {
      this.x = g.x;
      this.z = g.z;
      this.zoom = g.zoom;
      this.goal = null;
      this.vx = this.vz = this.vl = 0;
    }
    return true;
  }
}
