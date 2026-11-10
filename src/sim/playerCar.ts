/**
 * The learner's car: turns one tick of driver input into car state.
 *
 * `updatePlayerCar` applies the edge-triggered commands (engine, gears,
 * indicators, lights…) with the interlocks a real automatic has, moves the
 * steering wheel toward the requested angle, integrates the vehicle and keeps
 * the bookkeeping the rule monitor relies on (observation time stamps,
 * indicator timing, odometer, time stationary).
 *
 * It never calls `network.locate`; the session refreshes `player.location`
 * straight afterwards.
 */

import { STOPPED_SPEED } from '../core/constants';
import { angleDiff, approach, clamp, DEG, lerp } from '../core/math';
import type {
  ControlInput,
  Gear,
  HeadlightState,
  IndicatorState,
  LookDir,
  PlayerCar,
  PlayerCommand,
  Pose,
  SimContext,
  Terminology,
  VehicleSpec,
} from '../core/types';
import { createVehicle, gripLimitedSteer, MAX_LATERAL_G, stepVehicle } from './vehicle';

/* -------------------------------------------------------------------------- */
/* Tuning                                                                     */
/* -------------------------------------------------------------------------- */

/** Body colour of the learner's car (0xRRGGBB). */
export const PLAYER_COLOUR = 0xd8432e;

/** Thresholds for the gear-selector and ignition interlocks. */
export const INTERLOCKS = {
  /** Brake pedal travel needed to move the selector out of Park. */
  brakeToLeavePark: 0.2,
  /** Changing between Drive and Reverse needs the car slower than this, m/s. */
  directionChangeSpeed: 0.5,
  /** Selecting Park needs the car slower than this, m/s. */
  parkSpeed: 0.3,
  /** The engine can only be switched off below this speed, m/s. */
  engineOffSpeed: 1,
} as const;

/** How the steering wheel follows keyboard / stick input. */
export const STEERING = {
  /** Seconds from full left lock to full right lock at parking speeds. */
  lockToLockTime: 1.1,
  /** Above this speed (m/s) the lock a full input asks for starts to fade… */
  fadeStartSpeed: 8,
  /** …until by this speed (m/s) a full input only asks for `cruiseLateralG`. */
  fadeEndSpeed: 20,
  /** Cornering effort of a full input at and above `fadeEndSpeed`, as a fraction of g (scaled by grip). */
  cruiseLateralG: 0.3,
  /** The wheel never moves slower than this fraction of the parking-speed rate. */
  minRateFraction: 0.08,
} as const;

/** Seconds a look over the shoulder must be held before it counts as a check. */
export const LOOK_DWELL = 0.25;

/** How the indicator stalk springs back after a turn. All wheel values are fractions of full lock. */
export const SELF_CANCEL = {
  /** Steering input beyond this, toward the indicated side, is "steering into the turn". */
  steerInput: 0.35,
  /** It has to be held this long (s)… */
  steerHold: 0.4,
  /** …with the road wheels at least this far over for the stalk to latch. */
  latchWheel: 0.25,
  /** Alternatively the stalk latches once the car has turned this far toward the indicated side, radians. */
  headingChange: 40 * DEG,
  /** Once latched, the stalk cancels when the wheels come back inside this. */
  straightWheel: 0.15,
} as const;

/* -------------------------------------------------------------------------- */
/* Construction                                                               */
/* -------------------------------------------------------------------------- */

export type PlayerCarInit = Partial<
  Pick<PlayerCar, 'gear' | 'handbrake' | 'engineOn' | 'seatbelt' | 'headlights' | 'wipers'>
>;

/**
 * A new learner's car at `pose`. The default is a cold start — engine off,
 * seatbelt unfastened, selector in Park, parking brake on, lights and wipers
 * off — so the driver has to go through the cockpit drill. Pass `init` to
 * start part-way through it (e.g. rolling scenarios).
 */
