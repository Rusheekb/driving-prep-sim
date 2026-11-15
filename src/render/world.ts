/**
 * The static town: asphalt, raised sidewalk slabs with kerbs, road markings,
 * signs, traffic lights, buildings, trees and street lamps. Everything is
 * generated from the road network, so both driving sides and every sign family
 * come out right without any hand-placed geometry.
 */
import * as THREE from 'three';
import { CROSSWALK_WIDTH, KERB_HEIGHT, LANE_WIDTH, SIDEWALK_WIDTH } from '../core/constants';
import { COMPASS_VEC, forwardOf, rightOf } from '../core/math';
import { fromMps } from '../core/units';
import type { EnvironmentState, JurisdictionProfile, LaneInfo, SimContext, Vec2 } from '../core/types';
import { type SignKind, signAspect, signDataUrl, signStyleFor, signSvg } from '../signs';
import type { BlockGeom, NodeGeom } from '../world/layout';
import type { BuiltNetwork } from '../world/network';
import type { SceneryLayout } from '../world/scenery';
import { GeoBuilder, arcBetween, circlePoints } from './geo';

export interface WorldView {
  readonly group: THREE.Group;
  /** Per-frame dynamic parts (traffic-light lamps). Cheap. */
  update(ctx: SimContext): void;
  dispose(): void;
}

const COL = {
  asphalt: 0x3f444b,
  strip: 0x4a4f57,
  lot: 0x474c54,
  sidewalk: 0xb9b5ab,
  kerb: 0xd2cdc3,
  grass: 0x6ea65c,
  park: 0x5d9a50,
  white: 0xf4f4f0,
  yellow: 0xf5c22e,
  pole: 0x6c737c,
  trunk: 0x7a5a3c,
  window: 0x33475f,
};
const Y_MARK = 0.012;
const Y_TOP = KERB_HEIGHT;

/* ------------------------------ block outlines ----------------------------- */

interface Edges {
  n: number;
  s: number;
  w: number;
  e: number;
}

/** Tangent points of a block corner: `h` lies on the horizontal (N/S) edge, `v` on the vertical (E/W) edge. */
function corner(node: NodeGeom, sx: number, sz: number, xEdge: number, zEdge: number, inset: number): Vec2[] {
  const nx = node.def.x;
  const nz = node.def.z;
  if (node.roundabout) {
    const R = node.roundabout.outer + inset;
    const dx = xEdge - nx;
    const dz = zEdge - nz;
    if (dx * dx + dz * dz >= R * R) return [{ x: xEdge, z: zEdge }];
    const h = { x: nx + sx * Math.sqrt(R * R - dz * dz), z: zEdge };
    const v = { x: xEdge, z: nz + sz * Math.sqrt(R * R - dx * dx) };
    return arcBetween({ x: nx, z: nz }, h, v);
  }
  const f = node.fillets.find((c) => c.sx === sx && c.sz === sz);
  const r = f ? f.radius - inset : 0;
  if (!f || r < 0.3 || inset > 0) return [{ x: xEdge, z: zEdge }];
  const c = { x: nx + f.cx, z: nz + f.cz };
  return arcBetween(c, { x: c.x, z: zEdge }, { x: xEdge, z: c.z });
}

