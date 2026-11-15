/**
 * Side-independent geometry of a map: how wide each road is, where each
 * junction's stop lines sit, the shape of the paved junction surface (kerb
 * fillets, rounded bends, roundabout rings) and the city blocks in between.
 *
 * Nothing in here depends on which side of the road traffic keeps to, so the
 * same layout serves `validateMap` and `buildRoadNetwork`.
 *
 * Junction surface model (node-relative coordinates, x east, z south):
 *  - every arm contributes a rectangle of carriageway from the node centre out
 *    to its stop line (the "setback");
 *  - where two arms meet at a corner the kerb is a quarter circle, tangent to
 *    both carriageway edges, whose radius is the room left before the nearer
 *    stop line. A kerb-side turn follows that curve one half lane out;
 *  - a bend (two arms at right angles) also rounds its outer kerb;
 *  - a roundabout is the ring between the island and the outer radius plus the
 *    throat of each arm out to its give-way line.
 */
import {
  CROSSWALK_WIDTH,
  LANE_WIDTH,
  PARKING_STRIP_WIDTH,
  ROUNDABOUT_ISLAND_RADIUS,
  ROUNDABOUT_LANE_WIDTH,
  SIDEWALK_WIDTH,
  STOP_LINE_GAP,
} from '../core/constants';
import { COMPASS_VEC, OPPOSITE } from '../core/math';
import type { Compass, ControlType, MapDef, MapNodeDef, MapRoadDef, Rect, Vec2 } from '../core/types';
import {
  CROSSWALK_GAP,
  KERB_CORNER_ALLOWANCE,
  MIN_SETBACK,
  PARKING_STRIP_CLEARANCE,
  ROUNDABOUT_YIELD_GAP,
  UNMARKED_LINE_GAP,
} from './dims';

export const COMPASS_ORDER: readonly Compass[] = ['N', 'E', 'S', 'W'];
export const AXIS_OF: Record<Compass, 'NS' | 'EW'> = { N: 'NS', S: 'NS', E: 'EW', W: 'EW' };

const EPS = 1e-6;

/** Compass direction from `a` to `b` when they are axis-aligned and distinct, else null. */
export function compassBetween(a: Vec2, b: Vec2): Compass | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) < EPS && Math.abs(dz) > EPS) return dz > 0 ? 'S' : 'N';
  if (Math.abs(dz) < EPS && Math.abs(dx) > EPS) return dx > 0 ? 'E' : 'W';
  return null;
}

export interface RoadGeom {
  def: MapRoadDef;
  a: MapNodeDef;
  b: MapNodeDef;
  axis: 'NS' | 'EW';
  /** Compass direction of travel from `a` to `b`. */
  dir: Compass;
  length: number;
  /** Half the width of the travel lanes. */
  half: number;
  /** Axis to kerb where the road has parking strips (= `half` where it has none). */
  kerbOffset: number;
  /** Axis to the back of the sidewalk. */
  band: number;
  /** Distance from node `a` / node `b` to the stop line on this road. */
  setbackA: number;
  setbackB: number;
  /** Extent of the parking strips as distances from node `a`, or null. */
  strip: { from: number; to: number } | null;
}

export interface ArmGeom {
  dir: Compass;
  road: RoadGeom;
  /** True when the node is the road's `a` end. */
  atA: boolean;
  /** Unit vector from the node centre along the arm. */
  ux: number;
  uz: number;
  half: number;
  band: number;
  setback: number;
}

/** Quarter-circle kerb between two adjacent arms. Coordinates are node-relative. */
export interface KerbFillet {
  /** Quadrant of the corner: `sx` = +1 east / −1 west, `sz` = +1 south / −1 north. */
  sx: number;
  sz: number;
  /** Where the two carriageway edges would meet without the fillet. */
  kx: number;
  kz: number;
  radius: number;
  /** Centre of the kerb arc; the pavement is OUTSIDE the arc. */
  cx: number;
  cz: number;
}