export function createPlayerCar(pose: Pose, init: PlayerCarInit = {}): PlayerCar {
  const vehicle = createVehicle({ id: 0, kind: 'player', model: 'hatchback', pose, colour: PLAYER_COLOUR });
  const gear = init.gear ?? 'P';
  const headlights = init.headlights ?? 'off';
  vehicle.reversing = gear === 'R';
  vehicle.headlights = headlights !== 'off';
  return {
    vehicle,
    gear,
    handbrake: init.handbrake ?? true,
    engineOn: init.engineOn ?? false,
    seatbelt: init.seatbelt ?? false,
    indicator: 'off',
    headlights,
    wipers: init.wipers ?? false,
    horn: false,
    look: 'ahead',
    throttle: 0,
    brake: 0,
    steerInput: 0,
    lastMirrorCheck: { left: -Infinity, centre: -Infinity, right: -Infinity },
    lastShoulderCheck: { left: -Infinity, right: -Infinity, back: -Infinity },
    indicatorSince: null,
    indicatorOdometer: null,
    odometer: 0,
    stoppedFor: 0,
    location: { kind: 'offroad' },
  };
}

/* -------------------------------------------------------------------------- */
/* Pure rules                                                                 */
/* -------------------------------------------------------------------------- */

/** Stalk logic: the same direction again cancels, left/right/hazard replace each other, 'off' cancels. */
export function nextIndicator(
  current: IndicatorState,
  value: 'left' | 'right' | 'hazard' | 'off',
): IndicatorState {
  return value === 'off' || value === current ? 'off' : value;
}

/** Light switch cycle: off → low → high → off. */
export function nextHeadlights(current: HeadlightState): HeadlightState {
  return current === 'off' ? 'low' : current === 'low' ? 'high' : 'off';
}

export type GearBlock = 'engine_off' | 'brake_needed' | 'still_moving' | 'park_while_moving';
export type EngineBlock = 'not_in_park_or_neutral' | 'engine_off_while_moving';

/**
 * Why the selector cannot move to `target` right now, or null when the shift is
 * allowed. Mirrors a real automatic:
 *  - Drive and Reverse need the engine running (Park and Neutral can always be
 *    selected, otherwise a car switched off in gear could never be restarted);
 *  - leaving Park needs the brake pedal pressed;
 *  - Park needs the car at rest;
 *  - swapping between Drive and Reverse — directly or by way of Neutral —
 *    needs the car at rest.
 */
export function gearInterlock(
  state: { gear: Gear; engineOn: boolean; speed: number; brake: number },
  target: Gear,
): GearBlock | null {
  if (target === state.gear) return null;
  const driving = target === 'D' || target === 'R';
  if (driving && !state.engineOn) return 'engine_off';
  if (state.gear === 'P' && !(state.brake > INTERLOCKS.brakeToLeavePark)) return 'brake_needed';
  if (target === 'P' && Math.abs(state.speed) >= INTERLOCKS.parkSpeed) return 'park_while_moving';
  if (driving) {
    const swap = state.gear === 'D' || state.gear === 'R';
    // Coming out of Neutral only matters if the car is rolling against the new gear.
    const against = target === 'D' ? -state.speed : state.speed;
    if ((swap ? Math.abs(state.speed) : against) >= INTERLOCKS.directionChangeSpeed) return 'still_moving';
  }
  return null;
}

/** Why the start/stop button will not respond right now, or null when it will. */
export function engineInterlock(state: { gear: Gear; engineOn: boolean; speed: number }): EngineBlock | null {
  if (state.engineOn) {
    return Math.abs(state.speed) >= INTERLOCKS.engineOffSpeed ? 'engine_off_while_moving' : null;
  }
  return state.gear === 'P' || state.gear === 'N' ? null : 'not_in_park_or_neutral';
}

const GEAR_NAME: Record<Gear, string> = { P: 'Park (P)', R: 'Reverse (R)', N: 'Neutral (N)', D: 'Drive (D)' };

