/**
 * Builds the runtime road network for one jurisdiction from a `MapDef`:
 * lanes on the correct side of the road, junction arms and stop lines,
 * crosswalks, connectors (paths through junctions) and fast point queries.
 */
import { CROSSWALK_WIDTH, LANE_WIDTH, SIDEWALK_WIDTH, STOP_LINE_GAP } from '../core/constants';
import { COMPASS_HEADING, COMPASS_VEC, OPPOSITE, clamp, forwardOf, rectContains, rightOf } from '../core/math';
import { toMps } from '../core/units';
import type {
  BlockInfo,
  Compass,
  ConnectorInfo,
  ControlType,
  CrosswalkInfo,
  DrivingSide,
  JurisdictionProfile,
  LaneEndControl,
  LaneInfo,
  MapDef,
  MapNodeDef,
  MapPoi,
  NodeArm,
  NodeInfo,
  Pose,
  Rect,
  RoadInfo,
  RoadNetwork,
  SurfaceLocation,
  Vec2,
  ZoneInfo,
} from '../core/types';
import { type BuiltConnector, attachCrosswalks, buildNodeConnectors, computeConflicts } from './connectors';
import { CONNECTOR_SNAP_DISTANCE, DRIVEWAY_FLARE, MIDBLOCK_MIN_CLEARANCE, MIDBLOCK_STOP_GAP, MIN_LANE_LENGTH } from './dims';
import {
  AXIS_OF,
  type Layout,
  NODE_ISLAND,
  NODE_OUTSIDE,
  NODE_PAVED,
  NODE_SIDEWALK,
  NODE_SIDEWALK_ARM,
  type NodeGeom,
  type RoadGeom,
  classifyNodePoint,
  compassBetween,
  deriveLayout,
  inNodeBox,
} from './layout';
import { nearestOnPolyline, newPolylineHit, poseOnPath } from './paths';

export type NetworkProfile = Pick<JurisdictionProfile, 'drivingSide' | 'speedUnit' | 'speedLimits' | 'rules'>;

