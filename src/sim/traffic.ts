/**
 * AI traffic: calm, law-abiding drivers that follow lanes and junction
 * connectors, keep a safe gap (Intelligent Driver Model), obey signals, stop
 * and give-way lines and the jurisdiction's priority rules, and treat the
 * learner's car as just another road user.
 */
import { LEFT_OF, clamp, obbContainsPoint } from '../core/math';
import type { ConnectorInfo, LaneInfo, Obb, SimContext, SimVehicle, VehicleModel } from '../core/types';
import type { BuiltNetwork } from '../world/network';
import { createVehicle, vehicleObb } from './vehicle';

export interface TrafficOptions {
  /** Vehicles to keep on the road (default from ctx.settings.traffic). */
  count?: number;
  /** Lanes AI must never use or spawn on. */
  avoidLaneIds?: readonly string[];
  /** Keep spawns at least this far (m) from the player. */
  spawnClearance?: number;
}

export interface TrafficSystem {
  update(ctx: SimContext, dt: number): void;
  /** Place a scripted vehicle on a lane; it then drives like any other AI car. */
  spawn(ctx: SimContext, opts: { laneId: string; s: number; speed?: number; model?: VehicleModel; colour?: number; route?: string[] }): SimVehicle;
  remove(ctx: SimContext, id: number): void;
  /** Why a vehicle is doing what it is doing (debugging / tests). */
  debugState(id: number): { reason: string; waiting: number } | null;
}

const COUNTS = { none: 0, light: 8, normal: 16, heavy: 26 } as const;
const COLOURS = [0x2f6fbf, 0xc9ced6, 0x2b2f36, 0xf2f2f2, 0x8a1f2b, 0x3e7d5a, 0x7f8c99, 0xd8a136, 0x4a5d7a, 0x9b5a3c, 0x5c6bc0, 0x00897b];
const MODELS: VehicleModel[] = ['hatchback', 'hatchback', 'sedan', 'sedan', 'sedan', 'suv', 'suv', 'van', 'pickup'];

const A_MAX = 1.7;
const B_COMF = 2.2;
const B_HARD = 7;
const HEADWAY = 1.5;
const S0 = 2.3;
const GAP_TIME = 4.6;

interface Car {
  v: SimVehicle;
  factor: number;
  /** Connector ids to take at the next junctions (scripted), then random. */
  route: string[];
  /** Entered the current junction's decision: allowed to go. */
  cleared: boolean;
  /** Time spent stationary at the current stop line. */
  stoppedFor: number;
  /** Sim time this car came to a halt at a stop line (all-way ordering). */
  arrival: number;
  waiting: number;
  reason: string;
  lastBrakeEvent: number;
  stuck: number;
}

/** Longitudinal acceleration from the Intelligent Driver Model. */
function idm(v: number, v0: number, gap: number, leaderSpeed: number, s0 = S0): number {
  const free = 1 - Math.pow(v / Math.max(v0, 0.1), 4);
  if (!isFinite(gap)) return A_MAX * free;
  const dv = v - leaderSpeed;
  const sStar = s0 + Math.max(0, v * HEADWAY + (v * dv) / (2 * Math.sqrt(A_MAX * B_COMF)));
  return A_MAX * (free - Math.pow(sStar / Math.max(gap, 0.05), 2));
}