/** Short coaching line for a refused command, in the jurisdiction's vocabulary. */
export function interlockMessage(block: GearBlock | EngineBlock, terms: Terminology, target: Gear = 'D'): string {
  switch (block) {
    case 'engine_off':
      return `Start the engine before selecting ${GEAR_NAME[target]}.`;
    case 'brake_needed':
      return `Hold the brake pedal — not the ${terms.accelerator} — to shift out of ${GEAR_NAME.P}.`;
    case 'still_moving':
      return `Stop completely before changing between ${GEAR_NAME.D} and ${GEAR_NAME.R}.`;
    case 'park_while_moving':
      return `Stop completely before selecting ${GEAR_NAME.P}.`;
    case 'not_in_park_or_neutral':
      return `Select ${GEAR_NAME.P} or ${GEAR_NAME.N} before starting the engine.`;
    case 'engine_off_while_moving':
      return 'Stop the car before switching the engine off.';
  }
}

/**
 * Wheel angle (radians) that a full steering input asks for at `speed`.
 *
 * Up to `STEERING.fadeStartSpeed` it is everything the tyres can use (full lock
 * at parking speeds). Above that the cornering effort of a full input fades
 * from the grip limit down to a gentle `cruiseLateralG`, so a held arrow key at
 * 70 km/h is a firm lane change rather than a swerve.
 */
export function steeringReach(spec: VehicleSpec, speed: number, grip = 1): number {
  const v = Math.abs(speed);
  const t = clamp((v - STEERING.fadeStartSpeed) / (STEERING.fadeEndSpeed - STEERING.fadeStartSpeed), 0, 1);
  const fade = t * t * (3 - 2 * t);
  return gripLimitedSteer(spec, v, grip, lerp(MAX_LATERAL_G, STEERING.cruiseLateralG, fade));
}

/**
 * How fast the wheel turns (rad/s) when the reachable lock is `reach`. Scaling
 * the rate with the reach keeps the feel constant: centre to "full input"
 * always takes about half the lock-to-lock time, so a quick tap is a small
 * correction at any speed.
 */
export function steeringRate(spec: VehicleSpec, reach: number, sensitivity = 1): number {
  const parkingRate = (2 * spec.maxSteer) / STEERING.lockToLockTime;
  return parkingRate * Math.max(STEERING.minRateFraction, reach / spec.maxSteer) * sensitivity;
}

/** Memory of the indicator stalk's self-cancelling mechanism. */
export interface SelfCancelState {
  /** Seconds the driver has continuously steered toward the indicated side. */
  steerHold: number;
  /** Net heading change toward the indicated side since switch-on, radians. */
  turned: number;
  /** The stalk has latched: it will spring back when the wheel straightens. */
  latched: boolean;
}

export const createSelfCancelState = (): SelfCancelState => ({ steerHold: 0, turned: 0, latched: false });

/**
 * Advance the self-cancel mechanism by one tick and report whether the stalk
 * springs back now.
 *
 * Like a real stalk it latches once the driver has clearly steered toward the
 * indicated side and releases when the wheel comes back to centre. Requiring
 * real wheel angle (not just a held key) is what keeps it from cancelling
 * during a lane change at speed, where the wheels barely move.
 *
 * @param side          +1 for a right indicator, −1 for a left one
 * @param steerInput    driver's steering input, −1..1, + = right
 * @param wheelFraction current road-wheel angle as a fraction of full lock, + = right
 * @param headingDelta  change of heading during this tick, radians (turning right is negative)
 */
