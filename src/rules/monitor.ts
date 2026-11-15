/**
 * The examiner: watches the learner every tick and records faults the way a
 * fair driving examiner in the active jurisdiction would. Ambiguous evidence
 * never produces a fault — every check has tolerances, dwell times and
 * de-duplication.
 */
import { angleDiff, obbContainsPoint, toLocal } from '../core/math';
import { fromMps, toMps } from '../core/units';
import type { Fault, FaultCode, LaneInfo, ManeuverType, NodeInfo, PraiseKind, Severity, SignalColour, SimContext, SimVehicle, Turn, Vec2 } from '../core/types';
import { vehicleObb } from '../sim/vehicle';
import type { BuiltNetwork } from '../world/network';
import { FAULTS } from './catalog';
import { describeFault } from './messages';
import { effectiveSeverity } from './scoring';

export type RuleGroup = 'speed' | 'signals' | 'observation' | 'junction_control' | 'right_of_way' | 'positioning' | 'following' | 'control' | 'hesitation';

export interface ReportOptions {
  severity?: Severity;
  detail?: string;
  tip?: string;
  x?: number;
  z?: number;
  /** Bypass the per-code cool-down (manoeuvre evaluators). */
  force?: boolean;
  info?: Record<string, string | number>;
}

export interface RuleMonitor {
  readonly faults: readonly Fault[];
  readonly praise: Readonly<Partial<Record<PraiseKind, number>>>;
  update(ctx: SimContext, dt: number): void;
  /** Record a fault decided elsewhere (scenario / manoeuvre evaluators). Null when suppressed by the cool-down. */
  report(code: FaultCode, opts?: ReportOptions): Fault | null;
  setSuspended(groups: readonly RuleGroup[], suspended: boolean): void;
  setContext(c: { maneuver?: ManeuverType | null; emergencyStop?: boolean }): void;
}

interface Approach {
  lane: LaneInfo;
  startOdo: number;
  minSpeedZone: number;
  stillFor: number;
  stoppedInZone: boolean;
  stoppedPast: boolean;
  stopTime: number;
  waited: number;
  hesitated: boolean;
  crossed: boolean;
  signalAtLine: SignalColour | null;
}

interface Traverse {
  from: LaneInfo;
  node: NodeInfo;
  time: number;
  signal: SignalColour;
  stopped: boolean;
  indicator: string;
  indicatorDist: number;
  indicatorTime: number;
  approachDist: number;
  mirrorAge: number;
  lastKerbSignal: number;
  redFlagged: boolean;
  odo: number;
}

const PRAISE_TEXT: Record<PraiseKind, string> = {
  full_stop: 'Full stop — nicely done',
  good_signal: 'Good, early signal',
  good_observation: 'Great observation',
  smooth_stop: 'Smooth stop',
  yielded: 'Well judged — you gave way',
  good_gap: 'Safe following gap',
  good_parking: 'Neatly parked',
  speed_control: 'Good speed control',
};

