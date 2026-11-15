/**
 * One drive: owns the SimContext and runs the fixed-step tick in the order
 * documented in docs/ARCHITECTURE.md §3.
 */
import { SIM_DT } from '../core/constants';
import { createEventBus } from '../core/events';
import { createRng } from '../core/rng';
import type { ControlInput, Fault, JurisdictionProfile, MapDef, ScenarioState, SessionResult, SessionSettings, SimContext, SimEvents, StaticObstacle } from '../core/types';
import { type RuleMonitor, createRuleMonitor } from '../rules/monitor';
import { scoreFaults, starsFor } from '../rules/scoring';
import { type ScenarioDef, type ScenarioRuntime, createPlacement, createScenarioRuntime } from '../scenarios/core';
import { getScenario } from '../scenarios/defs';
import { type BuiltNetwork, buildRoadNetwork } from '../world/network';
import { type SceneryLayout, generateScenery } from '../world/scenery';
import { createSignalSystem } from '../world/signals';
import { TOWN } from '../world/town';
import { resolveCollisions } from './collision';
import { createEnvironment } from './environment';
import { type PedestrianSystem, createPedestrians } from './pedestrians';
import { createPlayerCar, updatePlayerCar } from './playerCar';
import { type TrafficSystem, createTraffic } from './traffic';
import { createVehicle } from './vehicle';

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
  readonly def: ScenarioDef;
  /** Live scenario state (same object every tick). */
  readonly scenario: ScenarioState;
  readonly runtime: ScenarioRuntime;
  readonly monitor: RuleMonitor;
  readonly traffic: TrafficSystem;
  readonly pedestrians: PedestrianSystem;
  readonly faults: readonly Fault[];
  readonly ended: boolean;
  /** Advance exactly one fixed step (SIM_DT). */
  tick(input: ControlInput): void;
  result(finishedAt: number, aborted?: boolean): SessionResult;
  dispose(): void;
}

const RESET_CODES = new Set(['collision_vehicle', 'collision_pedestrian', 'off_road']);

export function createSession(opts: SessionOptions): Session {
  const { profile } = opts;
  const def = getScenario(opts.scenarioId) ?? getScenario('free-drive')!;
  const settings: SessionSettings = { ...opts.settings, ...def.meta.forced };
  const network = buildRoadNetwork(opts.map ?? TOWN, profile);
  const scenery = generateScenery(network, 1);
  const events = createEventBus<SimEvents>();
  const rng = createRng(settings.seed);
  const plan = def.build({ net: network, profile, settings, rng: rng.fork(), place: createPlacement(network) });

  const player = createPlayerCar(plan.start, plan.car);
  const obstacles: StaticObstacle[] = [...scenery.obstacles];
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
    obstacles,
    rng,
    events,
  };
  player.location = network.locate(player.vehicle);

  let propId = 100;
  for (const prop of plan.props ?? []) {
    if (prop.kind === 'parked_car') {
      ctx.vehicles.push(createVehicle({ id: propId++, kind: 'parked', model: prop.model ?? 'sedan', pose: prop.pose, colour: prop.colour ?? 0x8a8f98 }));
    } else if (prop.kind === 'cone') {
      obstacles.push({ id: `cone${propId++}`, kind: 'cone', obb: { x: prop.x, z: prop.z, heading: 0, halfLength: 0.2, halfWidth: 0.2 }, height: 0.6 });
    } else {
      obstacles.push({ id: `barrier${propId++}`, kind: 'barrier', obb: { x: prop.pose.x, z: prop.pose.z, heading: prop.pose.heading, halfLength: prop.length / 2, halfWidth: 0.15 }, height: 0.9 });
    }
  }

  const traffic = createTraffic(ctx, plan.traffic);
  const pedestrians = createPedestrians(ctx);
  const monitor = createRuleMonitor(ctx);
  if (plan.suspend) monitor.setSuspended(plan.suspend, true);
  const runtime = createScenarioRuntime({ meta: def.meta, steps: plan.steps, ctx, net: network, monitor, traffic, pedestrians });
  const scenario = runtime.state;
  const assessed = !!def.meta.assessed;

  let resetIn = 0;
  events.on('fault', (f) => {
    if (assessed && f.severity === 'dangerous') runtime.fail(`Test stopped: ${f.title.toLowerCase()}`);
    else if (!assessed && def.meta.category !== 'free' && RESET_CODES.has(f.code) && resetIn <= 0) resetIn = 1.6;
  });

  const path: SessionResult['path'] = [];
  let lastSample = -1;
  const startOdometer = player.odometer;

  return {
    ctx,
    network,
    scenery,
    def,
    scenario,
    runtime,
    monitor,
    traffic,
    pedestrians,
    faults: monitor.faults,
    get ended() {
      return scenario.status !== 'running';
    },
    tick(input: ControlInput): void {
      if (scenario.status !== 'running') return;
      ctx.time += SIM_DT;
      ctx.frame++;
      updatePlayerCar(ctx, input, SIM_DT, opts.steeringSensitivity ?? 1);
      player.location = network.locate(player.vehicle);
      ctx.signals.update(SIM_DT);
      traffic.update(ctx, SIM_DT);
      pedestrians.update(ctx, SIM_DT);
      resolveCollisions(ctx);
      runtime.update(SIM_DT);
      monitor.update(ctx, SIM_DT);
      if (resetIn > 0) {
        resetIn -= SIM_DT;
        if (resetIn <= 0) {
          // Practice only: put the car back where this step began so nobody gets stuck.
          const v = player.vehicle;
          v.x = runtime.stepStart.x;
          v.z = runtime.stepStart.z;
          v.heading = runtime.stepStart.heading;
          v.speed = 0;
          v.steer = 0;
          player.location = network.locate(v);
          events.emit('coach', { text: 'Let us reset and try that part again.', tone: 'info' });
        }
      }
      if (ctx.time - lastSample >= 0.5) {
        lastSample = ctx.time;
        path.push({ x: player.vehicle.x, z: player.vehicle.z, t: ctx.time });
      }
    },
    result(finishedAt: number, aborted = false): SessionResult {
      const score = scoreFaults(monitor.faults, profile);
      const completed = scenario.status === 'completed';
      const free = def.meta.category === 'free';
      let outcome: SessionResult['outcome'];
      if (free) outcome = 'completed';
      else if (aborted && scenario.status === 'running') outcome = 'aborted';
      else if (assessed) outcome = completed && score.passed ? 'passed' : 'failed';
      else outcome = completed ? 'completed' : 'failed';
      return {
        scenarioId: def.meta.id,
        scenarioTitle: def.meta.title,
        category: def.meta.category,
        jurisdictionId: profile.id,
        feedback: settings.feedback,
        finishedAt,
        durationS: ctx.time,
        distanceM: player.odometer - startOdometer,
        outcome,
        endReason: scenario.endReason,
        faults: [...monitor.faults],
        score,
        stars: free || outcome === 'aborted' ? 0 : starsFor(score, completed),
        path,
        praise: { ...monitor.praise },
      };
    },
    dispose(): void {
      events.clear();
    },
  };
}
