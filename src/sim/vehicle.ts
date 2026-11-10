/**
 * Vehicle model shared by the learner's car and anything else that needs
 * believable car motion.
 *
 * Lateral motion is a kinematic bicycle model integrated about the REAR AXLE
 * (the point a real car pivots around) and converted back to the centre of the
 * footprint, which is what `SimVehicle.x/z` store. The axles are assumed to sit
 * symmetrically about the footprint centre.
 *
 * Longitudinal motion is a small force model expressed directly as
 * accelerations (m/s²):
 *
 *   drive      full-throttle acceleration tapers linearly to zero at top speed;
 *              with no pedal an idling engine in gear regulates the car toward
 *              walking pace (automatic-gearbox creep below it, gentle engine
 *              braking above it)
 *   resistance brakes (scaled by grip), parking brake, rolling resistance and
 *              aerodynamic drag — these only ever oppose motion, so they can
 *              bring the car to rest but never push it through zero
 *
 * The resulting acceleration is jerk limited: brake pressure, driveline torque
 * and weight transfer all take a moment to build, which is what makes real
 * stopping distances longer than v² / 2a.
 *
 * Conventions (see src/core/types.ts): heading h has forward = (sin h, cos h),
 * steering is positive to the RIGHT and turning right DECREASES the heading.
 */

import { PLAYER_SPEC } from '../core/constants';
import { approach, clamp, wrapAngle } from '../core/math';
import type { Obb, Pose, SimVehicle, VehicleModel, VehicleSpec } from '../core/types';

/* -------------------------------------------------------------------------- */
/* Specs                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Dimensions and performance of every vehicle model. Treat the entries as
 * immutable: vehicles created with `createVehicle` share these objects.
 * Everything except the bus fits a standard 2.6 m × 5.2 m parking bay.
 */
export const VEHICLE_SPECS: Record<VehicleModel, VehicleSpec> = {
  hatchback: PLAYER_SPEC,
  sedan: {
    length: 4.7,
    width: 1.85,
    height: 1.45,
    wheelbase: 2.8,
    maxSteer: 0.6,
    maxAccel: 3.0,
    maxBrake: 8.5,
    maxSpeed: 50,
    maxReverseSpeed: 6,
  },
  suv: {
    length: 4.7,
    width: 1.9,
    height: 1.7,
    wheelbase: 2.8,
    maxSteer: 0.59,
    maxAccel: 2.8,
    maxBrake: 8.0,
    maxSpeed: 48,
    maxReverseSpeed: 6,
  },
  van: {
    length: 5.0,
    width: 2.0,
    height: 2.3,
    wheelbase: 3.1,
    maxSteer: 0.6,
    maxAccel: 2.2,
    maxBrake: 7.5,
    maxSpeed: 40,
    maxReverseSpeed: 5,
  },
  pickup: {
    length: 5.2,
    width: 1.9,
    height: 1.85,
    wheelbase: 3.2,
    maxSteer: 0.58,
    maxAccel: 2.6,
    maxBrake: 7.5,
    maxSpeed: 44,
    maxReverseSpeed: 5,
  },
  bus: {
    length: 10.5,
    width: 2.5,
    height: 3.1,
    wheelbase: 5.4,
    maxSteer: 0.78,
    maxAccel: 1.3,
    maxBrake: 6.0,
    maxSpeed: 28,
    maxReverseSpeed: 3,
  },
};

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

/** m/s² */
export const GRAVITY = 9.81;

/** Speed an automatic settles at in gear with no pedals pressed, m/s (~6 km/h). */
export const CREEP_SPEED = 1.6;

/** Cornering limit as a fraction of g on a dry road; multiplied by grip. Beyond it the car understeers. */
export const MAX_LATERAL_G = 0.75;

/** Deceleration from a fully applied parking brake on a dry road, m/s². */
export const HANDBRAKE_DECEL = 2.5;

