import { createRng } from '../core/rng';
import type { Obb, Rect, RoadNetwork, StaticObstacle } from '../core/types';

export interface BuildingDef {
  id: string;
  obb: Obb;
  height: number;
  style: 'house' | 'shop' | 'office' | 'apartment' | 'school' | 'test_centre';
  roof: 'flat' | 'gable';
  wallColour: number;
  roofColour: number;
  floors: number;
}
export interface TreeDef {
  x: number;
  z: number;
  height: number;
  canopy: number;
  kind: 'round' | 'conifer';
}
export interface LampDef {
  x: number;
  z: number;
  /** Direction the lamp arm points (toward the road). */
  heading: number;
}
export interface SceneryLayout {
  buildings: BuildingDef[];
  trees: TreeDef[];
  lamps: LampDef[];
  /** Blocks left as parkland. */
  parks: Rect[];
  /** Solid things a car can hit: buildings, tree trunks, lamp posts. */
  obstacles: StaticObstacle[];
}

const HOUSE_WALLS = [0xf2e6d0, 0xe8d5b5, 0xd9c7a8, 0xc9d6c3, 0xd7dde8, 0xf0d9cf, 0xe3c9a4, 0xcfd8dc];
const HOUSE_ROOFS = [0x8a4b3c, 0x6d4c41, 0x546e7a, 0x7b5e57, 0x9a5b4a, 0x455a64];
const SHOP_WALLS = [0xc9b79c, 0xb9c4cf, 0xd8cfc4, 0xa9b8a8, 0xcbb9a0, 0xb7a99a, 0xd4c5b0];
const FLAT_ROOFS = [0x5c6670, 0x6b7178, 0x50585f];

const PARK_BLOCK = 'D1-E2';
const SCHOOL_BLOCK = 'B1-C2';

/**
 * Deterministic layout of everything that stands on the blocks. Pure data: the
 * renderer draws it and the simulation uses `obstacles` for collisions.
 */
