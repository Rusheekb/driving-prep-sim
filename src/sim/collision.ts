/**
 * Collisions between the learner's car and everything else.
 *
 * Runs once per tick after traffic and pedestrians have moved. For each thing
 * the car touches it emits ONE `collision` event when the contact begins (the
 * contact re-arms once the two have separated by more than
 * `CONTACT_REARM_GAP`) and then responds:
 *
 *  - vehicles and solid obstacles: the car is pushed out along the axis of
 *    least penetration and loses the part of its speed that was driving it in;
 *  - cones: knocked over (`hit = true`), never block and never report again;
 *  - pedestrians: the car is stopped, nobody is pushed.
 *
 * Finally the car's centre is kept inside the map bounds by a soft wall.
 * Collisions between AI vehicles are the traffic system's business, not ours.
 */

import { clamp, forwardOf, fromLocal, obbContainsPoint, obbCorners, rightOf, toLocal } from '../core/math';
import type { CollisionEvent, Obb, SimContext, StaticObstacle, Vec2 } from '../core/types';
import { vehicleObb } from './vehicle';

/** Pedestrians are treated as circles of this radius, metres. */
export const PEDESTRIAN_RADIUS = 0.35;

/** A contact is over (and may be reported again) once the gap exceeds this, metres. */
export const CONTACT_REARM_GAP = 0.3;

/** Extra clearance left after pushing the car out, so the shapes are cleanly apart. */
const SKIN = 0.005;
/** Slack added to the cheap range check so that it never rejects a contact that is still armed. */
const BROAD_PHASE_MARGIN = CONTACT_REARM_GAP + 0.2;
/** Push-out is repeated a few times so that a corner between two solids is resolved. */
const MAX_PASSES = 3;
/** Speeds below this after an impact are rounded down to a stop, m/s. */
const REST_SPEED = 0.05;

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

export interface Separation {
  /**
   * Positive: size of the gap between the shapes. Negative: how deeply they
   * overlap (the shortest move that separates them is `-distance` along the normal).
   */
  distance: number;
  /** Unit normal pointing from the second shape toward the first. */
  nx: number;
  nz: number;
}

/**
 * Separating-axis test for two oriented boxes that also reports how far apart
 * (or how deep) they are and in which direction `a` lies from `b`.
 *
 * When the boxes are apart, `distance` is the largest gap along any box axis —
 * exact for face-to-face and corner-to-face arrangements, and a slight
 * under-estimate when two corners are nearest.
 */
export function obbSeparation(a: Obb, b: Obb): Separation {
  const fa = forwardOf(a.heading);
  const ra = rightOf(a.heading);
  const fb = forwardOf(b.heading);
  const rb = rightOf(b.heading);
  const dx = a.x - b.x;
  const dz = a.z - b.z;

  let distance = -Infinity;
  let nx = 0;
  let nz = 0;
  const test = (ax: number, az: number): void => {
    const reachA = a.halfLength * Math.abs(fa.x * ax + fa.z * az) + a.halfWidth * Math.abs(ra.x * ax + ra.z * az);
    const reachB = b.halfLength * Math.abs(fb.x * ax + fb.z * az) + b.halfWidth * Math.abs(rb.x * ax + rb.z * az);
    const offset = dx * ax + dz * az;
    const gap = Math.abs(offset) - (reachA + reachB);
    if (gap > distance) {
      distance = gap;
      const side = offset >= 0 ? 1 : -1;
      nx = ax * side;
      nz = az * side;
    }
  };
  test(fa.x, fa.z);
  test(ra.x, ra.z);
  test(fb.x, fb.z);
  test(rb.x, rb.z);
  return { distance, nx, nz };
}

/**
 * Minimum translation vector: the shortest move of `a` that stops it
 * overlapping `b`, or null when the boxes do not overlap.
 */
export function obbMtv(a: Obb, b: Obb): Vec2 | null {
  const s = obbSeparation(a, b);
  return s.distance < 0 ? { x: -s.distance * s.nx, z: -s.distance * s.nz } : null;
}

