import { formatDistance } from '../core/units';
import type { FaultCode, JurisdictionProfile } from '../core/types';
import { FAULTS } from './catalog';

type Info = Record<string, string | number>;

/**
 * Plain-language text for a fault in the local vocabulary: what happened and
 * how to do it right next time.
 */
export function describeFault(code: FaultCode, profile: JurisdictionProfile, info: Info = {}): { title: string; detail: string; tip: string } {
  const t = profile.terms;
  const r = profile.rules;
  const u = profile.speedUnit;
  const signalDist = formatDistance(r.signalGuidanceDistanceM, u);
  const kerbTitle = (s: string): string => s.replace(/kerb/g, t.curb);
  const speed = info.speed !== undefined ? `${info.speed} ${u}` : 'too fast';
  const limit = info.limit !== undefined ? `${info.limit} ${u}` : 'the limit';
  const routine = t.observationRoutine;
  const side = String(info.side ?? '');

  const table: Record<FaultCode, [detail: string, tip: string]> = {
    speeding: [`You were doing ${speed} in a ${limit} zone.`, `Glance at the speedometer often and ease off the ${t.accelerator} before you drift over the limit.`],
    speeding_excessive: [`You were doing ${speed} in a ${limit} zone — well over the limit.`, 'Speed limits are maximums. Going this far over would fail a real test and gives you far less time to react.'],
    speeding_school_zone: [`You were doing ${speed} through a school zone posted at ${limit}.`, 'Slow down before the school zone starts and watch for children near the road.'],
    too_slow: ['You drove well below the limit with a clear road ahead.', 'Driving much slower than conditions allow holds up traffic. Keep up with the flow when it is safe.'],
    too_fast_for_conditions: ['You kept to the dry-weather limit in poor conditions.', 'In rain or fog, slow down and leave a bigger gap: the limit is for good conditions.'],
    no_signal_turn: [`You turned without using your ${t.turnSignal}.`, `Signal at least ${signalDist} before every turn so others know what you plan to do.`],
    late_signal_turn: [`You put your ${t.turnSignal} on only just before turning.`, `Signal earlier — about ${signalDist} before the turn — then brake.`],
    wrong_signal: [`Your ${t.turnSignal} did not match what you did.`, 'A misleading signal is worse than none. Check it is showing the way you are going, and cancel it afterwards.'],
    no_signal_lane_change: [`You changed lanes without using your ${t.turnSignal}.`, `Mirror, signal for about ${r.signalMinTimeLaneChangeS} seconds, ${t.blindSpotCheck}, then move over smoothly.`],
    no_signal_moving_off: [`You pulled away from the ${t.curb} without signalling.`, `Before moving off: mirrors, ${t.turnSignal} toward the road, ${t.blindSpotCheck}, then go when it is clear.`],
    no_signal_pulling_over: [`You pulled over without signalling.`, `Check your mirrors and signal toward the ${t.curb} before you slow down to stop.`],
    no_signal_roundabout_exit: [`You left the ${t.roundabout} without signalling.`, `Signal toward your exit as you pass the exit before the one you want.`],
    signal_left_on: [`Your ${t.turnSignal} was left flashing.`, 'After a lane change or a gentle turn the signal may not cancel itself. Check it and switch it off.'],
    no_mirror_check: ['You did not check your mirrors first.', `Use the routine every time: ${routine}.`],
    no_blind_spot_check: [`You did not do a ${t.blindSpotCheck}.`, `Mirrors leave a blind spot beside the car. Look over your shoulder before moving sideways.`],
    no_observation_moving_off: ['You moved off without looking around first.', `Check mirrors and do a ${t.blindSpotCheck} on the road side before you pull away.`],
    no_observation_reversing: ['You reversed without looking behind.', 'Before and while reversing, turn and look through the rear window. Mirrors alone are not enough.'],
    no_scan_at_junction: [`You entered the ${t.intersection} without looking both ways.`, 'Look left, right and left again (or right, left, right where traffic keeps left) before you go.'],
    rolling_stop: ['You slowed at the stop sign but never fully stopped.', 'Stop means a complete stop: wheels still, behind the line. Count "one" before moving.'],
    ran_stop_sign: ['You drove through a stop sign without stopping.', `Stop completely behind the line and ${t.yield} before you go.`],
    stopped_over_line: ['You stopped past the stop line.', 'Brake a little earlier so the front of the car stays behind the line.'],
    ran_red_light: ['You went through a red light.', `Red means stop behind the line. Watch the ${t.trafficLight} as you approach and be ready when it turns ${t.amber}.`],
    illegal_turn_on_red: [
      r.turnOnRed === 'allowed_after_stop' ? 'You turned on red without coming to a complete stop first.' : 'You turned on a red light, which is not allowed here.',
      r.turnOnRed === 'allowed_after_stop' ? `Turning on red is only legal after a full stop, and only once you have given way to pedestrians and traffic.` : 'Wait for a green signal before turning.',
    ],
    blocked_crosswalk: [`You stopped on the ${t.crosswalk}.`, `Stop behind the line so people can cross in front of you.`],
    blocked_junction: [`You stopped inside the ${t.intersection}.`, 'Only enter when your exit is clear.'],
    unnecessary_stop: ['You stopped when it was clear to go.', 'Unneeded stops confuse drivers behind. Keep moving when you have priority and it is safe.'],
    failed_to_yield_vehicle: [`You pulled out in front of a vehicle that had priority.`, `Wait for a safe gap. If another driver has to brake for you, the gap was too small.`],
    failed_to_yield_pedestrian: [`You drove through while a pedestrian was using the ${t.crosswalk}.`, `Slow down on approach and stop for anyone crossing${r.pedestrianPriority === 'on_or_waiting' ? ' or waiting to cross' : ''}.`],
    failed_to_yield_roundabout: [`You entered the ${t.roundabout} in front of a vehicle already on it.`, `Traffic on the ${t.roundabout} has priority. Wait for a gap, then go.`],
    out_of_turn_at_stop: ['You went before a driver who had stopped first.', 'At an all-way stop, go in the order you arrived. If you arrive together, the driver on the right goes first.'],
    undue_hesitation: ['You waited when it was safe to go.', 'Once you have checked and the way is clear, go promptly. Hesitating holds up traffic and counts against you.'],
    wrong_side_of_road: ['You drove on the wrong side of the road.', `Keep to the ${profile.drivingSide} of the centre line.`],
    wrong_way: ['You drove the wrong way.', 'Check for one-way and no-entry signs before you turn into a road.'],
    lane_straddling: ['You drifted across the lane line.', 'Look well ahead and keep the car centred in your lane.'],
    wrong_lane_for_turn: ['You turned from the wrong lane.', `Move into the lane nearest the direction you are turning well before the ${t.intersection}.`],
    wide_turn: ['You swung wide and finished the turn in the wrong lane.', 'Turn into the nearest lane going your way, then change lanes afterwards if you need to.'],
    cut_corner: ['You cut the corner and crossed into the oncoming lane.', `Drive further into the ${t.intersection} before you steer, so you turn around the centre point.`],
    unsafe_lane_change: ['You changed lanes into the path of another vehicle.', `Check the mirror and do a ${t.blindSpotCheck}. If a vehicle is alongside or closing fast, wait.`],
    mounted_kerb: [kerbTitle('You drove up the kerb.'), kerbTitle('Slow down and take the corner or manoeuvre wider. Hitting the kerb can fail a test.')],
    off_road: ['You left the road.', 'Slow down, look where you want to go and steer smoothly.'],
    roundabout_wrong_way: [`You went the wrong way round the ${t.roundabout}.`, `Go ${profile.drivingSide === 'left' ? 'clockwise (keep the island on your right)' : 'counter-clockwise (keep the island on your left)'}.`],
    tailgating: ['You followed the vehicle ahead too closely.', `Leave at least a ${r.followingGapS}-second gap, and more in rain.`],
    harsh_braking: ['You braked very hard when there was no need.', 'Look further ahead and ease off early so you can brake gently.'],
    no_seatbelt: ['You drove without your seatbelt fastened.', 'Belt up before you start the engine — every trip.'],
    handbrake_on: [`You drove with the ${t.parkingBrake} on.`, `Release the ${t.parkingBrake} before moving off.`],
    no_headlights: ['You drove without headlights when they were needed.', r.headlightsInRain ? 'Switch on dipped headlights at night, in fog and whenever the wipers are on.' : 'Switch on dipped headlights at night and whenever visibility is poor.'],
    no_wipers: ['You drove in the rain without wipers.', 'Turn the wipers on as soon as rain makes the windscreen hard to see through.'],
    not_secured: ['You left the car without securing it.', `When you finish: select Park and apply the ${t.parkingBrake}.`],
    coasting_in_neutral: ['You coasted in neutral.', 'Stay in gear while moving so you keep full control of the car.'],
    collision_vehicle: ['You hit another vehicle.', 'Slow down, keep a safe gap and check all around before you move.'],
    collision_pedestrian: ['You hit a pedestrian.', 'Always be ready to stop near crossings and wherever people are close to the road.'],
    collision_object: ['You hit an object.', 'Move slowly in tight spaces and keep checking where the corners of the car are.'],
    park_far_from_kerb: [kerbTitle(`You finished too far from the kerb${info.gap !== undefined ? ` (${info.gap})` : ''}.`), kerbTitle('Aim to finish close to and parallel with the kerb. Use the kerb-side mirror to judge the gap.')],
    park_not_straight: ['You finished at an angle.', 'Straighten the wheels as the car lines up, then stop.'],
    park_outside_bay: ['You finished over the bay line.', 'Use the lines in your mirrors: equal gaps on both sides means you are centred.'],
    park_touched_kerb: [kerbTitle('You touched the kerb.'), kerbTitle('Go slowly and stop turning in before the wheel reaches the kerb.')],
    manoeuvre_too_many_moves: ['You needed a lot of shuffles to finish.', 'Slow right down and use full steering lock early so each move does more.'],
    manoeuvre_incomplete: ['The manoeuvre was not completed.', 'Take your time: slow, controlled and with good observation is what examiners want.'],
    emergency_stop_slow: ['You were slow to react to the stop signal.', 'Brake firmly and immediately — do not check mirrors first in an emergency.'],
    ignored_instruction_unsafe: ['That action was unsafe.', 'Follow the instruction only when it is safe and legal to do so.'],
  };
  void side;
  const [detail, tip] = table[code];
  return { title: kerbTitle(FAULTS[code].title), detail, tip };
}
