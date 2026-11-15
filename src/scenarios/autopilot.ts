/**
 * The instructor's own driving: a careful, textbook driver that follows the
 * scenario's route. Used for "watch a demo" and, in tests, to prove that a
 * correct drive earns zero faults.
 */
import { PLAYER_SPEC } from '../core/constants';
import { clamp, obbContainsPoint, toLocal } from '../core/math';
import type { ConnectorInfo, ControlInput, LaneInfo, LookDir, PlayerCommand, Pose, RouteLeg } from '../core/types';
import type { Session } from '../sim/session';
import { vehicleObb } from '../sim/vehicle';

export interface Autopilot {
  /** The controls a perfect driver would apply this tick. */
  input(): ControlInput;
}

const HALF = PLAYER_SPEC.length / 2;

/** Distance along a connector of the point nearest (x, z). */
function projectOn(c: ConnectorInfo, x: number, z: number): number {
  let best = Infinity;
  let at = 0;
  for (let k = 0; k + 1 < c.points.length; k++) {
    const a = c.points[k]!;
    const b = c.points[k + 1]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
    const d = (x - a.x - dx * t) ** 2 + (z - a.z - dz * t) ** 2;
    if (d < best) {
      best = d;
      at = c.cumulative[k]! + Math.sqrt(l2) * t;
    }
  }
  return at;
}

