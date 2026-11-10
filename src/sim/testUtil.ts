/**
 * Test helpers for the headless simulation: a small, fully typed `SimContext`
 * that needs no map, plus a few conveniences for driving it.
 *
 * Only import this from `*.test.ts` files. Everything is deterministic.
 */

import { SIM_DT } from '../core/constants';
import { createEventBus } from '../core/events';
import { createRng } from '../core/rng';
import type {
  ControlInput,
  JurisdictionProfile,
  MapDef,
  PlayerCommand,
  Pose,
  Rect,
  RoadNetwork,
  SessionSettings,
  SignalSystem,
  SimContext,
  SimEvents,
} from '../core/types';
import { createEnvironment } from './environment';
import { createPlayerCar, updatePlayerCar } from './playerCar';
import type { PlayerCarInit } from './playerCar';

/** Heading that faces North (−Z); turning right from here faces East (+X). */
export const NORTH = Math.PI;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A made-up jurisdiction ("Testland") for unit tests. The values are
 * placeholders chosen to be easy to reason about — they are NOT the law
 * anywhere. Real profiles live in `src/jurisdictions/`.
 */
export function makeTestProfile(overrides: Partial<JurisdictionProfile> = {}): JurisdictionProfile {
  return {
    id: 'test',
    name: 'Testland',
    country: 'Testland',
    countryCode: 'ZZ',
    flag: '🏁',
    licensingAuthority: 'Testland Licensing Office',
    handbookName: 'Testland Driver Handbook',
    handbookUrl: 'https://example.invalid/handbook',
    drivingSide: 'right',
    speedUnit: 'km/h',
    speedLimits: { residential: 30, urban: 50, arterial: 60, school: 20, lot: 10 },
    rules: {
      turnOnRed: 'prohibited',
      signalMinDistanceM: null,
      signalGuidanceDistanceM: 30,
      signalMinTimeLaneChangeS: 3,
      followingGapS: 2,
      uncontrolledPriority: 'priority_to_right',
      allWayStops: true,
      roundabout: { signalOnExit: true, signalOnApproach: 'by_exit_direction' },
      pedestrianPriority: 'on_or_waiting',
      trafficLightSequence: 'red_green_amber',
      headlightsInRain: true,
      notes: [],
    },
    roadStyle: {
      centreLineColour: 'white',
      warningSign: 'red_triangle',
      speedLimitSign: 'red_circle',
      yieldSignText: '',
      crosswalkStyle: 'zebra',
      trafficLightPlacement: 'near_side',
      signalHousing: 'black',
    },
    terms: {
      yield: 'give way',
      curb: 'kerb',
      turnSignal: 'indicator',
      parkingBrake: 'handbrake',
      crosswalk: 'pedestrian crossing',
      sidewalk: 'pavement',
      intersection: 'junction',
      roundabout: 'roundabout',
      trafficLight: 'traffic light',
      amber: 'amber',
      license: 'licence',
      roadTest: 'driving test',
      threePointTurn: 'turn in the road',
      parallelPark: 'parallel park',
      examiner: 'examiner',
      blindSpotCheck: 'blind spot check',
      observationRoutine: 'MSM — Mirror, Signal, Manoeuvre',
      accelerator: 'accelerator',
      parkingLot: 'car park',
      highway: 'motorway',
    },
    roadTest: {
      officialName: 'Testland Driving Test',
      typicalDurationMin: 30,
      scoring: {
        style: 'fault_count',
        pointsPerMinor: 1,
        pointsPerSerious: 5,
        maxPoints: 15,
        seriousIsAutoFail: true,
        officiallyPublished: false,
        description: 'Placeholder marking scheme for unit tests.',
      },
      mockTestManeuvers: ['parallel_park', 'emergency_stop'],
      maneuverNotes: 'Placeholder.',
      preDriveChecks: [],
      automaticFailExamples: [],
      overview: [],
    },
    knowledgeTest: { officialName: 'Testland Theory Test', questionCount: 10, passMark: 8, timeLimitMin: null, notes: '' },
    facts: {
      bacLimit: 0.05,
      bacLimitNovice: 0,
      bacNote: '',
      handheldPhoneBan: true,
      phoneNote: '',
      seatbeltNote: '',
      minLearnerAge: '16',
      minSoloAge: '17',
      schoolZoneNote: '',
      schoolBusRule: null,
      extras: [],
    },
    sources: [],
    lastReviewed: '2000-01-01',
    ...overrides,
  };
}

export const DEFAULT_TEST_SETTINGS: Readonly<SessionSettings> = {
  weather: 'clear',
  timeOfDay: 'day',
  traffic: 'none',
  pedestrians: 'none',
  feedback: 'coach',
  observation: 'relaxed',
  seed: 1,
};

/** Bounds of the stub network: a 2 km square centred on the origin. */
export const STUB_BOUNDS: Readonly<Rect> = { minX: -1000, minZ: -1000, maxX: 1000, maxZ: 1000 };

