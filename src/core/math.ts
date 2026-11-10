import type { Compass, Obb, Pose, Rect, Vec2 } from './types';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(target, current + maxDelta);
  return Math.max(target, current - maxDelta);
}

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Smallest signed difference `a − b`, in (−π, π]. */
export const angleDiff = (a: number, b: number): number => wrapAngle(a - b);

/** Heading (see types.ts conventions) of the direction (dx, dz). */
export const headingOf = (dx: number, dz: number): number => Math.atan2(dx, dz);

/** Unit forward vector of a heading. */
export const forwardOf = (heading: number): Vec2 => ({ x: Math.sin(heading), z: Math.cos(heading) });

/** Unit vector pointing to the RIGHT of a heading. */
export const rightOf = (heading: number): Vec2 => ({ x: -Math.cos(heading), z: Math.sin(heading) });

export const COMPASS_HEADING: Record<Compass, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };
export const COMPASS_VEC: Record<Compass, Vec2> = {
  N: { x: 0, z: -1 },
  E: { x: 1, z: 0 },
  S: { x: 0, z: 1 },
  W: { x: -1, z: 0 },
};
export const OPPOSITE: Record<Compass, Compass> = { N: 'S', S: 'N', E: 'W', W: 'E' };
/** Compass direction to the right / left of a direction of travel. */
export const RIGHT_OF: Record<Compass, Compass> = { N: 'E', E: 'S', S: 'W', W: 'N' };
export const LEFT_OF: Record<Compass, Compass> = { N: 'W', W: 'S', S: 'E', E: 'N' };

export const v2 = (x: number, z: number): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, z: a.z * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const len = (a: Vec2): number => Math.hypot(a.x, a.z);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);
export const distSq = (a: Vec2, b: Vec2): number => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
export const lerpVec = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t) });

export function normalize(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.z);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { x: 0, z: 0 };
}

/**
 * Express world point `p` in the local frame of `pose`:
 * `forward` = distance ahead of the pose, `right` = distance to its right.
 */
export function toLocal(pose: Pose, p: Vec2): { forward: number; right: number } {
  const dx = p.x - pose.x;
  const dz = p.z - pose.z;
  const s = Math.sin(pose.heading);
  const c = Math.cos(pose.heading);
  return { forward: dx * s + dz * c, right: -dx * c + dz * s };
}

/** World position of a point given as (forward, right) offsets from `pose`. */
export function fromLocal(pose: Pose, forward: number, right: number): Vec2 {
  const s = Math.sin(pose.heading);
  const c = Math.cos(pose.heading);
  return { x: pose.x + forward * s - right * c, z: pose.z + forward * c + right * s };
}

export const rectContains = (r: Rect, p: Vec2, margin = 0): boolean =>
  p.x >= r.minX - margin && p.x <= r.maxX + margin && p.z >= r.minZ - margin && p.z <= r.maxZ + margin;

export const rectCentre = (r: Rect): Vec2 => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });

/** The four corners of an oriented box: front-right, front-left, rear-left, rear-right. */
export function obbCorners(o: Obb): [Vec2, Vec2, Vec2, Vec2] {
  const pose = { x: o.x, z: o.z, heading: o.heading };
  return [
    fromLocal(pose, o.halfLength, o.halfWidth),
    fromLocal(pose, o.halfLength, -o.halfWidth),
    fromLocal(pose, -o.halfLength, -o.halfWidth),
    fromLocal(pose, -o.halfLength, o.halfWidth),
  ];
}

/** Separating-axis overlap test for two oriented boxes. */
export function obbOverlap(a: Obb, b: Obb): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [forwardOf(a.heading), rightOf(a.heading), forwardOf(b.heading), rightOf(b.heading)];
  for (const axis of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const p of ca) {
      const d = dot(p, axis);
      if (d < minA) minA = d;
      if (d > maxA) maxA = d;
    }
    for (const p of cb) {
      const d = dot(p, axis);
      if (d < minB) minB = d;
      if (d > maxB) maxB = d;
    }
    if (maxA < minB || maxB < minA) return false;
  }
  return true;
}

export function obbContainsPoint(o: Obb, p: Vec2, margin = 0): boolean {
  const l = toLocal({ x: o.x, z: o.z, heading: o.heading }, p);
  return Math.abs(l.forward) <= o.halfLength + margin && Math.abs(l.right) <= o.halfWidth + margin;
}

/** Closest point on segment ab to p, with the parameter t in [0, 1]. */
export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number; dist: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  const t = l2 > 1e-12 ? clamp(((p.x - a.x) * abx + (p.z - a.z) * abz) / l2, 0, 1) : 0;
  const point = { x: a.x + abx * t, z: a.z + abz * t };
  return { point, t, dist: Math.hypot(p.x - point.x, p.z - point.z) };
}

/** Intersection of segments p1p2 and p3p4, or null. Returns parameters along each. */
export function segmentIntersection(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): { point: Vec2; t: number; u: number } | null {
  const d1x = p2.x - p1.x;
  const d1z = p2.z - p1.z;
  const d2x = p4.x - p3.x;
  const d2z = p4.z - p3.z;
  const denom = d1x * d2z - d1z * d2x;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((p3.x - p1.x) * d2z - (p3.z - p1.z) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1z - (p3.z - p1.z) * d1x) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: { x: p1.x + d1x * t, z: p1.z + d1z * t }, t, u };
}