export function createAutopilot(session: Session): Autopilot {
  const { ctx, network: net } = session;
  const player = ctx.player;
  const v = player.vehicle;
  const rules = ctx.profile.rules;
  const kerbSide: 'left' | 'right' = net.side === 'right' ? 'right' : 'left';
  const roadSide: 'left' | 'right' = kerbSide === 'right' ? 'left' : 'right';
  const strict = ctx.settings.observation === 'strict';

  let lookUntil = 0;
  let lookDir: LookDir = 'ahead';
  let lookPlan: LookDir[] = [];
  let launchStage = 0;
  let launchT = 0;
  let wasParked = true;
  let junctionKey = '';
  let stoppedAtLine = 0;
  let myStopTime = Infinity;
  let scanned = false;
  let signalled = false;
  let blockedFor = 0;
  let established = 0;
  let wander: RouteLeg[] = [];
  let lastDrive = -1;
  let lcStage = 0;
  let lcStart = 0;
  const aiStop = new Map<number, number>();

  const cmds: PlayerCommand[] = [];
  const setIndicator = (want: 'left' | 'right' | 'off'): void => {
    if (player.indicator === want || (want === 'off' && player.indicator === 'off')) return;
    cmds.push({ type: 'indicator', value: want });
  };
  const glance = (side: 'left' | 'right'): void => {
    if (ctx.time - player.lastMirrorCheck.centre > 3) cmds.push({ type: 'mirror', mirror: 'centre' });
    if (ctx.time - player.lastMirrorCheck[side] > 3) cmds.push({ type: 'mirror', mirror: side });
  };
  const startLooks = (dirs: LookDir[]): void => {
    if (lookPlan.length === 0 && ctx.time >= lookUntil) lookPlan = [...dirs];
  };

  function turnSpeed(c: ConnectorInfo): number {
    const node = net.nodes.get(c.nodeId)!;
    if (node.roundabout) return 5.4;
    if (c.turn === 'straight') return Infinity;
    return node.control === 'none' ? 6 : c.crossesOncoming ? 4.8 : 3.6;
  }

  /** Is it unsafe to enter `conn` from `lane` right now? */
  function blocked(lane: LaneInfo, conn: ConnectorInfo): boolean {
    const node = net.nodes.get(conn.nodeId)!;
    const myControl = lane.endControl;
    for (const k of conn.conflicts) {
      const other = net.connectors.get(k.other)!;
      const otherLane = net.lanes.get(other.from)!;
      for (const ai of ctx.vehicles) {
        const nav = ai.nav;
        if (!nav) continue;
        if (nav.connectorId === other.id && nav.s < k.otherS + 4.5) return true;
        if (nav.laneId !== otherLane.id) continue;
        if (nav.nextConnectorId && nav.nextConnectorId !== other.id) continue;
        const d = otherLane.length - nav.s + k.otherS;
        if (d > 110) continue;
        const theirControl = otherLane.endControl;
        if (node.control === 'signal') {
          const theirs = ctx.signals.getState(node.id, otherLane.arrivalArm);
          if (theirs === 'red' || theirs === 'red_amber') continue;
          const mine = ctx.signals.getState(node.id, lane.arrivalArm);
          if (mine === 'green' && !conn.crossesOncoming) continue;
        } else if (myControl === 'stop' && theirControl === 'stop') {
          const t = aiStop.get(ai.id);
          if (t !== undefined && t < myStopTime && ai.speed < 1 && blockedFor < 9) return true;
          continue;
        } else if (myControl === 'none' && (theirControl === 'stop' || theirControl === 'yield')) continue;
        else if (myControl === 'none' && theirControl === 'none' && !conn.crossesOncoming && node.control !== 'uncontrolled') continue;
        if (ai.speed < 0.5 && d > 8) continue;
        if (d / Math.max(ai.speed, 2) < 6.2) return true;
      }
    }
    for (const cw of conn.crosswalks) {
      if (ctx.pedestrians.some((p) => p.crosswalkId === cw.id && (p.state === 'crossing' || (p.state === 'waiting' && !net.crosswalks.get(cw.id)!.signalised)))) return true;
    }
    for (const ai of ctx.vehicles) if (ai.nav && ai.nav.laneId === conn.to && ai.nav.s < 10 && ai.speed < 1) return true;
    return false;
  }

  /** Pose `d` metres ahead along the route from (leg i, on lane or connector, s). */
  function ahead(legs: RouteLeg[], i: number, onConn: boolean, s: number, d: number, lateral: number): Pose {
    let rem = d;
    let idx = i;
    let conn = onConn;
    let at = s;
    for (let guard = 0; guard < 12; guard++) {
      const leg = legs[idx];
      if (!leg) break;
      if (!conn) {
        const lane = net.lanes.get(leg.laneId)!;
        if (at + rem <= lane.length || !leg.connectorId) return net.lanePose(lane.id, Math.min(lane.length, at + rem), lateral);
        rem -= lane.length - at;
        conn = true;
        at = 0;
      } else {
        const c = net.connectors.get(leg.connectorId!)!;
        if (at + rem <= c.length) {
          // Take turns a little wide, as a careful driver does, so the rear wheels clear the kerb.
          const pose = net.connectorPose(c.id, at + rem);
          if (c.turn === 'straight' || net.nodes.get(c.nodeId)!.roundabout) return pose;
          const bias = (c.crossesOncoming ? 0.25 : 0.75) * Math.sin((Math.PI * (at + rem)) / c.length) * (c.turn === 'right' ? -1 : 1);
          return { x: pose.x - Math.cos(pose.heading) * bias, z: pose.z + Math.sin(pose.heading) * bias, heading: pose.heading };
        }
        rem -= c.length - at;
        conn = false;
        at = 0;
        idx++;
      }
    }
    const last = legs[legs.length - 1]!;
    return net.lanePose(last.laneId, net.lanes.get(last.laneId)!.length, lateral);
  }

  function steerToward(target: { x: number; z: number }): number {
    const rel = toLocal(v, target);
    const d2 = rel.forward * rel.forward + rel.right * rel.right;
    if (d2 < 0.01) return 0;
    const curvature = (2 * rel.right) / d2;
    return clamp(Math.atan(PLAYER_SPEC.wheelbase * curvature) / PLAYER_SPEC.maxSteer, -1, 1);
  }

  function pedals(target: number): { throttle: number; brake: number } {
    const speed = v.speed;
    if (target <= 0.05) return { throttle: 0, brake: speed > 0.3 ? clamp(0.2 + speed * 0.09, 0.2, 0.62) : 0.6 };
    const a = clamp((target - speed) * 1.3, -3.2, 2.2);
    if (a > 0.1) return { throttle: clamp(a / 2.6, 0.08, 1), brake: 0 };
    if (a < -0.25) return { throttle: 0, brake: clamp(-a / 7.5, 0.05, 1) };
    return { throttle: speed < target ? 0.08 : 0, brake: 0 };
  }

  const stopProfile = (d: number): number => (d <= 0.2 ? 0 : Math.sqrt(2 * 1.25 * d));

  function drive(legsIn: RouteLeg[] | null, stop: { laneId: string; s: number; lateral: number } | null): Partial<ControlInput> {
    const loc = player.location;
    const speed = Math.abs(v.speed);

    // Track when AI vehicles stop at stop lines (all-way stop order).
    for (const ai of ctx.vehicles) {
      if (!ai.nav || !ai.nav.laneId) {
        aiStop.delete(ai.id);
        continue;
      }
      const l = net.lanes.get(ai.nav.laneId)!;
      if (l.endControl === 'stop' && l.length - ai.nav.s < 7 && ai.speed < 0.3) {
        if (!aiStop.has(ai.id)) aiStop.set(ai.id, ctx.time);
      } else if (l.length - ai.nav.s > 12) aiStop.delete(ai.id);
    }

    /* ---- getting the car ready ---- */
    if (!player.seatbelt) cmds.push({ type: 'seatbelt' });
    else if (!player.engineOn) {
      if (player.gear === 'P' || player.gear === 'N') cmds.push({ type: 'engine' });
      else cmds.push({ type: 'gear', gear: 'P' });
    } else if (ctx.env.headlightsRequired && player.headlights === 'off') cmds.push({ type: 'headlights' });
    else if (ctx.env.wipersRequired && !player.wipers) cmds.push({ type: 'wipers' });
    if (!player.seatbelt || !player.engineOn) return { brake: 1 };

    const onRoad = loc.kind === 'lane' || loc.kind === 'parking_strip';
    // Parked, or taking over from a step that got the car ready: do the full moving-off routine.
    if (speed < 0.2 && (player.gear !== 'D' || player.handbrake || ctx.time - lastDrive > 0.3)) wasParked = true;
    lastDrive = ctx.time;
    if (wasParked) {
      // Moving off: observation and signal first (on the road), then gear and brake.
      if (launchStage === 0) {
        launchStage = 1;
        launchT = ctx.time;
        if (onRoad) {
          glance(roadSide);
          setIndicator(roadSide);
          startLooks([roadSide]);
        }
      }
      if (player.gear !== 'D') {
        if (player.brake > 0.5 && speed < 0.2) cmds.push({ type: 'gear', gear: 'D' });
        return { brake: 1 };
      }
      if (onRoad && (ctx.time - launchT < 1.3 || player.indicator !== roadSide)) {
        setIndicator(roadSide);
        return { brake: 1 };
      }
      // Wait for a gap in the lane we are joining.
      if (onRoad) {
        const lane = loc.lane;
        for (const ai of ctx.vehicles) {
          if (!ai.nav || ai.nav.laneId !== lane.id) continue;
          const gap = loc.s - ai.nav.s;
          if (gap > -4 && gap < 45 && gap / Math.max(ai.speed, 1) < 6) return { brake: 1 };
        }
        // Fresh look just before going.
        if (ctx.time - player.lastShoulderCheck[roadSide] > 2.5) {
          glance(roadSide);
          startLooks([roadSide]);
          return { brake: 1 };
        }
      }
      if (player.handbrake) {
        cmds.push({ type: 'handbrake' });
        return { brake: 1 };
      }
      wasParked = false;
      launchStage = 0;
      established = ctx.time + 1.4;
    }

    /* ---- where are we on the route? ---- */
    let legs = legsIn && legsIn.length ? legsIn : wander;
    if (!legsIn || !legsIn.length) {
      // No route given: carry on along the current road.
      if (loc.kind === 'lane' && (!wander.length || !wander.some((l) => l.laneId === loc.lane.id))) {
        wander = [];
        let lane: LaneInfo = loc.lane;
        for (let n = 0; n < 4; n++) {
          const options = lane.connectors.map((id) => net.connectors.get(id)!);
          const next = options.find((c) => c.turn === 'straight') ?? options[0];
          wander.push({ laneId: lane.id, connectorId: next ? next.id : null });
          if (!next) break;
          lane = net.lanes.get(next.to)!;
        }
      }
      legs = wander;
    }
    if (!legs.length) {
      const near = net.nearestLane(v, 30);
      if (!near) return { brake: 1 };
      legs = [{ laneId: near.lane.id, connectorId: null }];
    }

    let i = -1;
    let onConn = false;
    let s = 0;
    if (onRoad) {
      i = legs.findIndex((l) => l.laneId === loc.lane.id);
      s = loc.s;
      // Lane change required by the route: mirror, signal, blind spot, then move across.
      if (i >= 0 && i + 1 < legs.length && legs[i]!.connectorId === null) {
        const from = loc.lane;
        const to = net.lanes.get(legs[i + 1]!.laneId)!;
        const dir = to.index > from.index ? kerbSide : roadSide;
        if (lcStage === 0 && s > 8) {
          glance(dir);
          setIndicator(dir);
          lcStart = ctx.time;
          lcStage = 1;
        } else if (lcStage === 1 && ctx.time - lcStart > rules.signalMinTimeLaneChangeS + 0.4) {
          setIndicator(dir);
          glance(dir);
          startLooks([dir]);
          lcStage = 2;
        } else if (lcStage === 2 && ctx.time - player.lastShoulderCheck[dir] < 1 && ctx.time >= lookUntil) {
          const busy = ctx.vehicles.some((ai) => ai.nav && ai.nav.laneId === to.id && ai.nav.s - s > -20 && ai.nav.s - s < 11);
          if (busy) {
            lcStage = 1;
            lcStart = ctx.time - rules.signalMinTimeLaneChangeS + 1;
          } else lcStage = 3;
        }
        if (lcStage === 3) i += 1;
        established = Math.max(established, ctx.time + 1.5);
      } else lcStage = 0;
    } else if (loc.kind === 'junction') {
      // Roundabout paths overlap, so project onto OUR connector rather than trusting the nearest one.
      i = legs.findIndex((l) => l.connectorId !== null && net.connectors.get(l.connectorId)!.nodeId === loc.node.id);
      if (i >= 0) {
        onConn = true;
        s = projectOn(net.connectors.get(legs[i]!.connectorId!)!, v.x, v.z);
      }
    }

    /* ---- off the network (car park, driveway) or not yet on the route ---- */
    if (i < 0) {
      const first = net.lanes.get(legs[0]!.laneId)!;
      let target: { x: number; z: number };
      let limit = 3.2;
      if (loc.kind === 'zone') {
        const zone = loc.zone;
        const dx = (zone.driveway.minX + zone.driveway.maxX) / 2;
        if (!loc.onDriveway && Math.abs(v.x - dx) > 1.2 && v.z > zone.rect.minZ + 9) target = { x: dx, z: Math.max(zone.rect.minZ + 4, v.z - 8) };
        else if (v.z > zone.driveway.minZ + 6.5) target = { x: dx, z: v.z - 7 };
        else {
          // At the mouth of the driveway: give way to everything on the road, then join the lane.
          const road = net.roads.get(first.roadId)!;
          for (const ai of ctx.vehicles) {
            if (!ai.nav || !ai.nav.laneId) continue;
            const l = net.lanes.get(ai.nav.laneId)!;
            if (l.roadId !== road.id) continue;
            const rel = toLocal({ x: ai.x, z: ai.z, heading: ai.heading }, v);
            if (rel.forward > -6 && rel.forward / Math.max(ai.speed, 1.5) < 6.5 && rel.forward < 70) return { brake: 1, steer: 0 };
          }
          // Aim along the lane we are joining; the closer we get, the nearer the aim point, so we arrive lined up.
          const fx = Math.sin(first.heading);
          const fz = Math.cos(first.heading);
          const along = (v.x - first.start.x) * fx + (v.z - first.start.z) * fz;
          const off = Math.abs(-(v.x - first.start.x) * fz + (v.z - first.start.z) * fx);
          target = net.lanePose(first.id, clamp(along + clamp(off * 0.95, 3.5, 9), 0, first.length));
          limit = 2.4;
          if (v.z > zone.driveway.minZ + 4.5 && speed < 0.3 && ctx.time - player.lastShoulderCheck.left > 4) startLooks(['left', 'right']);
        }
      } else {
        const fx = Math.sin(first.heading);
        const fz = Math.cos(first.heading);
        const along = (v.x - first.start.x) * fx + (v.z - first.start.z) * fz;
        const off = Math.abs(-(v.x - first.start.x) * fz + (v.z - first.start.z) * fx);
        target = net.lanePose(first.id, clamp(along + clamp(off * 0.95, 3.5, 9), 0, first.length));
        limit = 2.4;
      }
      return { steer: steerToward(target), ...pedals(limit) };
    }

    const leg = legs[i]!;
    const lane = net.lanes.get(leg.laneId)!;
    const conn = leg.connectorId ? net.connectors.get(leg.connectorId)! : null;
    const node = net.nodes.get(lane.to)!;
    const toEnd = onConn ? 0 : lane.length - s;

    /* ---- target speed ---- */
    const wet = ctx.env.weather !== 'clear';
    let target = (onConn ? net.lanes.get(conn!.to)!.speedLimit : lane.speedLimit) * (wet ? 0.82 : 0.93);
    if (conn) {
      const ts = turnSpeed(conn);
      target = onConn ? Math.min(target, ts) : Math.min(target, Math.sqrt(ts * ts + 2 * 1.5 * Math.max(0, toEnd - 3)));
    }

    // Reset per-junction memory when the approach changes.
    const key = `${lane.id}:${onConn}`;
    if (key !== junctionKey) {
      junctionKey = key;
      if (!onConn) {
        stoppedAtLine = 0;
        myStopTime = Infinity;
        scanned = false;
        signalled = false;
        blockedFor = 0;
      }
    }

    let lateral = 0;
    if (!onConn) {
      const frontGap = toEnd - HALF - 0.7;
      /* signals for the turn ahead */
      if (conn && node.control !== 'none' && Object.keys(node.arms).length >= 3 && ctx.time > established) {
        const signalAt = Math.max(rules.signalGuidanceDistanceM + 14, 48);
        let want: 'left' | 'right' | null = null;
        if (node.roundabout) {
          if (rules.roundabout.signalOnApproach === 'by_exit_direction' && conn.turn !== 'straight') want = conn.turn === 'left' ? 'left' : 'right';
        } else if (conn.turn === 'left' || conn.turn === 'right') want = conn.turn;
        if (want && toEnd < signalAt) {
          if (!signalled) {
            glance(want);
            signalled = true;
          }
          if (ctx.time - Math.max(player.lastMirrorCheck.centre, player.lastMirrorCheck[want]) > 0.25 || player.indicator === want) setIndicator(want);
        }
        if (toEnd < 22 && ctx.time - Math.max(player.lastMirrorCheck.centre, player.lastMirrorCheck.left, player.lastMirrorCheck.right) > 5) cmds.push({ type: 'mirror', mirror: 'centre' });
      }
      /* stop / give way at the line */
      if (conn && toEnd < 70) {
        const control = lane.endControl;
        let hold = false;
        if (control === 'signal') {
          const state = ctx.signals.getState(node.id, lane.arrivalArm);
          if (state === 'red' || state === 'red_amber') hold = true;
          else if (state === 'amber' && ((speed * speed) / (2 * Math.max(frontGap, 0.1)) < 3.2 || frontGap / Math.max(speed, 1) > ctx.signals.timeToChange(node.id, lane.arrivalArm) - 0.4)) hold = true;
          else if (toEnd < 30 && blocked(lane, conn)) hold = true;
        } else if (control === 'stop' && stoppedAtLine < 0.8) hold = true;
        else if (toEnd < 32 && blocked(lane, conn)) hold = true;
        if ((control === 'stop' || control === 'yield') && !node.roundabout && toEnd < 16 && strict) {
          // Look both ways, and look again if we have been waiting a while.
          const fresh = ctx.time - player.lastShoulderCheck.left < 4 && ctx.time - player.lastShoulderCheck.right < 4;
          if (!fresh) {
            startLooks(['left', 'right']);
            if (toEnd < 8) hold = true;
          }
          scanned = fresh;
        }
        if (hold && blockedFor > 28) hold = control === 'signal' && ctx.signals.getState(node.id, lane.arrivalArm) !== 'green';
        if (hold) {
          target = Math.min(target, stopProfile(frontGap));
          if (speed < 0.2 && frontGap < 2) blockedFor += 1 / 60;
        }
        if (speed < 0.25 && frontGap < 1.6) {
          stoppedAtLine += 1 / 60;
          if (!isFinite(myStopTime)) myStopTime = ctx.time;
        }
      }
      /* mid-block crossing */
      const mb = lane.midblock;
      if (mb && s + HALF < mb.stopS + 0.5) {
        const busy = ctx.pedestrians.some((p) => p.crosswalkId === mb.crosswalkId && (p.state === 'crossing' || p.state === 'waiting'));
        if (busy) target = Math.min(target, stopProfile(mb.stopS - s - HALF - 0.4));
      }
      /* stopping at the end of the step (pulling over) */
      if (stop && stop.laneId === lane.id) {
        const d = stop.s - s;
        if (d < 40) {
          if (d < 36 && !signalled) {
            glance(kerbSide);
            signalled = true;
          }
          if (d < 34) setIndicator(kerbSide);
          const road = net.roads.get(lane.roadId)!;
          const stripHere = net.locate(net.lanePose(lane.id, stop.s, net.kerbSign * (lane.width / 2 + 1))).kind === 'parking_strip';
          const kerbLat = stripHere ? net.kerbSign * (lane.width / 2 + road.parkingStripWidth / 2 + 0.25) : net.kerbSign * (lane.width / 2 - PLAYER_SPEC.width / 2 - 0.28);
          lateral = isNaN(stop.lateral) ? kerbLat * clamp((36 - d) / 16, 0, 1) : stop.lateral;
          target = Math.min(target, Math.max(d < 0.3 ? 0 : 0.9, stopProfile(d)));
          if (d < 0.3) target = 0;
        }
      }
    } else if (conn) {
      // In the junction: signal off the roundabout, and keep clear of crossings in use.
      const nodeC = net.nodes.get(conn.nodeId)!;
      if (nodeC.roundabout && rules.roundabout.signalOnExit && s > conn.length - 16) setIndicator(kerbSide);
      for (const cw of conn.crosswalks) {
        if (cw.s < s + HALF) continue;
        if (ctx.pedestrians.some((p) => p.crosswalkId === cw.id && p.state === 'crossing')) target = Math.min(target, stopProfile(cw.s - s - HALF - 2.8));
      }
    }

    /* ---- cancel a signal that is no longer needed ---- */
    if (!onConn && ctx.time > established && (player.indicator === 'left' || player.indicator === 'right')) {
      const turningSoon = conn && node.control !== 'none' && toEnd < Math.max(rules.signalGuidanceDistanceM + 14, 48) && (conn.turn !== 'straight' || node.roundabout);
      const pulling = stop && stop.laneId === lane.id && stop.s - s < 36;
      if (!turningSoon && !pulling && s > 6) setIndicator('off');
    }

    /* ---- anything physically ahead: keep a time gap ---- */
    const horizon = Math.max(14, speed * (rules.followingGapS + 1.6));
    const gapT = rules.followingGapS * (wet ? 1.5 : 1) + 0.5;
    outer: for (let d = HALF + 0.6; d < horizon; d += 1.3) {
      const pose = ahead(legs, i, onConn, s, d, lateral);
      for (const o of ctx.vehicles) {
        if (Math.abs(o.x - pose.x) > 6 || Math.abs(o.z - pose.z) > 6) continue;
        if (o.kind === 'parked' && lateral !== 0) continue;
        if (!obbContainsPoint(vehicleObb(o, 0.75), pose)) continue;
        const gap = d - HALF;
        const lead = Math.max(0, o.speed * Math.cos(o.heading - pose.heading));
        target = Math.min(target, Math.max(0, lead + (gap - 3 - lead * gapT) / gapT));
        if (gap < 3.2) target = 0;
        break outer;
      }
      for (const p of ctx.pedestrians) {
        if (Math.hypot(p.x - pose.x, p.z - pose.z) < 2.2 && (p.state === 'crossing' || d < 8)) {
          target = Math.min(target, stopProfile(d - HALF - 2.5));
          break outer;
        }
      }
    }

    const lookAhead = lcStage === 3 ? Math.max(11, speed * 1.3) : clamp(1.5 + speed * 0.6, 2.3, 12);
    const aim = ahead(legs, i, onConn, s, lookAhead, lateral);
    return { steer: steerToward(aim), ...pedals(target) };
  }

  return {
    input(): ControlInput {
      cmds.length = 0;
      const step = session.runtime.step;
      const env = session.runtime.env;
      let out: Partial<ControlInput> = { brake: 1 };
      if (step) {
        const hint = step.auto;
        if (hint.kind === 'input' || hint.kind === 'script') out = hint.act(env);
        else if (hint.kind === 'route') {
          if (session.scenario.instruction && session.scenario.instruction.text === 'STOP!') out = { brake: 1 };
          else out = drive(hint.legs(), hint.stopAt());
        } else out = { brake: Math.abs(v.speed) > 0.2 ? 0.6 : 1 };
      }
      // Timed looks (shoulder checks / scanning).
      if (ctx.time >= lookUntil) {
        const next = lookPlan.shift();
        if (next) {
          lookDir = next;
          lookUntil = ctx.time + 0.5;
        } else lookDir = 'ahead';
      }
      const commands = [...(out.commands ?? []), ...cmds];
      return {
        throttle: out.throttle ?? 0,
        brake: out.brake ?? 0,
        steer: out.steer ?? 0,
        look: out.look ?? lookDir,
        horn: false,
        commands,
      };
    },
  };
}
