/**
 * The curriculum: guided lessons, skill drills, the mock road test and free
 * drive. Everything is placed through `Placement`, so each scenario works on
 * either side of the road and picks up local rules and vocabulary.
 */
import type { JurisdictionProfile, PlayerCar, PropDef, ScenarioMeta } from '../core/types';
import { type BuildEnv, type ScenarioDef, type Step } from './core';
import {
  bayPark,
  checkMirrors,
  currentLane,
  drive,
  emergencyStop,
  explain,
  fastenSeatbelt,
  freeRoam,
  moveOff,
  parallelPark,
  prompt,
  pullOver,
  releaseHandbrake,
  reverseStraight,
  secureCar,
  selectGear,
  startEngine,
  stopInBox,
  threePointTurn,
  tx,
} from './steps';

const READY: Partial<Pick<PlayerCar, 'gear' | 'handbrake' | 'engineOn' | 'seatbelt'>> = { engineOn: true, seatbelt: true, gear: 'P', handbrake: true };
const ROUTINE = 'Before you pull away: check your mirrors [2], signal toward the road, then hold [Z] or [C] to look over your shoulder on the road side.';

function meta(m: Omit<ScenarioMeta, 'estMinutes' | 'difficulty'> & { estMinutes?: number; difficulty?: 1 | 2 | 3 }): ScenarioMeta {
  return { estMinutes: 4, difficulty: 1, ...m };
}

/** Steps that take a parked, running car onto the road with the full routine. */
function setOff(coach = ROUTINE): Step[] {
  return [selectGear('D'), releaseHandbrake(), moveOff({ coach })];
}

/** Instruction-only step used by tests: wait until the learner is on the road. */
const leaveCarPark = (text: string, firstLaneId: string): Step => ({
  ...prompt({
    label: 'Leave the car park',
    coach: '',
    say: { text, icon: 'straight' },
    until: (e) => e.ctx.player.location.kind === 'lane',
    enter: (e) => (e.state.coach = null),
  }),
  auto: { kind: 'route', legs: () => [{ laneId: firstLaneId, connectorId: null }], stopAt: () => null },
});

/** "Move into the left/right lane when it is safe." */
function laneChange(to: 'centre' | 'kerb', coach?: string): Step {
  return {
    label: 'Change lanes',
    enter(e) {
      const kerbSide = e.net.side === 'right' ? 'right' : 'left';
      const side = to === 'kerb' ? kerbSide : kerbSide === 'right' ? 'left' : 'right';
      e.say(`Move into the ${side}-hand lane when it is safe`, 'info');
      e.state.coach = coach ? tx(e.profile, coach) : null;
    },
    update(e) {
      const cur = currentLane(e);
      if (!cur || e.ctx.player.location.kind !== 'lane') return 'running';
      if (cur.lane.laneCount < 2) return e.stepTime > 4 ? 'done' : 'running';
      const want = to === 'kerb' ? cur.lane.laneCount - 1 : 0;
      return cur.lane.index === want && Math.abs(cur.lateral) < 0.9 ? 'done' : 'running';
    },
    exit(e) {
      e.state.coach = null;
    },
    auto: { kind: 'wait' },
  };
}

const parkedCar = (pose: { x: number; z: number; heading: number }, colour: number): PropDef => ({ kind: 'parked_car', pose, colour });

/* --------------------------------- lessons -------------------------------- */

