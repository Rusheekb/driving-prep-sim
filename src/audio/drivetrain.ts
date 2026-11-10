/**
 * A tiny, purely cosmetic powertrain model for the engine sound.
 *
 * The simulation only knows road speed and throttle, so the audio module
 * invents a believable engine speed: an automatic gearbox with a torque
 * converter. The pitch therefore climbs through a gear, drops back at each
 * shift and settles to a quiet idle at rest — it never rises endlessly.
 *
 * Everything here is pure (no Web Audio, no clock) so it can be unit tested.
 */
import { clamp, lerp } from '../core/math';

/** Engine speed at rest with the throttle closed, rev/min. */
export const IDLE_RPM = 800;
/** Hard ceiling for the modelled engine speed, rev/min. */
export const MAX_RPM = 5200;
/** Road speed (m/s) per 1000 rev/min in each forward gear of a small automatic hatchback. */
export const GEAR_SPEED_PER_KRPM: readonly number[] = [2.2, 3.9, 5.8, 8.0, 10.5, 13.4];
/**
 * Seconds the starter motor turns the engine before it fires. The continuous
 * engine tone stays silent for this long after `engineOn` rises so that the
 * 'engine_start' one-shot (a starter whirr of the same length) leads into it.
 */
export const STARTER_TIME = 0.45;

const TOP_GEAR = GEAR_SPEED_PER_KRPM.length - 1;
/** Engine speed while the starter is cranking. */
const CRANK_RPM = 260;
/** Brief over-rev just after the engine catches. */
const FLARE_RPM = 450;
const FLARE_TIME = 0.5;
/** How far a floored throttle lifts the revs against the torque converter at a standstill. */
const STALL_RISE_RPM = 1500;
/** Minimum time between gear changes, s — stops the box hunting when the throttle is pumped. */
const MIN_SHIFT_INTERVAL = 0.7;
/** Time constants (s) of the first-order lags that make every change glide. */
const RISE_TAU = 0.18;
const FALL_TAU = 0.28;
const CRANK_TAU = 0.08;
const SPIN_DOWN_TAU = 0.22;
const LOAD_TAU = 0.12;
/** Longest step integrated at once; longer frames (tab was in the background) are truncated. */
const MAX_STEP = 0.1;

export interface DrivetrainInput {
  engineOn: boolean;
  /** m/s; the sign is ignored */
  speed: number;
  /** 0..1 */
  throttle: number;
}

export interface DrivetrainState {
  engineOn: boolean;
  /** 0-based index into `GEAR_SPEED_PER_KRPM` */
  gear: number;
  /** Smoothed engine speed, rev/min (0 once a stopped engine has spun down). */
  rpm: number;
  /** Smoothed throttle, 0..1 — how hard the engine is working. */
  load: number;
  /** Seconds until the next gear change is allowed. */
  shiftLock: number;
  /** Seconds of starter cranking left before the engine fires. */
  cranking: number;
  /** Seconds of start-up flare left. */
  flare: number;
}

const unit = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);
const magnitude = (v: number): number => (Number.isFinite(v) ? Math.abs(v) : 0);

/** Exponential approach of `current` toward `target` over `dt` with time constant `tau`. */
const smooth = (current: number, target: number, tau: number, dt: number): number =>
  target + (current - target) * Math.exp(-dt / tau);

/** Engine speed if the wheels were rigidly coupled to the engine in `gear`. */
export function wheelRpm(speed: number, gear: number): number {
  return (magnitude(speed) / GEAR_SPEED_PER_KRPM[clamp(Math.round(gear), 0, TOP_GEAR)]!) * 1000;
}

/**
 * Engine speeds at which the gearbox changes up / down. A light foot shifts
 * early for a calm, low drone; a heavy foot holds each gear longer and kicks
 * down sooner. The gap between the two is wider than the largest ratio step,
 * so a steady speed can never sit on both sides of a shift point.
 */
export function shiftPoints(throttle: number): { up: number; down: number } {
  const t = unit(throttle);
  return { up: lerp(1900, 4200, t), down: lerp(950, 1700, t) };
}

