/**
 * Scenario engine: types, placement helpers (so content never hard-codes
 * coordinates and works on either driving side), examiner phrasing, and the
 * runtime that advances a scenario step by step.
 */
import { PLAYER_SPEC } from '../core/constants';
import { forwardOf, rightOf } from '../core/math';
import type {
  ConnectorInfo,
  ControlInput,
  InstructionIcon,
  JurisdictionProfile,
  LaneInfo,
  Obb,
  PlayerCar,
  Pose,
  PropDef,
  Rng,
  RouteLeg,
  ScenarioMeta,
  ScenarioState,
  SessionSettings,
  SimContext,
} from '../core/types';
import type { RuleGroup, RuleMonitor } from '../rules/monitor';
import type { PedestrianSystem } from '../sim/pedestrians';
import type { TrafficOptions, TrafficSystem } from '../sim/traffic';
import type { BuiltNetwork } from '../world/network';

/* --------------------------------- types ---------------------------------- */

export interface StepEnv {
  ctx: SimContext;
  net: BuiltNetwork;
  profile: JurisdictionProfile;
  monitor: RuleMonitor;
  traffic: TrafficSystem;
  pedestrians: PedestrianSystem;
  state: ScenarioState;
  /** Set the examiner's instruction (no-op if the text is unchanged). */
  say(text: string, icon: InstructionIcon, extra?: { exit?: number; distance?: number | null }): void;
  silence(): void;
  /** Seconds since this step was entered. */
  stepTime: number;
}

/** What a perfect driver should do during a step (used by the autopilot and demos). */
export type AutoHint =
  | { kind: 'wait' }
  | { kind: 'input'; act(e: StepEnv): Partial<ControlInput> }
  | { kind: 'route'; legs(): RouteLeg[] | null; stopAt(): { laneId: string; s: number; lateral: number } | null }
  | { kind: 'script'; act(e: StepEnv): Partial<ControlInput> };

export interface Step {
  label: string;
  enter?(e: StepEnv): void;
  update(e: StepEnv, dt: number): 'running' | 'done' | { fail: string };
  exit?(e: StepEnv): void;
  auto: AutoHint;
}

export interface ScenarioPlan {
  start: Pose;
  car?: Partial<Pick<PlayerCar, 'gear' | 'handbrake' | 'engineOn' | 'seatbelt' | 'headlights' | 'wipers'>>;
  props?: PropDef[];
  traffic?: TrafficOptions;
  suspend?: RuleGroup[];
  steps: Step[];
}

export interface BuildEnv {
  net: BuiltNetwork;
  profile: JurisdictionProfile;
  settings: SessionSettings;
  rng: Rng;
  place: Placement;
}

export interface ScenarioDef {
  meta: ScenarioMeta;
  available?(profile: JurisdictionProfile): boolean;
  build(env: BuildEnv): ScenarioPlan;
}

/* ------------------------------- placement -------------------------------- */

export interface Placement {
  /** Lane travelling from node `from` to the adjacent node `to` ('kerb' = kerb-most, 'centre' = centre-most). */
  lane(from: string, to: string, pick?: 'kerb' | 'centre'): LaneInfo;
  inLane(laneId: string, s: number): Pose;
  /** Parked at the kerb: on the parking strip where there is one, otherwise tight against the kerb in the lane. */
  atKerb(laneId: string, s: number): Pose;
  /** Lateral offset (right of travel) of a car parked at the kerb at this point. */
  kerbLateral(laneId: string, s: number): number;
  /** Pose of a car parked in a car-park bay, nose toward the edge ('in') or toward the aisle ('out'). */
  inBay(bayId: string, facing: 'in' | 'out'): Pose;
  bayObb(bayId: string): Obb;
  /** A kerbside parallel-parking set-up: target box, the cars in front and behind, and where to pull up first. */
  parallelSpot(laneId: string, s: number, gapLengths?: number): { bay: Obb; front: Pose; rear: Pose; pullUp: { s: number; lateral: number } };
}

