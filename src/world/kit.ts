import { BufferAttribute, BufferGeometry, Color, Euler, Group, Material, Matrix4, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface Piece {
  geometry: BufferGeometry;
  material: Material;
  matrix: Matrix4;
  cast: boolean;
}

export interface PlaceOpts {
  rx?: number;
  ry?: number;
  rz?: number;
  sx?: number;
  sy?: number;
  sz?: number;
  /** Casts shadows (default: true unless the piece is tiny). */
  cast?: boolean;
}

/**
 * Plain-coloured materials are baked into vertex colours and share this one
 * material, so a room full of differently coloured things is a single draw.
 */
export const bakedMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });

const tmpQ = new Quaternion();
const tmpE = new Euler();
const tmpS = new Vector3();
const tmpP = new Vector3();
const tmpC = new Color();

/** Pieces smaller than this (bounding radius, metres) do not cast shadows. */
const TINY = 0.09;

/**
 * Static batching. Furniture is described as many small pieces with a transform
 * stack, then merged on `build()`: one mesh for all plain colours, plus one per
 * textured or themed material. A furnished room becomes a handful of draw calls.
 */
export class Kit {
  private pieces: Piece[] = [];
  private stack: Matrix4[] = [new Matrix4()];

  private get top() {
    return this.stack[this.stack.length - 1];
  }

  /** Enter a local frame: translate, then rotate around Y. */
  push(x = 0, y = 0, z = 0, ry = 0) {
    const m = new Matrix4().compose(tmpP.set(x, y, z), tmpQ.setFromEuler(tmpE.set(0, ry, 0)), tmpS.set(1, 1, 1));
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }

  pop() {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  add(geometry: BufferGeometry, material: Material, x = 0, y = 0, z = 0, o: PlaceOpts = {}) {
    const local = new Matrix4().compose(
      tmpP.set(x, y, z),
      tmpQ.setFromEuler(tmpE.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0)),
      tmpS.set(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1),
    );
    let cast = o.cast ?? true;
    if (cast && o.cast === undefined) {
      if (!geometry.boundingSphere) geometry.computeBoundingSphere();
      const scale = Math.max(o.sx ?? 1, o.sy ?? 1, o.sz ?? 1);
      if (geometry.boundingSphere!.radius * scale < TINY) cast = false;
    }
    this.pieces.push({ geometry, material, matrix: this.top.clone().multiply(local), cast });
    return this;
  }

  /** Merge everything into a Group of meshes. */
  build(): Group {
    const group = new Group();
    const buckets = new Map<string, { material: Material; cast: boolean; geos: BufferGeometry[] }>();
    for (const p of this.pieces) {
      const bake = Boolean(p.material.userData.bake);
      const material = bake ? bakedMat : p.material;
      const key = `${material.uuid}|${p.cast}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { material, cast: p.cast, geos: [] }));
      const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()).applyMatrix4(p.matrix);
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      if (!g.attributes.uv) continue;
      if (bake) {
        tmpC.copy((p.material as MeshStandardMaterial).color);
        const n = g.attributes.position.count;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3] = tmpC.r;
          colors[i * 3 + 1] = tmpC.g;
          colors[i * 3 + 2] = tmpC.b;
        }
        g.setAttribute('color', new BufferAttribute(colors, 3));
      }
      b.geos.push(g);
    }
    for (const b of buckets.values()) {
      const merged = mergeGeometries(b.geos, false);
      for (const g of b.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new Mesh(merged, b.material);
      mesh.castShadow = b.cast;
      mesh.receiveShadow = true;
      mesh.userData.kit = true;
      if (b.material.transparent) mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.pieces = [];
    return group;
  }
}

/** Dispose the merged geometries a Kit produced (materials are shared). */
export function disposeKit(group: Group) {
  group.traverse((o) => {
    if (o instanceof Mesh && o.userData.kit) o.geometry.dispose();
  });
  group.removeFromParent();
}
