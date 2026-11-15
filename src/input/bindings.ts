/**
 * Control bindings — the single source of truth for both behaviour and the
 * controls help screen.
 *
 * The keyboard table below drives the key handler (through `keyTargetForCode`)
 * AND the list shown to the player (`KEY_BINDINGS`), so the two cannot drift
 * apart. It mirrors docs/ARCHITECTURE.md section 6; `bindings.test.ts` checks
 * that table against this one.
 *
 * Keys are matched on `KeyboardEvent.code` (physical position), so the layout
 * works unchanged on AZERTY, QWERTZ, Dvorak… keyboards.
 */

import type { Gear, LookDir, MirrorId, PlayerCommand } from '../core/types';
import type { UiAction } from './types';

export type BindingGroup = 'Driving' | 'Signals' | 'Observation' | 'Gears' | 'Car' | 'View';

/** One row of a controls help screen. */
export interface BindingInfo {
  /** Stable id, e.g. 'accelerate', 'indicator_left'. */
  action: string;
  /** Plain-language name of what the control does. */
  label: string;
  /** Display labels of the keys / buttons, e.g. 'W', '↑', 'Space', 'RT'. */
  keys: string[];
  group: BindingGroup;
}

/** What a key does when pressed. */
export type KeyTarget =
  /** Active for as long as the key is down. */
  | { kind: 'hold'; hold: 'throttle' | 'brake' | 'steerLeft' | 'steerRight' | 'horn' }
  /** Hold-to-look. */
  | { kind: 'look'; dir: Exclude<LookDir, 'ahead'> }
  /** One-shot car command, issued on key-down. */
  | { kind: 'command'; command: PlayerCommand }
  /** One-shot app action, issued on key-down. */
  | { kind: 'ui'; action: UiAction };

export interface KeyBinding extends BindingInfo {
  /** `KeyboardEvent.code` values, in the same order as `keys`. */
  codes: string[];
  target: KeyTarget;
}

const gear = (g: Gear): KeyTarget => ({ kind: 'command', command: { type: 'gear', gear: g } });
const mirror = (m: MirrorId): KeyTarget => ({ kind: 'command', command: { type: 'mirror', mirror: m } });
const indicator = (value: 'left' | 'right' | 'hazard'): KeyTarget => ({
  kind: 'command',
  command: { type: 'indicator', value },
});

export const KEYBOARD_BINDINGS: readonly KeyBinding[] = [
  // Driving
  { action: 'accelerate', label: 'Accelerate', keys: ['W', '↑'], codes: ['KeyW', 'ArrowUp'], group: 'Driving', target: { kind: 'hold', hold: 'throttle' } },
  { action: 'brake', label: 'Brake', keys: ['S', '↓'], codes: ['KeyS', 'ArrowDown'], group: 'Driving', target: { kind: 'hold', hold: 'brake' } },
  { action: 'steer_left', label: 'Steer left', keys: ['A', '←'], codes: ['KeyA', 'ArrowLeft'], group: 'Driving', target: { kind: 'hold', hold: 'steerLeft' } },
  { action: 'steer_right', label: 'Steer right', keys: ['D', '→'], codes: ['KeyD', 'ArrowRight'], group: 'Driving', target: { kind: 'hold', hold: 'steerRight' } },

  // Signals
  { action: 'indicator_left', label: 'Signal left', keys: ['Q'], codes: ['KeyQ'], group: 'Signals', target: indicator('left') },
  { action: 'indicator_right', label: 'Signal right', keys: ['E'], codes: ['KeyE'], group: 'Signals', target: indicator('right') },
  { action: 'hazards', label: 'Hazard lights', keys: ['T'], codes: ['KeyT'], group: 'Signals', target: indicator('hazard') },
  { action: 'horn', label: 'Horn (hold)', keys: ['H'], codes: ['KeyH'], group: 'Signals', target: { kind: 'hold', hold: 'horn' } },

  // Observation
  { action: 'look_left', label: 'Look over left shoulder (hold)', keys: ['Z'], codes: ['KeyZ'], group: 'Observation', target: { kind: 'look', dir: 'left' } },
  { action: 'look_back', label: 'Look behind (hold)', keys: ['X'], codes: ['KeyX'], group: 'Observation', target: { kind: 'look', dir: 'back' } },
  { action: 'look_right', label: 'Look over right shoulder (hold)', keys: ['C'], codes: ['KeyC'], group: 'Observation', target: { kind: 'look', dir: 'right' } },
  { action: 'mirror_left', label: 'Check left mirror', keys: ['1'], codes: ['Digit1'], group: 'Observation', target: mirror('left') },
  { action: 'mirror_centre', label: 'Check centre mirror', keys: ['2'], codes: ['Digit2'], group: 'Observation', target: mirror('centre') },
  { action: 'mirror_right', label: 'Check right mirror', keys: ['3'], codes: ['Digit3'], group: 'Observation', target: mirror('right') },

  // Gears
  { action: 'gear_park', label: 'Park (P)', keys: ['P'], codes: ['KeyP'], group: 'Gears', target: gear('P') },
  { action: 'gear_reverse', label: 'Reverse (R)', keys: ['R'], codes: ['KeyR'], group: 'Gears', target: gear('R') },
  { action: 'gear_neutral', label: 'Neutral (N)', keys: ['N'], codes: ['KeyN'], group: 'Gears', target: gear('N') },
  { action: 'gear_drive', label: 'Drive (D)', keys: ['F'], codes: ['KeyF'], group: 'Gears', target: gear('D') },
  { action: 'parking_brake', label: 'Parking brake', keys: ['Space'], codes: ['Space'], group: 'Gears', target: { kind: 'command', command: { type: 'handbrake' } } },

  // Car
  { action: 'headlights', label: 'Headlights', keys: ['L'], codes: ['KeyL'], group: 'Car', target: { kind: 'command', command: { type: 'headlights' } } },
  { action: 'wipers', label: 'Wipers', keys: ['K'], codes: ['KeyK'], group: 'Car', target: { kind: 'command', command: { type: 'wipers' } } },
  { action: 'seatbelt', label: 'Seatbelt', keys: ['B'], codes: ['KeyB'], group: 'Car', target: { kind: 'command', command: { type: 'seatbelt' } } },
  { action: 'engine', label: 'Engine start / stop', keys: ['I'], codes: ['KeyI'], group: 'Car', target: { kind: 'command', command: { type: 'engine' } } },

  // View
  { action: 'camera', label: 'Change camera', keys: ['V'], codes: ['KeyV'], group: 'View', target: { kind: 'ui', action: 'camera' } },
  { action: 'pause', label: 'Pause', keys: ['Esc'], codes: ['Escape'], group: 'View', target: { kind: 'ui', action: 'pause' } },
  { action: 'help', label: 'Show controls', keys: ['?', 'F1'], codes: ['Slash', 'F1'], group: 'View', target: { kind: 'ui', action: 'help' } },
];

