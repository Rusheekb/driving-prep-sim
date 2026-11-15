import * as THREE from 'three';
import type { Vec2 } from '../core/types';

/**
 * Accumulates coloured triangles into one BufferGeometry so the whole static
 * town renders in a handful of draw calls.
 */
export class GeoBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private colors: number[] = [];
  private readonly c = new THREE.Color();

  get triangleCount(): number {
    return this.positions.length / 9;
  }

  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(this.c.r, this.c.g, this.c.b);
  }

  /** Triangle with a flat normal computed from its winding (counter-clockwise = front). */
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, colour: number): void {
    this.c.setHex(colour);
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.vert(ax, ay, az, nx, ny, nz);
    this.vert(bx, by, bz, nx, ny, nz);
    this.vert(cx, cy, cz, nx, ny, nz);
  }

  /** Quad a-b-c-d (counter-clockwise seen from the front). */
  quad(a: THREE.Vector3Like, b: THREE.Vector3Like, c: THREE.Vector3Like, d: THREE.Vector3Like, colour: number): void {
    this.tri(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, colour);
    this.tri(a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z, colour);
  }

  /** Horizontal polygon (optionally with holes) at height y, facing up. */
  flatPoly(points: readonly Vec2[], y: number, colour: number, holes: readonly (readonly Vec2[])[] = []): void {
    const contour = points.map((p) => new THREE.Vector2(p.x, p.z));
    const holeVecs = holes.map((h) => h.map((p) => new THREE.Vector2(p.x, p.z)));
    const all = [...points, ...holes.flat()];
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(contour, holeVecs) as [number, number, number][]) {
      const a = all[i]!;
      const b = all[j]!;
      const c = all[k]!;
      // Make sure the face points up (+y).
      const up = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z) > 0;
      if (up) this.tri(a.x, y, a.z, b.x, y, b.z, c.x, y, c.z, colour);
      else this.tri(a.x, y, a.z, c.x, y, c.z, b.x, y, b.z, colour);
    }
  }

  /** Axis-aligned horizontal rectangle. */
  flatRect(minX: number, minZ: number, maxX: number, maxZ: number, y: number, colour: number): void {
    this.tri(minX, y, minZ, minX, y, maxZ, maxX, y, maxZ, colour);
    this.tri(minX, y, minZ, maxX, y, maxZ, maxX, y, minZ, colour);
  }

  /** Vertical wall along a closed loop of points, from y0 up to y1 (double-sided materials expected). */
  wall(points: readonly Vec2[], y0: number, y1: number, colour: number, closed = true): void {
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = points[i]!;
      const b = points[(i + 1) % n]!;
      this.quad({ x: a.x, y: y0, z: a.z }, { x: b.x, y: y0, z: b.z }, { x: b.x, y: y1, z: b.z }, { x: a.x, y: y1, z: a.z }, colour);
    }
  }

  /** Flat line of the given width from a to b at height y. */
  line(a: Vec2, b: Vec2, width: number, y: number, colour: number): void {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) return;
    const px = (-dz / l) * (width / 2);
    const pz = (dx / l) * (width / 2);
    this.tri(a.x + px, y, a.z + pz, a.x - px, y, a.z - pz, b.x - px, y, b.z - pz, colour);
    this.tri(a.x + px, y, a.z + pz, b.x - px, y, b.z - pz, b.x + px, y, b.z + pz, colour);
    // Second winding so the line is visible whichever way it was drawn.
    this.tri(a.x + px, y, a.z + pz, b.x - px, y, b.z - pz, a.x - px, y, a.z - pz, colour);
    this.tri(a.x + px, y, a.z + pz, b.x + px, y, b.z + pz, b.x - px, y, b.z - pz, colour);
  }

  dashed(a: Vec2, b: Vec2, width: number, y: number, colour: number, dash: number, gap: number): void {
    const l = Math.hypot(b.x - a.x, b.z - a.z);
    if (l < 1e-6) return;
    const ux = (b.x - a.x) / l;
    const uz = (b.z - a.z) / l;
    for (let s = 0; s < l; s += dash + gap) {
      const e = Math.min(l, s + dash);
      this.line({ x: a.x + ux * s, z: a.z + uz * s }, { x: a.x + ux * e, z: a.z + uz * e }, width, y, colour);
    }
  }

  /** Box centred at (x, z) sitting on y0, rotated by heading about Y. `sx` is across (right), `sz` along the heading. */
  box(x: number, y0: number, z: number, sx: number, sy: number, sz: number, heading: number, colour: number, topColour = colour): void {
    const s = Math.sin(heading);
    const c = Math.cos(heading);
    const corner = (r: number, f: number, y: number): THREE.Vector3Like => ({ x: x + f * s - r * c, y, z: z + f * c + r * s });
    const hx = sx / 2;
    const hz = sz / 2;
    const y1 = y0 + sy;
    const b = [corner(hx, hz, y0), corner(-hx, hz, y0), corner(-hx, -hz, y0), corner(hx, -hz, y0)];
    const t = [corner(hx, hz, y1), corner(-hx, hz, y1), corner(-hx, -hz, y1), corner(hx, -hz, y1)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(b[j]!, b[i]!, t[i]!, t[j]!, colour);
    }
    this.quad(t[0]!, t[1]!, t[2]!, t[3]!, topColour);
  }

  /** Append any geometry transformed by a matrix, painted one colour. */
  addGeometry(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, colour: number): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.getAttribute('position');
    const v = new THREE.Vector3();
    const p: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      p.push(v.clone());
      if (p.length === 3) {
        this.tri(p[0]!.x, p[0]!.y, p[0]!.z, p[1]!.x, p[1]!.y, p[1]!.z, p[2]!.x, p[2]!.y, p[2]!.z, colour);
        p.length = 0;
      }
    }
    if (g !== geometry) g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Points along a circular arc from p1 to p2 around `centre`, the short way round (endpoints included). */
export function arcBetween(centre: Vec2, p1: Vec2, p2: Vec2, step = Math.PI / 14): Vec2[] {
  const r = Math.hypot(p1.x - centre.x, p1.z - centre.z);
  const a1 = Math.atan2(p1.z - centre.z, p1.x - centre.x);
  let d = Math.atan2(p2.z - centre.z, p2.x - centre.x) - a1;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const n = Math.max(1, Math.ceil(Math.abs(d) / step));
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a1 + (d * i) / n;
    out.push({ x: centre.x + r * Math.cos(a), z: centre.z + r * Math.sin(a) });
  }
  return out;
}

export function circlePoints(cx: number, cz: number, r: number, n = 40): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
  }
  return out;
}