/** Rounded outer kerb of a bend. The pavement is INSIDE the arc. */
export interface BendOuter {
  /** Quadrant of the inside of the bend (same convention as `KerbFillet`). */
  sx: number;
  sz: number;
  cx: number;
  cz: number;
  radius: number;
}

export interface NodeGeom {
  def: MapNodeDef;
  /** Effective control (after any jurisdiction mapping). */
  control: ControlType;
  arms: Partial<Record<Compass, ArmGeom>>;
  /** Arms in N, E, S, W order. */
  armList: ArmGeom[];
  hasCrosswalks: boolean;
  roundabout: { island: number; mid: number; outer: number } | null;
  /** Half extents of the central box where the carriageways overlap. */
  boxX: number;
  boxZ: number;
  fillets: KerbFillet[];
  bend: BendOuter | null;
  /** How far the node's own area (junction surface + its sidewalks) reaches in each direction. */
  ext: Record<Compass, number>;
}

export interface BlockGeom {
  id: string;
  rect: Rect;
  inner: Rect;
  /** Bounding roads. */
  north: RoadGeom;
  south: RoadGeom;
  west: RoadGeom;
  east: RoadGeom;
  /** Corner node ids: north-west, north-east, south-west, south-east. */
  corners: [string, string, string, string];
}

export interface Layout {
  roads: Map<string, RoadGeom>;
  nodes: Map<string, NodeGeom>;
  blocks: BlockGeom[];
}

/** Marked crosswalks are painted on every arm of these junction types. */
export const hasMarkedCrosswalks = (control: ControlType): boolean => control === 'signal' || control === 'allway_stop';

/**
 * Derive the layout. The map must already have passed the structural checks in
 * `validateMap` (known node ids, axis-aligned roads, one road per arm).
 */
export function deriveLayout(map: MapDef, controlOf: (node: MapNodeDef) => ControlType): Layout {
  const nodes = new Map<string, NodeGeom>();
  for (const def of map.nodes) {
    const control = controlOf(def);
    nodes.set(def.id, {
      def,
      control,
      arms: {},
      armList: [],
      hasCrosswalks: hasMarkedCrosswalks(control),
      roundabout:
        control === 'roundabout'
          ? {
              island: ROUNDABOUT_ISLAND_RADIUS,
              mid: ROUNDABOUT_ISLAND_RADIUS + ROUNDABOUT_LANE_WIDTH / 2,
              outer: ROUNDABOUT_ISLAND_RADIUS + ROUNDABOUT_LANE_WIDTH,
            }
          : null,
      boxX: 0,
      boxZ: 0,
      fillets: [],
      bend: null,
      ext: { N: 0, E: 0, S: 0, W: 0 },
    });
  }

  const roads = new Map<string, RoadGeom>();
  for (const def of map.roads) {
    const a = nodes.get(def.a)!;
    const b = nodes.get(def.b)!;
    const dir = compassBetween(a.def, b.def)!;
    const half = ((def.lanes[0] + def.lanes[1]) * LANE_WIDTH) / 2;
    const kerbOffset = half + (def.parkingStrip ? PARKING_STRIP_WIDTH : 0);
    const road: RoadGeom = {
      def,
      a: a.def,
      b: b.def,
      axis: AXIS_OF[dir],
      dir,
      length: Math.hypot(b.def.x - a.def.x, b.def.z - a.def.z),
      half,
      kerbOffset,
      band: kerbOffset + SIDEWALK_WIDTH,
      setbackA: 0,
      setbackB: 0,
      strip: null,
    };
    roads.set(def.id, road);
    a.arms[dir] = makeArm(dir, road, true);
    b.arms[OPPOSITE[dir]] = makeArm(OPPOSITE[dir], road, false);
  }

  for (const node of nodes.values()) finishNode(node);

  for (const road of roads.values()) {
    road.setbackA = nodes.get(road.a.id)!.arms[road.dir]!.setback;
    road.setbackB = nodes.get(road.b.id)!.arms[OPPOSITE[road.dir]]!.setback;
    if (road.def.parkingStrip) {
      const from = road.setbackA + PARKING_STRIP_CLEARANCE;
      const to = road.length - road.setbackB - PARKING_STRIP_CLEARANCE;
      road.strip = to > from ? { from, to } : null;
    }
  }

  return { roads, nodes, blocks: deriveBlocks(map, roads) };
}

