// Motion primitives. Springs use Apple's designer-facing parameters:
//   response: roughly how long (seconds) the value takes to get there
//   damping:  1 = critically damped (no overshoot), < 1 = bouncy
// Springs always continue from their current value and velocity, so every
// animation can be interrupted and redirected mid-flight.

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  private stiffness: number;
  private dampingCoef: number;

  constructor(value: number, { response = 0.4, damping = 1 } = {}) {
    this.value = value;
    this.target = value;
    this.stiffness = Math.pow((2 * Math.PI) / response, 2);
    this.dampingCoef = (4 * Math.PI * damping) / response;
  }

  update(dt: number) {
    // Sub-step for stability on long frames.
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = Math.min(dt, 0.1) / steps;
    for (let i = 0; i < steps; i++) {
      const force = -this.stiffness * (this.value - this.target) - this.dampingCoef * this.velocity;
      this.velocity += force * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  settled(eps = 0.001) {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < eps;
  }
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

export function dampAngle(current: number, target: number, lambda: number, dt: number) {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