export function createPlacement(net: BuiltNetwork): Placement {
  const W = PLAYER_SPEC.width;
  const L = PLAYER_SPEC.length;
  const zone = net.zones.get('test_centre')!;
  const laneOf = (id: string): LaneInfo => {
    const lane = net.lanes.get(id);
    if (!lane) throw new Error(`Unknown lane ${id}`);
    return lane;
  };
  const hasStrip = (lane: LaneInfo, s: number): boolean => {
    const p = net.lanePose(lane.id, s, net.kerbSign * (lane.width / 2 + 1));
    return net.locate(p).kind === 'parking_strip';
  };
  const kerbLateral = (laneId: string, s: number): number => {
    const lane = laneOf(laneId);
    const road = net.roads.get(lane.roadId)!;
    return hasStrip(lane, s) ? net.kerbSign * (lane.width / 2 + road.parkingStripWidth / 2) : net.kerbSign * (lane.width / 2 - W / 2 - 0.3);
  };
  return {
    lane(from, to, pick = 'kerb') {
      const options = [...net.lanes.values()].filter((l) => l.from === from && l.to === to).sort((a, b) => a.index - b.index);
      if (!options.length) throw new Error(`No lane from ${from} to ${to}`);
      return pick === 'kerb' ? options[options.length - 1]! : options[0]!;
    },
    inLane: (laneId, s) => net.lanePose(laneId, s),
    atKerb: (laneId, s) => net.lanePose(laneId, s, kerbLateral(laneId, s)),
    kerbLateral,
    inBay(bayId, facing) {
      const bay = zone.bays.find((b) => b.id === bayId);
      if (!bay) throw new Error(`Unknown bay ${bayId}`);
      return { x: bay.pose.x, z: bay.pose.z, heading: facing === 'in' ? bay.pose.heading : bay.pose.heading + Math.PI };
    },
    bayObb(bayId) {
      const bay = zone.bays.find((b) => b.id === bayId)!;
      return { x: bay.pose.x, z: bay.pose.z, heading: bay.pose.heading, halfLength: bay.length / 2, halfWidth: bay.width / 2 };
    },
    parallelSpot(laneId, s, gapLengths = 1.7) {
      const lane = laneOf(laneId);
      const road = net.roads.get(lane.roadId)!;
      const lateral = net.kerbSign * (lane.width / 2 + road.parkingStripWidth / 2);
      const gap = L * gapLengths;
      const centre = net.lanePose(laneId, s, lateral);
      const car = 4.4;
      return {
        bay: { x: centre.x, z: centre.z, heading: lane.heading, halfLength: gap / 2, halfWidth: road.parkingStripWidth / 2 },
        front: net.lanePose(laneId, s + gap / 2 + car / 2, lateral),
        rear: net.lanePose(laneId, s - gap / 2 - car / 2, lateral),
        pullUp: { s: s + gap / 2 + car / 2 + 0.6, lateral: net.kerbSign * 0.25 },
      };
    },
  };
}

/** Clear distance from the kerb-side of a car to the kerb (probing sideways until the sidewalk starts). */
export function kerbGap(net: BuiltNetwork, pose: Pose, halfWidth = PLAYER_SPEC.width / 2): number {
  const r = rightOf(pose.heading);
  // The kerb side of the lane direction the car is facing.
  for (let d = 0; d < 6; d += 0.05) {
    const p = { x: pose.x + r.x * net.kerbSign * d, z: pose.z + r.z * net.kerbSign * d };
    if (net.locate(p).kind === 'sidewalk') return Math.max(0, d - halfWidth);
  }
  return Infinity;
}

/* ------------------------------- guidance --------------------------------- */

const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth'];