function makeArm(dir: Compass, road: RoadGeom, atA: boolean): ArmGeom {
  const u = COMPASS_VEC[dir];
  return { dir, road, atA, ux: u.x, uz: u.z, half: road.half, band: road.band, setback: 0 };
}

function finishNode(node: NodeGeom): void {
  node.armList = COMPASS_ORDER.map((d) => node.arms[d]).filter((a): a is ArmGeom => a !== undefined);
  const onAxis = (axis: 'NS' | 'EW'): ArmGeom[] => node.armList.filter((a) => AXIS_OF[a.dir] === axis);
  const widest = (arms: ArmGeom[], key: 'half' | 'band'): number => arms.reduce((m, a) => Math.max(m, a[key]), 0);
  const ns = onAxis('NS');
  const ew = onAxis('EW');

  for (const arm of node.armList) {
    const crossing = AXIS_OF[arm.dir] === 'NS' ? ew : ns;
    if (node.roundabout) arm.setback = node.roundabout.outer + ROUNDABOUT_YIELD_GAP;
    else if (crossing.length === 0) arm.setback = MIN_SETBACK;
    else {
      arm.setback =
        widest(crossing, 'half') +
        (node.hasCrosswalks
          ? CROSSWALK_GAP + CROSSWALK_WIDTH + STOP_LINE_GAP
          : KERB_CORNER_ALLOWANCE + UNMARKED_LINE_GAP);
    }
  }

  node.boxX = widest(ns, 'half');
  node.boxZ = widest(ew, 'half');

  for (const dir of COMPASS_ORDER) {
    const arm = node.arms[dir];
    if (arm) node.ext[dir] = arm.setback;
    else if (node.roundabout) node.ext[dir] = node.roundabout.outer + SIDEWALK_WIDTH;
    else node.ext[dir] = widest(AXIS_OF[dir] === 'NS' ? ew : ns, 'band');
  }

  if (node.roundabout) return;

  for (const nsArm of ns) {
    for (const ewArm of ew) {
      const sx = ewArm.dir === 'E' ? 1 : -1;
      const sz = nsArm.dir === 'S' ? 1 : -1;
      const radius = Math.min(ewArm.setback - nsArm.half, nsArm.setback - ewArm.half);
      if (radius <= EPS) continue;
      const kx = sx * nsArm.half;
      const kz = sz * ewArm.half;
      node.fillets.push({ sx, sz, kx, kz, radius, cx: kx + sx * radius, cz: kz + sz * radius });
    }
  }

  if (ns.length === 1 && ew.length === 1) {
    const sx = ew[0].dir === 'E' ? 1 : -1;
    const sz = ns[0].dir === 'S' ? 1 : -1;
    const radius = Math.min(ew[0].setback + ns[0].half, ns[0].setback + ew[0].half);
    node.bend = { sx, sz, radius, cx: sx * (radius - ns[0].half), cz: sz * (radius - ew[0].half) };
  }
}

/* -------------------------------------------------------------------------- */
/* Classifying a point inside a node's own area                               */
/* -------------------------------------------------------------------------- */

/** Not part of the node's surface or sidewalks: block interior, decided by the caller. */
export const NODE_OUTSIDE = -1;
/** Drivable junction surface. */
export const NODE_PAVED = 0;
/** Central island of a roundabout. */
export const NODE_ISLAND = 1;
/** Sidewalk that does not belong to a particular arm (round a bend or a roundabout). */
export const NODE_SIDEWALK = 2;
/** `NODE_SIDEWALK_ARM + i` = sidewalk alongside `armList[i]`. */
export const NODE_SIDEWALK_ARM = 3;