export function createTraffic(ctx: SimContext, opts: TrafficOptions = {}): TrafficSystem {
  const net = ctx.network as BuiltNetwork;
  const rng = ctx.rng.fork();
  const avoid = new Set(opts.avoidLaneIds ?? []);
  const cars = new Map<number, Car>();
  let nextId = 1000;
  /** When the player came to a stop at each node's stop line. */
  const playerArrival = new Map<string, number>();
  let playerStill = 0;

  const lanes = net.lanes;
  const connectors = net.connectors;

  function chooseConnector(lane: LaneInfo, car: Car | null): string | null {
    if (car && car.route.length) {
      const next = car.route[0]!;
      if (lane.connectors.includes(next)) {
        car.route.shift();
        return next;
      }
    }
    const options = lane.connectors.filter((id) => !avoid.has(connectors.get(id)!.to));
    const pool = options.length ? options : lane.connectors;
    if (!pool.length) return null;
    // Favour going straight a little so traffic flows through town.
    const weights = pool.map((id) => (connectors.get(id)!.turn === 'straight' ? 2 : 1));
    let r = rng.range(0, weights.reduce((a, b) => a + b, 0));
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]!;
      if (r <= 0) return pool[i]!;
    }
    return pool[pool.length - 1]!;
  }

  function place(car: Car): void {
    const nav = car.v.nav!;
    const pose = nav.laneId ? net.lanePose(nav.laneId, nav.s) : net.connectorPose(nav.connectorId!, nav.s);
    car.v.x = pose.x;
    car.v.z = pose.z;
    const dh = Math.atan2(Math.sin(pose.heading - car.v.heading), Math.cos(pose.heading - car.v.heading));
    car.v.steer = clamp(-dh * 6, -0.5, 0.5);
    car.v.heading = pose.heading;
  }

  function spawnOn(laneId: string, s: number, speed: number, model?: VehicleModel, colour?: number, route: string[] = []): Car {
    const lane = lanes.get(laneId)!;
    const v = createVehicle({ id: nextId++, kind: 'ai', model: model ?? rng.pick(MODELS), pose: net.lanePose(laneId, s), colour: colour ?? rng.pick(COLOURS), speed });
    v.nav = { laneId, connectorId: null, s, nextConnectorId: null };
    v.headlights = ctx.env.headlightsRequired;
    const car: Car = { v, factor: rng.range(0.86, 1), route: [...route], cleared: false, stoppedFor: 0, arrival: Infinity, waiting: 0, reason: 'cruise', lastBrakeEvent: -10, stuck: 0 };
    v.nav.nextConnectorId = chooseConnector(lane, car);
    cars.set(v.id, car);
    ctx.vehicles.push(v);
    return car;
  }

  function randomSpawn(): boolean {
    const clearance = opts.spawnClearance ?? 70;
    const candidates = [...lanes.values()].filter((l) => !avoid.has(l.id) && l.length > 40);
    for (let attempt = 0; attempt < 30; attempt++) {
      const lane = rng.pick(candidates);
      const s = rng.range(10, lane.length - 14);
      const pose = net.lanePose(lane.id, s);
      const p = ctx.player.vehicle;
      if (Math.hypot(pose.x - p.x, pose.z - p.z) < clearance) continue;
      let ok = true;
      for (const c of cars.values()) {
        if (Math.hypot(c.v.x - pose.x, c.v.z - pose.z) < 26) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      spawnOn(lane.id, s, lane.speedLimit * 0.6);
      return true;
    }
    return false;
  }

  const target = opts.count ?? COUNTS[ctx.settings.traffic];
  for (let i = 0; i < target; i++) randomSpawn();

  /* ----------------------------- per-tick index ---------------------------- */
  const onLane = new Map<string, Car[]>();
  const onConnector = new Map<string, Car[]>();

  /** The player as the priority logic sees it. */
  interface PlayerView {
    lane: LaneInfo | null;
    connector: ConnectorInfo | null;
    s: number;
    speed: number;
    obb: Obb;
    waitingAtLine: boolean;
  }
  let pv: PlayerView;

  function indexAll(): void {
    onLane.clear();
    onConnector.clear();
    for (const car of cars.values()) {
      const nav = car.v.nav!;
      const map = nav.laneId ? onLane : onConnector;
      const key = (nav.laneId ?? nav.connectorId)!;
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(car);
    }
    const p = ctx.player;
    const loc = p.location;
    let lane: LaneInfo | null = null;
    let connector: ConnectorInfo | null = null;
    let s = 0;
    if (loc.kind === 'lane') {
      const aligned = Math.cos(p.vehicle.heading - loc.lane.heading) > 0.3;
      if (aligned) {
        lane = loc.lane;
        s = loc.s;
      }
    } else if (loc.kind === 'junction' && loc.connector) {
      connector = loc.connector;
      s = loc.s;
    }
    const speed = Math.abs(p.vehicle.speed);
    playerStill = speed < 0.3 ? playerStill + 1 / 60 : 0;
    const waitingAtLine = !!lane && lane.endControl !== 'none' && speed < 0.4 && lane.length - s < 9;
    if (lane && lane.endControl === 'stop' && speed < 0.3 && lane.length - s < 9) {
      if (!playerArrival.has(lane.to)) playerArrival.set(lane.to, ctx.time);
    } else if (!lane || lane.length - s > 30) {
      if (lane) playerArrival.delete(lane.to);
    }
    if (connector && speed > 1) playerArrival.delete(connector.nodeId);
    pv = { lane, connector, s, speed, obb: vehicleObb(p.vehicle, 0), waitingAtLine };
  }

  /* ------------------------------ priority rules --------------------------- */

  /** Does traffic arriving on `other` have priority over `mine` (both ending at the same node)? */
  function otherHasPriority(mine: LaneInfo, myConn: ConnectorInfo, other: LaneInfo, otherTurnCrosses: boolean | null, myEta: number, otherEta: number, otherArrival: number, myArrival: number): boolean {
    const node = net.nodes.get(mine.to)!;
    const a = mine.endControl;
    const b = other.endControl;
    const oncoming = other.arrivalArm === mine.travel;
    if (node.control === 'signal') {
      const state = ctx.signals.getState(node.id, other.arrivalArm);
      if (state === 'red' || state === 'red_amber') return false;
      return myConn.crossesOncoming && oncoming && otherTurnCrosses !== true;
    }
    if (a === 'stop' && b === 'stop') {
      // All-way stop: first to stop goes first; an oncoming car that is not turning across shares the go.
      if (otherArrival < myArrival - 0.05) return !(oncoming && !myConn.crossesOncoming && otherTurnCrosses !== true);
      return false;
    }
    if ((a === 'stop' || a === 'yield') && b === 'none') return true;
    if (a === 'none' && (b === 'stop' || b === 'yield')) return false;
    if (node.roundabout) return false; // entries are equal; the ring is handled by occupancy
    if (myConn.crossesOncoming && oncoming && otherTurnCrosses !== true) return true;
    if (node.control === 'uncontrolled') {
      const fromRight = other.travel === LEFT_OF[mine.travel];
      const rule = ctx.profile.rules.uncontrolledPriority;
      if (rule === 'priority_to_right') return fromRight;
      if (otherEta < myEta - 0.8) return true;
      if (otherEta > myEta + 0.8) return false;
      return fromRight;
    }
    return false;
  }

  /** Can `car` commit to `conn` right now? Returns a reason when it must wait. */
  function entryBlocked(car: Car, lane: LaneInfo, conn: ConnectorInfo, distToLine: number): string | null {
    const v = car.v;
    const node = net.nodes.get(lane.to)!;
    const myEta = distToLine / Math.max(v.speed, 2.5);
    const gapTime = node.arms[lane.arrivalArm] && [...Object.values(node.arms)].some((arm) => net.roads.get(arm.roadId)!.speedClass === 'arterial') ? GAP_TIME + 1 : GAP_TIME;

    for (const k of conn.conflicts) {
      const other = connectors.get(k.other)!;
      // Vehicles already on the conflicting path that have not cleared the conflict point.
      const there = onConnector.get(other.id);
      if (there) {
        for (const o of there) {
          if (o.v.nav!.s < k.otherS + o.v.spec.length * 0.5 + 1.5) return 'vehicle in junction';
        }
      }
      if (pv.connector && pv.connector.id === other.id && pv.s < k.otherS + 4 && playerStill < 6) return 'learner in junction';

      const otherLane = lanes.get(other.from)!;
      const approaching = onLane.get(otherLane.id);
      if (approaching) {
        for (const o of approaching) {
          const on = o.v.nav!;
          const d = otherLane.length - on.s + k.otherS;
          if (d > 90) continue;
          const eta = d / Math.max(o.v.speed, 2.5);
          const oConn = on.nextConnectorId ? connectors.get(on.nextConnectorId)! : null;
          if (oConn && oConn.id !== other.id) continue; // it is taking a different path
          if (o.cleared && d < 25) return 'vehicle committed';
          if (!otherHasPriority(lane, conn, otherLane, oConn ? oConn.crossesOncoming : null, myEta, eta, o.arrival, car.arrival)) continue;
          // A car stopped at its own stop line with an earlier arrival, or any priority car arriving soon.
          if (otherLane.endControl === 'stop' ? o.arrival < Infinity : eta < gapTime) return 'giving way';
        }
      }
      // The learner approaching on a conflicting lane.
      if (pv.lane && pv.lane.id === otherLane.id && playerStill < 6) {
        const d = otherLane.length - pv.s + k.otherS;
        if (d < 90) {
          const eta = d / Math.max(pv.speed, 2.5);
          const arrival = playerArrival.get(otherLane.to) ?? Infinity;
          const has = otherHasPriority(lane, conn, otherLane, null, myEta, eta, arrival, car.arrival);
          if (has && (otherLane.endControl === 'stop' ? arrival < Infinity : eta < gapTime)) return 'giving way to learner';
          // Not stopping for their line: assume they are coming through.
          if (!has && !pv.waitingAtLine && d < 14 && pv.speed > 3) return 'learner not stopping';
        }
      }
    }

    // Pedestrians on the crossings this path uses.
    for (const cw of conn.crosswalks) {
      const xw = net.crosswalks.get(cw.id)!;
      for (const ped of ctx.pedestrians) {
        if (ped.crosswalkId !== cw.id) continue;
        if (ped.state === 'crossing' || (ped.state === 'waiting' && !xw.signalised && ctx.profile.rules.pedestrianPriority === 'on_or_waiting')) return 'pedestrian';
      }
    }

    // Room to clear the junction.
    const ahead = onLane.get(conn.to);
    if (ahead) {
      for (const o of ahead) {
        if (o.v.nav!.s < v.spec.length + o.v.spec.length * 0.5 + 3.5 && o.v.speed < 1.5) return 'exit blocked';
      }
    }
    return null;
  }

  /* ------------------------------- one vehicle ----------------------------- */

  function step(car: Car, dt: number): void {
    const v = car.v;
    const nav = v.nav!;
    const half = v.spec.length / 2;
    let accel = Infinity;
    let reason = 'cruise';
    let forPlayer = false;
    const consider = (a: number, why: string, player = false): void => {
      if (a < accel) {
        accel = a;
        reason = why;
        forPlayer = player;
      }
    };

    const lane = nav.laneId ? lanes.get(nav.laneId)! : null;
    const conn = nav.connectorId ? connectors.get(nav.connectorId)! : null;
    const nextConn = lane && nav.nextConnectorId ? connectors.get(nav.nextConnectorId)! : null;
    const segLen = lane ? lane.length : conn!.length;
    const toEnd = segLen - nav.s;

    // Desired speed, slowing for the turn ahead.
    const turnSpeed = (c: ConnectorInfo): number => {
      const node = net.nodes.get(c.nodeId)!;
      if (node.roundabout) return 6.2;
      if (c.turn === 'straight') return Infinity;
      return node.control === 'none' ? 7 : c.crossesOncoming ? 5.8 : 4.6;
    };
    const limit = (lane ? lane.speedLimit : lanes.get(conn!.to)!.speedLimit) * car.factor;
    let v0 = limit;
    if (conn) v0 = Math.min(v0, turnSpeed(conn));
    else if (nextConn) {
      const ts = turnSpeed(nextConn);
      if (isFinite(ts)) v0 = Math.min(v0, Math.sqrt(ts * ts + 2 * B_COMF * 0.8 * Math.max(0, toEnd - 2)));
      if (lane!.endControl === 'yield' || net.nodes.get(lane!.to)!.control === 'uncontrolled') v0 = Math.min(v0, Math.sqrt(22 + 2 * B_COMF * 0.7 * Math.max(0, toEnd - 4)));
    }
    consider(idm(v.speed, v0, Infinity, 0), 'cruise');

    // Leader on the same segment.
    const same = (lane ? onLane.get(lane.id) : onConnector.get(conn!.id)) ?? [];
    for (const o of same) {
      if (o === car || o.v.nav!.s <= nav.s) continue;
      consider(idm(v.speed, v0, o.v.nav!.s - nav.s - half - o.v.spec.length / 2, o.v.speed), 'following');
    }
    // Leaders on the path ahead: next connector and the lane after it.
    const ahead: { list: Car[] | undefined; offset: number }[] = [];
    if (lane && nextConn) {
      ahead.push({ list: onConnector.get(nextConn.id), offset: toEnd });
      ahead.push({ list: onLane.get(nextConn.to), offset: toEnd + nextConn.length });
    } else if (conn) {
      ahead.push({ list: onLane.get(conn.to), offset: toEnd });
    }
    for (const { list, offset } of ahead) {
      if (!list || offset > 60) continue;
      for (const o of list) consider(idm(v.speed, v0, offset + o.v.nav!.s - half - o.v.spec.length / 2, o.v.speed), 'following');
    }
    // Inside a junction: sort out merging/crossing paths with other vehicles in the junction.
    if (conn) {
      for (const k of conn.conflicts) {
        if (k.s < nav.s - 1) {
          // Past the conflict point: follow anything that merged in ahead of us.
          if (k.kind !== 'merge') continue;
          for (const o of onConnector.get(k.other) ?? []) {
            const lead = o.v.nav!.s - k.otherS - (nav.s - k.s);
            if (lead > 0) consider(idm(v.speed, v0, lead - half - o.v.spec.length / 2, o.v.speed), 'following in junction');
          }
          continue;
        }
        const mine = k.s - nav.s;
        for (const o of onConnector.get(k.other) ?? []) {
          const theirs = k.otherS - o.v.nav!.s;
          if (theirs < -(o.v.spec.length / 2 + 1.5)) {
            if (k.kind === 'merge') consider(idm(v.speed, v0, mine - theirs - half - o.v.spec.length / 2, o.v.speed), 'following in junction');
            continue;
          }
          // Both still to reach the point: whoever is nearer goes first.
          if (theirs < mine || (theirs === mine && o.v.id < v.id)) consider(idm(v.speed, v0, mine - half - 2.5, 0, 0.5), 'crossing traffic');
        }
      }
      for (const cw of conn.crosswalks) {
        if (cw.s < nav.s + half) continue;
        const busy = ctx.pedestrians.some((p) => p.crosswalkId === cw.id && p.state === 'crossing');
        if (busy) consider(idm(v.speed, v0, cw.s - nav.s - half - 2.6, 0, 0.5), 'pedestrian');
      }
    }

    // Lane end: stop line, signal, give way.
    if (lane && nextConn) {
      const stopGap = toEnd - half - 0.4;
      const stopA = idm(v.speed, v0, stopGap, 0, 0.5);
      const node = net.nodes.get(lane.to)!;
      const control = lane.endControl;
      if (!car.cleared && toEnd < 55) {
        let wait: string | null = null;
        if (control === 'signal') {
          const state = ctx.signals.getState(node.id, lane.arrivalArm);
          if (state === 'red' || state === 'red_amber') wait = 'red light';
          else if (state === 'amber' && (v.speed * v.speed) / (2 * Math.max(stopGap, 0.1)) < 3.2) wait = 'amber light';
        } else if (control === 'stop' && car.stoppedFor < 0.9) wait = 'stop sign';
        if (!wait && toEnd < 30) wait = entryBlocked(car, lane, nextConn, toEnd);
        // Deadlock breaker.
        if (wait && wait !== 'red light' && wait !== 'amber light' && wait !== 'stop sign' && wait !== 'pedestrian' && car.waiting > 14) {
          const occupied = nextConn.conflicts.some((k) => (onConnector.get(k.other) ?? []).some((o) => o.v.nav!.s < k.otherS + 3));
          if (!occupied) wait = null;
        }
        if (wait) consider(stopA, wait, wait.includes('learner'));
        // Commit only when about to cross the line, so the decision is always fresh.
        else if (toEnd - half < 4.5) car.cleared = true;
      }
      // Even once committed, never roll over a crossing someone has stepped onto.
      if (car.cleared && (v.speed * v.speed) / (2 * Math.max(stopGap, 0.1)) < 6) {
        for (const cw of nextConn.crosswalks) {
          if (ctx.pedestrians.some((ped) => ped.crosswalkId === cw.id && ped.state === 'crossing')) {
            consider(stopA, 'pedestrian');
            break;
          }
        }
      }
      // Mid-block crossing.
      const mb = lane.midblock;
      if (mb && nav.s + half < mb.stopS + 1.5) {
        const xw = net.crosswalks.get(mb.crosswalkId)!;
        const stop = ctx.pedestrians.some(
          (p) => p.crosswalkId === mb.crosswalkId && (p.state === 'crossing' || (p.state === 'waiting' && !xw.signalised && ctx.profile.rules.pedestrianPriority === 'on_or_waiting')),
        );
        const gap = mb.stopS - nav.s - half;
        if (stop && (v.speed * v.speed) / (2 * Math.max(gap, 0.1)) < 5) consider(idm(v.speed, v0, gap, 0, 0.4), 'pedestrian');
      }
    }

    // Physical obstacles in the corridor ahead: the learner, parked cars, cones.
    const look = Math.min(60, (v.speed * v.speed) / (2 * B_COMF) + 14);
    const margin = v.spec.width / 2 + 0.45;
    const p = ctx.player.vehicle;
    const near: { obb: Obb; speed: number; heading: number; player: boolean }[] = [];
    if (Math.hypot(p.x - v.x, p.z - v.z) < look + 8) near.push({ obb: { ...pv.obb, halfLength: pv.obb.halfLength + margin, halfWidth: pv.obb.halfWidth + margin }, speed: p.speed, heading: p.heading, player: true });
    for (const o of ctx.vehicles) {
      if (o.kind !== 'parked' || Math.hypot(o.x - v.x, o.z - v.z) > look + 8) continue;
      const b = vehicleObb(o, margin);
      near.push({ obb: b, speed: 0, heading: o.heading, player: false });
    }
    for (const o of ctx.obstacles) {
      if ((o.kind !== 'cone' && o.kind !== 'barrier') || o.hit || Math.hypot(o.obb.x - v.x, o.obb.z - v.z) > look + 8) continue;
      near.push({ obb: { ...o.obb, halfLength: o.obb.halfLength + margin, halfWidth: o.obb.halfWidth + margin }, speed: 0, heading: 0, player: false });
    }
    if (near.length) {
      for (let d = half + 0.5; d < look; d += 1.25) {
        let s = nav.s + d;
        let pose;
        if (lane) {
          if (s <= lane.length) pose = net.lanePose(lane.id, s);
          else if (nextConn) {
            s -= lane.length;
            pose = s <= nextConn.length ? net.connectorPose(nextConn.id, s) : net.lanePose(nextConn.to, s - nextConn.length);
          } else break;
        } else {
          pose = s <= conn!.length ? net.connectorPose(conn!.id, s) : net.lanePose(conn!.to, s - conn!.length);
        }
        let hit = false;
        for (const o of near) {
          if (!obbContainsPoint(o.obb, pose)) continue;
          const along = Math.max(0, o.speed * Math.cos(o.heading - pose.heading));
          consider(idm(v.speed, v0, d - half - 1.6, along, 1.2), o.player ? 'learner ahead' : 'obstacle', o.player);
          hit = true;
        }
        if (hit) break;
      }
    }

    // Integrate.
    accel = clamp(accel, -B_HARD, A_MAX);
    const before = v.speed;
    v.speed = Math.max(0, v.speed + accel * dt);
    v.accel = (v.speed - before) / dt;
    nav.s += v.speed * dt;
    car.reason = reason;
    if (v.speed < 0.15) {
      car.waiting += dt;
      if (lane && toEnd - half < 2.5) {
        car.stoppedFor += dt;
        if (!isFinite(car.arrival)) car.arrival = ctx.time;
      }
    } else if (v.speed > 1.5) car.waiting = 0;
    car.stuck = v.speed < 0.15 ? car.stuck + dt : 0;

    if (accel <= -3 && v.speed > 1 && ctx.time - car.lastBrakeEvent > 1) {
      car.lastBrakeEvent = ctx.time;
      ctx.events.emit('aiBrake', { vehicleId: v.id, decel: -accel, forPlayer });
    }

    // Segment transitions.
    if (lane && nav.s >= lane.length) {
      if (!nextConn || !car.cleared) {
        nav.s = lane.length - 0.01;
        v.speed = 0;
      } else {
        nav.s -= lane.length;
        nav.laneId = null;
        nav.connectorId = nextConn.id;
        nav.nextConnectorId = null;
        car.cleared = false;
        car.stoppedFor = 0;
        car.arrival = Infinity;
        car.waiting = 0;
      }
    } else if (conn && nav.s >= conn.length) {
      nav.s -= conn.length;
      nav.connectorId = null;
      nav.laneId = conn.to;
      nav.nextConnectorId = chooseConnector(lanes.get(conn.to)!, car);
    }
    place(car);

    // Lights.
    v.braking = accel < -0.8 || (v.speed < 0.2 && reason !== 'cruise');
    v.headlights = ctx.env.headlightsRequired;
    const signalFor = nav.connectorId ? connectors.get(nav.connectorId)! : nav.nextConnectorId && lanes.get(nav.laneId!)!.length - nav.s < 38 ? connectors.get(nav.nextConnectorId)! : null;
    if (!signalFor) v.indicator = 'off';
    else {
      const node = net.nodes.get(signalFor.nodeId)!;
      const kerbSide = net.side === 'right' ? 'right' : 'left';
      if (node.control === 'none') v.indicator = 'off';
      else if (node.roundabout) {
        const rules = ctx.profile.rules.roundabout;
        const leaving = !!nav.connectorId && nav.s > signalFor.length * 0.55;
        if (leaving && rules.signalOnExit) v.indicator = kerbSide;
        else if (rules.signalOnApproach === 'by_exit_direction' && signalFor.turn !== 'straight' && !leaving) v.indicator = signalFor.turn === 'left' ? 'left' : 'right';
        else v.indicator = 'off';
      } else v.indicator = signalFor.turn === 'left' ? 'left' : signalFor.turn === 'right' ? 'right' : 'off';
    }
  }

  return {
    update(c, dt) {
      indexAll();
      for (const car of cars.values()) step(car, dt);
      // Recycle anything hopelessly stuck where the learner cannot see it.
      for (const car of [...cars.values()]) {
        if (car.stuck < 45) continue;
        const p = c.player.vehicle;
        if (Math.hypot(car.v.x - p.x, car.v.z - p.z) < 120) continue;
        this.remove(c, car.v.id);
        randomSpawn();
      }
    },
    spawn(c, o) {
      void c;
      return spawnOn(o.laneId, o.s, o.speed ?? 0, o.model, o.colour, o.route).v;
    },
    remove(c, id) {
      cars.delete(id);
      const i = c.vehicles.findIndex((x) => x.id === id);
      if (i >= 0) c.vehicles.splice(i, 1);
    },
    debugState(id) {
      const car = cars.get(id);
      return car ? { reason: car.reason, waiting: car.waiting } : null;
    },
  };
}
