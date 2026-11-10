/**
 * Path building blocks for connectors and route lines: straight runs, circular
 * arcs and smooth lateral shifts, sampled into polylines that also remember the
 * exact tangent heading at every sample.
 *
 * Angle convention for arcs matches headings (see core/types.ts): a point on a
 * circle is `centre + radius·(sin φ, cos φ)`, and φ INCREASES when travelling
 * anticlockwise seen from above — i.e. while turning left.
 */
import { angleDiff, forwardOf, fromLocal, headingOf, rightOf, wrapAngle } from '../core/math';
import type { Pose, Vec2 } from '../core/types';

/** One analytic piece of a path, parameterised by distance travelled along it. */
export interface PathPiece {
  readonly length: number;
  poseAt(distance: number): Pose;
}

/** A path sampled into a polyline. All four arrays/values describe the same samples. */
export interface SampledPath {
  points: Vec2[];
  /** Exact tangent heading at each point. */
  headings: number[];
  /** Polyline (chord) distance of each point from the start. */
  cumulative: number[];
  /** Total polyline length (= last cumulative value). */
  length: number;
}

export function linePiece(from: Vec2, to: Vec2): PathPiece {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dz);
  const heading = headingOf(dx, dz);
  return {
    length,
    poseAt(distance) {
      const t = length > 0 ? distance / length : 0;
      return { x: from.x + dx * t, z: from.z + dz * t, heading };
    },
  };
}

/**
 * Circular arc starting at angle `startAngle` on the circle and sweeping
 * `sweep` radians: positive = anticlockwise seen from above (turning left),
 * negative = clockwise (turning right).
 */
export function arcPiece(centre: Vec2, radius: number, startAngle: number, sweep: number): PathPiece {
  const dir = sweep >= 0 ? 1 : -1;
  return {
    length: radius * Math.abs(sweep),
    poseAt(distance) {
      const phi = startAngle + (dir * distance) / radius;
      return {
        x: centre.x + radius * Math.sin(phi),
        z: centre.z + radius * Math.cos(phi),
        heading: wrapAngle(phi + (dir * Math.PI) / 2),
      };
    },
  };
}

/** Arc that leaves `start` tangentially. `sweep` > 0 turns left, < 0 turns right. */
export function arcFromPose(start: Pose, radius: number, sweep: number): PathPiece {
  const dir = sweep >= 0 ? 1 : -1;
  const right = rightOf(start.heading);
  // The centre is to the left of the vehicle for a left turn, to the right for a right turn.
  const centre = { x: start.x - dir * radius * right.x, z: start.z - dir * radius * right.z };
  return arcPiece(centre, radius, start.heading - (dir * Math.PI) / 2, sweep);
}

const SHIFT_TABLE_SIZE = 32;

/**
 * A run of `distance` metres ahead of `start` that eases `offset` metres to the
 * right (negative = left) with a smoothstep profile, so the heading is
 * continuous with a straight line at both ends. Used for lane changes and for
 * straight-on connectors between lanes that do not line up.
 */
export function shiftPiece(start: Pose, distance: number, offset: number): PathPiece {
  const lateralAt = (u: number): number => offset * u * u * (3 - 2 * u);
  const slopeAt = (u: number): number => (offset * 6 * u * (1 - u)) / distance;
  // Arc length table over the forward distance, for constant-speed parameterisation.
  const table: number[] = [0];
  for (let i = 1; i <= SHIFT_TABLE_SIZE; i++) {
    const u0 = (i - 1) / SHIFT_TABLE_SIZE;
    const u1 = i / SHIFT_TABLE_SIZE;
    table.push(table[i - 1] + Math.hypot(distance / SHIFT_TABLE_SIZE, lateralAt(u1) - lateralAt(u0)));
  }
  const length = table[SHIFT_TABLE_SIZE];
  return {
    length,
    poseAt(d) {
      const target = d <= 0 ? 0 : d >= length ? length : d;
      let i = 1;
      while (i < SHIFT_TABLE_SIZE && table[i] < target) i++;
      const span = table[i] - table[i - 1];
      const u = (i - 1 + (span > 0 ? (target - table[i - 1]) / span : 0)) / SHIFT_TABLE_SIZE;
      const p = fromLocal(start, distance * u, lateralAt(u));
      // Drifting right lowers the heading.
      return { x: p.x, z: p.z, heading: wrapAngle(start.heading - Math.atan(slopeAt(u))) };
    },
  };
}

/**
 * Tangent-continuous turn between two poses whose tangent lines intersect:
 * straight — circular arc — straight, using the largest radius that fits.
 * Throws when the poses do not describe a turn (parallel, or the corner lies
 * behind the start / beyond the end).
 */