/** True when the node-relative point lies within the node's own rectangle. */
export function inNodeBox(node: NodeGeom, x: number, z: number): boolean {
  return x >= -node.ext.W && x <= node.ext.E && z >= -node.ext.N && z <= node.ext.S;
}

/**
 * Classify a node-relative point that lies inside the node's rectangle.
 * Returns one of the `NODE_*` codes. Allocation free.
 */
export function classifyNodePoint(node: NodeGeom, x: number, z: number): number {
  const rb = node.roundabout;
  const d2 = x * x + z * z;
  if (rb) {
    if (d2 < rb.island * rb.island) return NODE_ISLAND;
    if (d2 <= rb.outer * rb.outer) return NODE_PAVED;
  } else {
    const bend = node.bend;
    if (bend) {
      const ux = (x - bend.cx) * bend.sx;
      const uz = (z - bend.cz) * bend.sz;
      if (ux < 0 && uz < 0) {
        const o2 = ux * ux + uz * uz;
        if (o2 > bend.radius * bend.radius) {
          const outer = bend.radius + SIDEWALK_WIDTH;
          return o2 <= outer * outer ? NODE_SIDEWALK : NODE_OUTSIDE;
        }
      }
    }
    if (Math.abs(x) <= node.boxX && Math.abs(z) <= node.boxZ) return NODE_PAVED;
  }

  let sidewalkArm = -1;
  const arms = node.armList;
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const along = x * arm.ux + z * arm.uz;
    if (along < 0 || along > arm.setback) continue;
    const lateral = Math.abs(x * arm.uz - z * arm.ux);
    if (lateral <= arm.half) return NODE_PAVED;
    if (lateral <= arm.band && sidewalkArm < 0) sidewalkArm = i;
  }

  if (rb) {
    const outer = rb.outer + SIDEWALK_WIDTH;
    if (d2 <= outer * outer) return NODE_SIDEWALK;
  } else {
    for (let i = 0; i < node.fillets.length; i++) {
      const f = node.fillets[i];
      const qx = (x - f.kx) * f.sx;
      const qz = (z - f.kz) * f.sz;
      if (qx < 0 || qx > f.radius || qz < 0 || qz > f.radius) continue;
      const dx = x - f.cx;
      const dz = z - f.cz;
      if (dx * dx + dz * dz >= f.radius * f.radius) return NODE_PAVED;
    }
  }
  return sidewalkArm >= 0 ? NODE_SIDEWALK_ARM + sidewalkArm : NODE_OUTSIDE;
}

/* -------------------------------------------------------------------------- */
/* Junction outline polygons (for renderers and the debug view)               */
/* -------------------------------------------------------------------------- */

const ARC_STEP = Math.PI / 24;

/** Points on a circle from angle `from` to `to` (map angle: 0 = east, +π/2 = south), endpoints included. */
function arcPoints(cx: number, cz: number, radius: number, from: number, to: number): Vec2[] {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / ARC_STEP));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = from + ((to - from) * i) / steps;
    out.push({ x: cx + radius * Math.cos(a), z: cz + radius * Math.sin(a) });
  }
  return out;
}

/**
 * Closed polygon around the paved junction surface in world coordinates,
 * clockwise seen from above (N → E → S → W). For a roundabout this is the
 * outer boundary (ring plus arm throats); the island is a hole of radius
 * `roundabout.island` around the node centre.
 */
export function nodeOutline(node: NodeGeom): Vec2[] {
  const local = node.roundabout ? roundaboutOutline(node) : node.bend ? bendOutline(node) : junctionOutline(node);
  return local.map((p) => ({ x: node.def.x + p.x, z: node.def.z + p.z }));
}

