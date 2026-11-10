import type { FaultCategory, FaultCode, Severity } from '../core/types';

export interface FaultSpec {
  category: FaultCategory;
  /**
   * Severity used unless the jurisdiction overrides it
   * (`profile.faultSeverityOverrides`) or the monitor escalates it because of
   * how dangerous the specific situation was.
   */
  severity: Severity;
  title: string;
}

/**
 * Every fault the simulator can record. Default severities follow the common
 * pattern across licensing authorities: `minor` = a driving fault that is not
 * potentially dangerous, `serious` = potentially dangerous / a clear breach of
 * the law, `dangerous` = actual danger to the driver, examiner, public or
 * property. Serious and dangerous faults fail most real tests outright.
 */
export const FAULTS: Record<FaultCode, FaultSpec> = {
  // speed
  speeding: { category: 'speed', severity: 'minor', title: 'Over the speed limit' },
  speeding_excessive: { category: 'speed', severity: 'serious', title: 'Well over the speed limit' },
  speeding_school_zone: { category: 'speed', severity: 'serious', title: 'Speeding in a school zone' },
  too_slow: { category: 'speed', severity: 'minor', title: 'Driving too slowly' },
  too_fast_for_conditions: { category: 'speed', severity: 'minor', title: 'Too fast for the conditions' },
  // signals
  no_signal_turn: { category: 'signals', severity: 'minor', title: 'No signal before turning' },
  late_signal_turn: { category: 'signals', severity: 'minor', title: 'Signalled too late' },
  wrong_signal: { category: 'signals', severity: 'minor', title: 'Misleading signal' },
  no_signal_lane_change: { category: 'signals', severity: 'minor', title: 'No signal before changing lanes' },
  no_signal_moving_off: { category: 'signals', severity: 'minor', title: 'No signal before moving off' },
  no_signal_pulling_over: { category: 'signals', severity: 'minor', title: 'No signal before pulling over' },
  no_signal_roundabout_exit: { category: 'signals', severity: 'minor', title: 'No signal leaving the roundabout' },
  signal_left_on: { category: 'signals', severity: 'minor', title: 'Signal left on' },
  // observation
  no_mirror_check: { category: 'observation', severity: 'minor', title: 'Mirrors not checked' },
  no_blind_spot_check: { category: 'observation', severity: 'minor', title: 'Blind spot not checked' },
  no_observation_moving_off: { category: 'observation', severity: 'minor', title: 'Moved off without looking' },
  no_observation_reversing: { category: 'observation', severity: 'minor', title: 'Reversed without looking behind' },
  no_scan_at_junction: { category: 'observation', severity: 'minor', title: 'Did not look both ways' },
  // junction control
  rolling_stop: { category: 'junctions', severity: 'serious', title: 'Rolling stop' },
  ran_stop_sign: { category: 'junctions', severity: 'dangerous', title: 'Ran a stop sign' },
  stopped_over_line: { category: 'junctions', severity: 'minor', title: 'Stopped past the line' },
  ran_red_light: { category: 'junctions', severity: 'dangerous', title: 'Ran a red light' },
  illegal_turn_on_red: { category: 'junctions', severity: 'serious', title: 'Illegal turn on red' },
  blocked_crosswalk: { category: 'junctions', severity: 'minor', title: 'Stopped on the crossing' },
  blocked_junction: { category: 'junctions', severity: 'minor', title: 'Blocked the junction' },
  unnecessary_stop: { category: 'junctions', severity: 'minor', title: 'Stopped when it was clear to go' },
  // right of way
  failed_to_yield_vehicle: { category: 'right_of_way', severity: 'serious', title: 'Did not give way to traffic' },
  failed_to_yield_pedestrian: { category: 'right_of_way', severity: 'serious', title: 'Did not give way to a pedestrian' },
  failed_to_yield_roundabout: { category: 'right_of_way', severity: 'serious', title: 'Did not give way at the roundabout' },
  out_of_turn_at_stop: { category: 'right_of_way', severity: 'minor', title: 'Went out of turn' },
  undue_hesitation: { category: 'right_of_way', severity: 'minor', title: 'Hesitated too long' },
  // positioning
  wrong_side_of_road: { category: 'positioning', severity: 'serious', title: 'Wrong side of the road' },
  wrong_way: { category: 'positioning', severity: 'dangerous', title: 'Driving the wrong way' },
  lane_straddling: { category: 'positioning', severity: 'minor', title: 'Straddling lanes' },
  wrong_lane_for_turn: { category: 'positioning', severity: 'minor', title: 'Wrong lane for the turn' },
  wide_turn: { category: 'positioning', severity: 'minor', title: 'Turned into the wrong lane' },
  cut_corner: { category: 'positioning', severity: 'minor', title: 'Cut the corner' },
  unsafe_lane_change: { category: 'positioning', severity: 'serious', title: 'Unsafe lane change' },
  mounted_kerb: { category: 'positioning', severity: 'serious', title: 'Mounted the kerb' },
  off_road: { category: 'positioning', severity: 'dangerous', title: 'Left the road' },
  roundabout_wrong_way: { category: 'positioning', severity: 'dangerous', title: 'Wrong way round the roundabout' },
  // following
  tailgating: { category: 'safety', severity: 'minor', title: 'Following too closely' },
  // control
  harsh_braking: { category: 'control', severity: 'minor', title: 'Harsh braking' },
  no_seatbelt: { category: 'safety', severity: 'serious', title: 'Seatbelt not fastened' },
  handbrake_on: { category: 'control', severity: 'minor', title: 'Drove with the parking brake on' },
  no_headlights: { category: 'safety', severity: 'minor', title: 'Headlights off' },
  no_wipers: { category: 'safety', severity: 'minor', title: 'Wipers off in the rain' },
  not_secured: { category: 'control', severity: 'minor', title: 'Car not secured' },
  coasting_in_neutral: { category: 'control', severity: 'minor', title: 'Coasting in neutral' },
  // collisions
  collision_vehicle: { category: 'safety', severity: 'dangerous', title: 'Collision with a vehicle' },
  collision_pedestrian: { category: 'safety', severity: 'dangerous', title: 'Collision with a pedestrian' },
  collision_object: { category: 'safety', severity: 'serious', title: 'Hit an object' },
  // manoeuvres
  park_far_from_kerb: { category: 'manoeuvres', severity: 'minor', title: 'Parked too far from the kerb' },
  park_not_straight: { category: 'manoeuvres', severity: 'minor', title: 'Parked at an angle' },
  park_outside_bay: { category: 'manoeuvres', severity: 'minor', title: 'Parked outside the bay' },
  park_touched_kerb: { category: 'manoeuvres', severity: 'minor', title: 'Touched the kerb' },
  manoeuvre_too_many_moves: { category: 'manoeuvres', severity: 'minor', title: 'Too many adjustments' },
  manoeuvre_incomplete: { category: 'manoeuvres', severity: 'serious', title: 'Manoeuvre not completed' },
  emergency_stop_slow: { category: 'manoeuvres', severity: 'minor', title: 'Slow emergency stop' },
  // examiner
  ignored_instruction_unsafe: { category: 'safety', severity: 'serious', title: 'Unsafe action' },
};
