import type { VehicleSpec } from './types';

/** Fixed simulation timestep, seconds. */
export const SIM_DT = 1 / 60;

/* Road geometry (metres) */
export const LANE_WIDTH = 3.4;
export const PARKING_STRIP_WIDTH = 2.4;
export const SIDEWALK_WIDTH = 2.6;
export const CROSSWALK_WIDTH = 3.0;
/** Gap between the stop line and the near edge of a junction crosswalk. */
export const STOP_LINE_GAP = 1.2;
export const KERB_HEIGHT = 0.14;

/* Roundabouts */
export const ROUNDABOUT_ISLAND_RADIUS = 7;
export const ROUNDABOUT_LANE_WIDTH = 5;

/** The learner's car: a typical small hatchback. */
export const PLAYER_SPEC: VehicleSpec = {
  length: 4.2,
  width: 1.8,
  height: 1.45,
  wheelbase: 2.6,
  maxSteer: 0.61, // ~35°
  maxAccel: 3.2,
  maxBrake: 8.5,
  maxSpeed: 45,
  maxReverseSpeed: 6,
};

/** |speed| below this counts as stopped, m/s. */
export const STOPPED_SPEED = 0.15;