export function stepSelfCancel(
  state: SelfCancelState,
  side: 1 | -1,
  steerInput: number,
  wheelFraction: number,
  headingDelta: number,
  dt: number,
): boolean {
  const steeringIn = steerInput * side > SELF_CANCEL.steerInput;
  state.steerHold = steeringIn ? state.steerHold + dt : 0;
  state.turned -= side * headingDelta;
  if (!state.latched) {
    const heldOver = state.steerHold > SELF_CANCEL.steerHold && wheelFraction * side > SELF_CANCEL.latchWheel;
    state.latched = heldOver || state.turned > SELF_CANCEL.headingChange;
  }
  return state.latched && !steeringIn && Math.abs(wheelFraction) < SELF_CANCEL.straightWheel;
}

/* -------------------------------------------------------------------------- */
/* Per-car driver state that is not part of the shared PlayerCar contract     */
/* -------------------------------------------------------------------------- */

interface DriverState {
  lookDir: LookDir;
  lookHeld: number;
  /** Indicator the self-cancel memory belongs to. */
  indicator: IndicatorState;
  selfCancel: SelfCancelState;
}

const DRIVER_STATE = new WeakMap<PlayerCar, DriverState>();

function driverStateOf(player: PlayerCar): DriverState {
  let state = DRIVER_STATE.get(player);
  if (!state) {
    state = { lookDir: 'ahead', lookHeld: 0, indicator: player.indicator, selfCancel: createSelfCancelState() };
    DRIVER_STATE.set(player, state);
  }
  return state;
}

/* -------------------------------------------------------------------------- */
/* Tick                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Advance the learner's car by one tick.
 *
 * @param steeringSensitivity multiplier on how fast the wheel follows the input
 *        (`AppSettings.steeringSensitivity`, 0.5..1.5); 1 when omitted.
 */
export function updatePlayerCar(ctx: SimContext, input: ControlInput, dt: number, steeringSensitivity = 1): void {
  const player = ctx.player;
  const vehicle = player.vehicle;
  const spec = vehicle.spec;
  const driver = driverStateOf(player);

  const throttle = unit(input.throttle);
  const brake = unit(input.brake);
  const steerInput = clamp(finiteOr(input.steer, 0), -1, 1);
  player.throttle = throttle;
  player.brake = brake;
  player.steerInput = steerInput;

  for (const command of input.commands) {
    if (applyCommand(ctx, command)) ctx.events.emit('command', command);
  }

  if (input.horn && !player.horn) ctx.events.emit('horn', {});
  player.horn = input.horn;

  if (!(dt > 0)) {
    syncLamps(player);
    return;
  }

  trackLook(player, driver, input.look, ctx.time, dt);

  // Steering wheel: follows the input at a finite rate and self-centres.
  const grip = ctx.env.grip;
  const reach = steeringReach(spec, vehicle.speed, grip);
  const rate = steeringRate(spec, reach, clamp(finiteOr(steeringSensitivity, 1), 0.1, 4));
  const wheel = approach(vehicle.steer, steerInput * reach, rate * dt);

  // Drivetrain.
  const direction = player.gear === 'D' ? 1 : player.gear === 'R' ? -1 : 0;
  if (player.gear === 'P') vehicle.speed = 0; // the parking pawl locks the driven wheels
  const fromX = vehicle.x;
  const fromZ = vehicle.z;
  const fromHeading = vehicle.heading;
  stepVehicle(
    vehicle,
    {
      throttle,
      brake,
      steer: wheel,
      direction,
      handbrake: player.handbrake,
      creep: direction !== 0,
      power: player.engineOn,
    },
    dt,
    grip,
  );

  // Indicator stalk self-cancel (hazard lights never cancel themselves).
  if (driver.indicator !== player.indicator) adoptIndicator(ctx, driver);
  if (player.indicator === 'left' || player.indicator === 'right') {
    const side = player.indicator === 'right' ? 1 : -1;
    const headingDelta = angleDiff(vehicle.heading, fromHeading);
    if (stepSelfCancel(driver.selfCancel, side, steerInput, vehicle.steer / spec.maxSteer, headingDelta, dt)) {
      setIndicator(ctx, driver, 'off');
    }
  }

  syncLamps(player);
  vehicle.braking = brake > 0.05;

  player.odometer += Math.hypot(vehicle.x - fromX, vehicle.z - fromZ);
  player.stoppedFor = Math.abs(vehicle.speed) < STOPPED_SPEED ? player.stoppedFor + dt : 0;
}

