import { CanvasTexture, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { clay, G } from './materials';
import { makeCanvas, roundRect, UI_FONT } from './text';
import { damp } from './motion';

/** 로비 남쪽 벽에 붙은 엘리베이터. 퇴사하는 고양이가 다가오면 문이 열린다. */
export const ELEVATOR_OPEN_RANGE = 2.6;

function signTexture(): CanvasTexture {
  const { ctx, texture } = makeCanvas(256, 64);
  ctx.fillStyle = '#23262e';
  roundRect(ctx, 2, 2, 252, 60, 14);
  ctx.fill();
  ctx.fillStyle = '#ffd37a';
  ctx.font = `700 30px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('엘리베이터', 128, 34);
  return texture;
}

export class Elevator {
  readonly root = new Group();
  private doorL = new Group();
  private doorR = new Group();
  private open = 0;
  private lamp: Mesh;
  /** 문 앞 바닥 위치(월드). 고양이 거리 계산에 쓴다. */
  readonly front: Vector3;

  /** x, z: 엘리베이터가 붙은 벽 위치. 문은 +Z(로비 안쪽)를 본다. */
  constructor(x: number, z: number) {
    this.root.position.set(x, 0, z);
    this.root.rotation.y = Math.PI; // 모델은 -Z를 보게 만들었으므로 돌려 놓는다
    this.front = new Vector3(x, 0, z + 1.2);
    const steel = clay('#c9ced6', { roughness: 0.35 });
    const frame = clay('#3a3f4a');
    const cab = clay('#f1e6cf');

    const body = new Group();
    body.add(mesh(G.rbox(2.3, 3.0, 0.6, 0.05), frame, 0, 1.5, 0.1));
    body.add(mesh(G.box(1.75, 2.45, 0.05), clay('#fff4d8', { emissive: '#ffe3a0', emissiveIntensity: 0.35 }), 0, 1.25, -0.2));
    body.add(mesh(G.box(1.75, 0.05, 0.9), cab, 0, 0.03, -0.45));
    this.root.add(body);

    for (const [door, side] of [[this.doorL, -1], [this.doorR, 1]] as const) {
      door.position.set(side * 0.44, 1.25, -0.3);
      door.add(mesh(G.box(0.86, 2.45, 0.06), steel, side * 0.0, 0, 0));
      door.add(mesh(G.box(0.03, 2.3, 0.07), frame, -side * 0.4, 0, 0));
      this.root.add(door);
    }

    const sign = new Mesh(new PlaneGeometry(1.5, 0.375), new MeshBasicMaterial({ map: signTexture(), toneMapped: false }));
    sign.position.set(0, 2.75, -0.215);
    sign.rotation.y = Math.PI;
    this.root.add(sign);

    this.lamp = mesh(G.sphere(0.05, 10, 8), clay('#ff5f2e', { emissive: '#ff5f2e', emissiveIntensity: 0.8 }), 1.35, 1.25, -0.22);
    this.root.add(this.lamp);
    this.root.add(mesh(G.rbox(0.12, 0.2, 0.05, 0.02), steel, 1.35, 1.2, -0.21));
    this.root.traverse((o) => ((o as Mesh).isMesh ? ((o as Mesh).castShadow = false) : undefined));
  }

  /** `near`가 true면 문을 연다. */
  update(dt: number, near: boolean) {
    this.open = damp(this.open, near ? 1 : 0, 5, dt);
    this.doorL.position.x = -0.44 - this.open * 0.8;
    this.doorR.position.x = 0.44 + this.open * 0.8;
  }

  dispose() {
    this.root.removeFromParent();
  }
}

function mesh(geo: Mesh['geometry'], mat: Mesh['material'], x: number, y: number, z: number) {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}