/** Strongest push the idling engine gives through the torque converter, m/s². */
const CREEP_ACCEL = 0.9;
/** Strongest engine braking when coasting in gear, m/s². */
const ENGINE_BRAKE_DECEL = 0.45;
/** How firmly the idling engine pulls the car toward its idle speed, 1/s. */
const IDLE_GAIN = 1.5;
/** Tyre rolling resistance, m/s². */
const ROLLING_DECEL = 0.12;
/** Aerodynamic drag: deceleration = AERO_DRAG · v² (1/m). */
const AERO_DRAG = 0.0003;
/** Idle speed the engine aims for so that, after rolling resistance, the car settles at CREEP_SPEED. */
const IDLE_TARGET_SPEED = CREEP_SPEED + ROLLING_DECEL / IDLE_GAIN;
/** Reverse gear gives less shove than first. */
const REVERSE_ACCEL_FACTOR = 0.6;
/** Fastest the longitudinal acceleration can change, m/s³ (full braking builds in about 0.3 s). */
const MAX_JERK = 30;
/** Longest interval integrated in one go, s; longer calls are split into equal sub-steps. */
const MAX_STEP = 1 / 20;
/** Grip values outside this range are treated as a caller error and clamped. */
const MIN_GRIP = 0.05;
const MAX_GRIP = 1.5;

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export function createVehicle(opts: {
  id: number;
  kind: SimVehicle['kind'];
  model: VehicleModel;
  pose: Pose;
  colour: number;
  speed?: number;
}): SimVehicle {
  return {
    id: opts.id,
    kind: opts.kind,
    model: opts.model,
    colour: opts.colour,
    spec: VEHICLE_SPECS[opts.model],
    x: opts.pose.x,
    z: opts.pose.z,
    heading: wrapAngle(opts.pose.heading),
    speed: opts.kind === 'parked' ? 0 : (opts.speed ?? 0),
    accel: 0,
    steer: 0,
    indicator: 'off',
    braking: false,
    reversing: false,
    headlights: false,
    nav: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Dynamics                                                                   */
/* -------------------------------------------------------------------------- */

export interface DriveCommand {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** target front-wheel angle, radians, + = right */
  steer: number;
  /** 1 forward gear, -1 reverse, 0 neutral/park */
  direction: 1 | 0 | -1;
  handbrake: boolean;
  /** automatic-gearbox idle creep */
  creep: boolean;
  /** engine running */
  power: boolean;
}

/**
 * Advance a vehicle by `dt` seconds. Mutates `speed`, `accel`, `steer`, `x`,
 * `z` and `heading`; nothing else is touched.
 *
 * `grip` is the tyre grip multiplier (1 dry): it scales braking and the
 * cornering limit. Intended for the fixed 1/60 s tick; larger steps are
 * integrated in sub-steps of at most 1/20 s.
 */
export function stepVehicle(v: SimVehicle, cmd: DriveCommand, dt: number, grip = 1): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const tyreGrip = clamp(Number.isFinite(grip) ? grip : 1, MIN_GRIP, MAX_GRIP);
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-9));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) integrate(v, cmd, h, tyreGrip);
}

function integrate(v: SimVehicle, cmd: DriveCommand, dt: number, grip: number): void {
  const spec = v.spec;
  const travelled = advanceSpeed(v, cmd, dt, grip);

  const steer = clamp(finiteOr(cmd.steer, 0), -spec.maxSteer, spec.maxSteer);
  v.steer = steer;
  if (travelled === 0) return;

  // The tyres can only supply so much cornering force: past that the front
  // washes out and the car runs wide instead of following the wheels.
  const meanSpeed = travelled / dt;
  const tanLimit = (MAX_LATERAL_G * GRAVITY * grip * spec.wheelbase) / (meanSpeed * meanSpeed);
  const tanSteer = clamp(Math.tan(steer), -tanLimit, tanLimit);

  // Bicycle model: the rear axle sweeps an arc of radius wheelbase / tan(steer).
  // Steering right (+) while moving forward (+) turns right, i.e. reduces heading.
  const turn = -(travelled / spec.wheelbase) * tanSteer;
  const heading = v.heading + turn;
  const midHeading = v.heading + turn / 2;
  // Exact chord of the arc, so the path does not depend on the step size.
  const chord = travelled * sinc(turn / 2);
  // Move the rear axle along the chord, then put the centre back half a
  // wheelbase ahead of it on the new heading.
  const halfBase = spec.wheelbase / 2;
  v.x += chord * Math.sin(midHeading) + halfBase * (Math.sin(heading) - Math.sin(v.heading));
  v.z += chord * Math.cos(midHeading) + halfBase * (Math.cos(heading) - Math.cos(v.heading));
  v.heading = wrapAngle(heading);
}

/**
 * Update `v.speed` / `v.accel` and return the signed distance travelled along
 * the heading during the step.
 */