/** Apply one command. Returns false when it was refused or changed nothing. */
function applyCommand(ctx: SimContext, command: PlayerCommand): boolean {
  const player = ctx.player;
  const speed = player.vehicle.speed;
  switch (command.type) {
    case 'engine': {
      const block = engineInterlock({ gear: player.gear, engineOn: player.engineOn, speed });
      if (block) return refuse(ctx, interlockMessage(block, ctx.profile.terms));
      player.engineOn = !player.engineOn;
      return true;
    }
    case 'gear': {
      if (command.gear === player.gear) return false;
      const block = gearInterlock(
        { gear: player.gear, engineOn: player.engineOn, speed, brake: player.brake },
        command.gear,
      );
      if (block) return refuse(ctx, interlockMessage(block, ctx.profile.terms, command.gear));
      player.gear = command.gear;
      return true;
    }
    case 'indicator': {
      const next = nextIndicator(player.indicator, command.value);
      if (next === player.indicator) return false;
      setIndicator(ctx, driverStateOf(player), next);
      return true;
    }
    case 'handbrake':
      player.handbrake = !player.handbrake;
      return true;
    case 'headlights':
      player.headlights = nextHeadlights(player.headlights);
      return true;
    case 'wipers':
      player.wipers = !player.wipers;
      return true;
    case 'seatbelt':
      player.seatbelt = !player.seatbelt;
      return true;
    case 'mirror':
      player.lastMirrorCheck[command.mirror] = ctx.time;
      return true;
  }
}

function refuse(ctx: SimContext, text: string): false {
  ctx.events.emit('coach', { text, tone: 'warn' });
  return false;
}

function setIndicator(ctx: SimContext, driver: DriverState, value: IndicatorState): void {
  ctx.player.indicator = value;
  ctx.player.vehicle.indicator = value;
  adoptIndicator(ctx, driver);
}

/**
 * Start timing whatever `player.indicator` now shows. Also reached when
 * something other than a command changed the indicator on the shared context.
 */
function adoptIndicator(ctx: SimContext, driver: DriverState): void {
  const player = ctx.player;
  driver.indicator = player.indicator;
  driver.selfCancel = createSelfCancelState();
  if (player.indicator === 'off') {
    player.indicatorSince = null;
    player.indicatorOdometer = null;
  } else {
    player.indicatorSince = ctx.time;
    player.indicatorOdometer = player.odometer;
  }
}

/**
 * Observation: a look over either shoulder counts once it has been held for
 * LOOK_DWELL and keeps counting while held; it also covers that side's mirror.
 * Looking behind counts straight away and covers the centre mirror.
 */
function trackLook(player: PlayerCar, driver: DriverState, look: LookDir, time: number, dt: number): void {
  if (look !== driver.lookDir) {
    driver.lookDir = look;
    driver.lookHeld = 0;
  }
  player.look = look;
  if (look === 'ahead') return;
  driver.lookHeld += dt;
  if (look === 'back') {
    player.lastShoulderCheck.back = time;
    player.lastMirrorCheck.centre = time;
  } else if (driver.lookHeld >= LOOK_DWELL - 1e-9) {
    player.lastShoulderCheck[look] = time;
    player.lastMirrorCheck[look] = time;
  }
}

/** Mirror the driver's switches onto the lamps other road users (and the renderer) see. */
function syncLamps(player: PlayerCar): void {
  const vehicle = player.vehicle;
  vehicle.indicator = player.indicator;
  vehicle.reversing = player.gear === 'R';
  vehicle.headlights = player.headlights !== 'off';
}

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

const unit = (x: number): number => clamp(finiteOr(x, 0), 0, 1);