/** How an examiner would announce the movement through the junction at the end of `lane`. Null = say nothing (follow the road). */
export function instructionFor(net: BuiltNetwork, profile: JurisdictionProfile, lane: LaneInfo, conn: ConnectorInfo): { text: string; icon: InstructionIcon; exit?: number } | null {
  const node = net.nodes.get(conn.nodeId)!;
  const t = profile.terms;
  if (node.control === 'none') return null;
  if (node.roundabout) {
    const exit = conn.exitNumber ?? 1;
    return { text: `At the ${t.roundabout}, take the ${ORDINAL[exit] ?? `${exit}th`} exit`, icon: 'roundabout', exit };
  }
  if (conn.turn === 'straight' || conn.turn === 'uturn') return null;
  const dir = conn.turn;
  const icon: InstructionIcon = dir;
  const endOfRoad = !node.arms[lane.travel];
  if (node.control === 'signal') return { text: `At the ${t.trafficLight}s, turn ${dir}`, icon };
  if (endOfRoad) return { text: `At the end of the road, turn ${dir}`, icon };
  if (lane.endControl === 'stop') return { text: `At the stop sign, turn ${dir}`, icon };
  return { text: `Take the next road on the ${dir}`, icon };
}

/* -------------------------------- runtime --------------------------------- */

export interface ScenarioRuntime {
  readonly state: ScenarioState;
  readonly step: Step | null;
  readonly env: StepEnv;
  update(dt: number): void;
  /** Pose and car state when the current step began (for "try that again" resets). */
  readonly stepStart: Pose;
  /** End the scenario as failed (e.g. a dangerous fault on a test). */
  fail(reason: string): void;
}

export function createScenarioRuntime(opts: { meta: ScenarioMeta; steps: Step[]; ctx: SimContext; net: BuiltNetwork; monitor: RuleMonitor; traffic: TrafficSystem; pedestrians: PedestrianSystem }): ScenarioRuntime {
  const { ctx, steps } = opts;
  const state: ScenarioState = {
    meta: opts.meta,
    status: 'running',
    endReason: null,
    instruction: null,
    coach: null,
    route: [],
    targets: [],
    step: 0,
    totalSteps: steps.length,
    activeManeuver: null,
  };
  let insId = 0;
  const env: StepEnv = {
    ctx,
    net: opts.net,
    profile: ctx.profile,
    monitor: opts.monitor,
    traffic: opts.traffic,
    pedestrians: opts.pedestrians,
    state,
    stepTime: 0,
    say(text, icon, extra = {}) {
      const cur = state.instruction;
      if (cur && cur.text === text && cur.icon === icon) {
        cur.distance = extra.distance ?? null;
        return;
      }
      state.instruction = { id: ++insId, text, icon, distance: extra.distance ?? null };
      if (extra.exit !== undefined) state.instruction.exit = extra.exit;
      ctx.events.emit('instruction', state.instruction);
    },
    silence() {
      state.instruction = null;
    },
  };
  let index = -1;
  let current: Step | null = null;
  const stepStart: Pose = { x: ctx.player.vehicle.x, z: ctx.player.vehicle.z, heading: ctx.player.vehicle.heading };

  function advance(): void {
    current?.exit?.(env);
    if (current) ctx.events.emit('step', { index, total: steps.length, label: current.label });
    index++;
    state.step = Math.min(index, steps.length);
    env.stepTime = 0;
    if (index >= steps.length) {
      current = null;
      state.status = 'completed';
      state.coach = null;
      state.route = [];
      state.targets = [];
      ctx.events.emit('ended', { status: 'completed', reason: null });
      return;
    }
    current = steps[index]!;
    const v = ctx.player.vehicle;
    stepStart.x = v.x;
    stepStart.z = v.z;
    stepStart.heading = v.heading;
    current.enter?.(env);
  }

  return {
    state,
    env,
    stepStart,
    get step() {
      return current;
    },
    update(dt) {
      if (state.status !== 'running') return;
      if (index < 0) advance();
      if (!current) return;
      env.stepTime += dt;
      const r = current.update(env, dt);
      if (r === 'done') advance();
      else if (r !== 'running') this.fail(r.fail);
    },
    fail(reason) {
      if (state.status !== 'running') return;
      state.status = 'failed';
      state.endReason = reason;
      ctx.events.emit('ended', { status: 'failed', reason });
    },
  };
}

export const playerPose = (ctx: SimContext): Pose => ({ x: ctx.player.vehicle.x, z: ctx.player.vehicle.z, heading: ctx.player.vehicle.heading });
export { forwardOf };