/** The gear the box wants given the gear it is in now (hysteresis keeps it there when either would do). */
export function selectGear(gear: number, speed: number, throttle: number): number {
  const { up, down } = shiftPoints(throttle);
  let g = clamp(Math.round(gear), 0, TOP_GEAR);
  while (g < TOP_GEAR && wheelRpm(speed, g) > up) g++;
  while (g > 0 && wheelRpm(speed, g) < down) g--;
  return g;
}

/** Steady-state engine speed for a running engine. */
export function targetRpm(speed: number, throttle: number, gear: number): number {
  // Below the speed at which the converter locks up, the engine spins freely
  // against the fluid coupling: revs follow the throttle, not the wheels.
  const slipping = IDLE_RPM + STALL_RISE_RPM * unit(throttle);
  return clamp(Math.max(slipping, wheelRpm(speed, gear)), IDLE_RPM, MAX_RPM);
}

/** A drivetrain that has already settled for the given conditions (no start-up sequence). */
export function createDrivetrain(input: DrivetrainInput): DrivetrainState {
  const throttle = unit(input.throttle);
  const gear = selectGear(0, input.speed, throttle);
  return {
    engineOn: input.engineOn,
    gear,
    rpm: input.engineOn ? targetRpm(input.speed, throttle, gear) : 0,
    load: input.engineOn ? throttle : 0,
    shiftLock: 0,
    cranking: 0,
    flare: 0,
  };
}

/** Advance the model by `dt` seconds. Returns a new state; the argument is not modified. */
export function stepDrivetrain(state: DrivetrainState, input: DrivetrainInput, dt: number): DrivetrainState {
  const step = Number.isFinite(dt) ? clamp(dt, 0, MAX_STEP) : 0;
  const throttle = unit(input.throttle);
  const speed = magnitude(input.speed);

  let { gear, rpm, cranking, flare } = state;
  if (!input.engineOn) {
    cranking = 0;
    flare = 0;
  } else if (!state.engineOn) {
    cranking = STARTER_TIME;
    flare = FLARE_TIME;
  }

  let shiftLock = Math.max(0, state.shiftLock - step);
  const wanted = selectGear(gear, speed, throttle);
  if (wanted !== gear && shiftLock <= 0) {
    gear = wanted;
    shiftLock = MIN_SHIFT_INTERVAL;
  }

  let target: number;
  let tau: number;
  if (!input.engineOn) {
    target = 0;
    tau = SPIN_DOWN_TAU;
  } else if (cranking > 0) {
    cranking = Math.max(0, cranking - step);
    target = CRANK_RPM;
    tau = CRANK_TAU;
  } else {
    target = targetRpm(speed, throttle, gear);
    if (flare > 0) {
      flare = Math.max(0, flare - step);
      target = Math.max(target, IDLE_RPM + FLARE_RPM);
    }
    tau = target > rpm ? RISE_TAU : FALL_TAU;
  }

  return {
    engineOn: input.engineOn,
    gear,
    rpm: smooth(rpm, target, tau, step),
    load: smooth(state.load, input.engineOn ? throttle : 0, LOAD_TAU, step),
    shiftLock,
    cranking,
    flare,
  };
}

/** Synthesiser settings for the engine tone. */
export interface EngineVoice {
  /** Firing frequency of a four-cylinder engine (two firings per revolution), Hz. */
  frequency: number;
  /** Low-pass cutoff for the tone, Hz — opens up with revs and load. */
  cutoff: number;
  /** Level of the tonal layer, 0 when the engine is not firing. */
  gain: number;
  /** Level of the breathy intake/exhaust noise layer. */
  hiss: number;
  /** Centre frequency of that noise layer, Hz. */
  hissFrequency: number;
}

/** Lowest oscillator frequency used while a stopped engine spins down, Hz. */
const MIN_FREQUENCY = 6;

/** Map the drivetrain state to oscillator / filter / gain targets. */
export function engineVoice(state: DrivetrainState): EngineVoice {
  const firing = state.engineOn && state.cranking <= 0;
  const rev = clamp((state.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM), 0, 1);
  const load = unit(state.load);
  return {
    frequency: Math.max(MIN_FREQUENCY, state.rpm / 30),
    cutoff: 210 + 1000 * rev + 620 * load,
    gain: firing ? 0.055 + 0.07 * load + 0.04 * rev : 0,
    hiss: firing ? 0.004 + 0.02 * load + 0.012 * rev : 0,
    hissFrequency: 260 + 900 * rev,
  };
}