const lessonControls: ScenarioDef = {
  meta: meta({
    id: 'lesson-controls',
    title: 'Meet your car',
    summary: 'Seatbelt, mirrors, starting up, moving, stopping and securing the car — in the quiet of the car park.',
    category: 'lesson',
    skills: ['controls', 'steering', 'reversing'],
    briefing: ['Go through the cockpit drill a real instructor starts with.', 'Drive forward, stop smoothly, reverse and park up.', 'No traffic and no faults for taking your time.'],
    order: 1,
    defaults: { traffic: 'none', pedestrians: 'none' },
  }),
  build({ place }: BuildEnv) {
    const start = place.inBay('S5', 'out');
    const box = (dz: number) => ({ x: start.x, z: start.z + dz, heading: start.heading, halfLength: 3.6, halfWidth: 2.2 });
    return {
      start,
      suspend: ['signals', 'observation', 'hesitation'],
      steps: [
        fastenSeatbelt(),
        checkMirrors(),
        startEngine(),
        selectGear('D', 'To leave Park you must press the brake. Hold [S] and press [F] for Drive.'),
        releaseHandbrake(),
        stopInBox({
          box: box(-16),
          label: 'Drive forward',
          instruction: 'Drive forward and stop in the yellow box',
          coach: 'Ease off the brake and the car creeps forward on its own. Press [W] gently to go faster, steer with [A] and [D], and brake with [S] to stop inside the box.',
        }),
        selectGear('R', 'Now reverse. Hold the brake [S] and press [R].'),
        prompt({
          label: 'Look behind',
          coach: 'Always look behind before reversing: hold [X] for a moment. The eye icons above the speedometer light up when a look registers.',
          until: (e) => e.ctx.time - e.ctx.player.lastShoulderCheck.back < 1.5,
          act: () => ({ brake: 1, look: 'back' }),
        }),
        stopInBox({ box: box(-7), label: 'Reverse', instruction: 'Reverse slowly into the box behind you', coach: 'Come off the brake and let the car creep back. Keep looking behind [X]. Stop in the box.' }),
        secureCar('That is the full routine. Finish by securing the car: Park [P], then the {parkingBrake} [Space].'),
      ],
    };
  },
};

