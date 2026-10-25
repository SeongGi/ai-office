import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  QuadraticBezierCurve3,
  RingGeometry,
  Vector3,
} from 'three';

// A folded paper plane, nose pointing +Z.
const planeGeo = (() => {
  const g = new BufferGeometry();
  const v = [
    // left wing
    0, 0, 0.22, -0.16, 0.02, -0.14, 0, 0, -0.08,
    // right wing
    0, 0, 0.22, 0, 0, -0.08, 0.16, 0.02, -0.14,
    // keel
    0, 0, 0.22, 0, -0.06, -0.1, 0, 0, -0.08,
  ];
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
})();
const planeMat = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.6, side: DoubleSide, emissive: '#ffffff', emissiveIntensity: 0.25 });
const rippleGeo = new RingGeometry(0.5, 0.56, 48);

const SEGMENTS = 48;

interface Flight {
  curve: QuadraticBezierCurve3;
  plane: Mesh;
  trail: Line;
  trailMat: LineBasicMaterial;
  t: number;
  duration: number;
  landed: boolean;
  fade: number;
  onLand: () => void;
}

interface Ripple {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
}

/** Flies paper planes between agents along arcs, with a fading trail. */
export class Courier {
  readonly root = new Group();
  private flights: Flight[] = [];
  private ripples: Ripple[] = [];

  send(from: Vector3, to: Vector3, color: string, reduced: boolean, onLand: () => void) {
    const dist = from.distanceTo(to);
    const mid = from.clone().lerp(to, 0.5);
    mid.y += 0.8 + dist * 0.28;
    const curve = new QuadraticBezierCurve3(from.clone(), mid, to.clone());

    const pts = curve.getPoints(SEGMENTS);
    const trailGeo = new BufferGeometry().setFromPoints(pts);
    trailGeo.setDrawRange(0, 0);
    const trailMat = new LineBasicMaterial({ color, transparent: true, opacity: 0.85, toneMapped: false });
    const trail = new Line(trailGeo, trailMat);
    const plane = new Mesh(planeGeo, planeMat);
    plane.scale.setScalar(1.6);
    plane.castShadow = true;
    plane.position.copy(from);
    this.root.add(trail, plane);

    this.flights.push({
      curve,
      plane,
      trail,
      trailMat,
      t: 0,
      // Longer trips take a bit longer, but never drag.
      duration: reduced ? 0.01 : Math.min(2.2, 0.9 + dist * 0.06),
      landed: false,
      fade: 1,
      onLand,
    });
  }

  ripple(at: Vector3, color: string) {
    const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const mesh = new Mesh(rippleGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(at.x, 0.09, at.z);
    this.root.add(mesh);
    this.ripples.push({ mesh, mat, t: 0 });
  }

  update(dt: number) {
    const tangent = new Vector3();
    for (const f of this.flights) {
      if (!f.landed) {
        f.t = Math.min(1, f.t + dt / f.duration);
        // Ease in-out so the plane launches and lands softly.
        const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
        f.curve.getPoint(e, f.plane.position);
        f.curve.getTangent(Math.min(0.999, e), tangent);
        f.plane.lookAt(f.plane.position.clone().add(tangent));
        f.plane.rotateZ(Math.sin(f.t * Math.PI * 3) * 0.3);
        f.trail.geometry.setDrawRange(0, Math.ceil(e * SEGMENTS) + 1);
        if (f.t >= 1) {
          f.landed = true;
          f.plane.visible = false;
          f.onLand();
        }
      } else {
        f.fade -= dt * 1.6;
        f.trailMat.opacity = Math.max(0, f.fade) * 0.85;
      }
    }
    this.flights = this.flights.filter((f) => {
      if (f.landed && f.fade <= 0) {
        f.trail.geometry.dispose();
        f.trailMat.dispose();
        f.trail.removeFromParent();
        f.plane.removeFromParent();
        return false;
      }
      return true;
    });

    for (const r of this.ripples) {
      r.t += dt;
      const s = 1 + r.t * 2.2;
      r.mesh.scale.setScalar(s);
      r.mat.opacity = Math.max(0, 0.9 - r.t * 1.4);
    }
    this.ripples = this.ripples.filter((r) => {
      if (r.mat.opacity <= 0) {
        r.mat.dispose();
        r.mesh.removeFromParent();
        return false;
      }
      return true;
    });
  }

  clear() {
    for (const f of this.flights) {
      f.trail.geometry.dispose();
      f.trailMat.dispose();
    }
    for (const r of this.ripples) r.mat.dispose();
    this.flights = [];
    this.ripples = [];
    this.root.clear();
  }
}
