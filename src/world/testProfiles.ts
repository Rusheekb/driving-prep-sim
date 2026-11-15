import type { JurisdictionProfile } from '../core/types';
import type { NetworkProfile } from './network';

type Rules = JurisdictionProfile['rules'];

const baseRules: Rules = {
  turnOnRed: 'allowed_after_stop',
  signalMinDistanceM: 30.48,
  signalGuidanceDistanceM: 30.48,
  signalMinTimeLaneChangeS: 3,
  followingGapS: 3,
  uncontrolledPriority: 'first_to_arrive_then_right',
  allWayStops: true,
  roundabout: { signalOnExit: true, signalOnApproach: 'by_exit_direction' },
  pedestrianPriority: 'on_crossing',
  trafficLightSequence: 'red_green_amber',
  headlightsInRain: true,
  notes: [],
};

/** Minimal right-hand, mph profile for tests (US-like). */
export const TEST_RIGHT: NetworkProfile = {
  drivingSide: 'right',
  speedUnit: 'mph',
  speedLimits: { residential: 25, urban: 35, arterial: 40, school: 20, lot: 10 },
  rules: baseRules,
};

/** Minimal left-hand, mph profile for tests (GB-like: no all-way stops, red+amber). */
export const TEST_LEFT: NetworkProfile = {
  drivingSide: 'left',
  speedUnit: 'mph',
  speedLimits: { residential: 20, urban: 30, arterial: 40, school: 20, lot: 10 },
  rules: {
    ...baseRules,
    turnOnRed: 'prohibited',
    signalMinDistanceM: null,
    followingGapS: 2,
    uncontrolledPriority: 'no_priority',
    allWayStops: false,
    pedestrianPriority: 'on_or_waiting',
    trafficLightSequence: 'red_redamber_green_amber',
  },
};