/** Signed distance between a circle and an oriented box; the normal points from the box toward the circle. */
export function circleObbSeparation(centre: Vec2, radius: number, box: Obb): Separation {
  const local = toLocal(box, centre);
  const f = forwardOf(box.heading);
  const r = rightOf(box.heading);
  const outF = local.forward - clamp(local.forward, -box.halfLength, box.halfLength);
  const outR = local.right - clamp(local.right, -box.halfWidth, box.halfWidth);
  const outside = Math.hypot(outF, outR);
  if (outside > 1e-9) {
    return {
      distance: outside - radius,
      nx: (f.x * outF + r.x * outR) / outside,
      nz: (f.z * outF + r.z * outR) / outside,
    };
  }
  // Centre inside the box: leave through the nearest face.
  const depthF = box.halfLength - Math.abs(local.forward);
  const depthR = box.halfWidth - Math.abs(local.right);
  if (depthF < depthR) {
    const side = local.forward >= 0 ? 1 : -1;
    return { distance: -depthF - radius, nx: f.x * side, nz: f.z * side };
  }
  const side = local.right >= 0 ? 1 : -1;
  return { distance: -depthR - radius, nx: r.x * side, nz: r.z * side };
}

export function circleObbOverlap(centre: Vec2, radius: number, box: Obb): boolean {
  return circleObbSeparation(centre, radius, box).distance < 0;
}

/** A representative point of contact between two overlapping boxes. */
function contactPoint(a: Obb, b: Obb): Vec2 {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const p of obbCorners(a)) {
    if (obbContainsPoint(b, p)) {
      x += p.x;
      z += p.z;
      n++;
    }
  }
  for (const p of obbCorners(b)) {
    if (obbContainsPoint(a, p)) {
      x += p.x;
      z += p.z;
      n++;
    }
  }
  if (n > 0) return { x: x / n, z: z / n };
  // Edges cross without any corner inside: use the point of `b` nearest the middle of `a`.
  const local = toLocal(b, a);
  return fromLocal(
    b,
    clamp(local.forward, -b.halfLength, b.halfLength),
    clamp(local.right, -b.halfWidth, b.halfWidth),
  );
}

/* -------------------------------------------------------------------------- */
/* Contact memory                                                             */
/* -------------------------------------------------------------------------- */

/** Keys of the things the car is currently in contact with, per simulation context. */
interface ContactMemory {
  active: Set<string>;
  /** Scratch set filled during a tick and then swapped with `active`. */
  next: Set<string>;
}

const MEMORY = new WeakMap<SimContext, ContactMemory>();