/** Keyboard rows for the controls help screen. */
export const KEY_BINDINGS: readonly BindingInfo[] = KEYBOARD_BINDINGS.map(({ action, label, keys, group }) => ({
  action,
  label,
  keys: [...keys],
  group,
}));

const TARGET_BY_CODE: ReadonlyMap<string, KeyTarget> = new Map(
  KEYBOARD_BINDINGS.flatMap((binding) => binding.codes.map((code) => [code, binding.target] as const)),
);

/** What the key at physical position `code` does, or null when the game does not use it. */
export const keyTargetForCode = (code: string): KeyTarget | null => TARGET_BY_CODE.get(code) ?? null;

/* -------------------------------------------------------------------------- */
/* Gamepad                                                                    */
/* -------------------------------------------------------------------------- */

/** Button indices of the W3C "standard" gamepad mapping. */
export const PAD = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  BACK: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

/** Axis indices of the standard mapping. */
export const PAD_AXIS = { LEFT_X: 0, LEFT_Y: 1, RIGHT_X: 2, RIGHT_Y: 3 } as const;

/**
 * Gamepad rows for the controls help screen (Xbox-style names; the positions
 * are the same on every pad that reports the standard mapping). The behaviour
 * lives in `gamepadMap.ts`, whose tests pin it to the indices in `PAD`.
 */
export const GAMEPAD_BINDINGS: readonly BindingInfo[] = [
  { action: 'steer', label: 'Steer', keys: ['Left stick'], group: 'Driving' },
  { action: 'accelerate', label: 'Accelerate', keys: ['RT'], group: 'Driving' },
  { action: 'brake', label: 'Brake', keys: ['LT'], group: 'Driving' },

  { action: 'indicator_left', label: 'Signal left', keys: ['LB'], group: 'Signals' },
  { action: 'indicator_right', label: 'Signal right', keys: ['RB'], group: 'Signals' },
  { action: 'hazards', label: 'Hazard lights', keys: ['D-pad ↓'], group: 'Signals' },
  { action: 'horn', label: 'Horn (hold)', keys: ['X'], group: 'Signals' },

  { action: 'look_left', label: 'Look over left shoulder (hold)', keys: ['Right stick ←'], group: 'Observation' },
  { action: 'look_back', label: 'Look behind (hold)', keys: ['Right stick ↓'], group: 'Observation' },
  { action: 'look_right', label: 'Look over right shoulder (hold)', keys: ['Right stick →'], group: 'Observation' },
  { action: 'mirror_left', label: 'Check left mirror', keys: ['D-pad ←'], group: 'Observation' },
  { action: 'mirror_centre', label: 'Check centre mirror', keys: ['D-pad ↑'], group: 'Observation' },
  { action: 'mirror_right', label: 'Check right mirror', keys: ['D-pad →'], group: 'Observation' },

  { action: 'gear_up', label: 'Shift toward Drive (P → R → N → D)', keys: ['Y'], group: 'Gears' },
  { action: 'gear_down', label: 'Shift toward Park (D → N → R → P)', keys: ['B'], group: 'Gears' },
  { action: 'parking_brake', label: 'Parking brake', keys: ['A'], group: 'Gears' },

  { action: 'seatbelt', label: 'Seatbelt', keys: ['L3'], group: 'Car' },
  { action: 'engine', label: 'Engine start / stop', keys: ['Hold L3'], group: 'Car' },
  { action: 'headlights', label: 'Headlights', keys: ['R3'], group: 'Car' },
  { action: 'wipers', label: 'Wipers', keys: ['Hold R3'], group: 'Car' },

  { action: 'camera', label: 'Change camera', keys: ['Back'], group: 'View' },
  { action: 'pause', label: 'Pause', keys: ['Start'], group: 'View' },
];
