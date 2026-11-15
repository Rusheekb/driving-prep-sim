/**
 * Connectors: the paths vehicles follow through a junction, from the stop line
 * of one lane to the start of another, plus the places where two such paths
 * conflict and the crosswalks each path passes over.
 */
import { LEFT_OF, OPPOSITE, RIGHT_OF, angleDiff, headingOf, segmentIntersection, toLocal } from '../core/math';
import type {
  Compass,
  ConnectorInfo,
  CrosswalkInfo,
  DrivingSide,
  LaneInfo,
  NodeArm,
  NodeInfo,
  Pose,
  Turn,
  Vec2,
} from '../core/types';
import { CONFLICT_DISTANCE, CONNECTOR_SPACING, MERGE_ANGLE } from './dims';
import { COMPASS_ORDER } from './layout';
import {
  type PathPiece,
  arcPiece,
  filletTurn,
  linePiece,
  nearestOnPolyline,
  newPolylineHit,
  poseOnPath,
  samplePath,
  shiftPiece,
} from './paths';

/** A connector together with the exact tangent heading at each of its points. */
export interface BuiltConnector {
  info: ConnectorInfo;
  headings: number[];
}

const TURNS: readonly Turn[] = ['left', 'straight', 'right'];

const exitDirection = (travel: Compass, turn: Turn): Compass =>
  turn === 'straight' ? travel : turn === 'right' ? RIGHT_OF[travel] : LEFT_OF[travel];

const endPose = (lane: LaneInfo): Pose => ({ x: lane.end.x, z: lane.end.z, heading: lane.heading });
const startPose = (lane: LaneInfo): Pose => ({ x: lane.start.x, z: lane.start.z, heading: lane.heading });

function makeConnector(
  node: NodeInfo,
  from: LaneInfo,
  to: LaneInfo,
  turn: Turn,
  crossesOncoming: boolean,
  pieces: readonly PathPiece[],
  exitNumber?: number,
): BuiltConnector {
  const path = samplePath(pieces, CONNECTOR_SPACING);
  const info: ConnectorInfo = {
    id: `${from.id}>${to.id}`,
    nodeId: node.id,
    from: from.id,
    to: to.id,
    turn,
    crossesOncoming,
    points: path.points,
    cumulative: path.cumulative,
    length: path.length,
    conflicts: [],
    crosswalks: [],
  };
  if (exitNumber !== undefined) info.exitNumber = exitNumber;
  return { info, headings: path.headings };
}

/** Every movement through one node. */
export function buildNodeConnectors(
  node: NodeInfo,
  lanes: ReadonlyMap<string, LaneInfo>,
  side: DrivingSide,
): BuiltConnector[] {
  return node.roundabout ? roundaboutConnectors(node, lanes, side) : junctionConnectors(node, lanes, side);
}

/* -------------------------------------------------------------------------- */
/* Ordinary junctions and bends                                               */
/* -------------------------------------------------------------------------- */

/**
 * Lane discipline: the kerb-side turn runs kerb lane → kerb lane, the turn
 * across oncoming traffic runs centre lane → centre lane, and straight on keeps
 * the lane index (clamped). A lane left with no movement at all (the inner lane
 * of a bend, a middle lane at a T) follows the turn next to it, keeping its
 * index, so no lane is ever a dead end.
 */
function junctionConnectors(node: NodeInfo, lanes: ReadonlyMap<string, LaneInfo>, side: DrivingSide): BuiltConnector[] {
  const kerbTurn: Turn = side === 'right' ? 'right' : 'left';
  const built: BuiltConnector[] = [];

  for (const dirIn of COMPASS_ORDER) {
    const armIn = node.arms[dirIn];
    if (!armIn || armIn.incoming.length === 0) continue;
    const travel = OPPOSITE[dirIn];
    const exits: { arm: NodeArm; turn: Turn }[] = [];
    for (const turn of TURNS) {
      const arm = node.arms[exitDirection(travel, turn)];
      if (arm && arm.outgoing.length > 0) exits.push({ arm, turn });
    }

    const nIn = armIn.incoming.length;
    const served = new Array<boolean>(nIn).fill(false);
    const connect = (fromIndex: number, exit: { arm: NodeArm; turn: Turn }, toIndex: number): void => {
      const from = lanes.get(armIn.incoming[fromIndex])!;
      const to = lanes.get(exit.arm.outgoing[toIndex])!;
      served[fromIndex] = true;
      built.push(
        makeConnector(node, from, to, exit.turn, exit.turn !== 'straight' && exit.turn !== kerbTurn, turnPieces(from, to, exit.turn)),
      );
    };

    for (const exit of exits) {
      const nOut = exit.arm.outgoing.length;
      if (exit.turn === 'straight') {
        for (let i = 0; i < nIn; i++) connect(i, exit, Math.min(i, nOut - 1));
      } else if (exit.turn === kerbTurn) {
        connect(nIn - 1, exit, nOut - 1);
      } else {
        connect(0, exit, 0);
      }
    }
    const fallback = exits.find((e) => e.turn === kerbTurn) ?? exits.find((e) => e.turn !== 'straight');
    if (fallback) {
      for (let i = 0; i < nIn; i++) {
        if (!served[i]) connect(i, fallback, Math.min(i, fallback.arm.outgoing.length - 1));
      }
    }
  }
  return built;
}