const EMPTY_MAP: MapDef = { id: 'stub', name: 'Stub', nodes: [], roads: [], zones: [], pois: [] };

/**
 * A road network with no roads: every point is off-road and nothing can be
 * looked up. Enough for subsystems that only need `bounds` and `locate`.
 */
export function stubNetwork(bounds: Rect = STUB_BOUNDS, side: RoadNetwork['side'] = 'right'): RoadNetwork {
  const missing = (what: string): never => {
    throw new Error(`stubNetwork has no ${what}; pass a real network to makeTestContext`);
  };
  return {
    map: EMPTY_MAP,
    side,
    bounds: { ...bounds },
    nodes: new Map(),
    roads: new Map(),
    lanes: new Map(),
    connectors: new Map(),
    crosswalks: new Map(),
    zones: new Map(),
    blocks: [],
    pois: new Map(),
    locate: () => ({ kind: 'offroad' }),
    lanePose: () => missing('lanes'),
    connectorPose: () => missing('connectors'),
    nearestLane: () => null,
  };
}

/** Signals that are always green and never change. */
export function stubSignals(): SignalSystem {
  return {
    update: () => {},
    getState: () => 'green',
    timeToChange: () => Infinity,
    getWalkState: () => 'walk',
  };
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

export interface TestContextOptions {
  /** Where the player's car starts. Default: the origin, facing North. */
  pose?: Pose;
  /** Initial state of the player's car. Default: a cold start (see `createPlayerCar`). */
  player?: PlayerCarInit;
  settings?: Partial<SessionSettings>;
  profile?: JurisdictionProfile;
  /** Real network to use instead of the stub. */
  network?: RoadNetwork;
  /** Bounds of the stub network (ignored when `network` is given). */
  bounds?: Rect;
  signals?: SignalSystem;
}

/** Player state for tests that just want to drive: engine running, belted, in Drive, parking brake off. */
export const READY_TO_DRIVE: Readonly<PlayerCarInit> = {
  engineOn: true,
  seatbelt: true,
  gear: 'D',
  handbrake: false,
};

/**
 * Build a self-contained `SimContext`: stub network and signals unless real
 * ones are passed in, empty vehicle / pedestrian / obstacle lists, environment
 * derived from the settings, and a player car at `pose`.
 */
export function makeTestContext(options: TestContextOptions = {}): SimContext {
  const settings: SessionSettings = { ...DEFAULT_TEST_SETTINGS, ...options.settings };
  const profile = options.profile ?? makeTestProfile();
  return {
    time: 0,
    frame: 0,
    profile,
    settings,
    network: options.network ?? stubNetwork(options.bounds),
    signals: options.signals ?? stubSignals(),
    env: createEnvironment(settings, profile),
    player: createPlayerCar(options.pose ?? { x: 0, z: 0, heading: NORTH }, options.player),
    vehicles: [],
    pedestrians: [],
    obstacles: [],
    rng: createRng(settings.seed),
    events: createEventBus<SimEvents>(),
  };
}

/* -------------------------------------------------------------------------- */
/* Driving                                                                    */
/* -------------------------------------------------------------------------- */

/** A `ControlInput` with nothing pressed, optionally overridden. */
export function makeInput(overrides: Partial<ControlInput> = {}): ControlInput {
  return { throttle: 0, brake: 0, steer: 0, look: 'ahead', horn: false, commands: [], ...overrides };
}

/** Advance the simulation clock by one tick. */
export function advanceClock(ctx: SimContext, dt: number = SIM_DT): void {
  ctx.time += dt;
  ctx.frame += 1;
}

/**
 * Run the player-car update for `seconds` of simulated time with a held input.
 * `commands` are issued on the first tick only (they are edge triggered).
 * Returns the number of ticks run.
 */
export function drivePlayer(
  ctx: SimContext,
  seconds: number,
  input: Partial<Omit<ControlInput, 'commands'>> = {},
  commands: PlayerCommand[] = [],
  dt: number = SIM_DT,
): number {
  const ticks = Math.round(seconds / dt);
  for (let i = 0; i < ticks; i++) {
    updatePlayerCar(ctx, makeInput({ ...input, commands: i === 0 ? commands : [] }), dt);
    advanceClock(ctx, dt);
  }
  return ticks;
}

/** Issue commands on a single tick with otherwise idle (or the given) input. */
export function sendCommands(
  ctx: SimContext,
  commands: PlayerCommand[],
  input: Partial<Omit<ControlInput, 'commands'>> = {},
): void {
  updatePlayerCar(ctx, makeInput({ ...input, commands }), SIM_DT);
  advanceClock(ctx);
}

/** Record every payload emitted for one event type from now on. */
export function recordEvents<K extends keyof SimEvents>(ctx: SimContext, type: K): SimEvents[K][] {
  const seen: SimEvents[K][] = [];
  ctx.events.on(type, (payload) => {
    seen.push(payload);
  });
  return seen;
}