function advanceSpeed(v: SimVehicle, cmd: DriveCommand, dt: number, grip: number): number {
  const spec = v.spec;
  const speed = v.speed;
  const direction = cmd.power ? cmd.direction : 0;
  // The accelerator only does something with the engine running and a gear engaged.
  const pedal = direction !== 0 ? clamp01(cmd.throttle) : 0;

  // Signed push from the engine along the heading.
  let drive = 0;
  if (direction !== 0) {
    const along = speed * direction; // speed in the direction the selected gear drives
    const forward = direction > 0;
    const peak = forward ? spec.maxAccel : spec.maxAccel * REVERSE_ACCEL_FACTOR;
    const top = forward ? spec.maxSpeed : spec.maxReverseSpeed;
    const taper = clamp(1 - along / top, 0, 1);
    drive = direction * (pedal * peak * taper + (1 - pedal) * idleAccel(along, cmd.creep));
  }

  // Everything that only opposes motion. Foot brake and parking brake share the
  // same tyres, so together they cannot exceed what the service brakes manage.
  const braking =
    Math.min(spec.maxBrake, clamp01(cmd.brake) * spec.maxBrake + (cmd.handbrake ? HANDBRAKE_DECEL : 0)) * grip;
  // The full-throttle curve is the car's NET performance, so the coasting
  // losses fade out as the pedal goes down (this also makes maxSpeed exact).
  const resistance = braking + (1 - pedal) * (ROLLING_DECEL + AERO_DRAG * speed * speed);

  let accel = v.accel;
  let target: number;
  if (speed !== 0) {
    target = drive - Math.sign(speed) * resistance;
  } else if (Math.abs(drive) > resistance) {
    // Breaking away from rest.
    target = drive - Math.sign(drive) * resistance;
    if (accel * target < 0) accel = 0; // never set off the wrong way on stale acceleration
  } else {
    // Held at rest: friction simply balances whatever the engine is doing.
    v.accel = 0;
    return 0;
  }

  accel = approach(accel, target, MAX_JERK * dt);
  const next = speed + accel * dt;

  if (speed !== 0 && next * speed <= 0) {
    // The car comes to rest part-way through the step. It stops exactly; if the
    // engine can overcome the brakes it sets off again from rest next step.
    v.speed = 0;
    v.accel = 0;
    return -(speed * speed) / (2 * accel);
  }

  v.speed = clamp(next, -spec.maxReverseSpeed, spec.maxSpeed);
  v.accel = accel;
  return ((speed + v.speed) / 2) * dt;
}

/**
 * Acceleration from an idling engine in gear, relative to the gear's direction
 * of travel: positive creep below idle speed, engine braking above it.
 */
function idleAccel(along: number, creep: boolean): number {
  return creep
    ? clamp(IDLE_GAIN * (IDLE_TARGET_SPEED - along), -ENGINE_BRAKE_DECEL, CREEP_ACCEL)
    : clamp(-IDLE_GAIN * along, -ENGINE_BRAKE_DECEL, 0);
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Footprint of a vehicle, optionally grown by `margin` metres on every side. */
export function vehicleObb(v: SimVehicle, margin = 0): Obb {
  return {
    x: v.x,
    z: v.z,
    heading: v.heading,
    halfLength: v.spec.length / 2 + margin,
    halfWidth: v.spec.width / 2 + margin,
  };
}

/** Radius of the circle traced by the middle of the rear axle at wheel angle `steer` (Infinity when straight). */
export function turningRadius(spec: VehicleSpec, steer: number = spec.maxSteer): number {
  const t = Math.abs(Math.tan(steer));
  return t > 1e-9 ? spec.wheelbase / t : Infinity;
}

/** Kerb-to-kerb turning circle at full lock: diameter swept by the outer front wheel, metres. */
export function kerbTurningCircle(spec: VehicleSpec): number {
  return 2 * Math.hypot(turningRadius(spec) + spec.width / 2, spec.wheelbase);
}

/**
 * Largest wheel angle (radians) the tyres can make use of at `speed`: more lock
 * than this only produces understeer. Capped at the spec's full lock.
 */
export function gripLimitedSteer(spec: VehicleSpec, speed: number, grip = 1, lateralG = MAX_LATERAL_G): number {
  const v2 = speed * speed;
  if (v2 < 1e-6) return spec.maxSteer;
  return Math.min(spec.maxSteer, Math.atan((lateralG * GRAVITY * grip * spec.wheelbase) / v2));
}

/* -------------------------------------------------------------------------- */

const clamp01 = (x: number): number => clamp(finiteOr(x, 0), 0, 1);

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

/** sin(x) / x, well behaved near zero. */
const sinc = (x: number): number => (Math.abs(x) < 1e-4 ? 1 - (x * x) / 6 : Math.sin(x) / x);
