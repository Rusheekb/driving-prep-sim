/**
 * Step library: the building blocks lessons and tests are assembled from.
 * Text may contain {term} tokens (see `tx`) and [Key] hints for the HUD.
 */
import { PLAYER_SPEC } from '../core/constants';
import { angleDiff, obbCorners, toLocal } from '../core/math';
import { formatDistance } from '../core/units';
import type { ControlInput, Gear, InstructionIcon, JurisdictionProfile, LaneInfo, ManeuverType, Obb, RouteLeg, TargetArea } from '../core/types';
import { findRoute, routePolyline, routeThroughNodes } from '../world/routing';
import { type Step, type StepEnv, instructionFor, kerbGap, playerPose } from './core';

const HALF_L = PLAYER_SPEC.length / 2;

/** Replace {yield}, {curb}, {turnSignal}… with the local word, plus {kerbSide}/{roadSide}. */
export function tx(profile: JurisdictionProfile, text: string): string {
  const kerbSide = profile.drivingSide === 'right' ? 'right' : 'left';
  const extra: Record<string, string> = { kerbSide, roadSide: kerbSide === 'right' ? 'left' : 'right' };
  return text.replace(/\{(\w+)\}/g, (_m, key: string) => extra[key] ?? (profile.terms as unknown as Record<string, string>)[key] ?? key);
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The lane the learner is properly driving in, or null. */
export function currentLane(e: StepEnv): { lane: LaneInfo; s: number; lateral: number } | null {
  const p = e.ctx.player;
  const loc = p.location;
  if (loc.kind !== 'lane' && loc.kind !== 'parking_strip') return null;
  if (Math.cos(p.vehicle.heading - loc.lane.heading) <= 0.2) return null;
  return { lane: loc.lane, s: loc.s, lateral: loc.lateral };
}

/* -------------------------------- prompts --------------------------------- */

export interface PromptOptions {
  label: string;
  coach: string;
  until(e: StepEnv): boolean;
  /** What a perfect driver does to satisfy the prompt. */
  act?(e: StepEnv): Partial<ControlInput>;
  say?: { text: string; icon: InstructionIcon };
  enter?(e: StepEnv): void;
}

export function prompt(o: PromptOptions): Step {
  return {
    label: o.label,
    enter(e) {
      e.state.coach = tx(e.profile, o.coach);
      if (o.say) e.say(tx(e.profile, o.say.text), o.say.icon);
      else e.silence();
      o.enter?.(e);
    },
    update: (e) => (o.until(e) ? 'done' : 'running'),
    exit(e) {
      e.state.coach = null;
    },
    auto: o.act ? { kind: 'input', act: o.act } : { kind: 'wait' },
  };
}

const brakeHeld: Partial<ControlInput> = { brake: 1 };

export const fastenSeatbelt = (): Step =>
  prompt({
    label: 'Seatbelt',
    coach: 'First things first: fasten your seatbelt [B].',
    until: (e) => e.ctx.player.seatbelt,
    act: (e) => (e.ctx.player.seatbelt ? {} : { commands: [{ type: 'seatbelt' }] }),
  });

export function checkMirrors(): Step {
  let t0 = 0;
  const done = (e: StepEnv, m: 'left' | 'centre' | 'right'): boolean => e.ctx.player.lastMirrorCheck[m] > t0;
  return prompt({
    label: 'Mirrors',
    coach: 'Check all three mirrors: left [1], centre [2] and right [3]. Each one lights up when your check registers.',
    enter: (e) => (t0 = e.ctx.time),
    until: (e) => done(e, 'left') && done(e, 'centre') && done(e, 'right'),
    act: (e) => {
      const next = (['left', 'centre', 'right'] as const).find((m) => !done(e, m));
      return next && e.ctx.frame % 20 === 0 ? { commands: [{ type: 'mirror', mirror: next }] } : {};
    },
  });
}

export const startEngine = (): Step =>
  prompt({
    label: 'Start the engine',
    coach: 'Start the engine [I]. The car must be in Park.',
    until: (e) => e.ctx.player.engineOn,
    act: (e) => (e.ctx.player.engineOn ? {} : { commands: [{ type: 'engine' }] }),
  });

export const selectGear = (gear: Gear, coach?: string): Step =>
  prompt({
    label: `Select ${gear}`,
    coach: coach ?? `Hold the brake [S] and select ${gear === 'D' ? 'Drive [F]' : gear === 'R' ? 'Reverse [R]' : gear === 'P' ? 'Park [P]' : 'Neutral [N]'}.`,
    until: (e) => e.ctx.player.gear === gear,
    act: (e) => (e.ctx.player.gear === gear ? brakeHeld : { brake: 1, commands: Math.abs(e.ctx.player.vehicle.speed) < 0.2 && e.ctx.player.brake > 0.5 ? [{ type: 'gear', gear }] : [] }),
  });

export const releaseHandbrake = (): Step =>
  prompt({
    label: 'Release the brake',
    coach: 'Release the {parkingBrake} [Space]. Keep your foot on the brake [S] so the car does not creep.',
    until: (e) => !e.ctx.player.handbrake,
    act: (e) => (e.ctx.player.handbrake ? { brake: 1, commands: [{ type: 'handbrake' }] } : brakeHeld),
  });

export const secureCar = (coach = 'Secure the car: select Park [P] and apply the {parkingBrake} [Space].'): Step =>
  prompt({
    label: 'Secure the car',
    coach,
    say: { text: 'Secure the car', icon: 'park' },
    until: (e) => e.ctx.player.gear === 'P' && e.ctx.player.handbrake && Math.abs(e.ctx.player.vehicle.speed) < 0.1,
    act: (e) => {
      const p = e.ctx.player;
      if (Math.abs(p.vehicle.speed) > 0.2) return { brake: 1 };
      if (p.gear !== 'P') return { brake: 1, commands: [{ type: 'gear', gear: 'P' }] };
      if (!p.handbrake) return { brake: 1, commands: [{ type: 'handbrake' }] };
      return { brake: 1 };
    },
  });

/** Free text coaching with a timer or condition (for explanations between actions). */
export const explain = (label: string, coach: string, seconds: number): Step => prompt({ label, coach, until: (e) => e.stepTime > seconds, act: () => brakeHeld });

/* --------------------------------- driving -------------------------------- */

export interface DriveOptions {
  /** Node ids to pass through, in order, starting with the node behind the learner. */
  via: string[];
  /** Where on the last lane the step ends (default: half way along). */
  endS?: number;
  label?: string;
  coach?: string;
  /** Scripted events when the step starts. */
  onEnter?(e: StepEnv): void;
  /** Called every tick (for triggers along the way). */
  onTick?(e: StepEnv): void;
}

export function drive(o: DriveOptions): Step {
  let legs: RouteLeg[] = [];
  let idx = 0;
  let destLane = '';
  let destS = 0;
  let lastRoute = -1;
  let offRouteSaid = false;
  let started = false;

  function locate(e: StepEnv): void {
    const cur = currentLane(e);
    const loc = e.ctx.player.location;
    if (cur && loc.kind === 'lane') {
      const j = legs.findIndex((l, i) => i >= idx && l.laneId === cur.lane.id);
      if (j >= 0) {
        idx = j;
        started = true;
        return;
      }
      // Not on the planned route.
      const to = started ? destLane : legs[0]!.laneId;
      const detour = findRoute(e.net, cur.lane.id, to);
      if (!detour) return;
      if (started) {
        legs = detour;
        if (!offRouteSaid) {
          offRouteSaid = true;
          e.ctx.events.emit('coach', { text: 'Different way — no problem, going off route is not a fault. Follow the new directions.', tone: 'info' });
        }
      } else legs = [...detour.slice(0, -1), ...legs];
      idx = 0;
      started = true;
    }
    // Inside a junction the leg does not change: routes may revisit a junction, and paths
    // overlap there, so the nearest connector is not a safe way to tell where on the route we are.
  }

  return {
    label: o.label ?? 'Drive',
    enter(e) {
      const planned = routeThroughNodes(e.net, o.via);
      if (!planned) throw new Error(`No route through ${o.via.join(' → ')}`);
      legs = planned;
      idx = 0;
      started = false;
      destLane = legs[legs.length - 1]!.laneId;
      destS = o.endS ?? e.net.lanes.get(destLane)!.length * 0.5;
      e.state.coach = o.coach ? tx(e.profile, o.coach) : null;
      o.onEnter?.(e);
    },
    update(e) {
      locate(e);
      o.onTick?.(e);
      const cur = currentLane(e);
      const unit = e.profile.speedUnit;
      // Next announcement.
      let dist = cur && legs[idx] && cur.lane.id === legs[idx]!.laneId ? cur.lane.length - cur.s : 0;
      let said = false;
      for (let j = idx; j < legs.length && dist < 230; j++) {
        const leg = legs[j]!;
        const lane = e.net.lanes.get(leg.laneId)!;
        if (j > idx && !(legs[j - 1] && legs[j - 1]!.connectorId === null)) dist += lane.length;
        if (leg.connectorId) {
          const conn = e.net.connectors.get(leg.connectorId)!;
          const ins = instructionFor(e.net, e.profile, lane, conn);
          if (ins) {
            e.say(ins.text, ins.icon, { exit: ins.exit, distance: dist });
            said = true;
            break;
          }
          dist += conn.length;
        }
      }
      if (!said) {
        if (e.stepTime < 7 && e.state.step <= 1) e.say('Follow the road ahead unless I ask you to turn', 'straight');
        else e.silence();
      }
      if (e.ctx.time - lastRoute > 0.4 || e.ctx.time < lastRoute) {
        lastRoute = e.ctx.time;
        const fromS = cur && legs[idx] && cur.lane.id === legs[idx]!.laneId ? cur.s : 0;
        e.state.route = routePolyline(e.net, legs.slice(idx), fromS, destS);
      }
      void unit;
      if (cur && cur.lane.id === destLane && cur.s >= destS && e.ctx.player.location.kind === 'lane') return 'done';
      return 'running';
    },
    exit(e) {
      e.state.route = [];
      e.state.coach = null;
    },
    auto: { kind: 'route', legs: () => legs.slice(idx), stopAt: () => null },
  };
}

/** "Pull up on the left/right when it's safe." Assesses signal, position and angle. */
export function pullOver(o: { label?: string; coach?: string } = {}): Step {
  let lastKerbSignal = -Infinity;
  let still = 0;
  let target: { laneId: string; s: number; lateral: number } | null = null;
  let nudged = -Infinity;
  return {
    label: o.label ?? 'Pull over',
    enter(e) {
      e.say(tx(e.profile, 'Pull up on the {kerbSide} when it is safe'), 'pull_over');
      e.state.coach = o.coach ? tx(e.profile, o.coach) : null;
      e.monitor.setContext({ maneuver: 'curbside_stop' });
      target = null;
    },
    update(e, dt) {
      const p = e.ctx.player;
      const kerbSide = e.net.side === 'right' ? 'right' : 'left';
      if (p.indicator === kerbSide) lastKerbSignal = e.ctx.time;
      const cur = currentLane(e);
      // A sensible spot for the demo driver: well clear of the junction ahead (else wait for the next road).
      if (cur && !target && cur.lane.length - cur.s > 52 && cur.s > 6 && e.ctx.player.location.kind === 'lane') {
        target = { laneId: cur.lane.id, s: cur.s + 28, lateral: 0 };
      }
      still = Math.abs(p.vehicle.speed) < 0.15 ? still + dt : 0;
      if (still < 1 || !cur) return 'running';
      const gap = kerbGap(e.net, playerPose(e.ctx));
      const angle = Math.abs(angleDiff(p.vehicle.heading, cur.lane.heading));
      const nearJunction = cur.s < 12 || cur.lane.length - cur.s < 14;
      const onCrossing = !!cur.lane.midblock && cur.s + HALF_L > cur.lane.midblock.stopS && cur.s - HALF_L < cur.lane.midblock.endS;
      if (gap > 1.3 || nearJunction || onCrossing || angle > 0.35) {
        if (e.ctx.time - nudged > 6) {
          nudged = e.ctx.time;
          const why = nearJunction ? `too close to the ${e.profile.terms.intersection}` : onCrossing ? `on the ${e.profile.terms.crosswalk}` : `too far from the ${e.profile.terms.curb}`;
          e.ctx.events.emit('coach', { text: `Not here — you are ${why}. Move on a little and try again.`, tone: 'warn' });
        }
        return 'running';
      }
      if (e.ctx.time - lastKerbSignal > 4) e.monitor.report('no_signal_pulling_over');
      if (gap > 0.5) e.monitor.report('park_far_from_kerb', { info: { gap: formatDistance(gap, e.profile.speedUnit) } });
      if (angle > 0.17) e.monitor.report('park_not_straight');
      if (gap <= 0.5 && angle <= 0.17) e.ctx.events.emit('praise', { kind: 'good_parking', text: 'Neat stop, close to the kerb'.replace('kerb', e.profile.terms.curb) });
      return 'done';
    },
    exit(e) {
      e.monitor.setContext({ maneuver: null });
      e.state.coach = null;
    },
    auto: {
      kind: 'route',
      legs: () => (target ? [{ laneId: target.laneId, connectorId: null }] : null),
      stopAt: () => target && { ...target, lateral: NaN },
    },
  };
}

/** Wait until the learner has pulled away and is established in the lane. */
export function moveOff(o: { label?: string; coach?: string } = {}): Step {
  return {
    label: o.label ?? 'Move off',
    enter(e) {
      e.say('Move off when you are ready', 'straight');
      e.state.coach = o.coach ? tx(e.profile, o.coach) : null;
    },
    update(e) {
      const cur = currentLane(e);
      return cur && e.ctx.player.location.kind === 'lane' && e.ctx.player.vehicle.speed > 2.5 && Math.abs(cur.lateral) < 1 ? 'done' : 'running';
    },
    exit(e) {
      e.state.coach = null;
    },
    auto: {
      kind: 'route',
      legs() {
        return null;
      },
      stopAt: () => null,
    },
  };
}

/* ------------------------------- manoeuvres ------------------------------- */

interface ManeuverBase {
  label: string;
  maneuver: ManeuverType;
  instruction: string;
  icon: InstructionIcon;
  coach?: string;
  target?: Obb;
  maxMoves: number;
  timeout?: number;
}

/** Shared scaffolding: context, target highlight, move counting, timeout. `check` returns 'done' when the manoeuvre is complete. */
function maneuverStep(o: ManeuverBase, check: (e: StepEnv, dt: number, moves: number) => 'running' | 'done', onEnter?: (e: StepEnv) => void): Step {
  let moves = 0;
  let lastGear: Gear = 'P';
  let movedSince = 0;
  let lastOdo = 0;
  let tooMany = false;
  const target = (state: TargetArea['state']): TargetArea[] => (o.target ? [{ id: 'target', kind: 'bay', obb: o.target, state }] : []);
  return {
    label: o.label,
    enter(e) {
      e.say(tx(e.profile, o.instruction), o.icon);
      e.state.coach = o.coach ? tx(e.profile, o.coach) : null;
      e.state.activeManeuver = o.maneuver;
      e.state.targets = target('active');
      e.monitor.setContext({ maneuver: o.maneuver });
      e.monitor.setSuspended(['hesitation', 'speed'], true);
      moves = 0;
      lastGear = e.ctx.player.gear;
      lastOdo = e.ctx.player.odometer;
      onEnter?.(e);
    },
    update(e, dt) {
      const p = e.ctx.player;
      movedSince += p.odometer - lastOdo;
      lastOdo = p.odometer;
      if ((p.gear === 'D' || p.gear === 'R') && p.gear !== lastGear) {
        if ((lastGear === 'D' || lastGear === 'R') && movedSince > 0.5) moves++;
        lastGear = p.gear;
        movedSince = 0;
      }
      if (moves > o.maxMoves && !tooMany) {
        tooMany = true;
        e.monitor.report('manoeuvre_too_many_moves', { force: true });
      }
      if (e.stepTime > (o.timeout ?? 300)) {
        e.monitor.report('manoeuvre_incomplete', { force: true });
        return 'done';
      }
      return check(e, dt, moves);
    },
    exit(e) {
      e.state.activeManeuver = null;
      e.state.targets = target('done');
      e.state.coach = null;
      e.monitor.setContext({ maneuver: null });
      e.monitor.setSuspended(['hesitation', 'speed'], false);
    },
    auto: { kind: 'wait' },
  };
}

const stoppedFor = (e: StepEnv): number => e.ctx.player.stoppedFor;

export function parallelPark(o: { bay: Obb; coach?: string }): Step {
  let nudged = -Infinity;
  return maneuverStep(
    {
      label: 'Parallel park',
      maneuver: 'parallel_park',
      instruction: `${cap('{parallelPark}')} in the marked space`,
      icon: 'park',
      coach: o.coach,
      target: o.bay,
      maxMoves: 4,
    },
    (e) => {
      if (stoppedFor(e) < 1.5) return 'running';
      const pose = playerPose(e.ctx);
      const rel = toLocal({ x: o.bay.x, z: o.bay.z, heading: o.bay.heading }, pose);
      if (Math.abs(rel.forward) > o.bay.halfLength + 1.5 || Math.abs(rel.right) > 3) return 'running';
      const fits = Math.abs(rel.forward) + HALF_L <= o.bay.halfLength + 0.2;
      const gap = kerbGap(e.net, pose);
      const angle = Math.abs(angleDiff(pose.heading, o.bay.heading));
      if (!fits || gap > 0.9 || angle > 0.26) {
        if (e.ctx.time - nudged > 7) {
          nudged = e.ctx.time;
          const why = !fits ? 'not fully inside the space' : gap > 0.9 ? `too far from the ${e.profile.terms.curb}` : 'at too much of an angle';
          e.ctx.events.emit('coach', { text: `Nearly — you are ${why}. Adjust and stop again.`, tone: 'warn' });
        }
        return 'running';
      }
      if (gap > 0.45) e.monitor.report('park_far_from_kerb', { force: true, info: { gap: formatDistance(gap, e.profile.speedUnit) } });
      if (angle > 0.14) e.monitor.report('park_not_straight', { force: true });
      if (gap <= 0.45 && angle <= 0.14) e.ctx.events.emit('praise', { kind: 'good_parking', text: 'Neatly parked' });
      return 'done';
    },
  );
}

export function bayPark(o: { bay: Obb; mode: 'reverse' | 'forward'; coach?: string }): Step {
  let nudged = -Infinity;
  return maneuverStep(
    {
      label: o.mode === 'reverse' ? 'Reverse bay park' : 'Forward bay park',
      maneuver: o.mode === 'reverse' ? 'reverse_bay_park' : 'forward_bay_park',
      instruction: o.mode === 'reverse' ? 'Reverse into the marked bay' : 'Drive forward into the marked bay',
      icon: 'park',
      coach: o.coach,
      target: o.bay,
      maxMoves: o.mode === 'reverse' ? 4 : 3,
    },
    (e) => {
      if (stoppedFor(e) < 1.5) return 'running';
      const v = e.ctx.player.vehicle;
      const bayPose = { x: o.bay.x, z: o.bay.z, heading: o.bay.heading };
      const centre = toLocal(bayPose, v);
      if (Math.abs(centre.forward) > o.bay.halfLength || Math.abs(centre.right) > o.bay.halfWidth) return 'running';
      // Nose toward the edge = heading matches the bay; reversing in leaves the nose pointing out.
      const want = o.mode === 'forward' ? o.bay.heading : o.bay.heading + Math.PI;
      const angle = Math.abs(angleDiff(v.heading, want));
      let overhang = 0;
      for (const c of obbCorners({ x: v.x, z: v.z, heading: v.heading, halfLength: HALF_L, halfWidth: PLAYER_SPEC.width / 2 })) {
        const r = toLocal(bayPose, c);
        overhang = Math.max(overhang, Math.abs(r.right) - o.bay.halfWidth, Math.abs(r.forward) - o.bay.halfLength);
      }
      if (angle > 0.3 || overhang > 0.45) {
        if (e.ctx.time - nudged > 7) {
          nudged = e.ctx.time;
          e.ctx.events.emit('coach', { text: angle > 1.5 ? `Wrong way round — ${o.mode === 'reverse' ? 'reverse' : 'drive forward'} into the bay.` : 'Nearly — straighten up inside the lines and stop again.', tone: 'warn' });
        }
        return 'running';
      }
      if (overhang > 0.08) e.monitor.report('park_outside_bay', { force: true });
      if (angle > 0.14) e.monitor.report('park_not_straight', { force: true });
      if (overhang <= 0.08 && angle <= 0.14) e.ctx.events.emit('praise', { kind: 'good_parking', text: 'Right between the lines' });
      return 'done';
    },
  );
}

export function threePointTurn(o: { coach?: string } = {}): Step {
  let start: LaneInfo | null = null;
  return maneuverStep(
    {
      label: 'Turn in the road',
      maneuver: 'three_point_turn',
      instruction: 'Turn the car around to face the other way, using forward and reverse gears',
      icon: 'uturn',
      coach: o.coach,
      maxMoves: 4,
      timeout: 240,
    },
    (e) => {
      const cur = currentLane(e);
      if (!start) {
        const near = e.net.nearestLane(e.ctx.player.vehicle, 8);
        start = near ? near.lane : null;
        return 'running';
      }
      if (!cur || e.ctx.player.location.kind !== 'lane') return 'running';
      const opposite = cur.lane.roadId === start.roadId && cur.lane.travel !== start.travel;
      const straight = Math.abs(angleDiff(e.ctx.player.vehicle.heading, cur.lane.heading)) < 0.3;
      return opposite && straight && Math.abs(cur.lateral) < 1.2 && e.ctx.player.vehicle.speed > 1 ? 'done' : 'running';
    },
    () => (start = null),
  );
}

export function reverseStraight(o: { distance: number; coach?: string }): Step {
  let s0 = NaN;
  let lat0 = 0;
  let maxDrift = 0;
  let maxAngle = 0;
  return maneuverStep(
    {
      label: 'Reverse in a straight line',
      maneuver: 'reverse_straight',
      instruction: `Reverse in a straight line, keeping close to the {curb}`,
      icon: 'reverse',
      coach: o.coach,
      maxMoves: 3,
      timeout: 180,
    },
    (e) => {
      const p = e.ctx.player;
      const near = e.net.nearestLane(p.vehicle, 8);
      if (!near) return 'running';
      if (isNaN(s0)) {
        s0 = near.s;
        lat0 = near.lateral;
        return 'running';
      }
      maxDrift = Math.max(maxDrift, Math.abs(near.lateral - lat0));
      maxAngle = Math.max(maxAngle, Math.abs(angleDiff(p.vehicle.heading, near.lane.heading)));
      const done = s0 - near.s;
      e.say(tx(e.profile, 'Reverse in a straight line, keeping close to the {curb}'), 'reverse', { distance: Math.max(0, o.distance - done) });
      if (done < o.distance || stoppedFor(e) < 1) return 'running';
      if (maxDrift > 0.6) e.monitor.report('park_far_from_kerb', { force: true, detail: `You drifted away from the ${e.profile.terms.curb} while reversing.` });
      if (maxAngle > 0.14) e.monitor.report('park_not_straight', { force: true, detail: 'The car weaved while reversing.' });
      if (maxDrift <= 0.6 && maxAngle <= 0.14) e.ctx.events.emit('praise', { kind: 'good_parking', text: 'Straight as an arrow' });
      return 'done';
    },
    () => {
      s0 = NaN;
      maxDrift = 0;
      maxAngle = 0;
    },
  );
}

/** Emergency stop: warns first, cues "STOP!" at speed on a clear straight, measures reaction and stopping. */
export function emergencyStop(o: { coach?: string } = {}): Step {
  let phase: 'brief' | 'armed' | 'stopping' | 'stopped' = 'brief';
  let cueAt = 0;
  let reacted = false;
  return {
    label: 'Emergency stop',
    enter(e) {
      phase = 'brief';
      reacted = false;
      e.say('Soon I will say STOP. When I do, stop as quickly and safely as you can', 'info');
      e.state.coach = o.coach ? tx(e.profile, o.coach) : null;
      e.state.activeManeuver = 'emergency_stop';
    },
    update(e) {
      const p = e.ctx.player;
      const cur = currentLane(e);
      if (phase === 'brief') {
        if (e.stepTime > 5) phase = 'armed';
      } else if (phase === 'armed') {
        if (cur && p.vehicle.speed > 7.5 && cur.lane.length - cur.s > 55 && !cur.lane.midblock) {
          const behind = e.ctx.vehicles.some((v) => v.nav && v.nav.laneId === cur.lane.id && v.nav.s < cur.s && cur.s - v.nav.s < 28);
          const ahead = e.ctx.vehicles.some((v) => v.nav && v.nav.laneId === cur.lane.id && v.nav.s > cur.s && v.nav.s - cur.s < 40);
          if (!behind && !ahead) {
            phase = 'stopping';
            cueAt = e.ctx.time;
            e.monitor.setContext({ emergencyStop: true });
            e.say('STOP!', 'stop');
            e.ctx.events.emit('coach', { text: 'STOP!', tone: 'warn' });
          }
        }
      } else if (phase === 'stopping') {
        if (!reacted && p.brake > 0.4) {
          reacted = true;
          if (e.ctx.time - cueAt > 1.0) e.monitor.report('emergency_stop_slow', { force: true });
        }
        if (!reacted && e.ctx.time - cueAt > 2.5) {
          reacted = true;
          e.monitor.report('emergency_stop_slow', { force: true, severity: 'serious' });
        }
        if (Math.abs(p.vehicle.speed) < 0.15) {
          phase = 'stopped';
          cueAt = e.ctx.time;
          e.monitor.setContext({ emergencyStop: false });
          e.say('Thank you. Drive on when you are ready', 'straight');
        }
      } else if (e.ctx.time - cueAt > 1.5 && p.vehicle.speed > 2) return 'done';
      return 'running';
    },
    exit(e) {
      e.monitor.setContext({ emergencyStop: false });
      e.state.activeManeuver = null;
      e.state.coach = null;
    },
    auto: { kind: 'route', legs: () => null, stopAt: () => null },
  };
}

/** Never completes: free driving. */
export const freeRoam = (): Step => ({ label: 'Free drive', update: () => 'running', auto: { kind: 'wait' } });

/** Stop inside a marked box (lessons in the car park). */
export function stopInBox(o: { box: Obb; label: string; instruction: string; coach?: string }): Step {
  return {
    label: o.label,
    enter(e) {
      e.say(tx(e.profile, o.instruction), 'flag');
      e.state.coach = o.coach ? tx(e.profile, o.coach) : null;
      e.state.targets = [{ id: 'box', kind: 'stop_box', obb: o.box, state: 'active' }];
    },
    update(e) {
      const v = e.ctx.player.vehicle;
      const r = toLocal({ x: o.box.x, z: o.box.z, heading: o.box.heading }, v);
      return Math.abs(r.forward) < o.box.halfLength && Math.abs(r.right) < o.box.halfWidth && stoppedFor(e) > 0.6 ? 'done' : 'running';
    },
    exit(e) {
      e.state.targets = [];
      e.state.coach = null;
    },
    auto: { kind: 'wait' },
  };
}
