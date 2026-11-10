/**
 * Types shared by the input module's internals and re-exported from `index.ts`.
 * Types only — safe to import from anywhere, including unit tests in node.
 */

import type { AppSettings, Gear, HeadlightState, IndicatorState, LookDir, SpeedUnit } from '../core/types';

/** Things the player asks of the app rather than of the car. */
export type UiAction = 'pause' | 'camera' | 'help' | 'restart';

export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** The two user preferences the input layer reads (live, every frame). */
export type InputSettings = Pick<AppSettings, 'touchControls' | 'steeringSensitivity'>;

/** Car state the touch overlay mirrors on its buttons. */
export interface TouchDisplayState {
  gear: Gear;
  indicator: IndicatorState;
  handbrake: boolean;
  engineOn: boolean;
  seatbelt: boolean;
  headlights: HeadlightState;
  wipers: boolean;
  unit: SpeedUnit;
}

/** The held / analog part of one device's contribution to a `ControlInput`. */
export interface DeviceSample {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** −1 (left) .. +1 (right) */
  steer: number;
  look: LookDir;
  horn: boolean;
}

export const neutralSample = (): DeviceSample => ({ throttle: 0, brake: 0, steer: 0, look: 'ahead', horn: false });
