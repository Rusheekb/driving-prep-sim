/**
 * One drive: owns the SimContext and runs the fixed-step tick in the order
 * documented in docs/ARCHITECTURE.md §3.
 */
import { SIM_DT } from '../core/constants';
import { createEventBus } from '../core/events';
import { createRng } from '../core/rng';
import type { ControlInput, Fault, JurisdictionProfile, MapDef, ScenarioState, SessionResult, SessionSettings, SimContext, SimEvents } from '../core/types';
import { type BuiltNetwork, buildRoadNetwork } from '../world/network';
import { type SceneryLayout, generateScenery } from '../world/scenery';
import { createSignalSystem } from '../world/signals';
import { TOWN } from '../world/town';
import { resolveCollisions } from './collision';
import { createEnvironment } from './environment';
import { createPlayerCar, updatePlayerCar } from './playerCar';

export interface SessionOptions {
  scenarioId: string;
  profile: JurisdictionProfile;
  settings: SessionSettings;
  map?: MapDef;
  /** Keyboard steering speed multiplier (AppSettings.steeringSensitivity). */
  steeringSensitivity?: number;
}

export interface Session {
  readonly ctx: SimContext;
  readonly network: BuiltNetwork;
  readonly scenery: SceneryLayout;
  /** Live scenario state (same object every tick). */
  readonly scenario: ScenarioState;
  readonly faults: readonly Fault[];
  readonly ended: boolean;
  /** Advance exactly one fixed step (SIM_DT). */
  tick(input: ControlInput): void;
  result(finishedAt: number, aborted?: boolean): SessionResult;
  dispose(): void;
}

const EMPTY_INPUT: ControlInput = { throttle: 0, brake: 0, steer: 0, look: 'ahead', horn: false, commands: [] };

export function createSession(opts: SessionOptions): Session {
  const { profile, settings } = opts;
  const network = buildRoadNetwork(opts.map ?? TOWN, profile);
  const scenery = generateScenery(network, 1);
  const events = createEventBus<SimEvents>();
  const rng = createRng(settings.seed);

  // Free drive starts parked nose-out in the Test Centre car park.
  const zone = network.zones.get('test_centre')!;
  const bay = zone.bays.find((b) => b.id === 'S5')!;
  const player = createPlayerCar({ x: bay.pose.x, z: bay.pose.z, heading: bay.pose.heading + Math.PI });

  const ctx: SimContext = {
    time: 0,
    frame: 0,
    profile,
    settings,
    network,
    signals: createSignalSystem(network, profile),
    env: createEnvironment(settings, profile),
    player,
    vehicles: [],
    pedestrians: [],
    obstacles: [...scenery.obstacles],
    rng,
    events,
  };
  player.location = network.locate(player.vehicle);

  const scenario: ScenarioState = {
    meta: {
      id: opts.scenarioId,
      title: 'Free drive',
      summary: 'Explore Maple Grove at your own pace.',
      category: 'free',
      skills: [],
      difficulty: 1,
      estMinutes: 10,
      briefing: [],
      order: 0,
    },
    status: 'running',
    endReason: null,
    instruction: null,
    coach: null,
    route: [],
    targets: [],
    step: 0,
    totalSteps: 0,
    activeManeuver: null,
  };
  const faults: Fault[] = [];
  const path: SessionResult['path'] = [];
  let lastSample = -1;
  const startOdometer = player.odometer;

  return {
    ctx,
    network,
    scenery,
    scenario,
    faults,
    get ended() {
      return scenario.status !== 'running';
    },
    tick(input: ControlInput = EMPTY_INPUT): void {
      if (scenario.status !== 'running') return;
      ctx.time += SIM_DT;
      ctx.frame++;
      updatePlayerCar(ctx, input, SIM_DT, opts.steeringSensitivity ?? 1);
      player.location = network.locate(player.vehicle);
      ctx.signals.update(SIM_DT);
      resolveCollisions(ctx);
      if (ctx.time - lastSample >= 0.5) {
        lastSample = ctx.time;
        path.push({ x: player.vehicle.x, z: player.vehicle.z, t: ctx.time });
      }
    },
    result(finishedAt: number, aborted = false): SessionResult {
      return {
        scenarioId: scenario.meta.id,
        scenarioTitle: scenario.meta.title,
        category: scenario.meta.category,
        jurisdictionId: profile.id,
        feedback: settings.feedback,
        finishedAt,
        durationS: ctx.time,
        distanceM: player.odometer - startOdometer,
        outcome: aborted ? 'aborted' : 'completed',
        endReason: scenario.endReason,
        faults: [...faults],
        score: { minor: 0, serious: 0, dangerous: 0, points: 0, maxPoints: profile.roadTest.scoring.maxPoints, passed: true, failReasons: [], headline: '' },
        stars: 0,
        path,
        praise: {},
      };
    },
    dispose(): void {
      events.clear();
    },
  };
}