/** Closed outline of a block, clockwise in map view, with rounded corners, parking-strip notches and the car-park keyhole. */
function blockOutline(net: BuiltNetwork, block: BlockGeom, edges: Edges, inset: number, notches: boolean, zoneMargin: number): Vec2[] {
  const nodes = net.layout.nodes;
  const [nw, ne, sw, se] = block.corners.map((id) => nodes.get(id)!) as [NodeGeom, NodeGeom, NodeGeom, NodeGeom];
  const pts: Vec2[] = [];
  const zone = [...net.zones.values()].find((z) => z.rect.minX > block.rect.minX && z.rect.maxX < block.rect.maxX && z.rect.minZ > block.rect.minZ && z.rect.maxZ < block.rect.maxZ);

  // NW corner (arrive heading north along the west edge → leave east along the north edge): v → h.
  pts.push(...corner(nw, 1, 1, edges.w, edges.n, inset).reverse());
  if (notches && block.north.strip) {
    const d = block.north.kerbOffset - block.north.half;
    const x1 = block.north.a.x + block.north.strip.from;
    const x2 = block.north.a.x + block.north.strip.to;
    pts.push({ x: x1, z: edges.n }, { x: x1, z: edges.n + d }, { x: x2, z: edges.n + d }, { x: x2, z: edges.n });
  }
  if (zone && Math.abs(zone.driveway.minZ - block.rect.minZ) < 0.5) {
    const m = zoneMargin;
    const dr = zone.driveway;
    const r = zone.rect;
    pts.push(
      { x: dr.minX - m, z: edges.n },
      { x: dr.minX - m, z: r.minZ - m },
      { x: r.minX - m, z: r.minZ - m },
      { x: r.minX - m, z: r.maxZ + m },
      { x: r.maxX + m, z: r.maxZ + m },
      { x: r.maxX + m, z: r.minZ - m },
      { x: dr.maxX + m, z: r.minZ - m },
      { x: dr.maxX + m, z: edges.n },
    );
  }
  // NE corner: h → v.
  pts.push(...corner(ne, -1, 1, edges.e, edges.n, inset));
  if (notches && block.east.strip) {
    const d = block.east.kerbOffset - block.east.half;
    const z1 = block.east.a.z + block.east.strip.from;
    const z2 = block.east.a.z + block.east.strip.to;
    pts.push({ x: edges.e, z: z1 }, { x: edges.e - d, z: z1 }, { x: edges.e - d, z: z2 }, { x: edges.e, z: z2 });
  }
  // SE corner: v → h.
  pts.push(...corner(se, -1, -1, edges.e, edges.s, inset).reverse());
  if (notches && block.south.strip) {
    const d = block.south.kerbOffset - block.south.half;
    const x1 = block.south.a.x + block.south.strip.from;
    const x2 = block.south.a.x + block.south.strip.to;
    pts.push({ x: x2, z: edges.s }, { x: x2, z: edges.s - d }, { x: x1, z: edges.s - d }, { x: x1, z: edges.s });
  }
  // SW corner: h → v.
  pts.push(...corner(sw, 1, -1, edges.w, edges.s, inset));
  if (notches && block.west.strip) {
    const d = block.west.kerbOffset - block.west.half;
    const z1 = block.west.a.z + block.west.strip.from;
    const z2 = block.west.a.z + block.west.strip.to;
    pts.push({ x: edges.w, z: z2 }, { x: edges.w + d, z: z2 }, { x: edges.w + d, z: z1 }, { x: edges.w, z: z1 });
  }
  return pts;
}

/** Outer kerb line of the perimeter roads (clockwise), pushed outward by `offset`. Assumes a rectangular town. */
function perimeterLoop(net: BuiltNetwork, offset: number): Vec2[] {
  const all = [...net.layout.nodes.values()];
  const minX = Math.min(...all.map((n) => n.def.x));
  const maxX = Math.max(...all.map((n) => n.def.x));
  const minZ = Math.min(...all.map((n) => n.def.z));
  const maxZ = Math.max(...all.map((n) => n.def.z));
  const at = (x: number, z: number): NodeGeom => all.find((n) => n.def.x === x && n.def.z === z)!;
  const pts: Vec2[] = [];
  const cornerArc = (n: NodeGeom, order: 'vh' | 'hv'): void => {
    const b = n.bend;
    if (!b) {
      pts.push({ x: n.def.x - (n.def.x === minX ? 1 : -1) * (n.boxX + offset), z: n.def.z - (n.def.z === minZ ? 1 : -1) * (n.boxZ + offset) });
      return;
    }
    const c = { x: n.def.x + b.cx, z: n.def.z + b.cz };
    const R = b.radius + offset;
    const v = { x: c.x - b.sx * R, z: c.z };
    const h = { x: c.x, z: c.z - b.sz * R };
    pts.push(...(order === 'vh' ? arcBetween(c, v, h) : arcBetween(c, h, v)));
  };
  cornerArc(at(minX, minZ), 'vh');
  cornerArc(at(maxX, minZ), 'hv');
  cornerArc(at(maxX, maxZ), 'vh');
  cornerArc(at(minX, maxZ), 'hv');
  return pts;
}

/* ------------------------------- sign atlas -------------------------------- */

const CELL = 256;
const ATLAS_COLS = 8;
const ATLAS_ROWS = 4;