export function createRuleMonitor(ctx: SimContext): RuleMonitor {
  const net = ctx.network as BuiltNetwork;
  const profile = ctx.profile;
  const rules = profile.rules;
  const kerbSide: 'left' | 'right' = net.side === 'right' ? 'right' : 'left';
  const roadSide: 'left' | 'right' = kerbSide === 'right' ? 'left' : 'right';
  const faults: Fault[] = [];
  const praise: Partial<Record<PraiseKind, number>> = {};
  const suspended = new Set<RuleGroup>();
  const lastFault = new Map<FaultCode, { time: number; odo: number }>();
  const lastPraise = new Map<PraiseKind, number>();
  let nextId = 1;
  let maneuver: ManeuverType | null = null;
  let emergencyStop = false;

  const player = ctx.player;
  const pv = player.vehicle;
  const half = pv.spec.length / 2;
  const on = (g: RuleGroup): boolean => !suspended.has(g);

  function report(code: FaultCode, opts: ReportOptions = {}): Fault | null {
    const prev = lastFault.get(code);
    if (!opts.force && prev && ctx.time - prev.time < 8 && Math.abs(player.odometer - prev.odo) < 25) return null;
    lastFault.set(code, { time: ctx.time, odo: player.odometer });
    const text = describeFault(code, profile, opts.info);
    const fault: Fault = {
      id: nextId++,
      code,
      category: FAULTS[code].category,
      severity: effectiveSeverity(code, profile, opts.severity),
      time: ctx.time,
      x: opts.x ?? pv.x,
      z: opts.z ?? pv.z,
      title: text.title,
      detail: opts.detail ?? text.detail,
      tip: opts.tip ?? text.tip,
    };
    faults.push(fault);
    ctx.events.emit('fault', fault);
    return fault;
  }

  function cheer(kind: PraiseKind, gap = 25): void {
    const last = lastPraise.get(kind) ?? -Infinity;
    if (ctx.time - last < gap) return;
    lastPraise.set(kind, ctx.time);
    praise[kind] = (praise[kind] ?? 0) + 1;
    ctx.events.emit('praise', { kind, text: PRAISE_TEXT[kind] });
  }

  /* ------------------------------ state ------------------------------ */
  let approach: Approach | null = null;
  let traverse: Traverse | null = null;
  let lastTurnCrossed = false;
  let lastSettle = -Infinity;
  let laneId: string | null = null;
  let lastLaneChange = -Infinity;
  let lastLaneChangeDir: 'left' | 'right' | null = null;
  let establishedSince = 0;
  let overT = 0;
  let underLimitT = 0;
  let speedFlag: '' | 'minor' | 'serious' = '';
  let excessT = 0;
  let schoolT = 0;
  let slowT = 0;
  let goodSpeedT = 0;
  let wrongSideT = 0;
  let wrongSideFlagged = false;
  let straddleT = 0;
  let kerbT = 0;
  let offT = 0;
  let rbWrongT = 0;
  let tailT = 0;
  let tailCloseT = 0;
  let goodGapT = 0;
  let handT = 0;
  let lightsT = 0;
  let wipersT = 0;
  let neutralT = 0;
  let harshT = 0;
  let lightsFlagged = false;
  let wipersFlagged = false;
  let beltFlagged = false;
  let parkedFor = 0;
  let parkedArmed = false;
  let wasParkGear = false;
  let reversingFor = 0;
  let notReversingFor = 10;
  let lastKerbSignal = -Infinity;
  let signalWarned = false;
  let lastCollision = -Infinity;
  const aiStop = new Map<number, number>();
  const encounters = new Map<number, number>();
  const pedWait = new Map<number, number>();
  const pedFlag = new Map<number, number>();
  let yieldedHold = 0;

  const unsub = [
    ctx.events.on('collision', (c) => {
      lastCollision = ctx.time;
      if (c.with === 'pedestrian') report('collision_pedestrian', { force: true, x: c.x, z: c.z });
      else if (c.with === 'vehicle') report('collision_vehicle', { force: true, x: c.x, z: c.z });
      else if (c.with === 'parked_vehicle') report('collision_vehicle', { force: true, severity: c.impactSpeed < 1 ? 'serious' : 'dangerous', x: c.x, z: c.z, detail: 'You bumped a parked vehicle.' });
      else {
        const o = ctx.obstacles.find((x) => x.id === c.otherId);
        const cone = o?.kind === 'cone';
        report('collision_object', { force: true, severity: cone ? (maneuver ? 'minor' : 'serious') : c.impactSpeed > 5 ? 'dangerous' : 'serious', x: c.x, z: c.z, detail: cone ? 'You knocked over a cone.' : undefined });
      }
    }),
    ctx.events.on('aiBrake', (e) => {
      if (!e.forPlayer || !on('right_of_way')) return;
      const ai = ctx.vehicles.find((v) => v.id === e.vehicleId);
      if (ai) judgeRightOfWay(ai, e.decel > 5 ? 0.8 : 1.6);
    }),
  ];
  void unsub;

  /* --------------------------- right of way --------------------------- */

  /** The lane an AI vehicle is on or came from (for priority comparisons). */
  function aiLane(ai: SimVehicle): { lane: LaneInfo; inJunction: boolean } | null {
    const nav = ai.nav;
    if (!nav) return null;
    if (nav.laneId) return { lane: net.lanes.get(nav.laneId)!, inJunction: false };
    if (nav.connectorId) return { lane: net.lanes.get(net.connectors.get(nav.connectorId)!.from)!, inJunction: true };
    return null;
  }

  /** Decide whether `ai` had priority over the learner in the current situation and record the fault if so. */
  function judgeRightOfWay(ai: SimVehicle, timeToContact: number): void {
    const last = encounters.get(ai.id) ?? -Infinity;
    if (ctx.time - last < 10) return;
    const a = aiLane(ai);
    if (!a) return;
    const loc = player.location;
    let code: FaultCode | null = null;

    if (traverse && ctx.time - traverse.time < 12) {
      // The learner is in (or has just left) a junction.
      const node = traverse.node;
      const sameNode = a.lane.to === node.id || (a.inJunction && net.connectors.get(ai.nav!.connectorId!)!.nodeId === node.id);
      if (sameNode) {
        const mine = traverse.from;
        const mineControl = mine.endControl;
        const oncoming = a.lane.arrivalArm === mine.travel;
        const turning = Math.abs(angleDiff(pv.heading, mine.heading));
        const crossing = turning > 0.35 && (angleDiff(pv.heading, mine.heading) > 0 ? 'left' : 'right') === roadSide;
        if (node.roundabout) {
          if (a.inJunction) code = 'failed_to_yield_roundabout';
        } else if (node.control === 'signal') {
          if (traverse.signal === 'red' || traverse.signal === 'red_amber') code = 'failed_to_yield_vehicle';
          else if (crossing && oncoming) code = 'failed_to_yield_vehicle';
        } else if ((mineControl === 'stop' || mineControl === 'yield') && a.lane.endControl === 'none') code = 'failed_to_yield_vehicle';
        else if (mineControl === 'stop' && a.lane.endControl === 'stop') {
          const theirs = aiStop.get(ai.id) ?? Infinity;
          if (theirs < (approachStopTime ?? Infinity) - 0.3) code = 'failed_to_yield_vehicle';
        } else if (crossing && oncoming) code = 'failed_to_yield_vehicle';
        else if (node.control === 'uncontrolled') {
          const fromRight = a.lane.travel === ({ N: 'W', W: 'S', S: 'E', E: 'N' } as const)[mine.travel];
          if (rules.uncontrolledPriority === 'priority_to_right' ? fromRight : a.inJunction && fromRight) code = 'failed_to_yield_vehicle';
        }
      }
    }
    if (!code && (loc.kind === 'lane' || loc.kind === 'parking_strip')) {
      // Pulled out or changed lanes into the path of a vehicle already travelling in that lane.
      const sameLane = !a.inJunction && a.lane.id === loc.lane.id;
      if (sameLane && ctx.time - lastLaneChange < 4) code = 'unsafe_lane_change';
      else if (sameLane && ctx.time - establishedSince < 5 && ctx.time - lastSettle > 5) code = 'failed_to_yield_vehicle';
    }
    if (!code) return;
    encounters.set(ai.id, ctx.time);
    report(code, { force: true, severity: timeToContact < 1 ? 'dangerous' : 'serious' });
  }
  let approachStopTime: number | null = null;

  function checkRightOfWay(): void {
    const box = vehicleObb(pv, 0.4);
    for (const ai of ctx.vehicles) {
      if (ai.kind !== 'ai' || ai.speed < 2.5 || !ai.nav) continue;
      const dx = ai.x - pv.x;
      const dz = ai.z - pv.z;
      if (dx * dx + dz * dz > 1600) continue;
      // Is the AI simply following the learner along the same lane?
      const loc = player.location;
      if (loc.kind === 'lane' && ai.nav.laneId === loc.lane.id && ctx.time - establishedSince > 5 && ctx.time - lastLaneChange > 4) continue;
      const horizon = Math.max(10, ai.speed * 2.5);
      const nav = ai.nav;
      for (let d = ai.spec.length / 2 + 0.5; d < horizon; d += 1.2) {
        let pose: Vec2 | null = null;
        let s = nav.s + d;
        if (nav.laneId) {
          const lane = net.lanes.get(nav.laneId)!;
          if (s <= lane.length) pose = net.lanePose(lane.id, s);
          else if (nav.nextConnectorId) {
            const c = net.connectors.get(nav.nextConnectorId)!;
            s -= lane.length;
            pose = s <= c.length ? net.connectorPose(c.id, s) : net.lanePose(c.to, s - c.length);
          }
        } else if (nav.connectorId) {
          const c = net.connectors.get(nav.connectorId)!;
          pose = s <= c.length ? net.connectorPose(c.id, s) : net.lanePose(c.to, s - c.length);
        }
        if (!pose) break;
        if (obbContainsPoint(box, pose)) {
          judgeRightOfWay(ai, d / ai.speed);
          break;
        }
      }
    }
  }

  function checkPedestrians(): void {
    const front = { x: pv.x + Math.sin(pv.heading) * half, z: pv.z + Math.cos(pv.heading) * half };
    const speed = Math.abs(pv.speed);
    let holdingForPed = false;
    for (const ped of ctx.pedestrians) {
      if (!ped.crosswalkId) {
        pedWait.delete(ped.id);
        continue;
      }
      if (ped.state === 'waiting' && !pedWait.has(ped.id)) pedWait.set(ped.id, ctx.time);
      const xw = net.crosswalks.get(ped.crosswalkId);
      if (!xw) continue;
      const dx = xw.b.x - xw.a.x;
      const dz = xw.b.z - xw.a.z;
      const len = Math.hypot(dx, dz);
      const along = ((front.x - xw.a.x) * dx + (front.z - xw.a.z) * dz) / len;
      const across = Math.abs(((front.x - xw.a.x) * dz - (front.z - xw.a.z) * dx) / len);
      const near = Math.hypot(ped.x - pv.x, ped.z - pv.z);
      if (near < 14 && speed < 1 && (ped.state === 'crossing' || ped.state === 'waiting')) holdingForPed = true;
      if (along < 0 || along > len || across > xw.width / 2 || speed < 1) continue;
      if (ctx.time - (pedFlag.get(ped.id) ?? -Infinity) < 12) continue;
      const rel = toLocal(pv, ped);
      if (ped.state === 'crossing') {
        // In the car's path, or about to be: not someone already safely past or far across a wide road.
        if (rel.forward > -1.5 && rel.forward < 9 && Math.abs(rel.right) < 3.2) {
          pedFlag.set(ped.id, ctx.time);
          report('failed_to_yield_pedestrian', { force: true, severity: Math.abs(rel.right) < 1.5 && rel.forward < 4 ? 'dangerous' : 'serious' });
        }
      } else if (ped.state === 'waiting' && !xw.signalised && rules.pedestrianPriority === 'on_or_waiting' && speed > 3) {
        if (ctx.time - (pedWait.get(ped.id) ?? ctx.time) > 2.5) {
          pedFlag.set(ped.id, ctx.time);
          report('failed_to_yield_pedestrian', { force: true, detail: `Someone was waiting to cross and you drove through the ${profile.terms.crosswalk}.` });
        }
      }
    }
    if (holdingForPed) {
      yieldedHold += 1 / 60;
      if (yieldedHold > 1) cheer('yielded', 30);
    } else yieldedHold = 0;
  }

  /* ----------------------------- junctions ---------------------------- */

  function turnBetween(from: LaneInfo, to: LaneInfo): Turn {
    const d = angleDiff(to.heading, from.heading);
    if (Math.abs(d) < 0.35) return 'straight';
    if (Math.abs(d) > 2.6) return 'uturn';
    return d < 0 ? 'right' : 'left';
  }

  function onCross(a: Approach): void {
    const lane = a.lane;
    const node = net.nodes.get(lane.to)!;
    const signal = a.signalAtLine ?? ctx.signals.getState(node.id, lane.arrivalArm);
    traverse = {
      from: lane,
      node,
      time: ctx.time,
      signal,
      stopped: a.stoppedInZone,
      indicator: player.indicator,
      indicatorDist: player.indicatorOdometer === null ? 0 : player.odometer - player.indicatorOdometer,
      indicatorTime: player.indicatorSince === null ? 0 : ctx.time - player.indicatorSince,
      approachDist: player.odometer - a.startOdo,
      mirrorAge: ctx.time - Math.max(player.lastMirrorCheck.centre, player.lastMirrorCheck.left, player.lastMirrorCheck.right),
      lastKerbSignal: -Infinity,
      redFlagged: false,
      odo: player.odometer,
    };
    approachStopTime = a.stopTime;
    if (!on('junction_control')) return;
    if (lane.endControl === 'stop') {
      if (a.stoppedInZone) cheer('full_stop', 20);
      else if (a.stoppedPast) report('stopped_over_line', { force: true });
      else if (a.minSpeedZone > 3.5) report('ran_stop_sign', { force: true });
      else report('rolling_stop', { force: true });
      // All-way stops: did someone who stopped first lose their turn?
      if (a.stoppedInZone && node.control === 'allway_stop' && on('right_of_way')) {
        for (const ai of ctx.vehicles) {
          const t = aiStop.get(ai.id);
          if (t === undefined || !ai.nav || !ai.nav.laneId) continue;
          const l = net.lanes.get(ai.nav.laneId)!;
          if (l.to === node.id && l.id !== lane.id && t < a.stopTime - 0.4 && ai.speed < 1) {
            report('out_of_turn_at_stop');
            break;
          }
        }
      }
    }
    if (ctx.settings.observation === 'strict' && on('observation') && (lane.endControl === 'stop' || lane.endControl === 'yield') && !node.roundabout) {
      const lookedBoth = ctx.time - player.lastShoulderCheck.left < 7 && ctx.time - player.lastShoulderCheck.right < 7;
      if (!lookedBoth) report('no_scan_at_junction');
    }
  }

  function onSettle(t: Traverse, to: LaneInfo): void {
    const turn = turnBetween(t.from, to);
    const node = t.node;
    lastTurnCrossed = turn !== 'straight' && turn === roadSide;
    lastSettle = ctx.time;
    const nearSideTurn = turn === kerbSide;

    if (on('junction_control') && (t.signal === 'red' || t.signal === 'red_amber') && !t.redFlagged) {
      if (nearSideTurn && rules.turnOnRed === 'allowed_after_stop' && t.stopped) {
        /* legal turn on red */
      } else if (nearSideTurn && t.stopped) report('illegal_turn_on_red', { force: true });
      else if (nearSideTurn && rules.turnOnRed === 'allowed_after_stop') report('illegal_turn_on_red', { force: true });
      else report('ran_red_light', { force: true });
    }

    const arms = Object.keys(node.arms).length;
    if (on('signals') && node.control !== 'none' && arms >= 3) {
      if (node.roundabout) {
        const rb = rules.roundabout;
        if (rb.signalOnApproach === 'by_exit_direction') {
          if (turn === 'straight' && (t.indicator === 'left' || t.indicator === 'right') && t.indicator !== kerbSide) report('wrong_signal');
          else if (turn !== 'straight' && turn !== 'uturn' && t.indicator !== turn) report(t.indicator === 'off' || t.indicator === 'hazard' ? 'no_signal_turn' : 'wrong_signal');
        }
        if (rb.signalOnExit && ctx.time - lastKerbSignal > 2.5) report('no_signal_roundabout_exit');
      } else if (turn === 'left' || turn === 'right') {
        const need = Math.min(rules.signalGuidanceDistanceM, 0.6 * t.approachDist) * 0.6;
        if (t.indicator === turn) {
          if (t.indicatorDist < need && t.indicatorTime < 2.5) report('late_signal_turn');
          else cheer('good_signal', 40);
        } else if (t.indicator === 'off' || t.indicator === 'hazard') report('no_signal_turn');
        else report('wrong_signal');
      } else if (turn === 'straight' && (t.indicator === 'left' || t.indicator === 'right') && t.indicatorDist > 20) report('wrong_signal');
    }

    if (on('positioning') && !node.roundabout && (turn === 'left' || turn === 'right')) {
      if (to.laneCount >= 2) {
        const wanted = nearSideTurn ? to.laneCount - 1 : 0;
        if (to.index !== wanted) report('wide_turn');
      }
      const legal = t.from.connectors.some((id) => net.connectors.get(id)!.turn === turn);
      if (!legal && t.from.laneCount >= 2) report('wrong_lane_for_turn');
    }
    if (ctx.settings.observation === 'strict' && on('observation') && (turn === 'left' || turn === 'right') && node.control !== 'none' && t.mirrorAge > 8) report('no_mirror_check');
  }

  /* ------------------------------ update ------------------------------ */

  function update(_c: SimContext, dt: number): void {
    if (ctx.time < 1) return;
    const loc = player.location;
    const speed = Math.abs(pv.speed);
    const moving = speed > 1;
    const inZone = loc.kind === 'zone';
    const lane = loc.kind === 'lane' || loc.kind === 'parking_strip' ? loc.lane : null;
    const aligned = !!lane && Math.cos(pv.heading - lane.heading) > 0;
    const onLane = loc.kind === 'lane' && aligned;
    const s = loc.kind === 'lane' || loc.kind === 'parking_strip' ? loc.s : 0;

    if (player.indicator === kerbSide) lastKerbSignal = ctx.time;

    // Track when AI vehicles come to a halt at stop lines (for all-way stop order).
    for (const ai of ctx.vehicles) {
      if (ai.kind !== 'ai' || !ai.nav || !ai.nav.laneId) {
        aiStop.delete(ai.id);
        continue;
      }
      const l = net.lanes.get(ai.nav.laneId)!;
      if (l.endControl === 'stop' && l.length - ai.nav.s < 7 && ai.speed < 0.3) {
        if (!aiStop.has(ai.id)) aiStop.set(ai.id, ctx.time);
      } else if (l.length - ai.nav.s > 12) aiStop.delete(ai.id);
    }

    /* ---- lane tracking: lane changes and "established in lane" ---- */
    const currentId = onLane ? lane!.id : null;
    if (currentId !== laneId) {
      if (currentId && laneId) {
        const prev = net.lanes.get(laneId)!;
        const now = lane!;
        if (prev.roadId === now.roadId && prev.travel === now.travel && Math.abs(prev.index - now.index) === 1) {
          const outward = now.index > prev.index;
          const dir: 'left' | 'right' = outward ? kerbSide : roadSide;
          lastLaneChange = ctx.time;
          lastLaneChangeDir = dir;
          straddleT = 0;
          if (s > 12 && now.length - s > 12 && !inZone) {
            let clean = true;
            if (on('signals')) {
              const ok = player.indicator === dir && player.indicatorSince !== null && ctx.time - player.indicatorSince >= rules.signalMinTimeLaneChangeS * 0.6;
              if (!ok) {
                report('no_signal_lane_change');
                clean = false;
              }
            }
            if (on('observation') && ctx.settings.observation !== 'off') {
              const mirror = ctx.time - Math.max(player.lastMirrorCheck.centre, player.lastMirrorCheck[dir]) < 6;
              const shoulder = ctx.time - player.lastShoulderCheck[dir] < 5;
              if (ctx.settings.observation === 'relaxed') {
                if (!mirror && !shoulder) {
                  report('no_mirror_check');
                  clean = false;
                }
              } else {
                if (!mirror) {
                  report('no_mirror_check');
                  clean = false;
                }
                if (!shoulder) {
                  report('no_blind_spot_check');
                  clean = false;
                }
              }
            }
            if (on('right_of_way')) {
              for (const ai of ctx.vehicles) {
                if (ai.kind !== 'ai' || !ai.nav || ai.nav.laneId !== now.id) continue;
                const gap = ai.nav.s - s;
                if (gap > -9 && gap < 6.5) {
                  report('unsafe_lane_change', { force: true, severity: Math.abs(gap) < 4 ? 'dangerous' : 'serious' });
                  encounters.set(ai.id, ctx.time);
                  clean = false;
                }
              }
            }
            if (clean) cheer('good_observation', 30);
          }
        }
      }
      laneId = currentId;
      if (currentId) establishedSince = ctx.time;
    }

    /* ---- approach to the end of the lane ---- */
    if (onLane) {
      if (!approach || approach.lane.id !== lane!.id) {
        approach = { lane: lane!, startOdo: player.odometer, minSpeedZone: Infinity, stillFor: 0, stoppedInZone: false, stoppedPast: false, stopTime: Infinity, waited: 0, hesitated: false, crossed: false, signalAtLine: null };
      }
      const a = approach;
      const d = lane!.length - (s + half); // front bumper to the line (negative = past it)
      // Signalling distance is judged from where the car last set off, not from a stop further back.
      if (speed < 0.15 && d > 8) a.startOdo = player.odometer;
      if (d < 0 && a.signalAtLine === null) a.signalAtLine = ctx.signals.getState(lane!.to, lane!.arrivalArm);
      if (d < 6 && d > -0.8) {
        a.minSpeedZone = Math.min(a.minSpeedZone, speed);
        a.stillFor = speed < 0.3 ? a.stillFor + dt : 0;
        if (a.stillFor >= 0.3 && !a.stoppedInZone) {
          a.stoppedInZone = true;
          a.stopTime = ctx.time;
        }
      } else if (d <= -0.8 && speed < 0.3) a.stoppedPast = true;

      // Stopped over the line or on the crossing at a red light / stop sign.
      if (on('junction_control') && d <= -0.8 && d > -5 && speed < 0.2 && player.stoppedFor > 1.5 && !a.crossed) {
        const control = lane!.endControl;
        const red = control === 'signal' && ctx.signals.getState(lane!.to, lane!.arrivalArm) !== 'green';
        if (red || control === 'stop') {
          const node = net.nodes.get(lane!.to)!;
          report(node.crosswalkIds.length ? 'blocked_crosswalk' : 'stopped_over_line');
        }
      }

      // Hesitation: first in line, way clear, not going.
      if (on('hesitation') && !a.hesitated && d < 7 && speed < 0.3 && lane!.endControl !== 'none') {
        const node = net.nodes.get(lane!.to)!;
        const green = lane!.endControl !== 'signal' || ctx.signals.getState(node.id, lane!.arrivalArm) === 'green';
        let clear = green && (lane!.endControl !== 'stop' || a.stoppedInZone);
        if (clear) {
          for (const ai of ctx.vehicles) {
            if (ai.kind !== 'ai' || !ai.nav) continue;
            if (Math.hypot(ai.x - node.pos.x, ai.z - node.pos.z) < 48 && (ai.speed > 0.5 || ai.nav.connectorId)) {
              // Ignore vehicles driving away from the junction.
              const l = ai.nav.laneId ? net.lanes.get(ai.nav.laneId)! : null;
              if (!l || l.to === node.id) clear = false;
            }
            if (ai.nav.laneId === lane!.id && ai.nav.s > s) clear = false;
          }
          for (const ped of ctx.pedestrians) if (ped.crosswalkId && Math.hypot(ped.x - node.pos.x, ped.z - node.pos.z) < 30) clear = false;
        }
        a.waited = clear ? a.waited + dt : 0;
        if (a.waited > (lane!.endControl === 'signal' ? 5 : 7)) {
          a.hesitated = true;
          report('undue_hesitation');
        }
      }

      if (!a.crossed && d < -1.5) {
        a.crossed = true;
        onCross(a);
      }
    } else if (loc.kind === 'junction' && approach && !approach.crossed && loc.node.id === approach.lane.to) {
      approach.crossed = true;
      onCross(approach);
    }

    /* ---- junction traversal ---- */
    if (traverse) {
      const t = traverse;
      if (player.indicator === kerbSide) t.lastKerbSignal = ctx.time;
      // A clear red-light run: well into the junction without ever stopping.
      if (on('junction_control') && !t.redFlagged && (t.signal === 'red' || t.signal === 'red_amber') && !t.stopped && player.odometer - t.odo > 6) {
        t.redFlagged = true;
        report('ran_red_light', { force: true });
      }
      if (onLane && lane!.id !== t.from.id && ctx.time - t.time > 0.2) {
        if (lane!.from === t.node.id) onSettle(t, lane!);
        traverse = null;
      } else if (ctx.time - t.time > 25 || (onLane && lane!.id === t.from.id && s + half < lane!.length - 3)) {
        traverse = null;
      }
      // Wrong way round a roundabout.
      if (loc.kind === 'junction' && loc.node.roundabout && loc.connector && on('positioning')) {
        const dirHeading = net.connectorPose(loc.connector.id, loc.s).heading;
        rbWrongT = moving && Math.cos(pv.heading - dirHeading) < -0.5 ? rbWrongT + dt : 0;
        if (rbWrongT > 1) {
          rbWrongT = 0;
          report('roundabout_wrong_way');
        }
      }
    }

    /* ---- speed ---- */
    if (on('speed') && (lane || inZone)) {
      const limit = inZone ? toMps(profile.speedLimits.lot, profile.speedUnit) : lane!.speedLimit;
      const tolerance = inZone ? 3 : 1.0;
      const over = speed - limit;
      const unit = profile.speedUnit;
      const info = { speed: Math.round(fromMps(speed, unit)), limit: Math.round(fromMps(limit, unit)) };
      if (over > tolerance) {
        overT += dt;
        underLimitT = 0;
      } else {
        underLimitT += dt;
        if (underLimitT > 4) {
          overT = 0;
          speedFlag = '';
        }
      }
      const school = !!lane && lane.speedClass === 'school';
      schoolT = school && over > 0.9 ? schoolT + dt : 0;
      excessT = over > 4.5 ? excessT + dt : 0;
      if (school && schoolT > 1.5 && speedFlag !== 'serious') {
        speedFlag = 'serious';
        report('speeding_school_zone', { force: true, info });
      } else if ((excessT > 1 || (over > limit * 0.25 && overT > 3)) && speedFlag !== 'serious' && !inZone) {
        speedFlag = 'serious';
        report('speeding_excessive', { force: true, info });
      } else if (overT > 2.5 && speedFlag === '') {
        speedFlag = 'minor';
        report('speeding', { force: true, info });
      }
      // Too slow on a clear road (deliberately conservative).
      if (onLane && !maneuver && ctx.env.weather === 'clear' && (lane!.speedClass === 'urban' || lane!.speedClass === 'arterial') && speed < limit * 0.55 && lane!.length - s > 70 && s > 25 && !lane!.midblock) {
        const led = ctx.vehicles.some((ai) => ai.nav && ai.nav.laneId === lane!.id && ai.nav.s > s && ai.nav.s - s < 50);
        slowT = led ? 0 : slowT + dt;
        if (slowT > 15) {
          slowT = 0;
          report('too_slow');
        }
      } else slowT = 0;
      if (onLane && ctx.env.weather !== 'clear' && limit >= 13 && speed > limit * 0.95) {
        goodSpeedT = 0;
      }
      if (onLane && over <= 0 && speed > limit * 0.7) {
        goodSpeedT += dt;
        if (goodSpeedT > 60) {
          goodSpeedT = 0;
          cheer('speed_control', 180);
        }
      } else if (over > tolerance) goodSpeedT = 0;
    }

    /* ---- positioning ---- */
    if (on('positioning') && !inZone && maneuver !== 'three_point_turn') {
      // Driving ALONG a lane against its direction — merely crossing one at an angle (leaving a driveway, turning) does not count.
      const wrong = !!lane && loc.kind === 'lane' && Math.cos(pv.heading - lane.heading) < -0.64 && moving;
      if (wrong) {
        wrongSideT += dt;
        if (wrongSideT > 1.5 && !wrongSideFlagged) {
          wrongSideFlagged = true;
          report(loc.kind === 'lane' && loc.road.oneWay ? 'wrong_way' : 'wrong_side_of_road', { force: true });
        }
      } else {
        if (wrongSideT > 0.25 && !wrongSideFlagged && lastTurnCrossed && ctx.time - lastSettle < 6) report('cut_corner');
        wrongSideT = 0;
        wrongSideFlagged = false;
      }
      if (onLane && moving && ctx.time - lastLaneChange > 4) {
        const over = Math.abs(loc.lateral) - (lane!.width / 2 - pv.spec.width / 2 + 0.3);
        // Toward the kerb on the outermost lane there is no line to straddle.
        const towardKerb = loc.lateral * net.kerbSign > 0;
        const lineThere = towardKerb ? lane!.outerNeighbour !== null : true;
        straddleT = over > 0 && lineThere ? straddleT + dt : 0;
        if (straddleT > (lane!.laneCount > 1 ? 4 : 3)) {
          straddleT = 0;
          report('lane_straddling');
        }
      } else straddleT = 0;
    }
    if (on('positioning')) {
      // Kerbs: any corner of the car on the sidewalk.
      let onKerb = false;
      if (!inZone || (loc.kind === 'zone' && loc.onDriveway)) {
        const sx = Math.sin(pv.heading);
        const cx = Math.cos(pv.heading);
        // Sample a little inside the bodywork so a light graze of the kerb is forgiven.
        const hw = pv.spec.width / 2 - 0.28;
        for (const f of [half - 0.3, -half + 0.3]) {
          for (const r of [hw, -hw]) {
            const k = net.locate({ x: pv.x + f * sx - r * cx, z: pv.z + f * cx + r * sx }).kind;
            if (k === 'sidewalk') onKerb = true;
          }
        }
      }
      kerbT = onKerb ? kerbT + dt : 0;
      if (kerbT > 0.2) {
        kerbT = -3;
        if (maneuver) report('park_touched_kerb');
        else report('mounted_kerb');
      }
      const off = loc.kind === 'offroad' || loc.kind === 'sidewalk';
      offT = off ? offT + dt : 0;
      if (offT > 1) {
        offT = -6;
        report('off_road', { force: true });
      }
    }

    /* ---- following distance ---- */
    if (on('following') && onLane && speed > 5) {
      let gap = Infinity;
      for (const ai of ctx.vehicles) {
        if (!ai.nav || ai.nav.laneId !== lane!.id || ai.nav.s <= s) continue;
        gap = Math.min(gap, ai.nav.s - s - half - ai.spec.length / 2);
      }
      const timeGap = gap / speed;
      const need = Math.max(1, rules.followingGapS * 0.55) * (ctx.env.weather === 'rain' ? 1.4 : 1);
      tailT = timeGap < need ? tailT + dt : 0;
      tailCloseT = timeGap < 0.5 ? tailCloseT + dt : 0;
      if (tailCloseT > 1.5) {
        tailCloseT = 0;
        tailT = 0;
        report('tailgating', { severity: 'serious', force: true });
      } else if (tailT > 3) {
        tailT = 0;
        report('tailgating');
      }
      if (isFinite(gap) && gap < 60 && timeGap >= rules.followingGapS) {
        goodGapT += dt;
        if (goodGapT > 45) {
          goodGapT = 0;
          cheer('good_gap', 120);
        }
      } else goodGapT = 0;
    } else {
      tailT = 0;
      tailCloseT = 0;
    }

    /* ---- moving off, reversing, signal left on ---- */
    const parkedNow = speed < 0.15 && (player.gear === 'P' || loc.kind === 'parking_strip' || (player.handbrake && (!lane || lane.length - s > 15)));
    if (parkedNow) {
      parkedFor += dt;
      if (player.gear === 'P') wasParkGear = true;
      if (parkedFor > 3 && (loc.kind === 'parking_strip' || wasParkGear || parkedFor > 8)) parkedArmed = true;
    } else if (speed > 1.5 && pv.speed > 0) {
      if (parkedArmed && !inZone && (loc.kind === 'lane' || loc.kind === 'parking_strip')) {
        if (on('signals') && player.indicator !== roadSide) report('no_signal_moving_off');
        if (on('observation') && ctx.settings.observation !== 'off') {
          const mirror = ctx.time - Math.max(player.lastMirrorCheck.centre, player.lastMirrorCheck[roadSide]) < 7;
          const shoulder = ctx.time - player.lastShoulderCheck[roadSide] < 7;
          const ok = ctx.settings.observation === 'strict' ? mirror && shoulder : mirror || shoulder;
          if (!ok) report('no_observation_moving_off');
          else cheer('good_observation', 30);
        }
        establishedSince = ctx.time;
      }
      parkedArmed = false;
      parkedFor = 0;
      wasParkGear = false;
    } else if (speed >= 0.15) parkedFor = 0;

    const reversing = player.gear === 'R' && pv.speed < -0.3;
    if (reversing) {
      if (reversingFor === 0 && notReversingFor > 3 && on('observation') && ctx.settings.observation !== 'off') {
        const looked = ctx.time - Math.max(player.lastShoulderCheck.back, player.lastMirrorCheck.centre) < 4.5;
        if (!looked) report('no_observation_reversing');
      }
      reversingFor += dt;
      notReversingFor = 0;
    } else {
      reversingFor = 0;
      notReversingFor += dt;
    }

    if (on('signals') && (player.indicator === 'left' || player.indicator === 'right') && player.indicatorSince !== null && player.indicatorOdometer !== null) {
      if (!signalWarned && ctx.time - player.indicatorSince > 14 && player.odometer - player.indicatorOdometer > 130 && !maneuver) {
        signalWarned = true;
        report('signal_left_on');
      }
    } else signalWarned = false;

    /* ---- car control ---- */
    if (on('control')) {
      if (moving && !player.seatbelt && !beltFlagged) {
        beltFlagged = true;
        report('no_seatbelt', { force: true });
      }
      if (player.seatbelt) beltFlagged = false;
      handT = speed > 1.5 && player.handbrake ? handT + dt : 0;
      if (handT > 1) {
        handT = -8;
        report('handbrake_on');
      }
      const needLights = ctx.env.headlightsRequired && player.headlights === 'off' && moving;
      lightsT = needLights ? lightsT + dt : 0;
      if (!needLights && player.headlights !== 'off') lightsFlagged = false;
      if (lightsT > 6 && !lightsFlagged) {
        lightsFlagged = true;
        report('no_headlights', { force: true });
      }
      const needWipers = ctx.env.wipersRequired && !player.wipers && moving;
      wipersT = needWipers ? wipersT + dt : 0;
      if (player.wipers) wipersFlagged = false;
      if (wipersT > 8 && !wipersFlagged) {
        wipersFlagged = true;
        report('no_wipers', { force: true });
      }
      neutralT = player.gear === 'N' && speed > 3 ? neutralT + dt : 0;
      if (neutralT > 3) {
        neutralT = -10;
        report('coasting_in_neutral');
      }
      harshT = pv.accel < -6.5 && speed > 3 && player.brake > 0.5 ? harshT + dt : 0;
      if (!emergencyStop && harshT > 0.35 && ctx.time - lastCollision > 2) {
        harshT = -2;
        // Was there a reason to brake hard?
        let reason = false;
        for (const ai of ctx.vehicles) {
          const rel = toLocal(pv, ai);
          if (rel.forward > 0 && rel.forward < 25 && Math.abs(rel.right) < 3) reason = true;
        }
        for (const ped of ctx.pedestrians) {
          const rel = toLocal(pv, ped);
          if (rel.forward > 0 && rel.forward < 25 && Math.abs(rel.right) < 5) reason = true;
        }
        if (lane && lane.endControl === 'signal' && lane.length - s < 40 && ctx.signals.getState(lane.to, lane.arrivalArm) !== 'green') reason = true;
        if (!reason) report('harsh_braking');
      }
    }

    if (on('right_of_way')) {
      if (ctx.frame % 3 === 0) checkRightOfWay();
      checkPedestrians();
    }
  }

  return {
    faults,
    praise,
    update,
    report,
    setSuspended(groups, value) {
      for (const g of groups) {
        if (value) suspended.add(g);
        else suspended.delete(g);
      }
    },
    setContext(c) {
      if (c.maneuver !== undefined) maneuver = c.maneuver;
      if (c.emergencyStop !== undefined) emergencyStop = c.emergencyStop;
    },
  };
}