function turnPieces(from: LaneInfo, to: LaneInfo, turn: Turn): PathPiece[] {
  const start = endPose(from);
  if (turn !== 'straight') return filletTurn(start, startPose(to));
  const local = toLocal(start, to.start);
  if (Math.abs(local.right) < 1e-6) return [linePiece(from.end, to.start)];
  return [shiftPiece(start, local.forward, local.right)];
}

/* -------------------------------------------------------------------------- */
/* Roundabouts                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One connector per (entry, exit) pair: an entry curve from the give-way line
 * onto the circle in the middle of the circulating lane, round the island in
 * the direction of circulation, and an exit curve into the exit lane. The entry
 * and exit curves are the largest arcs that are tangent to both the lane and
 * the circle, so the heading is continuous throughout.
 */
function roundaboutConnectors(node: NodeInfo, lanes: ReadonlyMap<string, LaneInfo>, side: DrivingSide): BuiltConnector[] {
  const rb = node.roundabout!;
  const midRadius = (rb.islandRadius + rb.outerRadius) / 2;
  // +1: anticlockwise seen from above (traffic keeps right); −1: clockwise (traffic keeps left).
  const spin = side === 'right' ? 1 : -1;
  const nextArm = side === 'right' ? LEFT_OF : RIGHT_OF;
  const built: BuiltConnector[] = [];

  /** Arc of the largest radius tangent to the lane at `pose` and to the mid-lane circle. */
  const blend = (pose: Pose): { centre: Vec2; radius: number; ringAngle: number } => {
    const vx = pose.x - node.pos.x;
    const vz = pose.z - node.pos.z;
    // Unit vector toward the kerb side (where the blend arc's centre lies).
    const kx = -Math.cos(pose.heading) * spin;
    const kz = Math.sin(pose.heading) * spin;
    const radius = (vx * vx + vz * vz - midRadius * midRadius) / (2 * (midRadius - (vx * kx + vz * kz)));
    const centre = { x: pose.x + kx * radius, z: pose.z + kz * radius };
    return { centre, radius, ringAngle: headingOf(centre.x - node.pos.x, centre.z - node.pos.z) };
  };

  for (const dirIn of COMPASS_ORDER) {
    const armIn = node.arms[dirIn];
    if (!armIn || armIn.incoming.length === 0) continue;
    const from = lanes.get(armIn.incoming[armIn.incoming.length - 1])!;
    const entry = blend(endPose(from));
    const travel = OPPOSITE[dirIn];

    let exitNumber = 0;
    for (let dirOut = nextArm[dirIn]; dirOut !== dirIn; dirOut = nextArm[dirOut]) {
      const armOut = node.arms[dirOut];
      if (!armOut || armOut.outgoing.length === 0) continue;
      exitNumber++;
      const to = lanes.get(armOut.outgoing[armOut.outgoing.length - 1])!;
      const exit = blend(startPose(to));

      // Entry and exit blends curve toward the kerb (opposite to the circulation).
      const entryStart = headingOf(from.end.x - entry.centre.x, from.end.z - entry.centre.z);
      const entryEnd = headingOf(node.pos.x - entry.centre.x, node.pos.z - entry.centre.z);
      const exitStart = headingOf(node.pos.x - exit.centre.x, node.pos.z - exit.centre.z);
      const exitEnd = headingOf(to.start.x - exit.centre.x, to.start.z - exit.centre.z);
      const ringSweep = spin * positiveAngle(spin * (exit.ringAngle - entry.ringAngle));

      const pieces = [
        arcPiece(entry.centre, entry.radius, entryStart, -spin * positiveAngle(-spin * (entryEnd - entryStart))),
        arcPiece(node.pos, midRadius, entry.ringAngle, ringSweep),
        arcPiece(exit.centre, exit.radius, exitStart, -spin * positiveAngle(-spin * (exitEnd - exitStart))),
      ];
      const turn: Turn = dirOut === travel ? 'straight' : dirOut === RIGHT_OF[travel] ? 'right' : 'left';
      built.push(makeConnector(node, from, to, turn, false, pieces, exitNumber));
    }
  }
  return built;
}

/** Wrap an angle into [0, 2π). */
function positiveAngle(a: number): number {
  const tau = Math.PI * 2;
  const r = a % tau;
  return r < 0 ? r + tau : r;
}

/* -------------------------------------------------------------------------- */
/* Conflicts                                                                  */
/* -------------------------------------------------------------------------- */