function junctionOutline(node: NodeGeom): Vec2[] {
  const out: Vec2[] = [];
  // Quadrants in clockwise order. Each is generated walking from its N/S side to its E/W side
  // and reversed where the clockwise walk runs the other way (SE and NW).
  const quadrants: [number, number][] = [
    [1, -1],
    [1, 1],
    [-1, 1],
    [-1, -1],
  ];
  for (const [sx, sz] of quadrants) {
    const nsArm = node.arms[sz < 0 ? 'N' : 'S'];
    const ewArm = node.arms[sx > 0 ? 'E' : 'W'];
    const hx = nsArm ? nsArm.half : node.boxX;
    const hz = ewArm ? ewArm.half : node.boxZ;
    const pts: Vec2[] = [];
    if (nsArm && ewArm) {
      pts.push({ x: sx * hx, z: sz * nsArm.setback });
      const f = node.fillets.find((c) => c.sx === sx && c.sz === sz);
      if (f) {
        // From the tangent point on the N/S arm's edge to the tangent point on the E/W arm's edge.
        const from = Math.atan2(0, -sx);
        const to = Math.atan2(-sz, 0);
        pts.push(...arcPoints(f.cx, f.cz, f.radius, from, from + shortestTurn(from, to)));
      } else {
        pts.push({ x: sx * hx, z: sz * hz });
      }
      pts.push({ x: sx * ewArm.setback, z: sz * hz });
    } else if (nsArm) {
      pts.push({ x: sx * hx, z: sz * nsArm.setback }, { x: sx * hx, z: 0 });
    } else if (ewArm) {
      pts.push({ x: 0, z: sz * hz }, { x: sx * ewArm.setback, z: sz * hz });
    } else {
      pts.push({ x: sx * hx, z: sz * hz });
    }
    if (sx * sz > 0) pts.reverse();
    out.push(...pts);
  }
  return dedupe(out);
}

function bendOutline(node: NodeGeom): Vec2[] {
  const bend = node.bend!;
  const { sx, sz } = bend;
  const nsArm = node.arms[sz < 0 ? 'N' : 'S']!;
  const ewArm = node.arms[sx > 0 ? 'E' : 'W']!;
  const fillet = node.fillets[0];
  const pts: Vec2[] = [];
  // E/W arm end (outer side), outer kerb arc, N/S arm end, inner fillet, back to the E/W arm end.
  pts.push({ x: sx * ewArm.setback, z: -sz * ewArm.half });
  {
    const from = Math.atan2(-sz, 0);
    const to = Math.atan2(0, -sx);
    pts.push(...arcPoints(bend.cx, bend.cz, bend.radius, from, from + shortestTurn(from, to)));
  }
  pts.push({ x: -sx * nsArm.half, z: sz * nsArm.setback }, { x: sx * nsArm.half, z: sz * nsArm.setback });
  if (fillet) {
    const from = Math.atan2(0, -sx);
    const to = Math.atan2(-sz, 0);
    pts.push(...arcPoints(fillet.cx, fillet.cz, fillet.radius, from, from + shortestTurn(from, to)));
  } else {
    pts.push({ x: sx * nsArm.half, z: sz * ewArm.half });
  }
  pts.push({ x: sx * ewArm.setback, z: sz * ewArm.half });
  const out = dedupe(pts);
  return signedArea(out) < 0 ? out.reverse() : out;
}