export function filletTurn(from: Pose, to: Pose): PathPiece[] {
  const f0 = forwardOf(from.heading);
  const f1 = forwardOf(to.heading);
  const cross = f0.x * f1.z - f0.z * f1.x;
  const turn = angleDiff(to.heading, from.heading);
  if (Math.abs(cross) < 1e-6) throw new Error('filletTurn: headings are parallel');
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  // from + a·f0 = corner = to − b·f1
  const a = (dx * f1.z - dz * f1.x) / cross;
  const b = -(dx * f0.z - dz * f0.x) / cross;
  if (a <= 1e-6 || b <= 1e-6) throw new Error('filletTurn: poses do not form a forward turn');
  const tangent = Math.min(a, b);
  const radius = tangent / Math.tan(Math.abs(turn) / 2);
  const arcStart: Pose = { x: from.x + f0.x * (a - tangent), z: from.z + f0.z * (a - tangent), heading: from.heading };
  const arcEnd: Vec2 = { x: to.x - f1.x * (b - tangent), z: to.z - f1.z * (b - tangent) };
  const pieces: PathPiece[] = [];
  if (a - tangent > 1e-6) pieces.push(linePiece(from, arcStart));
  pieces.push(arcFromPose(arcStart, radius, turn));
  if (b - tangent > 1e-6) pieces.push(linePiece(arcEnd, to));
  return pieces;
}

/**
 * Sample a chain of pieces at even intervals of at most `spacing` metres.
 * The first and last samples are exactly the ends of the chain.
 */
export function samplePath(pieces: readonly PathPiece[], spacing: number): SampledPath {
  const live = pieces.filter((p) => p.length > 1e-9);
  const total = live.reduce((sum, p) => sum + p.length, 0);
  if (live.length === 0 || total <= 0) throw new Error('samplePath: empty path');
  const steps = Math.max(1, Math.ceil(total / spacing - 1e-9));
  const points: Vec2[] = [];
  const headings: number[] = [];
  let piece = 0;
  let pieceStart = 0;
  for (let k = 0; k <= steps; k++) {
    const d = k === steps ? total : (total * k) / steps;
    while (piece < live.length - 1 && d > pieceStart + live[piece].length) {
      pieceStart += live[piece].length;
      piece++;
    }
    const pose = live[piece].poseAt(Math.min(d - pieceStart, live[piece].length));
    points.push({ x: pose.x, z: pose.z });
    headings.push(pose.heading);
  }
  const cumulative = cumulativeLengths(points);
  return { points, headings, cumulative, length: cumulative[cumulative.length - 1] };
}

export function cumulativeLengths(points: readonly Vec2[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  }
  return out;
}

/** Index `i` of the polyline segment [i, i+1] that contains distance `s` (clamped). */
function segmentAt(cumulative: readonly number[], s: number): number {
  let lo = 0;
  let hi = cumulative.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumulative[mid] <= s) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Pose at distance `s` along a sampled path (clamped to its ends). Position is
 * interpolated along the polyline; heading is interpolated between the exact
 * tangents stored at the two surrounding samples.
 */
export function poseOnPath(
  points: readonly Vec2[],
  headings: readonly number[],
  cumulative: readonly number[],
  s: number,
): Pose {
  const last = cumulative.length - 1;
  if (s <= 0) return { x: points[0].x, z: points[0].z, heading: headings[0] };
  if (s >= cumulative[last]) return { x: points[last].x, z: points[last].z, heading: headings[last] };
  const i = segmentAt(cumulative, s);
  const span = cumulative[i + 1] - cumulative[i];
  const t = span > 0 ? (s - cumulative[i]) / span : 0;
  return {
    x: points[i].x + (points[i + 1].x - points[i].x) * t,
    z: points[i].z + (points[i + 1].z - points[i].z) * t,
    heading: wrapAngle(headings[i] + angleDiff(headings[i + 1], headings[i]) * t),
  };
}

/** Result slot for `nearestOnPolyline` (reused by callers to avoid allocation). */
export interface PolylineHit {
  /** Squared distance from the query point to the polyline. */
  distSq: number;
  /** Distance along the polyline of the closest point. */
  s: number;
  /** Signed offset of the query point from the polyline, positive to the RIGHT of its direction. */
  lateral: number;
}

export const newPolylineHit = (): PolylineHit => ({ distSq: Infinity, s: 0, lateral: 0 });

/** Closest point of a polyline to (px, pz). Writes into `out`; allocation free. */
export function nearestOnPolyline(
  px: number,
  pz: number,
  points: readonly Vec2[],
  cumulative: readonly number[],
  out: PolylineHit,
): void {
  let best = Infinity;
  let bestS = 0;
  let bestLateral = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    if (l2 < 1e-12) continue;
    let t = ((px - a.x) * abx + (pz - a.z) * abz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (a.x + abx * t);
    const dz = pz - (a.z + abz * t);
    const d2 = dx * dx + dz * dz;
    if (d2 < best) {
      best = d2;
      const l = Math.sqrt(l2);
      bestS = cumulative[i] + l * t;
      // Right-hand vector of the direction (abx, abz)/l is (−abz, abx)/l.
      bestLateral = (-dx * abz + dz * abx) / l;
    }
  }
  out.distSq = best;
  out.s = bestS;
  out.lateral = bestLateral;
}