function memoryOf(ctx: SimContext): ContactMemory {
  let memory = MEMORY.get(ctx);
  if (!memory) {
    memory = { active: new Set(), next: new Set() };
    MEMORY.set(ctx, memory);
  }
  return memory;
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                 */
/* -------------------------------------------------------------------------- */

/** Something the car cannot pass through, gathered by the broad phase. */
interface Solid {
  key: string;
  obb: Obb;
  /** World velocity, m/s. */
  vx: number;
  vz: number;
  with: CollisionEvent['with'];
  id: number | string;
  /** Set when the solid is a static obstacle, so it can be flagged as struck. */
  obstacle: StaticObstacle | null;
}

export function resolveCollisions(ctx: SimContext): void {
  const car = ctx.player.vehicle;
  const memory = memoryOf(ctx);
  const { active, next } = memory;
  next.clear();

  const box = vehicleObb(car);
  const forward = forwardOf(car.heading);
  // The car's velocity as it arrived, before any response: impact speeds are measured against this.
  const vx = forward.x * car.speed;
  const vz = forward.z * car.speed;
  // Half length + half width is at least the distance from the centre to a corner.
  const reach = box.halfLength + box.halfWidth + BROAD_PHASE_MARGIN;
  const near = (x: number, z: number, otherReach: number): boolean =>
    Math.abs(x - box.x) <= reach + otherReach && Math.abs(z - box.z) <= reach + otherReach;

  const report = (kind: CollisionEvent['with'], id: number | string, closing: number, at: Vec2): void => {
    ctx.events.emit('collision', { with: kind, impactSpeed: Math.max(0, closing), otherId: id, x: at.x, z: at.z });
  };

  /* ---- broad phase: solids ---- */
  const solids: Solid[] = [];
  for (const other of ctx.vehicles) {
    if (other === car || other.kind === 'player') continue;
    if (!near(other.x, other.z, (other.spec.length + other.spec.width) / 2)) continue;
    const f = forwardOf(other.heading);
    solids.push({
      key: `v${other.id}`,
      obb: vehicleObb(other),
      vx: f.x * other.speed,
      vz: f.z * other.speed,
      with: other.kind === 'parked' ? 'parked_vehicle' : 'vehicle',
      id: other.id,
      obstacle: null,
    });
  }
  for (const obstacle of ctx.obstacles) {
    if (obstacle.kind === 'cone') continue;
    const o = obstacle.obb;
    if (!near(o.x, o.z, o.halfLength + o.halfWidth)) continue;
    solids.push({ key: `o${obstacle.id}`, obb: o, vx: 0, vz: 0, with: 'obstacle', id: obstacle.id, obstacle });
  }

  /* ---- solids: report new contacts, push the car out, shed inward speed ---- */
  let speed = car.speed;
  for (let pass = 0; pass < MAX_PASSES && solids.length > 0; pass++) {
    let pushed = false;
    for (const solid of solids) {
      const sep = obbSeparation(box, solid.obb);
      if (sep.distance >= 0) {
        // Not touching. A contact from an earlier tick stays armed until the gap opens up.
        if (pass === 0 && sep.distance <= CONTACT_REARM_GAP && active.has(solid.key)) next.add(solid.key);
        continue;
      }
      if (!next.has(solid.key)) {
        if (!active.has(solid.key)) {
          const closing = -((vx - solid.vx) * sep.nx + (vz - solid.vz) * sep.nz);
          report(solid.with, solid.id, closing, contactPoint(box, solid.obb));
          if (solid.obstacle) solid.obstacle.hit = true;
        }
        next.add(solid.key);
      }
      const push = SKIN - sep.distance;
      box.x += sep.nx * push;
      box.z += sep.nz * push;
      pushed = true;
      // Remove the component of the car's own motion that points into the solid.
      const into = forward.x * sep.nx + forward.z * sep.nz;
      if (speed * into < 0) speed *= 1 - into * into;
    }
    if (!pushed) break;
  }
  if (box.x !== car.x || box.z !== car.z) {
    car.x = box.x;
    car.z = box.z;
  }
  if (speed !== car.speed) {
    car.speed = Math.abs(speed) < REST_SPEED ? 0 : speed;
    car.accel = 0;
  }

  /* ---- cones: knocked over once, never solid ---- */
  for (const obstacle of ctx.obstacles) {
    if (obstacle.kind !== 'cone' || obstacle.hit) continue;
    const o = obstacle.obb;
    if (!near(o.x, o.z, o.halfLength + o.halfWidth)) continue;
    const sep = obbSeparation(box, o);
    if (sep.distance >= 0) continue;
    obstacle.hit = true;
    report('obstacle', obstacle.id, -(vx * sep.nx + vz * sep.nz), { x: o.x, z: o.z });
  }

  /* ---- pedestrians: stop, never push ---- */
  for (const ped of ctx.pedestrians) {
    if (!near(ped.x, ped.z, PEDESTRIAN_RADIUS)) continue;
    // Normal points from the car toward the pedestrian.
    const sep = circleObbSeparation(ped, PEDESTRIAN_RADIUS, box);
    const key = `p${ped.id}`;
    if (sep.distance >= 0) {
      if (sep.distance <= CONTACT_REARM_GAP && active.has(key)) next.add(key);
      continue;
    }
    const isNew = !active.has(key);
    next.add(key);
    if (isNew) {
      const pf = forwardOf(ped.heading);
      const closing = (vx - pf.x * ped.speed) * sep.nx + (vz - pf.z * ped.speed) * sep.nz;
      report('pedestrian', ped.id, closing, { x: ped.x, z: ped.z });
    }
    // Stop dead on impact; afterwards the car may only ease away, never further in.
    const toward = (forward.x * sep.nx + forward.z * sep.nz) * car.speed > 0;
    if (car.speed !== 0 && (isNew || toward)) {
      car.speed = 0;
      car.accel = 0;
    }
  }

  /* ---- edge of the world: soft wall ---- */
  const bounds = ctx.network.bounds;
  const x = clamp(car.x, bounds.minX, bounds.maxX);
  const z = clamp(car.z, bounds.minZ, bounds.maxZ);
  if (x !== car.x || z !== car.z) {
    car.x = x;
    car.z = z;
    car.speed = 0;
    car.accel = 0;
  }

  memory.active = next;
  memory.next = active;
}