function roundaboutOutline(node: NodeGeom): Vec2[] {
  const rb = node.roundabout!;
  // Map angle of each compass direction (0 = east, clockwise positive because z points south).
  const angleOf: Record<Compass, number> = { E: 0, S: Math.PI / 2, W: Math.PI, N: (3 * Math.PI) / 2 };
  const arms = node.armList;
  const out: Vec2[] = [];
  for (let i = 0; i < arms.length; i++) {
    const arm = arms[i];
    const next = arms[(i + 1) % arms.length];
    const along = Math.sqrt(rb.outer * rb.outer - arm.half * arm.half);
    // Clockwise-side unit vector of the arm (N → east, E → south …).
    const cx = -arm.uz;
    const cz = arm.ux;
    out.push(
      { x: arm.ux * along - cx * arm.half, z: arm.uz * along - cz * arm.half },
      { x: arm.ux * arm.setback - cx * arm.half, z: arm.uz * arm.setback - cz * arm.half },
      { x: arm.ux * arm.setback + cx * arm.half, z: arm.uz * arm.setback + cz * arm.half },
      { x: arm.ux * along + cx * arm.half, z: arm.uz * along + cz * arm.half },
    );
    const from = angleOf[arm.dir] + Math.asin(arm.half / rb.outer);
    let to = angleOf[next.dir] - Math.asin(next.half / rb.outer);
    while (to <= from) to += 2 * Math.PI;
    const ring = arcPoints(0, 0, rb.outer, from, to);
    out.push(...ring.slice(1, -1));
  }
  return dedupe(out);
}

/** Signed turn from angle `from` to `to` by the shorter way round. */
function shortestTurn(from: number, to: number): number {
  let d = (to - from) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/** Twice the signed area; positive for a clockwise polygon in map view (x east, z south). */
function signedArea(points: readonly Vec2[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum;
}

function dedupe(points: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.abs(prev.x - p.x) > 1e-9 || Math.abs(prev.z - p.z) > 1e-9) out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.abs(first.x - last.x) < 1e-9 && Math.abs(first.z - last.z) < 1e-9) out.pop();
  return out;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                     */
/* -------------------------------------------------------------------------- */

/** One block per grid cell whose four sides are all roads. */
function deriveBlocks(map: MapDef, roads: Map<string, RoadGeom>): BlockGeom[] {
  const key = (x: number, z: number): string => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const nodeAt = new Map(map.nodes.map((n) => [key(n.x, n.z), n]));
  const roadBetween = new Map<string, RoadGeom>();
  for (const road of roads.values()) {
    roadBetween.set(`${road.a.id}|${road.b.id}`, road);
    roadBetween.set(`${road.b.id}|${road.a.id}`, road);
  }
  const unique = (values: number[]): number[] =>
    [...values].sort((p, q) => p - q).filter((v, i, all) => i === 0 || v - all[i - 1] > EPS);
  const xs = unique(map.nodes.map((n) => n.x));
  const zs = unique(map.nodes.map((n) => n.z));

  const blocks: BlockGeom[] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const nw = nodeAt.get(key(xs[i], zs[j]));
      const ne = nodeAt.get(key(xs[i + 1], zs[j]));
      const sw = nodeAt.get(key(xs[i], zs[j + 1]));
      const se = nodeAt.get(key(xs[i + 1], zs[j + 1]));
      if (!nw || !ne || !sw || !se) continue;
      const north = roadBetween.get(`${nw.id}|${ne.id}`);
      const south = roadBetween.get(`${sw.id}|${se.id}`);
      const west = roadBetween.get(`${nw.id}|${sw.id}`);
      const east = roadBetween.get(`${ne.id}|${se.id}`);
      if (!north || !south || !west || !east) continue;
      const rect: Rect = {
        minX: xs[i] + west.kerbOffset,
        maxX: xs[i + 1] - east.kerbOffset,
        minZ: zs[j] + north.kerbOffset,
        maxZ: zs[j + 1] - south.kerbOffset,
      };
      const inner: Rect = {
        minX: rect.minX + SIDEWALK_WIDTH,
        maxX: rect.maxX - SIDEWALK_WIDTH,
        minZ: rect.minZ + SIDEWALK_WIDTH,
        maxZ: rect.maxZ - SIDEWALK_WIDTH,
      };
      blocks.push({ id: `${nw.id}-${se.id}`, rect, inner, north, south, west, east, corners: [nw.id, ne.id, sw.id, se.id] });
    }
  }
  return blocks;
}
