/**
 * Pure maths behind the analog controls: gamepad dead-zone and response curve,
 * the touch steering wheel (drag → rotation → steer) and the touch pedals.
 * No DOM, no time — everything here is unit tested in node.
 *
 * Sign convention (same as the simulation): steer is positive to the RIGHT,
 * which on screen is a CLOCKWISE rotation of the wheel.
 */

import { clamp } from '../core/math';

/* -------------------------------------------------------------------------- */
/* Sensitivity                                                                */
/* -------------------------------------------------------------------------- */

export const SENSITIVITY_MIN = 0.5;
export const SENSITIVITY_MAX = 1.5;

/** `AppSettings.steeringSensitivity` made safe: non-finite → 1, clamped to 0.5..1.5. */
export function normaliseSensitivity(sensitivity: number): number {
  return Number.isFinite(sensitivity) ? clamp(sensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX) : 1;
}

/* -------------------------------------------------------------------------- */
/* Gamepad stick                                                              */
/* -------------------------------------------------------------------------- */

/** Stick travel around the centre that is ignored (worn sticks rarely rest at exactly 0). */
export const STICK_DEADZONE = 0.12;

/**
 * Dead-zone for one stick axis. The remaining travel is rescaled to the full
 * −1..1 range so there is no jump at the edge of the dead-zone.
 */
export function applyDeadzone(value: number, deadzone = STICK_DEADZONE): number {
  if (!Number.isFinite(value)) return 0;
  const magnitude = Math.abs(value);
  if (magnitude <= deadzone) return 0;
  const scaled = Math.min(1, (magnitude - deadzone) / (1 - deadzone));
  return value < 0 ? -scaled : scaled;
}

/**
 * Share of the stick response that is cubic rather than linear. More "expo"
 * means finer control around the centre; full deflection is always full lock.
 * Sensitivity 1 → 0.45, 1.5 → 0.1 (nearly linear), 0.5 → 0.8 (very gentle).
 */
export function stickExpo(sensitivity = 1): number {
  return clamp(0.45 + (1 - normaliseSensitivity(sensitivity)) * 0.7, 0, 0.9);
}

/** Raw stick X (−1..1) → steer (−1..1): dead-zone, then a gentle expo curve. */
export function stickSteer(raw: number, sensitivity = 1): number {
  const t = applyDeadzone(raw);
  const expo = stickExpo(sensitivity);
  return t * (1 - expo + expo * t * t);
}

/** Analog triggers often rest slightly above 0; ignore the first few percent. */
export const TRIGGER_DEADZONE = 0.04;

/** Trigger value (0..1) with a small dead-zone, rescaled to the full range. */
export function triggerValue(raw: number): number {
  if (!Number.isFinite(raw) || raw <= TRIGGER_DEADZONE) return 0;
  return Math.min(1, (raw - TRIGGER_DEADZONE) / (1 - TRIGGER_DEADZONE));
}

/* -------------------------------------------------------------------------- */
/* Touch steering wheel                                                       */
/* -------------------------------------------------------------------------- */

/** Wheel rotation, in degrees, that gives full lock at the default sensitivity. */
export const WHEEL_LOCK_DEG = 100;

/**
 * Rotation (radians) from centre to full lock. Sensitivity shortens or
 * lengthens the travel a little (1.5 → 75°, 0.5 → 125°); the range is kept
 * narrow on purpose because a thumb cannot comfortably wind a wheel much
 * further than a third of a turn.
 */
export function wheelLockAngle(sensitivity = 1): number {
  const degrees = WHEEL_LOCK_DEG * (1.5 - 0.5 * normaliseSensitivity(sensitivity));
  return (degrees * Math.PI) / 180;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * How far the wheel turns (radians, clockwise positive) when the pointer moves
 * from `prev` to `cur`. Both points are relative to the wheel centre in screen
 * coordinates (y grows downward).
 *
 * Away from the hub this is the true angle swept around the centre, so the rim
 * follows the thumb exactly. Inside `hubRadius` that angle is ill-conditioned
 * (a tiny movement across the centre would spin the wheel half a turn), so
 * sideways travel is used instead, as if the thumb were pushing the top of the
 * rim at `gripRadius`.
 */
export function wheelDragDelta(prev: Point, cur: Point, hubRadius: number, gripRadius: number): number {
  const nearHub = Math.hypot(prev.x, prev.y) < hubRadius || Math.hypot(cur.x, cur.y) < hubRadius;
  if (nearHub) return gripRadius > 0 ? (cur.x - prev.x) / gripRadius : 0;
  const cross = prev.x * cur.y - prev.y * cur.x;
  const dot = prev.x * cur.x + prev.y * cur.y;
  return Math.atan2(cross, dot);
}

/**
 * New wheel angle after turning by `delta`, stopped at the locks. Clamping the
 * accumulated angle (rather than the output) means the wheel answers at once
 * when the thumb reverses after pushing against a lock.
 */
export function turnWheel(angle: number, delta: number, lock: number): number {
  if (!Number.isFinite(delta)) return angle;
  return clamp(angle + delta, -lock, lock);
}

/** Wheel angle (radians) → steer −1..1. */
export function wheelSteer(angle: number, lock: number): number {
  return lock > 0 ? clamp(angle / lock, -1, 1) : 0;
}

/* -------------------------------------------------------------------------- */
/* Touch pedals                                                               */
/* -------------------------------------------------------------------------- */

/** A touch anywhere on a pedal presses it at least this far, so a tap always does something. */
export const PEDAL_MIN = 0.35;
/** Fraction of the pedal height (from the bottom) at which the pedal is fully pressed. */
export const PEDAL_FULL_AT = 0.85;

/**
 * Pedal travel (0.35..1) for a touch `offsetFromTop` pixels below the top edge
 * of a pedal `height` pixels tall: pressing higher presses harder. Touches
 * dragged beyond either end are clamped.
 */
export function pedalValue(offsetFromTop: number, height: number): number {
  if (!(height > 0) || !Number.isFinite(offsetFromTop)) return PEDAL_MIN;
  const up = 1 - offsetFromTop / height;
  const t = clamp(up / PEDAL_FULL_AT, 0, 1);
  return PEDAL_MIN + (1 - PEDAL_MIN) * t;
}