class SignAtlas {
  readonly canvas = document.createElement('canvas');
  readonly texture: THREE.CanvasTexture;
  private readonly cells = new Map<string, { col: number; row: number; aspect: number }>();
  private readonly ctx2d: CanvasRenderingContext2D;
  constructor(private readonly profile: JurisdictionProfile) {
    this.canvas.width = CELL * ATLAS_COLS;
    this.canvas.height = CELL * ATLAS_ROWS;
    this.ctx2d = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
  }
  /** UV rectangle (u0, v0, u1, v1) and aspect of a sign face, drawing it into the atlas on first use. */
  face(kind: SignKind, value?: number): { u0: number; v0: number; u1: number; v1: number; aspect: number } {
    const key = `${kind}:${value ?? ''}`;
    let cell = this.cells.get(key);
    if (!cell) {
      const i = this.cells.size;
      if (i >= ATLAS_COLS * ATLAS_ROWS) throw new Error('Sign atlas is full');
      const style = signStyleFor(this.profile);
      const aspect = signAspect(kind, style);
      cell = { col: i % ATLAS_COLS, row: Math.floor(i / ATLAS_COLS), aspect };
      this.cells.set(key, cell);
      const w = aspect >= 1 ? CELL : Math.round(CELL * aspect);
      const h = aspect >= 1 ? Math.round(CELL / aspect) : CELL;
      const svg = signSvg(kind, style, { value }).replace('<svg ', `<svg width="${w}" height="${h}" `);
      const img = new Image();
      const { col, row } = cell;
      img.onload = () => {
        this.ctx2d.drawImage(img, col * CELL + (CELL - w) / 2, row * CELL + (CELL - h) / 2, w, h);
        this.texture.needsUpdate = true;
      };
      img.src = signDataUrl(svg);
    }
    const w = cell.aspect >= 1 ? 1 : cell.aspect;
    const h = cell.aspect >= 1 ? 1 / cell.aspect : 1;
    const cu = (cell.col + 0.5) / ATLAS_COLS;
    const cv = 1 - (cell.row + 0.5) / ATLAS_ROWS;
    return { u0: cu - w / 2 / ATLAS_COLS, u1: cu + w / 2 / ATLAS_COLS, v0: cv - h / 2 / ATLAS_ROWS, v1: cv + h / 2 / ATLAS_ROWS, aspect: cell.aspect };
  }
}

/* --------------------------------- build ----------------------------------- */