/** The network plus the geometry renderers need (junction outlines, kerb fillets, parking-strip extents). */
export interface BuiltNetwork extends RoadNetwork {
  readonly layout: Layout;
  /** +1 when traffic keeps right, −1 when it keeps left: multiply a "right of travel" offset by this to get "toward the kerb". */
  readonly kerbSign: 1 | -1;
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                 */
/* -------------------------------------------------------------------------- */

/** Human-readable problems with a map; empty when it can be built. */
export function validateMap(map: MapDef): string[] {
  const problems: string[] = [];
  const nodeById = new Map<string, MapNodeDef>();
  for (const n of map.nodes) {
    if (nodeById.has(n.id)) problems.push(`Duplicate node id ${n.id}`);
    nodeById.set(n.id, n);
  }
  const roadIds = new Set<string>();
  const arms = new Map<string, Map<Compass, string>>();
  for (const r of map.roads) {
    if (roadIds.has(r.id)) problems.push(`Duplicate road id ${r.id}`);
    roadIds.add(r.id);
    const a = nodeById.get(r.a);
    const b = nodeById.get(r.b);
    if (!a || !b) {
      problems.push(`Road ${r.id} refers to an unknown node`);
      continue;
    }
    const dir = compassBetween(a, b);
    if (!dir) {
      problems.push(`Road ${r.id} is not axis-aligned`);
      continue;
    }
    if (dir !== 'E' && dir !== 'S') problems.push(`Road ${r.id} must run from its west/north node to its east/south node`);
    if (r.lanes[0] < 0 || r.lanes[1] < 0 || r.lanes[0] + r.lanes[1] === 0) problems.push(`Road ${r.id} has no lanes`);
    for (const [node, d] of [
      [a, dir],
      [b, OPPOSITE[dir]],
    ] as const) {
      let m = arms.get(node.id);
      if (!m) arms.set(node.id, (m = new Map()));
      if (m.has(d)) problems.push(`Node ${node.id} has two roads on its ${d} arm`);
      m.set(d, r.id);
    }
    if (r.midblockCrossing !== undefined && (r.midblockCrossing <= 0.1 || r.midblockCrossing >= 0.9)) {
      problems.push(`Road ${r.id}: mid-block crossing must be between 0.1 and 0.9`);
    }
  }
  const roadById = new Map(map.roads.map((r) => [r.id, r]));
  for (const n of map.nodes) {
    const m = arms.get(n.id);
    const count = m ? m.size : 0;
    if (count < 2) problems.push(`Node ${n.id} is a dead end (${count} arm)`);
    if (n.control === 'none') {
      if (count !== 2) problems.push(`Node ${n.id}: control 'none' needs exactly 2 arms`);
    }
    if (n.control === 'roundabout' && m) {
      for (const id of m.values()) {
        const r = roadById.get(id)!;
        if (r.lanes[0] !== 1 || r.lanes[1] !== 1) problems.push(`Roundabout ${n.id}: road ${id} must have lanes [1, 1]`);
        if (r.parkingStrip) problems.push(`Roundabout ${n.id}: road ${id} must not have parking strips`);
      }
    }
    if ((n.control === 'stop_minor' || n.control === 'yield_minor' || n.control === 'allway_stop') && !n.minorAxis) {
      problems.push(`Node ${n.id}: control '${n.control}' needs a minorAxis`);
    }
    if ((n.control === 'stop_minor' || n.control === 'yield_minor') && m && n.minorAxis) {
      const hasMinor = [...m.keys()].some((d) => AXIS_OF[d] === n.minorAxis);
      const hasMajor = [...m.keys()].some((d) => AXIS_OF[d] !== n.minorAxis);
      if (!hasMinor || !hasMajor) problems.push(`Node ${n.id}: needs arms on both the minor and the major axis`);
    }
  }
  for (const z of map.zones) {
    if (!roadById.has(z.roadId)) problems.push(`Zone ${z.id} joins unknown road ${z.roadId}`);
    const ids = new Set<string>();
    for (const b of z.bays) {
      if (ids.has(b.id)) problems.push(`Zone ${z.id}: duplicate bay ${b.id}`);
      ids.add(b.id);
      if (!rectContains(z.rect, b.pose)) problems.push(`Zone ${z.id}: bay ${b.id} is outside the lot`);
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Build                                                                      */
/* -------------------------------------------------------------------------- */

interface RoadRuntime {
  geom: RoadGeom;
  info: RoadInfo;
  /** Unit vector a→b and its right-hand vector. */
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  /** Each lane with the offset of its centre to the right of a→b. */
  lanes: { lane: LaneInfo; r: number; ab: boolean }[];
}

function endControlFor(control: ControlType, role: NodeArm['role']): LaneEndControl {
  switch (control) {
    case 'signal':
      return 'signal';
    case 'allway_stop':
      return 'stop';
    case 'stop_minor':
      return role === 'minor' ? 'stop' : 'none';
    case 'yield_minor':
      return role === 'minor' ? 'yield' : 'none';
    case 'roundabout':
      return 'yield';
    default:
      return 'none';
  }
}

export function buildRoadNetwork(map: MapDef, profile: NetworkProfile): BuiltNetwork {
  const problems = validateMap(map);
  if (problems.length) throw new Error(`Invalid map ${map.id}:\n - ${problems.join('\n - ')}`);

  const side: DrivingSide = profile.drivingSide;
  const kerbSign: 1 | -1 = side === 'right' ? 1 : -1;
  const controlOf = (n: MapNodeDef): ControlType =>
    n.control === 'allway_stop' && !profile.rules.allWayStops ? 'yield_minor' : n.control;
  const layout = deriveLayout(map, controlOf);

  const roads = new Map<string, RoadInfo>();
  const lanes = new Map<string, LaneInfo>();
  const nodes = new Map<string, NodeInfo>();
  const crosswalks = new Map<string, CrosswalkInfo>();
  const connectors = new Map<string, ConnectorInfo>();
  const connectorHeadings = new Map<string, number[]>();
  const roadRt = new Map<string, RoadRuntime>();

  /* ---- nodes (arms are filled in while creating lanes) ---- */
  for (const g of layout.nodes.values()) {
    const minorAxis = g.def.minorAxis ?? null;
    const arms: Partial<Record<Compass, NodeArm>> = {};
    for (const a of g.armList) {
      const role: NodeArm['role'] =
        g.control === 'stop_minor' || g.control === 'yield_minor' ? (AXIS_OF[a.dir] === minorAxis ? 'minor' : 'major') : 'equal';
      arms[a.dir] = { dir: a.dir, roadId: a.road.def.id, role, incoming: [], outgoing: [], stopLine: null, setback: a.setback };
    }
    nodes.set(g.def.id, {
      id: g.def.id,
      pos: { x: g.def.x, z: g.def.z },
      control: g.control,
      declaredControl: g.def.control,
      minorAxis,
      arms,
      radius: 0,
      roundabout: g.roundabout ? { islandRadius: g.roundabout.island, outerRadius: g.roundabout.outer } : null,
      crosswalkIds: [],
      connectorIds: [],
    });
  }

  /* ---- roads and lanes ---- */
  for (const g of layout.roads.values()) {
    const def = g.def;
    const speedLimit = toMps(profile.speedLimits[def.speedClass], profile.speedUnit);
    const info: RoadInfo & { strip: { from: number; to: number } | null; setbackA: number; setbackB: number } = {
      id: def.id,
      name: def.name,
      a: def.a,
      b: def.b,
      axis: g.axis,
      start: { x: g.a.x, z: g.a.z },
      end: { x: g.b.x, z: g.b.z },
      lanesAB: [],
      lanesBA: [],
      laneWidth: LANE_WIDTH,
      carriagewayWidth: g.half * 2,
      parkingStripWidth: g.kerbOffset - g.half,
      kerbOffset: g.kerbOffset,
      sidewalkWidth: SIDEWALK_WIDTH,
      speedClass: def.speedClass,
      speedLimit,
      oneWay: def.lanes[0] === 0 || def.lanes[1] === 0,
      strip: g.strip,
      setbackA: g.setbackA,
      setbackB: g.setbackB,
    };
    roads.set(def.id, info);
    const f = COMPASS_VEC[g.dir];
    const rAB = rightOf(COMPASS_HEADING[g.dir]);
    const rt: RoadRuntime = { geom: g, info, fx: f.x, fz: f.z, rx: rAB.x, rz: rAB.z, lanes: [] };
    roadRt.set(def.id, rt);

    const laneLength = g.length - g.setbackA - g.setbackB;
    if (laneLength < MIN_LANE_LENGTH) throw new Error(`Road ${def.id} is too short for its junctions`);

    for (const ab of [true, false]) {
      const nSame = ab ? def.lanes[0] : def.lanes[1];
      const nOpp = ab ? def.lanes[1] : def.lanes[0];
      const travel: Compass = ab ? g.dir : OPPOSITE[g.dir];
      const heading = COMPASS_HEADING[travel];
      const fwd = forwardOf(heading);
      const right = rightOf(heading);
      const fromNode = ab ? g.a : g.b;
      const toNode = ab ? g.b : g.a;
      const setFrom = ab ? g.setbackA : g.setbackB;
      const toInfo = nodes.get(toNode.id)!;
      const fromInfo = nodes.get(fromNode.id)!;
      const armTo = toInfo.arms[OPPOSITE[travel]]!;
      const armFrom = fromInfo.arms[travel]!;
      const ids: string[] = [];
      for (let i = 0; i < nSame; i++) {
        const id = `${def.id}:${ab ? 'ab' : 'ba'}:${i}`;
        // Offset of the lane centre to the right of its own direction of travel.
        const r = kerbSign * (((nOpp - nSame) * LANE_WIDTH) / 2 + (i + 0.5) * LANE_WIDTH);
        const start = { x: fromNode.x + fwd.x * setFrom + right.x * r, z: fromNode.z + fwd.z * setFrom + right.z * r };
        const end = { x: start.x + fwd.x * laneLength, z: start.z + fwd.z * laneLength };
        let midblock: LaneInfo['midblock'] = null;
        if (def.midblockCrossing !== undefined) {
          const fromA = def.midblockCrossing * g.length;
          const s = ab ? fromA - g.setbackA : g.length - g.setbackB - fromA;
          midblock = {
            crosswalkId: `xw:mid:${def.id}`,
            stopS: s - CROSSWALK_WIDTH / 2 - MIDBLOCK_STOP_GAP,
            endS: s + CROSSWALK_WIDTH / 2,
          };
          if (midblock.stopS < MIDBLOCK_MIN_CLEARANCE || laneLength - midblock.endS < MIDBLOCK_MIN_CLEARANCE) {
            throw new Error(`Road ${def.id}: mid-block crossing is too close to a junction`);
          }
        }
        const lane: LaneInfo = {
          id,
          roadId: def.id,
          from: fromNode.id,
          to: toNode.id,
          travel,
          arrivalArm: OPPOSITE[travel],
          index: i,
          laneCount: nSame,
          start,
          end,
          heading,
          length: laneLength,
          width: LANE_WIDTH,
          speedLimit,
          speedClass: def.speedClass,
          endControl: endControlFor(toInfo.control, armTo.role),
          connectors: [],
          incoming: [],
          innerNeighbour: i > 0 ? `${def.id}:${ab ? 'ab' : 'ba'}:${i - 1}` : null,
          outerNeighbour: i + 1 < nSame ? `${def.id}:${ab ? 'ab' : 'ba'}:${i + 1}` : null,
          midblock,
        };
        lanes.set(id, lane);
        ids.push(id);
        rt.lanes.push({ lane, r: ab ? r : -r, ab });
        armTo.incoming.push(id);
        armFrom.outgoing.push(id);
      }
      if (ab) info.lanesAB = ids;
      else info.lanesBA = ids;

      // Stop line across the incoming lanes of the destination node.
      if (nSame > 0 && toInfo.control !== 'none') {
        const first = lanes.get(ids[0]!)!;
        const last = lanes.get(ids[ids.length - 1]!)!;
        const half = LANE_WIDTH / 2;
        armTo.stopLine = {
          a: { x: first.end.x - right.x * kerbSign * half, z: first.end.z - right.z * kerbSign * half },
          b: { x: last.end.x + right.x * kerbSign * half, z: last.end.z + right.z * kerbSign * half },
        };
      }
    }

    if (def.midblockCrossing !== undefined) {
      const d = def.midblockCrossing * g.length;
      const inStrip = g.strip && d >= g.strip.from && d <= g.strip.to;
      const edge = inStrip ? g.kerbOffset : g.half;
      const cx = g.a.x + f.x * d;
      const cz = g.a.z + f.z * d;
      crosswalks.set(`xw:mid:${def.id}`, {
        id: `xw:mid:${def.id}`,
        kind: 'midblock',
        nodeId: null,
        arm: null,
        roadId: def.id,
        a: { x: cx - rAB.x * edge, z: cz - rAB.z * edge },
        b: { x: cx + rAB.x * edge, z: cz + rAB.z * edge },
        width: CROSSWALK_WIDTH,
        signalised: false,
      });
    }
  }

  /* ---- junction crosswalks ---- */
  for (const g of layout.nodes.values()) {
    if (!g.hasCrosswalks) continue;
    const node = nodes.get(g.def.id)!;
    for (const a of g.armList) {
      const d = a.setback - STOP_LINE_GAP - CROSSWALK_WIDTH / 2;
      const cx = g.def.x + a.ux * d;
      const cz = g.def.z + a.uz * d;
      // Perpendicular to the arm.
      const px = -a.uz;
      const pz = a.ux;
      const id = `xw:${g.def.id}:${a.dir}`;
      crosswalks.set(id, {
        id,
        kind: 'junction',
        nodeId: g.def.id,
        arm: a.dir,
        roadId: a.road.def.id,
        a: { x: cx - px * a.half, z: cz - pz * a.half },
        b: { x: cx + px * a.half, z: cz + pz * a.half },
        width: CROSSWALK_WIDTH,
        signalised: g.control === 'signal',
      });
      node.crosswalkIds.push(id);
    }
  }

  /* ---- connectors ---- */
  for (const node of nodes.values()) {
    const built: BuiltConnector[] = buildNodeConnectors(node, lanes, side);
    computeConflicts(built);
    attachCrosswalks(
      built,
      node.crosswalkIds.map((id) => crosswalks.get(id)!),
    );
    let radius = 0;
    for (const arm of Object.values(node.arms)) radius = Math.max(radius, arm.setback);
    for (const { info, headings } of built) {
      connectors.set(info.id, info);
      connectorHeadings.set(info.id, headings);
      node.connectorIds.push(info.id);
      lanes.get(info.from)!.connectors.push(info.id);
      lanes.get(info.to)!.incoming.push(info.id);
      for (const p of info.points) radius = Math.max(radius, Math.hypot(p.x - node.pos.x, p.z - node.pos.z));
    }
    node.radius = radius + 2;
  }

  /* ---- zones, blocks, bounds ---- */
  const zones = new Map<string, ZoneInfo>(map.zones.map((z) => [z.id, z]));
  const blocks: BlockInfo[] = layout.blocks.map((b) => {
    const zone = map.zones.find((z) => rectContains(b.rect, { x: (z.rect.minX + z.rect.maxX) / 2, z: (z.rect.minZ + z.rect.maxZ) / 2 }));
    return { id: b.id, rect: b.rect, inner: b.inner, zoneId: zone ? zone.id : null };
  });
  const bounds: Rect = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const g of layout.nodes.values()) {
    bounds.minX = Math.min(bounds.minX, g.def.x - g.ext.W - SIDEWALK_WIDTH);
    bounds.maxX = Math.max(bounds.maxX, g.def.x + g.ext.E + SIDEWALK_WIDTH);
    bounds.minZ = Math.min(bounds.minZ, g.def.z - g.ext.N - SIDEWALK_WIDTH);
    bounds.maxZ = Math.max(bounds.maxZ, g.def.z + g.ext.S + SIDEWALK_WIDTH);
  }
  const pois = new Map<string, MapPoi>(map.pois.map((p) => [p.id, p]));

  /* ---- spatial lookup: the grid of node coordinates ---- */
  const uniq = (vals: number[]): number[] => [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
  const xs = uniq(map.nodes.map((n) => n.x));
  const zs = uniq(map.nodes.map((n) => n.z));
  const key = (x: number, z: number): string => `${x}|${z}`;
  const nodeAt = new Map<string, NodeGeom>();
  for (const g of layout.nodes.values()) nodeAt.set(key(Math.round(g.def.x * 1000) / 1000, Math.round(g.def.z * 1000) / 1000), g);
  /** Roads indexed by `${axis}|${fixed coordinate}|${index of the lower grid line}`. */
  const roadAt = new Map<string, RoadRuntime>();
  for (const rt of roadRt.values()) {
    const g = rt.geom;
    if (g.axis === 'EW') roadAt.set(`EW|${g.a.z}|${xs.indexOf(Math.round(Math.min(g.a.x, g.b.x) * 1000) / 1000)}`, rt);
    else roadAt.set(`NS|${g.a.x}|${zs.indexOf(Math.round(Math.min(g.a.z, g.b.z) * 1000) / 1000)}`, rt);
  }
  const nearestIndex = (vals: number[], v: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < vals.length; i++) {
      const d = Math.abs(vals[i]! - v);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };
  const lowerIndex = (vals: number[], v: number): number => {
    let i = 0;
    while (i + 1 < vals.length - 1 && vals[i + 1]! <= v) i++;
    return i;
  };

  const hit = newPolylineHit();
  const OFFROAD: SurfaceLocation = { kind: 'offroad' };

  /**
   * The driveway where it crosses the sidewalk, including the flared apron (widest at the kerb).
   * Driveways run north–south and meet an east–west road at one end.
   */
  function onDrivewayApron(zone: ZoneInfo, x: number, z: number): boolean {
    const d = zone.driveway;
    if (z < d.minZ || z > d.maxZ) return false;
    if (x >= d.minX && x <= d.maxX) return true;
    const road = roads.get(zone.roadId);
    if (!road || road.axis !== 'EW') return false;
    const mouthZ = Math.abs(d.minZ - road.start.z) < Math.abs(d.maxZ - road.start.z) ? d.minZ : d.maxZ;
    const depth = Math.abs(z - mouthZ) / SIDEWALK_WIDTH;
    if (depth > 1) return false;
    const flare = DRIVEWAY_FLARE * (1 - depth);
    return x >= d.minX - flare && x <= d.maxX + flare;
  }

  function locateOnRoad(rt: RoadRuntime, x: number, z: number): SurfaceLocation | null {
    const g = rt.geom;
    const dx = x - g.a.x;
    const dz = z - g.a.z;
    const along = dx * rt.fx + dz * rt.fz;
    if (along < g.setbackA || along > g.length - g.setbackB) return null;
    const r = dx * rt.rx + dz * rt.rz;
    const ar = Math.abs(r);
    if (ar > g.band) return null;
    if (ar <= g.half + 1e-9) {
      for (const entry of rt.lanes) {
        if (Math.abs(r - entry.r) <= LANE_WIDTH / 2 + 1e-9) {
          return entry.ab
            ? { kind: 'lane', road: rt.info, lane: entry.lane, s: along - g.setbackA, lateral: r - entry.r }
            : { kind: 'lane', road: rt.info, lane: entry.lane, s: g.length - g.setbackB - along, lateral: entry.r - r };
        }
      }
      return null;
    }
    if (ar <= g.kerbOffset && g.strip && along >= g.strip.from && along <= g.strip.to) {
      // The kerb-most lane on this side of the road.
      let best: RoadRuntime['lanes'][number] | null = null;
      for (const entry of rt.lanes) {
        if (Math.sign(entry.r) === Math.sign(r) && (!best || Math.abs(entry.r) > Math.abs(best.r))) best = entry;
      }
      if (!best) for (const entry of rt.lanes) if (!best || Math.abs(entry.r - r) < Math.abs(best.r - r)) best = entry;
      if (best) {
        return best.ab
          ? { kind: 'parking_strip', road: rt.info, lane: best.lane, s: along - g.setbackA, lateral: r - best.r }
          : { kind: 'parking_strip', road: rt.info, lane: best.lane, s: g.length - g.setbackB - along, lateral: best.r - r };
      }
    }
    for (const zone of zones.values()) if (onDrivewayApron(zone, x, z)) return { kind: 'zone', zone, onDriveway: true };
    return { kind: 'sidewalk', road: rt.info };
  }

  function locate(p: Vec2): SurfaceLocation {
    const { x, z } = p;
    const xi = nearestIndex(xs, x);
    const zi = nearestIndex(zs, z);

    // 1. The junction around the nearest grid point.
    const g = nodeAt.get(key(xs[xi]!, zs[zi]!));
    if (g) {
      const lx = x - g.def.x;
      const lz = z - g.def.z;
      if (inNodeBox(g, lx, lz)) {
        const code = classifyNodePoint(g, lx, lz);
        if (code === NODE_PAVED) {
          const node = nodes.get(g.def.id)!;
          let best: ConnectorInfo | null = null;
          let bestD = CONNECTOR_SNAP_DISTANCE * CONNECTOR_SNAP_DISTANCE;
          let bestS = 0;
          let bestLat = 0;
          for (const id of node.connectorIds) {
            const c = connectors.get(id)!;
            nearestOnPolyline(x, z, c.points, c.cumulative, hit);
            if (hit.distSq < bestD) {
              bestD = hit.distSq;
              best = c;
              bestS = hit.s;
              bestLat = hit.lateral;
            }
          }
          return { kind: 'junction', node, connector: best, s: bestS, lateral: bestLat };
        }
        if (code === NODE_ISLAND) return OFFROAD;
        if (code === NODE_SIDEWALK) return { kind: 'sidewalk', road: null };
        if (code >= NODE_SIDEWALK_ARM) return { kind: 'sidewalk', road: roads.get(g.armList[code - NODE_SIDEWALK_ARM]!.road.def.id)! };
        if (code !== NODE_OUTSIDE) return OFFROAD;
      }
    }

    // 2. The two roads that can contain the point: along the nearest row and the nearest column.
    const ew = roadAt.get(`EW|${zs[zi]}|${lowerIndex(xs, x)}`);
    if (ew) {
      const loc = locateOnRoad(ew, x, z);
      if (loc) return loc;
    }
    const ns = roadAt.get(`NS|${xs[xi]}|${lowerIndex(zs, z)}`);
    if (ns) {
      const loc = locateOnRoad(ns, x, z);
      if (loc) return loc;
    }

    // 3. Car parks.
    for (const zone of zones.values()) {
      if (rectContains(zone.rect, p)) return { kind: 'zone', zone, onDriveway: false };
      if (rectContains(zone.driveway, p)) return { kind: 'zone', zone, onDriveway: true };
    }
    return OFFROAD;
  }

  function lanePose(laneId: string, s: number, lateral = 0): Pose {
    const lane = lanes.get(laneId);
    if (!lane) throw new Error(`Unknown lane ${laneId}`);
    const d = clamp(s, 0, lane.length);
    const f = forwardOf(lane.heading);
    const r = rightOf(lane.heading);
    return { x: lane.start.x + f.x * d + r.x * lateral, z: lane.start.z + f.z * d + r.z * lateral, heading: lane.heading };
  }

  function connectorPose(connectorId: string, s: number): Pose {
    const c = connectors.get(connectorId);
    if (!c) throw new Error(`Unknown connector ${connectorId}`);
    return poseOnPath(c.points, connectorHeadings.get(connectorId)!, c.cumulative, s);
  }

  function nearestLane(p: Vec2, maxDist = Infinity): { lane: LaneInfo; s: number; lateral: number } | null {
    let best: LaneInfo | null = null;
    let bestD = maxDist;
    let bestS = 0;
    let bestLat = 0;
    for (const lane of lanes.values()) {
      const f = forwardOf(lane.heading);
      const dx = p.x - lane.start.x;
      const dz = p.z - lane.start.z;
      const s = clamp(dx * f.x + dz * f.z, 0, lane.length);
      const qx = dx - f.x * s;
      const qz = dz - f.z * s;
      const d = Math.hypot(qx, qz);
      if (d < bestD) {
        bestD = d;
        best = lane;
        bestS = s;
        const r = rightOf(lane.heading);
        bestLat = qx * r.x + qz * r.z;
      }
    }
    return best ? { lane: best, s: bestS, lateral: bestLat } : null;
  }

  return {
    map,
    side,
    kerbSign,
    layout,
    bounds,
    nodes,
    roads,
    lanes,
    connectors,
    crosswalks,
    zones,
    blocks,
    pois,
    locate,
    lanePose,
    connectorPose,
    nearestLane,
  };
}