interface Scan {
  /** Where `self` first comes within the conflict distance of `other`, or null. */
  first: { s: number; otherS: number } | null;
  /** Closest approach. */
  minDistSq: number;
  minS: number;
  minOtherS: number;
}

const hit = newPolylineHit();

function scan(self: ConnectorInfo, other: ConnectorInfo): Scan {
  const limitSq = CONFLICT_DISTANCE * CONFLICT_DISTANCE;
  const result: Scan = { first: null, minDistSq: Infinity, minS: 0, minOtherS: 0 };
  let prevDist = Infinity;
  let prevOtherS = 0;
  for (let i = 0; i < self.points.length; i++) {
    const p = self.points[i];
    nearestOnPolyline(p.x, p.z, other.points, other.cumulative, hit);
    if (hit.distSq < result.minDistSq) {
      result.minDistSq = hit.distSq;
      result.minS = self.cumulative[i];
      result.minOtherS = hit.s;
    }
    const d = Math.sqrt(hit.distSq);
    if (!result.first && d <= CONFLICT_DISTANCE) {
      if (i === 0 || prevDist <= d) {
        result.first = { s: self.cumulative[i], otherS: hit.s };
      } else {
        // Interpolate back to where the gap closed to exactly the conflict distance.
        const t = (prevDist - CONFLICT_DISTANCE) / (prevDist - d);
        result.first = {
          s: self.cumulative[i - 1] + (self.cumulative[i] - self.cumulative[i - 1]) * t,
          otherS: prevOtherS + (hit.s - prevOtherS) * t,
        };
      }
    }
    prevDist = d;
    prevOtherS = hit.s;
    if (hit.distSq > limitSq && result.first) continue;
  }
  return result;
}

function boundsOf(points: readonly Vec2[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Fill in `conflicts` for all connectors of one node. Two connectors that
 * start from different lanes conflict when their centre lines come within
 * `CONFLICT_DISTANCE`. Each side records where IT first reaches that distance
 * (`s`) and where the other does (`otherS`), so the relation is symmetric.
 */
export function computeConflicts(connectors: readonly BuiltConnector[]): void {
  const boxes = connectors.map((c) => boundsOf(c.info.points));
  for (let i = 0; i < connectors.length; i++) {
    for (let j = i + 1; j < connectors.length; j++) {
      const a = connectors[i];
      const b = connectors[j];
      if (a.info.from === b.info.from) continue;
      const ba = boxes[i];
      const bb = boxes[j];
      if (
        ba.minX > bb.maxX + CONFLICT_DISTANCE ||
        bb.minX > ba.maxX + CONFLICT_DISTANCE ||
        ba.minZ > bb.maxZ + CONFLICT_DISTANCE ||
        bb.minZ > ba.maxZ + CONFLICT_DISTANCE
      ) {
        continue;
      }
      const ab = scan(a.info, b.info);
      const baScan = scan(b.info, a.info);
      if (!ab.first && !baScan.first) continue;
      const sA = ab.first ? ab.first.s : baScan.first!.otherS;
      const sB = baScan.first ? baScan.first.s : ab.first!.otherS;

      let kind: 'cross' | 'merge' = 'cross';
      if (a.info.to === b.info.to) kind = 'merge';
      else {
        // Compare directions where the two paths are closest: joining paths run together there.
        const closest = ab.minDistSq <= baScan.minDistSq ? { sA: ab.minS, sB: ab.minOtherS } : { sA: baScan.minOtherS, sB: baScan.minS };
        const hA = poseOnPath(a.info.points, a.headings, a.info.cumulative, closest.sA).heading;
        const hB = poseOnPath(b.info.points, b.headings, b.info.cumulative, closest.sB).heading;
        if (Math.abs(angleDiff(hA, hB)) <= MERGE_ANGLE) kind = 'merge';
      }
      a.info.conflicts.push({ other: b.info.id, s: sA, otherS: sB, kind });
      b.info.conflicts.push({ other: a.info.id, s: sB, otherS: sA, kind });
    }
  }
  for (const c of connectors) c.info.conflicts.sort((p, q) => p.s - q.s || (p.other < q.other ? -1 : 1));
}

/* -------------------------------------------------------------------------- */
/* Crosswalks                                                                 */
/* -------------------------------------------------------------------------- */

/** Record, for each connector, the junction crosswalks its path passes over. */
export function attachCrosswalks(connectors: readonly BuiltConnector[], crosswalks: readonly CrosswalkInfo[]): void {
  for (const { info } of connectors) {
    for (const xw of crosswalks) {
      for (let i = 0; i < info.points.length - 1; i++) {
        const cut = segmentIntersection(info.points[i], info.points[i + 1], xw.a, xw.b);
        if (!cut) continue;
        info.crosswalks.push({ id: xw.id, s: info.cumulative[i] + (info.cumulative[i + 1] - info.cumulative[i]) * cut.t });
        break;
      }
    }
    info.crosswalks.sort((p, q) => p.s - q.s);
  }
}