const lessonMovingOff: ScenarioDef = {
  meta: meta({
    id: 'lesson-moving-off',
    title: 'Moving off and pulling over',
    summary: 'The routine examiners watch most closely: observe, signal, move off — then stop neatly at the kerb.',
    category: 'lesson',
    skills: ['moving_off', 'observation', 'signals'],
    briefing: ['Move off from the kerb using mirrors, signal and a shoulder check.', 'Pull over close to and parallel with the kerb.', 'You will do it twice so it starts to feel natural.'],
    order: 2,
    defaults: { traffic: 'light' },
  }),
  build({ place }) {
    const lane = place.lane('B4', 'B5');
    return {
      start: place.atKerb(lane.id, 22),
      car: READY,
      steps: [
        explain('Briefing', `You are parked at the {curb}. ${ROUTINE}`, 6),
        ...setOff(),
        drive({ via: ['B4', 'B5', 'C5'], endS: 12, coach: 'Good. Keep to the middle of your lane and under the limit shown beside your speed.' }),
        pullOver({ coach: 'Mirrors first [2], signal toward the {curb}, then slow down and steer in gently. Finish close to the {curb} and straight.' }),
        secureCar(),
        explain('Again', 'Well done. Once more — this time without the hints. Move off, and I will ask you to pull over again.', 4),
        ...setOff(''),
        drive({ via: ['B5', 'C5', 'D5'], endS: 12 }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonJunctions: ScenarioDef = {
  meta: meta({
    id: 'lesson-junctions',
    title: 'Turning at junctions',
    summary: 'Left and right turns on quiet streets: signal, position, look, and finish in the correct lane.',
    category: 'lesson',
    skills: ['junctions', 'signals', 'steering'],
    briefing: ['Signal in good time before every turn.', 'Slow down before the turn, not during it.', 'Turns across oncoming traffic: give way to anyone coming toward you.'],
    order: 3,
    estMinutes: 5,
    defaults: { traffic: 'light' },
  }),
  build({ place }) {
    const lane = place.lane('B4', 'A4');
    return {
      start: place.atKerb(lane.id, 24),
      car: READY,
      steps: [
        ...setOff(),
        drive({
          via: ['B4', 'A4', 'A5', 'B5', 'C5', 'D5', 'D4', 'E4', 'E5', 'D5'],
          endS: 28,
          coach: 'Listen for each direction. Signal with [Q] or [E] well before the turn, brake to walking pace, look both ways, then turn into the nearest lane.',
        }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonStops: ScenarioDef = {
  meta: meta({
    id: 'lesson-stops',
    title: 'Stop signs and who goes first',
    summary: 'Full stops, give-way lines, an unmarked crossroads and a school zone on the way.',
    category: 'lesson',
    skills: ['stop_signs', 'right_of_way', 'speed'],
    briefing: ['Stop completely behind the line at every stop sign.', 'Learn who has priority at each kind of junction in your region.', 'Mind the lower limit in the school zone.'],
    order: 4,
    estMinutes: 5,
    difficulty: 2,
    defaults: { traffic: 'light' },
  }),
  build({ place, profile }) {
    const lane = place.lane('A2', 'B2');
    const r = profile.rules;
    const priority =
      r.uncontrolledPriority === 'priority_to_right'
        ? 'At a junction with no signs, give way to traffic from your right.'
        : r.uncontrolledPriority === 'no_priority'
          ? 'At a junction with no signs nobody has priority: slow right down and be ready to give way.'
          : 'At a junction with no signs, the first to arrive goes first; if you arrive together, the driver on the right goes.';
    const allWay = r.allWayStops ? 'At an all-way stop, everyone stops and goes in the order they arrived.' : 'At a give-way line, slow down and only go when the main road is clear.';
    return {
      start: place.atKerb(lane.id, 24),
      car: READY,
      steps: [
        explain('Briefing', `${allWay} ${priority}`, 7),
        ...setOff(),
        drive({ via: ['A2', 'B2', 'C2', 'C1', 'B1', 'B2', 'A2'], endS: 16, coach: 'A stop sign means wheels still, behind the line. Count "one" before you move. The school zone ahead has a lower limit.' }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonLights: ScenarioDef = {
  meta: meta({
    id: 'lesson-lights',
    title: 'Traffic lights',
    summary: 'Reading signals on the main road, stopping at the line and turning across oncoming traffic.',
    category: 'lesson',
    skills: ['traffic_lights', 'junctions', 'right_of_way'],
    briefing: ['Stop behind the line on red; be ready to stop when the light changes.', 'Learn what your region allows when turning on red.', 'On green, turning across traffic still means giving way to oncoming vehicles and pedestrians.'],
    order: 5,
    estMinutes: 5,
    difficulty: 2,
    defaults: { traffic: 'normal' },
  }),
  build({ place, profile }) {
    const lane = place.lane('B4', 'B3');
    const t = profile.terms;
    const red =
      profile.rules.turnOnRed === 'allowed_after_stop'
        ? `Here you may turn ${profile.drivingSide === 'right' ? 'right' : 'left'} on red after a complete stop, if the way is clear and no sign forbids it.`
        : 'Here you may not turn on a red light: wait for green.';
    const seq = profile.rules.trafficLightSequence === 'red_redamber_green_amber' ? `Red and ${t.amber} together mean stop — green is about to show.` : `${t.amber.charAt(0).toUpperCase() + t.amber.slice(1)} means stop unless you are too close to stop safely.`;
    return {
      start: place.atKerb(lane.id, 20),
      car: READY,
      steps: [
        explain('Briefing', `${red} ${seq}`, 7),
        ...setOff(),
        drive({ via: ['B4', 'B3', 'C3', 'D3', 'D2', 'D1', 'C1'], endS: 16, coach: `Watch each ${t.trafficLight} as you approach. Turning across oncoming traffic on green, wait in the junction until there is a safe gap.` }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonRoundabouts: ScenarioDef = {
  meta: meta({
    id: 'lesson-roundabouts',
    title: 'Roundabouts',
    summary: 'Approach, give way, circulate the right way and signal off — at two different roundabouts.',
    category: 'lesson',
    skills: ['roundabouts', 'right_of_way', 'signals'],
    briefing: ['Give way to traffic already on the roundabout.', 'Go round in the correct direction and keep your speed low.', 'Signal as your region expects when you leave.'],
    order: 6,
    estMinutes: 6,
    difficulty: 2,
    defaults: { traffic: 'normal' },
  }),
  build({ place, profile }) {
    const lane = place.lane('B4', 'C4');
    const rb = profile.rules.roundabout;
    const dir = profile.drivingSide === 'left' ? 'clockwise' : 'counter-clockwise';
    const sig = rb.signalOnExit ? `Signal ${profile.drivingSide === 'left' ? 'left' : 'right'} as you pass the exit before yours.` : 'Check your handbook for how to signal here.';
    return {
      start: place.atKerb(lane.id, 20),
      car: READY,
      steps: [
        explain('Briefing', `Slow down on the approach and {yield} to traffic already on the {roundabout}. Go round ${dir}. ${sig}`, 7),
        ...setOff(),
        drive({ via: ['B4', 'C4', 'C5', 'D5', 'E5', 'F5', 'F4', 'F3', 'F2', 'E2', 'D2'], endS: 16, coach: 'Count the exits as you pass them. Look for a gap, then go without stopping if it is clear.' }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonLaneChanges: ScenarioDef = {
  meta: meta({
    id: 'lesson-lane-changes',
    title: 'Changing lanes',
    summary: 'Mirror, signal, blind spot, go — on the four-lane main road.',
    category: 'lesson',
    skills: ['lane_changes', 'observation', 'signals'],
    briefing: ['Check the centre and side mirror, then signal.', 'Look over your shoulder into the blind spot before you move.', 'Move across smoothly and cancel the signal.'],
    order: 7,
    estMinutes: 5,
    difficulty: 2,
    defaults: { traffic: 'normal' },
  }),
  build({ place, profile }) {
    const lane = place.lane('A2', 'A3');
    const routine = `Use the routine: ${profile.terms.observationRoutine}. Check the mirror [2], signal [Q] / [E], hold [Z] or [C] to check the blind spot, then steer gently across.`;
    return {
      start: place.atKerb(lane.id, 22),
      car: READY,
      steps: [
        ...setOff(),
        drive({ via: ['A2', 'A3', 'B3'], endS: 12, coach: 'You are heading for the main road. Stay in your lane through the turn.' }),
        laneChange('centre', routine),
        drive({ via: ['A3', 'B3', 'C3'], endS: 12 }),
        laneChange('kerb', routine),
        drive({ via: ['B3', 'C3', 'D3'], endS: 12 }),
        laneChange('centre', 'Once more. Remember the signal may not cancel itself after a lane change.'),
        laneChange('kerb'),
        drive({ via: ['C3', 'D3', 'E3', 'E4'], endS: 16 }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonCrossings: ScenarioDef = {
  meta: meta({
    id: 'lesson-crossings',
    title: 'Pedestrian crossings',
    summary: 'Spot people early, slow down and give way at the school crossing and in town.',
    category: 'lesson',
    skills: ['pedestrians', 'hazards', 'speed'],
    briefing: ['Scan both kerbs as you approach a crossing.', 'Stop behind the line and wait until people are clear.', 'Keep to the school-zone limit.'],
    order: 8,
    difficulty: 2,
    defaults: { traffic: 'light', pedestrians: 'many' },
  }),
  build({ place, profile, net }) {
    const lane = place.lane('C1', 'C2');
    const who = profile.rules.pedestrianPriority === 'on_or_waiting' ? 'anyone on the crossing or waiting to cross' : 'anyone on the crossing';
    const spawned = new Set<string>();
    return {
      start: place.atKerb(lane.id, 22),
      car: READY,
      steps: [
        explain('Briefing', `At a marked {crosswalk} you must {yield} to ${who}. Ease off early so you can stop gently.`, 6),
        ...setOff(),
        drive({
          via: ['C1', 'C2', 'B2', 'B3', 'B4', 'C4', 'D4', 'D5', 'E5'],
          endS: 30,
          coach: 'Look well ahead for people near the kerb. If someone is crossing, stop at the line and wait.',
          onTick(e) {
            const cur = currentLane(e);
            if (!cur || !cur.lane.midblock) return;
            const id = cur.lane.midblock.crosswalkId;
            const d = cur.lane.midblock.stopS - cur.s;
            if (d > 48 && d < 62 && !spawned.has(id)) {
              spawned.add(id);
              const far = net.kerbSign > 0 ? 'a' : 'b';
              e.pedestrians.spawnCrossing(e.ctx, id, { delay: 0.4, fromEnd: far, assertive: true });
            }
          },
        }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const lessonNight: ScenarioDef = {
  meta: meta({
    id: 'lesson-night-rain',
    title: 'Night and rain',
    summary: 'Lights on, wipers on, more space and less speed when you cannot see as far.',
    category: 'lesson',
    skills: ['night', 'weather', 'following'],
    briefing: ['Switch on headlights and wipers before you move.', 'Leave a bigger gap: stopping distances grow on wet roads.', 'Look further ahead for pedestrians and unlit hazards.'],
    order: 9,
    difficulty: 2,
    forced: { timeOfDay: 'night', weather: 'rain' },
    defaults: { traffic: 'light' },
  }),
  build({ place }) {
    const lane = place.lane('E4', 'E5');
    return {
      start: place.atKerb(lane.id, 20),
      car: READY,
      steps: [
        prompt({
          label: 'Headlights',
          coach: 'It is dark and raining. Switch on your headlights [L].',
          until: (e) => e.ctx.player.headlights !== 'off',
          act: (e) => (e.ctx.player.headlights === 'off' ? { brake: 1, commands: [{ type: 'headlights' }] } : { brake: 1 }),
        }),
        prompt({
          label: 'Wipers',
          coach: 'And the wipers [K].',
          until: (e) => e.ctx.player.wipers,
          act: (e) => (e.ctx.player.wipers ? { brake: 1 } : { brake: 1, commands: [{ type: 'wipers' }] }),
        }),
        ...setOff('Wet roads roughly double your stopping distance. Drive a little under the limit and brake earlier than usual.'),
        drive({ via: ['E4', 'E5', 'D5', 'C5', 'B5', 'B4', 'C4', 'D4'], endS: 16 }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

/* ---------------------------------- skills -------------------------------- */

const skillParallel: ScenarioDef = {
  meta: meta({
    id: 'skill-parallel-park',
    title: 'Parallel parking',
    summary: 'Reverse into a kerbside space between two parked cars.',
    category: 'skill',
    skills: ['parking', 'reversing', 'observation'],
    briefing: ['Pull up alongside the car in front of the space.', 'Reverse slowly, steering toward the kerb, then straighten.', 'Finish close to the kerb and straight, without touching it or the other cars.'],
    order: 1,
    difficulty: 3,
    defaults: { traffic: 'none', pedestrians: 'none' },
    hasDemo: false,
  }),
  build({ place }) {
    const lane = place.lane('A4', 'B4');
    const spot = place.parallelSpot(lane.id, 58);
    return {
      start: place.inLane(lane.id, 22),
      car: { ...READY, gear: 'D', handbrake: false },
      props: [parkedCar(spot.front, 0x3f6fb5), parkedCar(spot.rear, 0x8a8f98)],
      steps: [
        parallelPark({
          bay: spot.bay,
          coach: 'Pull up level with the car in front, about a door-width away. Select Reverse [R], look behind [X], creep back and steer toward the {curb}. When the car is at 45°, steer the other way to straighten. Top view [V] helps.',
        }),
        secureCar(),
      ],
    };
  },
};

function bayScenario(mode: 'reverse' | 'forward'): ScenarioDef {
  return {
    meta: meta({
      id: mode === 'reverse' ? 'skill-bay-reverse' : 'skill-bay-forward',
      title: mode === 'reverse' ? 'Reverse bay parking' : 'Forward bay parking',
      summary: mode === 'reverse' ? 'Reverse into a marked bay and finish between the lines.' : 'Drive forward into a marked bay and finish between the lines.',
      category: 'skill',
      skills: ['parking', mode === 'reverse' ? 'reversing' : 'steering'],
      briefing: ['Use slow speed and full steering.', 'Finish straight, inside the lines.', 'Keep looking all around — car parks are full of surprises.'],
      order: mode === 'reverse' ? 2 : 3,
      difficulty: mode === 'reverse' ? 3 : 2,
      defaults: { traffic: 'none', pedestrians: 'none' },
      hasDemo: false,
    }),
    build({ place }) {
      const bayId = mode === 'reverse' ? 'S7' : 'N4';
      const neighbours = mode === 'reverse' ? ['S5', 'S9'] : ['N2', 'N6'];
      return {
        start: { x: 96, z: mode === 'reverse' ? 184 : 170, heading: Math.PI / 2 },
        car: { ...READY, gear: 'D', handbrake: false },
        suspend: ['signals', 'hesitation'],
        props: neighbours.map((id, i) => parkedCar(place.inBay(id, 'in'), i ? 0x9aa3ad : 0x2f4f7f)),
        steps: [
          bayPark({
            bay: place.bayObb(bayId),
            mode,
            coach:
              mode === 'reverse'
                ? 'Drive just past the bay, select Reverse [R], look behind [X] and steer in slowly. Use the door mirrors [1] [3] to see the lines. Top view [V] helps while you learn.'
                : 'Swing a little wide, then steer in so the car is straight before it enters the bay.',
          }),
          secureCar(),
        ],
      };
    },
  };
}

const skillThreePoint: ScenarioDef = {
  meta: meta({
    id: 'skill-three-point',
    title: 'Turn in the road',
    summary: 'Turn the car to face the other way using forward and reverse gears.',
    category: 'skill',
    skills: ['manoeuvres', 'reversing', 'observation'],
    briefing: ['Full lock, slow speed.', 'Look both ways before each move and behind before reversing.', 'Do not touch the kerbs.'],
    order: 4,
    difficulty: 3,
    defaults: { traffic: 'none', pedestrians: 'none' },
    hasDemo: false,
  }),
  build({ place }) {
    const lane = place.lane('E4', 'E5');
    return {
      start: place.atKerb(lane.id, 45),
      car: READY,
      steps: [
        threePointTurn({ coach: 'Check all around. Drive forward on full lock toward the far {curb} and stop just short. Reverse on the opposite lock, looking behind [X]. Then drive away on the other side of the road.' }),
        pullOver(),
        secureCar(),
      ],
    };
  },
};

const skillReverse: ScenarioDef = {
  meta: meta({
    id: 'skill-reverse-straight',
    title: 'Reversing in a straight line',
    summary: 'Back up along the kerb, slow and straight, looking behind.',
    category: 'skill',
    skills: ['reversing', 'observation'],
    briefing: ['Look behind before and while you reverse.', 'Keep it slow and make tiny steering corrections.', 'Stay close to the kerb without touching it.'],
    order: 5,
    difficulty: 2,
    defaults: { traffic: 'none', pedestrians: 'none' },
    hasDemo: false,
  }),
  build({ place }) {
    const lane = place.lane('B4', 'B5');
    return {
      start: place.atKerb(lane.id, 66),
      car: READY,
      steps: [reverseStraight({ distance: 14, coach: 'Hold the brake [S], select Reverse [R], hold [X] to look behind, then creep back. Small steering inputs only.' }), secureCar()],
    };
  },
};

const skillEmergency: ScenarioDef = {
  meta: meta({
    id: 'skill-emergency-stop',
    title: 'Emergency stop',
    summary: 'Stop quickly and under control when the instructor calls it.',
    category: 'skill',
    skills: ['emergency_stop', 'controls'],
    briefing: ['Drive normally until you hear STOP.', 'Brake firmly and at once — no mirror check first.', 'Then check all around before you move off again.'],
    order: 6,
    difficulty: 2,
    defaults: { traffic: 'none', pedestrians: 'none' },
    hasDemo: false,
  }),
  build({ place }) {
    const lane = place.lane('A5', 'B5');
    return {
      start: place.atKerb(lane.id, 20),
      car: READY,
      steps: [...setOff(), emergencyStop({ coach: 'Build up to the speed limit. When you hear STOP, brake hard [S] straight away.' }), drive({ via: ['A5', 'B5', 'C5', 'D5'], endS: 16 }), pullOver(), secureCar()],
    };
  },
};

const skillKerbside: ScenarioDef = {
  meta: meta({
    id: 'skill-kerbside-stop',
    title: 'Kerbside stop',
    summary: 'Pull over and move off again, safely and smoothly — three times.',
    category: 'skill',
    skills: ['moving_off', 'signals', 'observation'],
    briefing: ['Signal before you pull over.', 'Stop close to the kerb, away from junctions and crossings.', 'Full observation before every move-off.'],
    order: 7,
    defaults: { traffic: 'light' },
  }),
  build({ place }) {
    const lane = place.lane('B5', 'C5');
    return {
      start: place.atKerb(lane.id, 20),
      car: READY,
      steps: [...setOff(''), pullOver(), ...setOff(''), drive({ via: ['B5', 'C5', 'D5'], endS: 12 }), pullOver(), ...setOff(''), drive({ via: ['C5', 'D5', 'E5'], endS: 12 }), pullOver(), secureCar()],
    };
  },
};

/* ------------------------------- mock test -------------------------------- */

function buildTest({ place, profile }: BuildEnv, full: boolean) {
  const m = new Set(profile.roadTest.mockTestManeuvers);
  const props: PropDef[] = [];
  const steps: Step[] = [leaveCarPark('When you are ready, leave the car park and turn right onto the road', place.lane('D4', 'E4').id)];
  const t = profile.terms;

  // Part 1: town centre, main road, school zone.
  steps.push(drive({ via: ['D4', 'E4', 'E3', 'D3', 'C3', 'B3', 'B2', 'C2', 'D2'], endS: 14, label: 'Town drive' }));
  if (m.has('curbside_stop') || m.has('reverse_straight')) {
    steps.push(pullOver());
    if (m.has('reverse_straight')) steps.push(selectGearSilently('R'), reverseStraight({ distance: 12 }));
    steps.push(moveOff());
  }
  if (!full) {
    steps.push(drive({ via: ['C2', 'D2', 'D3', 'D4', 'E4'], endS: 30, label: 'Return' }));
  } else {
    // Part 2: roundabout, signals, then the quiet streets for manoeuvres.
    if (m.has('three_point_turn')) {
      steps.push(drive({ via: ['C2', 'D2', 'E2', 'E3', 'E4', 'E5'], endS: 34, label: 'Roundabout' }), pullOver(), threePointTurn());
      steps.push(drive({ via: ['E5', 'E4', 'D4', 'C4', 'B4', 'B5'], endS: 16, label: 'Back streets' }));
      if (m.has('parallel_park')) {
        const lane = place.lane('B4', 'B5');
        const spot = place.parallelSpot(lane.id, 52);
        props.push(parkedCar(spot.front, 0x3f6fb5), parkedCar(spot.rear, 0x8a8f98));
        steps.push(parallelPark({ bay: spot.bay }), moveOff());
      }
      if (m.has('emergency_stop')) steps.push(drive({ via: ['B4', 'B5', 'C5'], endS: 6 }), emergencyStop());
      steps.push(drive({ via: ['B4', 'B5', 'C5', 'D5', 'D4', 'E4'], endS: 30, label: 'Return' }));
    } else {
      steps.push(drive({ via: ['C2', 'D2', 'E2', 'E3', 'E4', 'E5', 'D5'], endS: 6, label: 'Roundabout' }));
      if (m.has('emergency_stop')) steps.push(emergencyStop());
      steps.push(drive({ via: ['E5', 'D5', 'C5', 'B5', 'B4'], endS: 16, label: 'Back streets' }));
      if (m.has('parallel_park')) {
        const lane = place.lane('B5', 'B4');
        const spot = place.parallelSpot(lane.id, 52);
        props.push(parkedCar(spot.front, 0x3f6fb5), parkedCar(spot.rear, 0x8a8f98));
        steps.push(parallelPark({ bay: spot.bay }), moveOff());
      }
      steps.push(drive({ via: ['B5', 'B4', 'C4', 'D4', 'E4'], endS: 30, label: 'Return' }));
    }
  }

  // Finish in the car park.
  const mode = m.has('reverse_bay_park') ? 'reverse' : 'forward';
  const bayId = mode === 'reverse' ? 'N2' : 'N5';
  const final = bayPark({ bay: place.bayObb(bayId), mode });
  const baseEnter = final.enter!;
  final.enter = (e) => {
    baseEnter(e);
    e.say(`Turn into the Test Centre ${t.parkingLot} on the right and ${mode === 'reverse' ? 'reverse' : 'drive forward'} into the marked bay`, 'park');
  };
  steps.push(final, secureCar(''));
  return { start: place.inBay('S5', 'out'), props, steps };
}

/** Gear change during a test: instruction only, no coaching. */
function selectGearSilently(gear: 'R' | 'D'): Step {
  return prompt({
    label: `Select ${gear}`,
    coach: '',
    until: (e) => e.ctx.player.gear === gear,
    enter: (e) => (e.state.coach = null),
    act: (e) => (e.ctx.player.gear === gear ? { brake: 1 } : { brake: 1, commands: [{ type: 'gear', gear }] }),
  });
}

function testMeta(profile: JurisdictionProfile | null, full: boolean): ScenarioMeta {
  return meta({
    id: full ? 'test-full' : 'test-quick',
    title: full ? 'Mock road test' : 'Quick mock test',
    summary: full ? 'The full route: town, main road, roundabouts, manoeuvres and back to the Test Centre — marked like the real thing.' : 'A shorter assessed drive for when you have five minutes.',
    category: 'test',
    skills: ['junctions', 'traffic_lights', 'roundabouts', 'observation', 'signals', 'speed', 'manoeuvres'],
    briefing: [
      'The examiner gives directions; going off route is not a fault.',
      profile ? profile.roadTest.scoring.description : 'Marked with your region\'s scheme.',
      'Start by getting the car ready: seatbelt, engine, mirrors.',
    ],
    order: full ? 1 : 2,
    estMinutes: full ? 12 : 6,
    difficulty: 3,
    assessed: true,
    defaults: { feedback: 'exam', observation: 'strict', traffic: 'normal', pedestrians: 'few' },
    hasDemo: false,
  });
}

const testFull: ScenarioDef = { meta: testMeta(null, true), build: (env) => buildTest(env, true) };
const testQuick: ScenarioDef = { meta: testMeta(null, false), build: (env) => buildTest(env, false) };

/* -------------------------------- free drive ------------------------------ */

const freeDrive: ScenarioDef = {
  meta: meta({
    id: 'free-drive',
    title: 'Free drive',
    summary: 'Explore Maple Grove your way. The instructor still points out faults if coaching is on.',
    category: 'free',
    skills: [],
    briefing: ['No route and no time limit.', 'Choose the weather, time of day and traffic you want to practise in.', 'Pause and quit whenever you like to see your drive review.'],
    order: 1,
    estMinutes: 10,
    hasDemo: false,
  }),
  build: ({ place }) => ({ start: place.inBay('S5', 'out'), steps: [freeRoam()] }),
};

export const SCENARIOS: readonly ScenarioDef[] = [
  lessonControls,
  lessonMovingOff,
  lessonJunctions,
  lessonStops,
  lessonLights,
  lessonRoundabouts,
  lessonLaneChanges,
  lessonCrossings,
  lessonNight,
  skillParallel,
  bayScenario('reverse'),
  bayScenario('forward'),
  skillThreePoint,
  skillReverse,
  skillEmergency,
  skillKerbside,
  testFull,
  testQuick,
  freeDrive,
];

const BY_ID = new Map(SCENARIOS.map((s) => [s.meta.id, s] as const));

export const getScenario = (id: string): ScenarioDef | undefined => BY_ID.get(id);

/** Scenario cards for a jurisdiction (test briefings quote that region's marking scheme). */
export function listScenarios(profile: JurisdictionProfile): ScenarioMeta[] {
  return SCENARIOS.filter((s) => !s.available || s.available(profile)).map((s) => (s.meta.category === 'test' ? testMeta(profile, s.meta.id === 'test-full') : s.meta));
}