export function generateScenery(net: RoadNetwork, seed: number): SceneryLayout {
  const rng = createRng(seed);
  const buildings: BuildingDef[] = [];
  const trees: TreeDef[] = [];
  const lamps: LampDef[] = [];
  const parks: Rect[] = [];

  const mainStreetZ = [...net.roads.values()].find((r) => r.speedClass === 'arterial')?.start.z ?? NaN;
  const overlaps = (o: Obb, margin: number): boolean =>
    buildings.some((b) => Math.abs(b.obb.x - o.x) < b.obb.halfWidth + o.halfWidth + margin && Math.abs(b.obb.z - o.z) < b.obb.halfLength + o.halfLength + margin);
  // All buildings are axis-aligned: heading 0 → halfLength along z, halfWidth along x.
  const add = (b: Omit<BuildingDef, 'id'>): boolean => {
    if (overlaps(b.obb, 1.5)) return false;
    buildings.push({ ...b, id: `b${buildings.length}` });
    return true;
  };
  const treeOk = (x: number, z: number): boolean =>
    !buildings.some((b) => Math.abs(b.obb.x - x) < b.obb.halfWidth + 2.2 && Math.abs(b.obb.z - z) < b.obb.halfLength + 2.2) &&
    !trees.some((t) => Math.hypot(t.x - x, t.z - z) < 4.5);
  const addTree = (x: number, z: number): void => {
    if (!treeOk(x, z)) return;
    const conifer = rng.chance(0.25);
    trees.push({ x, z, height: rng.range(5, 8.5), canopy: conifer ? rng.range(1.6, 2.2) : rng.range(2.2, 3.4), kind: conifer ? 'conifer' : 'round' });
  };

  for (const block of net.blocks) {
    const r = block.inner;
    const w = r.maxX - r.minX;
    const d = r.maxZ - r.minZ;
    const zone = block.zoneId ? net.zones.get(block.zoneId)! : null;

    if (block.id === PARK_BLOCK) {
      parks.push(r);
      for (let i = 0; i < 46; i++) addTree(rng.range(r.minX + 3, r.maxX - 3), rng.range(r.minZ + 3, r.maxZ - 3));
      continue;
    }

    if (zone) {
      // Test Centre office beside the driveway, clear of the lot.
      const z0 = r.minZ + 4;
      const depth = Math.min(20, zone.rect.minZ - z0 - 5);
      add({
        obb: { x: zone.driveway.maxX + 22, z: z0 + depth / 2, heading: 0, halfWidth: 14, halfLength: depth / 2 },
        height: 6.5,
        style: 'test_centre',
        roof: 'flat',
        wallColour: 0xe9eef2,
        roofColour: 0x3f5a73,
        floors: 2,
      });
      const clearOfLot = (x: number, z: number): boolean =>
        !(x > zone.rect.minX - 4 && x < zone.rect.maxX + 4 && z > zone.rect.minZ - 4 && z < zone.rect.maxZ + 4) &&
        !(x > zone.driveway.minX - 4 && x < zone.driveway.maxX + 4 && z < zone.rect.minZ + 4);
      for (let i = 0; i < 40; i++) {
        const x = rng.range(r.minX + 2.5, r.maxX - 2.5);
        const z = rng.range(r.minZ + 2.5, r.maxZ - 2.5);
        if (clearOfLot(x, z)) addTree(x, z);
      }
      continue;
    }

    if (block.id === SCHOOL_BLOCK) {
      // The school faces Maple Street (the block's south side).
      add({
        obb: { x: (r.minX + r.maxX) / 2, z: r.maxZ - 22, heading: 0, halfWidth: 30, halfLength: 11 },
        height: 8,
        style: 'school',
        roof: 'flat',
        wallColour: 0xd9a86c,
        roofColour: 0x5c6670,
        floors: 2,
      });
      for (let i = 0; i < 26; i++) addTree(rng.range(r.minX + 3, r.maxX - 3), rng.range(r.minZ + 3, r.maxZ - 40));
      continue;
    }

    // Ordinary blocks: buildings along each side, facing the street.
    const sides: { horizontal: boolean; fixed: number; inward: 1 | -1; downtown: boolean }[] = [
      { horizontal: true, fixed: r.minZ, inward: 1, downtown: Math.abs(block.rect.minZ - mainStreetZ) < 12 },
      { horizontal: true, fixed: r.maxZ, inward: -1, downtown: Math.abs(block.rect.maxZ - mainStreetZ) < 12 },
      { horizontal: false, fixed: r.minX, inward: 1, downtown: false },
      { horizontal: false, fixed: r.maxX, inward: -1, downtown: false },
    ];
    for (const side of sides) {
      const span = side.horizontal ? w : d;
      const start = side.horizontal ? r.minX : r.minZ;
      let pos = start + rng.range(2, 5);
      while (pos < start + span - 10) {
        const downtown = side.downtown;
        const frontage = downtown ? rng.range(14, 24) : rng.range(9, 13);
        if (pos + frontage > start + span - 2) break;
        const depth = downtown ? rng.range(12, 16) : rng.range(8, 11);
        const setback = downtown ? 1.5 : rng.range(4, 6.5);
        const centreAlong = pos + frontage / 2;
        const centreAcross = side.fixed + side.inward * (setback + depth / 2);
        const obb: Obb = side.horizontal
          ? { x: centreAlong, z: centreAcross, heading: 0, halfWidth: frontage / 2, halfLength: depth / 2 }
          : { x: centreAcross, z: centreAlong, heading: 0, halfWidth: depth / 2, halfLength: frontage / 2 };
        if (downtown) {
          const style = rng.pick(['shop', 'shop', 'office', 'apartment'] as const);
          const floors = style === 'shop' ? rng.int(1, 2) : rng.int(3, 5);
          add({ obb, height: floors * 3.3 + 1, style, roof: 'flat', wallColour: rng.pick(SHOP_WALLS), roofColour: rng.pick(FLAT_ROOFS), floors });
        } else {
          const floors = rng.chance(0.6) ? 2 : 1;
          add({ obb, height: floors * 2.9 + 0.6, style: 'house', roof: 'gable', wallColour: rng.pick(HOUSE_WALLS), roofColour: rng.pick(HOUSE_ROOFS), floors });
        }
        pos += frontage + (downtown ? rng.range(0.5, 3) : rng.range(4, 8));
      }
    }
    for (let i = 0; i < 22; i++) addTree(rng.range(r.minX + 2.5, r.maxX - 2.5), rng.range(r.minZ + 2.5, r.maxZ - 2.5));
  }

  // Street lamps on the kerb-side sidewalks, alternating sides.
  for (const road of net.roads.values()) {
    const horizontal = road.axis === 'EW';
    const length = horizontal ? road.end.x - road.start.x : road.end.z - road.start.z;
    let flip = false;
    for (let dist = 24; dist < length - 20; dist += 34) {
      const side = flip ? 1 : -1;
      flip = !flip;
      const off = side * (road.kerbOffset + 0.9);
      const x = horizontal ? road.start.x + dist : road.start.x + off;
      const z = horizontal ? road.start.z + off : road.start.z + dist;
      const loc = net.locate({ x, z });
      if (loc.kind !== 'sidewalk') continue;
      // Arm points back toward the road axis.
      const heading = horizontal ? (side > 0 ? Math.PI : 0) : side > 0 ? -Math.PI / 2 : Math.PI / 2;
      lamps.push({ x, z, heading });
    }
  }

  const obstacles: StaticObstacle[] = [];
  for (const b of buildings) obstacles.push({ id: b.id, kind: 'building', obb: b.obb, height: b.height });
  trees.forEach((t, i) => obstacles.push({ id: `tree${i}`, kind: 'tree', obb: { x: t.x, z: t.z, heading: 0, halfLength: 0.3, halfWidth: 0.3 }, height: t.height }));
  lamps.forEach((l, i) => obstacles.push({ id: `lamp${i}`, kind: 'pole', obb: { x: l.x, z: l.z, heading: 0, halfLength: 0.12, halfWidth: 0.12 }, height: 6 }));
  return { buildings, trees, lamps, parks, obstacles };
}