export function buildWorld(input: { network: BuiltNetwork; profile: JurisdictionProfile; scenery: SceneryLayout; env: EnvironmentState }): WorldView {
  const { network: net, profile, scenery, env } = input;
  const group = new THREE.Group();
  group.name = 'world';
  const kerbSign = net.kerbSign;
  const night = env.timeOfDay !== 'day';

  const ground = new GeoBuilder();
  const marks = new GeoBuilder();
  const solid = new GeoBuilder();
  const windows = new GeoBuilder();
  const glow = new GeoBuilder();

  /* ---- asphalt base ---- */
  const b = net.bounds;
  ground.flatRect(b.minX - 5, b.minZ - 5, b.maxX + 5, b.maxZ + 5, 0, COL.asphalt);

  /* ---- raised blocks ---- */
  for (const block of net.layout.blocks) {
    const info = net.blocks.find((x) => x.id === block.id)!;
    const slabEdges: Edges = {
      n: block.north.a.z + block.north.half,
      s: block.south.a.z - block.south.half,
      w: block.west.a.x + block.west.half,
      e: block.east.a.x - block.east.half,
    };
    const slab = blockOutline(net, block, slabEdges, 0, true, 0);
    ground.flatPoly(slab, Y_TOP, COL.sidewalk);
    ground.wall(slab, 0, Y_TOP, COL.kerb);
    const inner = info.inner;
    const isPark = scenery.parks.some((p) => p.minX === inner.minX && p.minZ === inner.minZ);
    const lawn = blockOutline(net, block, { n: inner.minZ, s: inner.maxZ, w: inner.minX, e: inner.maxX }, SIDEWALK_WIDTH, false, 1.2);
    ground.flatPoly(lawn, Y_TOP + 0.01, isPark ? COL.park : COL.grass);
  }

  /* ---- land outside the perimeter roads ---- */
  const kerbLoop = perimeterLoop(net, 0);
  const backLoop = perimeterLoop(net, SIDEWALK_WIDTH);
  ground.flatPoly(backLoop, Y_TOP, COL.sidewalk, [kerbLoop]);
  ground.wall(kerbLoop, 0, Y_TOP, COL.kerb);
  const far = 420;
  ground.flatPoly(
    [
      { x: b.minX - far, z: b.minZ - far },
      { x: b.maxX + far, z: b.minZ - far },
      { x: b.maxX + far, z: b.maxZ + far },
      { x: b.minX - far, z: b.maxZ + far },
    ],
    Y_TOP + 0.01,
    COL.grass,
    [backLoop],
  );

  /* ---- roundabout islands ---- */
  for (const node of net.layout.nodes.values()) {
    if (!node.roundabout) continue;
    const ring = circlePoints(node.def.x, node.def.z, node.roundabout.island, 44);
    ground.flatPoly(ring, Y_TOP + 0.05, COL.park);
    ground.wall(ring, 0, Y_TOP + 0.05, COL.kerb);
    const inner = circlePoints(node.def.x, node.def.z, node.roundabout.island - 0.9, 44);
    marks.flatPoly(ring, Y_TOP + 0.055, COL.sidewalk, [inner]);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const m = new THREE.Matrix4().compose(
        new THREE.Vector3(node.def.x + Math.cos(a) * 3, Y_TOP + 0.6, node.def.z + Math.sin(a) * 3),
        new THREE.Quaternion(),
        new THREE.Vector3(1.3, 0.9, 1.3),
      );
      solid.addGeometry(ICO, m, i % 2 ? 0x4f8f48 : 0x5fa052);
    }
  }

  /* ---- parking strips, lot surface and bays ---- */
  for (const road of net.layout.roads.values()) {
    if (!road.strip) continue;
    const f = COMPASS_VEC[road.dir];
    const horizontal = road.axis === 'EW';
    for (const side of [-1, 1]) {
      const a0 = road.strip.from;
      const a1 = road.strip.to;
      const r0 = side * road.half;
      const r1 = side * road.kerbOffset;
      const p = (along: number, r: number): Vec2 =>
        horizontal ? { x: road.a.x + f.x * along, z: road.a.z + r } : { x: road.a.x + r, z: road.a.z + f.z * along };
      const c0 = p(a0, r0);
      const c1 = p(a1, r1);
      ground.flatRect(Math.min(c0.x, c1.x), Math.min(c0.z, c1.z), Math.max(c0.x, c1.x), Math.max(c0.z, c1.z), 0.004, COL.strip);
      marks.line(p(a0, r0), p(a1, r0), 0.1, Y_MARK, COL.white);
    }
  }
  for (const zone of net.zones.values()) {
    ground.flatRect(zone.rect.minX, zone.rect.minZ, zone.rect.maxX, zone.rect.maxZ, 0.004, COL.lot);
    ground.flatRect(zone.driveway.minX, zone.driveway.minZ, zone.driveway.maxX, zone.driveway.maxZ, 0.004, COL.lot);
    for (const bay of zone.bays) {
      const fw = forwardOf(bay.pose.heading);
      const rt = rightOf(bay.pose.heading);
      const pt = (along: number, across: number): Vec2 => ({ x: bay.pose.x + fw.x * along + rt.x * across, z: bay.pose.z + fw.z * along + rt.z * across });
      const hl = bay.length / 2;
      const hw = bay.width / 2;
      marks.line(pt(-hl, -hw), pt(hl, -hw), 0.12, Y_MARK, COL.white);
      marks.line(pt(-hl, hw), pt(hl, hw), 0.12, Y_MARK, COL.white);
      marks.line(pt(hl, -hw), pt(hl, hw), 0.12, Y_MARK, COL.white);
    }
  }

  /* ---- lane markings ---- */
  const centreColour = profile.roadStyle.centreLineColour === 'yellow' ? COL.yellow : COL.white;
  for (const road of net.layout.roads.values()) {
    const info = net.roads.get(road.def.id)!;
    const f = COMPASS_VEC[road.dir];
    const r = rightOf(Math.atan2(f.x, f.z));
    const lanes = [...info.lanesAB, ...info.lanesBA].map((id) => net.lanes.get(id)!);
    const offsets = lanes
      .map((lane) => ({ lane, off: (lane.start.x - road.a.x) * r.x + (lane.start.z - road.a.z) * r.z }))
      .sort((p, q) => p.off - q.off);
    const from = road.setbackA;
    const to = road.length - road.setbackB;
    const pt = (along: number, off: number): Vec2 => ({ x: road.a.x + f.x * along + r.x * off, z: road.a.z + f.z * along + r.z * off });
    for (let i = 0; i + 1 < offsets.length; i++) {
      const mid = (offsets[i]!.off + offsets[i + 1]!.off) / 2;
      const opposing = offsets[i]!.lane.travel !== offsets[i + 1]!.lane.travel;
      if (!opposing) marks.dashed(pt(from, mid), pt(to, mid), 0.12, Y_MARK, COL.white, 3, 6);
      else if (lanes.length > 2) {
        marks.line(pt(from, mid - 0.14), pt(to, mid - 0.14), 0.12, Y_MARK, centreColour);
        marks.line(pt(from, mid + 0.14), pt(to, mid + 0.14), 0.12, Y_MARK, centreColour);
      } else marks.dashed(pt(from, mid), pt(to, mid), 0.12, Y_MARK, centreColour, 3, 4.5);
    }
  }

  /* ---- stop / give-way lines ---- */
  for (const node of net.nodes.values()) {
    for (const arm of Object.values(node.arms)) {
      if (!arm.stopLine || !arm.incoming.length) continue;
      const control = net.lanes.get(arm.incoming[0]!)!.endControl;
      if (control === 'stop' || control === 'signal') marks.line(arm.stopLine.a, arm.stopLine.b, 0.4, Y_MARK, COL.white);
      else if (control === 'yield') marks.dashed(arm.stopLine.a, arm.stopLine.b, 0.4, Y_MARK, COL.white, 0.6, 0.35);
    }
  }

  /* ---- crosswalks ---- */
  for (const xw of net.crosswalks.values()) {
    const len = Math.hypot(xw.b.x - xw.a.x, xw.b.z - xw.a.z);
    const ux = (xw.b.x - xw.a.x) / len;
    const uz = (xw.b.z - xw.a.z) / len;
    const px = -uz;
    const pz = ux;
    const zebra = xw.kind === 'midblock' || profile.roadStyle.crosswalkStyle === 'zebra';
    if (zebra) {
      const n = Math.floor(len / 1.0);
      const start = (len - n) / 2 + 0.5;
      for (let i = 0; i < n; i++) {
        const cx = xw.a.x + ux * (start + i);
        const cz = xw.a.z + uz * (start + i);
        marks.line({ x: cx - (px * xw.width) / 2, z: cz - (pz * xw.width) / 2 }, { x: cx + (px * xw.width) / 2, z: cz + (pz * xw.width) / 2 }, 0.5, Y_MARK + 0.004, COL.white);
      }
    } else {
      for (const s of [-1, 1]) {
        const o = (s * (xw.width - 0.25)) / 2;
        marks.line({ x: xw.a.x + px * o, z: xw.a.z + pz * o }, { x: xw.b.x + px * o, z: xw.b.z + pz * o }, 0.25, Y_MARK + 0.004, COL.white);
      }
    }
  }

  /* ---- signs ---- */
  const atlas = new SignAtlas(profile);
  const signPos: number[] = [];
  const signUv: number[] = [];
  const style = signStyleFor(profile);
  /** A sign on a post facing drivers of `lane`, `s` metres along it, on the kerb side. */
  const placeSign = (lane: LaneInfo, s: number, kind: SignKind, value?: number, stack = 0, sizeScale = 1): void => {
    const fw = forwardOf(lane.heading);
    const rt = rightOf(lane.heading);
    const kerbDist = (lane.laneCount - 1 - lane.index + 0.5) * LANE_WIDTH + 0.85;
    const x = lane.start.x + fw.x * s + rt.x * kerbSign * kerbDist;
    const z = lane.start.z + fw.z * s + rt.z * kerbSign * kerbDist;
    const face = atlas.face(kind, value);
    const h = (face.aspect > 1.5 ? 0.34 : 0.78) * sizeScale;
    const w = h * face.aspect;
    const y0 = Y_TOP + 2.1 - stack * 0.42;
    if (stack === 0) solid.box(x, Y_TOP, z, 0.07, 2.1 + h, 0.07, 0, COL.pole);
    // Quad faces oncoming drivers: its normal is −forward. Left edge as seen by the driver is their left.
    const lx = x - rt.x * (w / 2) - fw.x * 0.05;
    const lz = z - rt.z * (w / 2) - fw.z * 0.05;
    const rx = x + rt.x * (w / 2) - fw.x * 0.05;
    const rz = z + rt.z * (w / 2) - fw.z * 0.05;
    signPos.push(lx, y0, lz, rx, y0, rz, rx, y0 + h, rz, lx, y0, lz, rx, y0 + h, rz, lx, y0 + h, lz);
    signUv.push(face.u0, face.v0, face.u1, face.v0, face.u1, face.v1, face.u0, face.v0, face.u1, face.v1, face.u0, face.v1);
    // Grey back.
    solid.quad({ x: rx + fw.x * 0.02, y: y0, z: rz + fw.z * 0.02 }, { x: lx + fw.x * 0.02, y: y0, z: lz + fw.z * 0.02 }, { x: lx + fw.x * 0.02, y: y0 + h, z: lz + fw.z * 0.02 }, { x: rx + fw.x * 0.02, y: y0 + h, z: rz + fw.z * 0.02 }, 0x8d949c);
  };
  const limitValue = (lane: LaneInfo): number => Math.round(fromMps(lane.speedLimit, profile.speedUnit));
  for (const lane of net.lanes.values()) {
    if (lane.index !== lane.laneCount - 1) continue;
    const node = net.nodes.get(lane.to)!;
    if (lane.endControl === 'stop') {
      placeSign(lane, lane.length - 0.6, 'stop');
      if (node.control === 'allway_stop' && (style.family === 'us' || style.family === 'ca')) placeSign(lane, lane.length - 0.6, 'all_way_plaque', undefined, 1);
    } else if (lane.endControl === 'yield') {
      placeSign(lane, lane.length - 0.6, 'yield');
      if (node.roundabout && (style.family === 'gb' || style.family === 'de' || style.family === 'ie' || style.family === 'in')) placeSign(lane, lane.length - 0.6, 'roundabout_mandatory', undefined, 2, 0.8);
    }
    if (node.roundabout) placeSign(lane, lane.length - 32, 'roundabout');
    placeSign(lane, 16, 'speed_limit', limitValue(lane));
    if (lane.speedClass === 'school') placeSign(lane, 7, 'school_zone', limitValue(lane));
    if (lane.midblock) placeSign(lane, Math.max(22, lane.midblock.stopS - 18), 'pedestrian_crossing');
  }
  for (const zone of net.zones.values()) {
    const face = atlas.face('parking');
    const x = zone.driveway.maxX + 0.8;
    const z = zone.driveway.minZ + 1.2;
    solid.box(x, Y_TOP, z, 0.07, 2.9, 0.07, 0, COL.pole);
    const h = 0.8;
    signPos.push(x - 0.4, Y_TOP + 2.1, z - 0.05, x + 0.4, Y_TOP + 2.1, z - 0.05, x + 0.4, Y_TOP + 2.1 + h, z - 0.05, x - 0.4, Y_TOP + 2.1, z - 0.05, x + 0.4, Y_TOP + 2.1 + h, z - 0.05, x - 0.4, Y_TOP + 2.1 + h, z - 0.05);
    signUv.push(face.u1, face.v0, face.u0, face.v0, face.u0, face.v1, face.u1, face.v0, face.u0, face.v1, face.u1, face.v1);
  }

  /* ---- traffic lights ---- */
  interface Head {
    nodeId: string;
    arm: LaneInfo['arrivalArm'];
    first: number;
    state: string;
  }
  const heads: Head[] = [];
  const lampMatrices: THREE.Matrix4[] = [];
  const housing = profile.roadStyle.signalHousing === 'yellow' ? 0xe0b020 : profile.roadStyle.signalHousing === 'dark_green' ? 0x1f3b2c : 0x1c1f24;
  const addHead = (x: number, z: number, heading: number, nodeId: string, arm: LaneInfo['arrivalArm'], poleHeight: number): void => {
    // `heading` = direction the approaching traffic travels; lamps face the opposite way.
    const fw = forwardOf(heading);
    solid.box(x, Y_TOP, z, 0.14, poleHeight, 0.14, 0, COL.pole);
    const top = Y_TOP + poleHeight;
    solid.box(x - fw.x * 0.2, top - 1.15, z - fw.z * 0.2, 0.4, 1.15, 0.3, heading, housing);
    const first = lampMatrices.length;
    for (let i = 0; i < 3; i++) {
      lampMatrices.push(new THREE.Matrix4().makeTranslation(x - fw.x * 0.37, top - 0.22 - i * 0.355, z - fw.z * 0.37));
    }
    heads.push({ nodeId, arm, first, state: '' });
  };
  for (const node of net.nodes.values()) {
    if (node.control !== 'signal') continue;
    for (const arm of Object.values(node.arms)) {
      if (!arm.incoming.length) continue;
      const lane = net.lanes.get(arm.incoming[arm.incoming.length - 1]!)!;
      const fw = forwardOf(lane.heading);
      const rt = rightOf(lane.heading);
      const side = kerbSign * (LANE_WIDTH / 2 + 0.9);
      // Near side, at the stop line.
      addHead(lane.end.x + rt.x * side - fw.x * 0.4, lane.end.z + rt.z * side - fw.z * 0.4, lane.heading, node.id, lane.arrivalArm, 3.5);
      // Far side, where a driver waiting at the line looks.
      const opposite = node.arms[lane.travel];
      const across = arm.setback + (opposite ? opposite.setback - 0.6 : Math.max(...Object.values(node.arms).filter((a) => a.dir !== arm.dir).map((a) => net.layout.roads.get(a.roadId)!.half)) + 0.9);
      addHead(lane.end.x + fw.x * across + rt.x * side, lane.end.z + fw.z * across + rt.z * side, lane.heading, node.id, lane.arrivalArm, 4.3);
      if (arm.incoming.length > 1) {
        // Wide approaches get a second far-side head on the centre-line side.
        const inner = net.lanes.get(arm.incoming[0]!)!;
        const off = -kerbSign * (LANE_WIDTH / 2 + 0.2);
        if (!opposite) continue;
        addHead(inner.end.x + fw.x * (across + 1.2) + rt.x * off, inner.end.z + fw.z * (across + 1.2) + rt.z * off, lane.heading, node.id, lane.arrivalArm, 5.2);
      }
    }
  }
  const lampGeo = new THREE.SphereGeometry(0.115, 12, 8);
  const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  const lamps = new THREE.InstancedMesh(lampGeo, lampMat, Math.max(1, lampMatrices.length));
  lampMatrices.forEach((m, i) => lamps.setMatrixAt(i, m));
  const LIT = [new THREE.Color(0xff3b30), new THREE.Color(0xffb300), new THREE.Color(0x35f07a)];
  const DIM = [new THREE.Color(0x40140f), new THREE.Color(0x3d2e08), new THREE.Color(0x0d3a1f)];
  for (let i = 0; i < lampMatrices.length; i++) lamps.setColorAt(i, DIM[i % 3]!);
  lamps.count = lampMatrices.length;
  lamps.frustumCulled = false;

  /* ---- scenery ---- */
  for (const bld of scenery.buildings) {
    const { x, z, halfWidth: hw, halfLength: hl } = bld.obb;
    const wallH = bld.roof === 'gable' ? bld.height * 0.72 : bld.height;
    solid.box(x, Y_TOP, z, hw * 2, wallH, hl * 2, 0, bld.wallColour, bld.roofColour);
    if (bld.roof === 'gable') {
      // Ridge along the longer side.
      const alongX = hw >= hl;
      const y0 = Y_TOP + wallH;
      const y1 = Y_TOP + bld.height;
      const o = 0.35;
      if (alongX) {
        const a = { x: x - hw - o, y: y0, z: z - hl - o };
        const bb = { x: x + hw + o, y: y0, z: z - hl - o };
        const c = { x: x + hw + o, y: y0, z: z + hl + o };
        const d = { x: x - hw - o, y: y0, z: z + hl + o };
        const r1 = { x: x - hw - o, y: y1, z };
        const r2 = { x: x + hw + o, y: y1, z };
        solid.quad(bb, a, r1, r2, bld.roofColour);
        solid.quad(d, c, r2, r1, bld.roofColour);
        solid.tri(a.x, a.y, a.z, d.x, d.y, d.z, r1.x, r1.y, r1.z, bld.wallColour);
        solid.tri(c.x, c.y, c.z, bb.x, bb.y, bb.z, r2.x, r2.y, r2.z, bld.wallColour);
      } else {
        const a = { x: x - hw - o, y: y0, z: z - hl - o };
        const bb = { x: x + hw + o, y: y0, z: z - hl - o };
        const c = { x: x + hw + o, y: y0, z: z + hl + o };
        const d = { x: x - hw - o, y: y0, z: z + hl + o };
        const r1 = { x, y: y1, z: z - hl - o };
        const r2 = { x, y: y1, z: z + hl + o };
        solid.quad(a, d, r2, r1, bld.roofColour);
        solid.quad(c, bb, r1, r2, bld.roofColour);
        solid.tri(bb.x, bb.y, bb.z, a.x, a.y, a.z, r1.x, r1.y, r1.z, bld.wallColour);
        solid.tri(d.x, d.y, d.z, c.x, c.y, c.z, r2.x, r2.y, r2.z, bld.wallColour);
      }
    } else {
      solid.box(x, Y_TOP + wallH, z, hw * 2 - 0.8, 0.35, hl * 2 - 0.8, 0, bld.roofColour);
    }
    // Windows on all four façades.
    const floorH = wallH / bld.floors;
    for (let fl = 0; fl < bld.floors; fl++) {
      const y = Y_TOP + fl * floorH + floorH * 0.38;
      const wh = Math.min(1.5, floorH * 0.42);
      const shopFront = fl === 0 && (bld.style === 'shop' || bld.style === 'test_centre');
      for (const [nx, nz, half, depth] of [
        [0, 1, hw, hl],
        [0, -1, hw, hl],
        [1, 0, hl, hw],
        [-1, 0, hl, hw],
      ] as const) {
        const count = Math.max(1, Math.floor((half * 2 - 1.2) / (shopFront ? 3.6 : 2.6)));
        const ww = shopFront ? 2.6 : 1.15;
        for (let i = 0; i < count; i++) {
          const t = ((i + 0.5) / count - 0.5) * (half * 2 - 1.2);
          // Centre of the window on the façade whose outward normal is (nx, nz).
          const cx = x + nx * (depth + 0.03) + (nx === 0 ? t : 0);
          const cz = z + nz * (depth + 0.03) + (nz === 0 ? t : 0);
          const tx = nx === 0 ? 1 : 0;
          const tz = nz === 0 ? 1 : 0;
          const lit = night && (cx * 7.3 + cz * 3.1 + fl * 5.7) % 3 < 1.1;
          const target = lit ? glow : windows;
          const p = (s: number, yy: number): THREE.Vector3Like => ({ x: cx + tx * s * (ww / 2), y: yy, z: cz + tz * s * (ww / 2) });
          const flip = nx - nz > 0 ? 1 : -1;
          target.quad(p(-flip, y), p(flip, y), p(flip, y + (shopFront ? wh * 1.3 : wh)), p(-flip, y + (shopFront ? wh * 1.3 : wh)), lit ? 0xffd68a : COL.window);
        }
      }
    }
  }
  for (const t of scenery.trees) {
    solid.box(t.x, Y_TOP, t.z, 0.36, t.height * 0.5, 0.36, 0, COL.trunk);
    const tint = [0x4f9a46, 0x5aa850, 0x468a3f, 0x63ab55][Math.abs(Math.round(t.x * 3 + t.z)) % 4]!;
    if (t.kind === 'round') {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, Y_TOP + t.height * 0.68, t.z), new THREE.Quaternion(), new THREE.Vector3(t.canopy, t.canopy * 0.95, t.canopy));
      solid.addGeometry(ICO, m, tint);
    } else {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(t.x, Y_TOP + t.height * 0.62, t.z), new THREE.Quaternion(), new THREE.Vector3(t.canopy, t.height * 0.75, t.canopy));
      solid.addGeometry(CONE, m, 0x3f7f45);
    }
  }
  for (const l of scenery.lamps) {
    const fw = forwardOf(l.heading);
    solid.box(l.x, Y_TOP, l.z, 0.13, 6, 0.13, 0, COL.pole);
    solid.box(l.x + fw.x * 0.8, Y_TOP + 5.9, l.z + fw.z * 0.8, 0.12, 0.1, 1.7, l.heading, COL.pole);
    solid.box(l.x + fw.x * 1.6, Y_TOP + 5.78, l.z + fw.z * 1.6, 0.3, 0.12, 0.6, l.heading, 0x555b63);
    if (night) glow.box(l.x + fw.x * 1.6, Y_TOP + 5.72, l.z + fw.z * 1.6, 0.24, 0.06, 0.5, l.heading, 0xffe2a8);
  }

  /* ---- meshes ---- */
  const disposables: { dispose(): void }[] = [];
  const mesh = (builder: GeoBuilder, material: THREE.Material, name: string, shadow: 'cast' | 'receive' | 'none'): THREE.Mesh | null => {
    if (builder.triangleCount === 0) return null;
    const geo = builder.build();
    const m = new THREE.Mesh(geo, material);
    m.name = name;
    m.castShadow = shadow === 'cast';
    m.receiveShadow = shadow !== 'none';
    m.matrixAutoUpdate = false;
    group.add(m);
    disposables.push(geo, material);
    return m;
  };
  mesh(ground, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'ground', 'receive');
  mesh(marks, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), 'markings', 'none');
  mesh(solid, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 'structures', 'cast');
  mesh(windows, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 'windows', 'none');
  mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 'glow', 'none');

  const signGeo = new THREE.BufferGeometry();
  signGeo.setAttribute('position', new THREE.Float32BufferAttribute(signPos, 3));
  signGeo.setAttribute('uv', new THREE.Float32BufferAttribute(signUv, 2));
  const signMat = new THREE.MeshBasicMaterial({ map: atlas.texture, side: THREE.DoubleSide, toneMapped: false, alphaTest: 0.5, color: night ? 0xb0b0b0 : 0xffffff });
  const signs = new THREE.Mesh(signGeo, signMat);
  signs.name = 'signs';
  signs.matrixAutoUpdate = false;
  group.add(signs, lamps);
  disposables.push(signGeo, signMat, atlas.texture, lampGeo, lampMat);

  return {
    group,
    update(ctx: SimContext): void {
      let dirty = false;
      for (const head of heads) {
        const state = ctx.signals.getState(head.nodeId, head.arm);
        if (state === head.state) continue;
        head.state = state;
        dirty = true;
        const on = [state === 'red' || state === 'red_amber', state === 'amber' || state === 'red_amber', state === 'green'];
        for (let i = 0; i < 3; i++) lamps.setColorAt(head.first + i, on[i] ? LIT[i]! : DIM[i]!);
      }
      if (dirty && lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    },
    dispose(): void {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}

const ICO = new THREE.IcosahedronGeometry(1, 1);
const CONE = new THREE.ConeGeometry(1, 1, 7);
void CROSSWALK_WIDTH;
