import type { BayDef, ControlType, MapDef, MapNodeDef, MapRoadDef, SpeedClass } from '../core/types';

/**
 * Maple Grove — the one town every mode shares. A complete 6 × 5 grid so that
 * every road is axis-aligned and every bend happens inside a junction.
 * See docs/ARCHITECTURE.md §4 for the plan and the reasoning behind each
 * junction's control type.
 */

const COLS: Record<string, number> = { A: -275, B: -165, C: -55, D: 55, E: 165, F: 275 };
const ROWS: Record<string, number> = { '1': -220, '2': -110, '3': 0, '4': 110, '5': 220 };

type NodeSpec = [control: ControlType, minorAxis?: 'NS' | 'EW'];

const CONTROLS: Record<string, NodeSpec> = {
  A1: ['none'],
  F1: ['none'],
  A5: ['none'],
  F5: ['none'],
  B1: ['stop_minor', 'NS'],
  C1: ['yield_minor', 'NS'],
  D1: ['stop_minor', 'NS'],
  E1: ['stop_minor', 'NS'],
  B5: ['yield_minor', 'NS'],
  C5: ['stop_minor', 'NS'],
  D5: ['stop_minor', 'NS'],
  E5: ['yield_minor', 'NS'],
  A2: ['stop_minor', 'EW'],
  A4: ['yield_minor', 'EW'],
  F2: ['yield_minor', 'EW'],
  F4: ['stop_minor', 'EW'],
  A3: ['signal'],
  B3: ['signal'],
  D3: ['signal'],
  E3: ['signal'],
  F3: ['signal'],
  C3: ['stop_minor', 'NS'],
  B2: ['allway_stop', 'NS'],
  B4: ['allway_stop', 'EW'],
  E4: ['allway_stop', 'NS'],
  C2: ['uncontrolled'],
  D2: ['stop_minor', 'EW'],
  D4: ['stop_minor', 'EW'],
  E2: ['roundabout'],
  C4: ['roundabout'],
};

const ROW_ROADS: Record<string, { name: string; speedClass: SpeedClass; lanes: [number, number] }> = {
  '1': { name: 'Northgate Road', speedClass: 'urban', lanes: [1, 1] },
  '2': { name: 'Maple Street', speedClass: 'residential', lanes: [1, 1] },
  '3': { name: 'Main Street', speedClass: 'arterial', lanes: [2, 2] },
  '4': { name: 'Orchard Lane', speedClass: 'residential', lanes: [1, 1] },
  '5': { name: 'Southfield Road', speedClass: 'urban', lanes: [1, 1] },
};

const COL_ROADS: Record<string, { name: string; speedClass: SpeedClass }> = {
  A: { name: 'West Avenue', speedClass: 'urban' },
  B: { name: 'Birch Street', speedClass: 'residential' },
  C: { name: 'Cedar Street', speedClass: 'residential' },
  D: { name: 'Station Road', speedClass: 'urban' },
  E: { name: 'Elm Street', speedClass: 'residential' },
  F: { name: 'East Avenue', speedClass: 'urban' },
};

const colIds = Object.keys(COLS);
const rowIds = Object.keys(ROWS);

const nodes: MapNodeDef[] = [];
for (const r of rowIds) {
  for (const c of colIds) {
    const [control, minorAxis] = CONTROLS[c + r]!;
    const node: MapNodeDef = { id: c + r, x: COLS[c]!, z: ROWS[r]!, control };
    if (minorAxis) node.minorAxis = minorAxis;
    nodes.push(node);
  }
}

/** Per-road tweaks on top of the row/column defaults. */
const OVERRIDES: Record<string, Partial<MapRoadDef>> = {
  'B2-C2': { speedClass: 'school', midblockCrossing: 0.5 },
  'D4-D5': { midblockCrossing: 0.5 },
  'A4-B4': { parkingStrip: true },
  'B4-B5': { parkingStrip: true },
  'A2-B2': { parkingStrip: true },
};

const roads: MapRoadDef[] = [];
for (const r of rowIds) {
  for (let i = 0; i + 1 < colIds.length; i++) {
    const a = colIds[i]! + r;
    const b = colIds[i + 1]! + r;
    const base = ROW_ROADS[r]!;
    const id = `${a}-${b}`;
    roads.push({ id, name: base.name, a, b, lanes: base.lanes, speedClass: base.speedClass, ...OVERRIDES[id] });
  }
}
for (const c of colIds) {
  for (let j = 0; j + 1 < rowIds.length; j++) {
    const a = c + rowIds[j]!;
    const b = c + rowIds[j + 1]!;
    const base = COL_ROADS[c]!;
    const id = `${a}-${b}`;
    roads.push({ id, name: base.name, a, b, lanes: [1, 1], speedClass: base.speedClass, ...OVERRIDES[id] });
  }
}

/* ------------------------------ Test Centre ------------------------------- */

const BAY_W = 2.6;
const BAY_L = 5.2;
const LOT = { minX: 75, maxX: 145, minZ: 150, maxZ: 200 };
const DRIVE_X = 110;

const bays: BayDef[] = [];
// South row: nose toward the south edge (facing south, heading 0).
for (let i = 0; i < 10; i++) {
  bays.push({
    id: `S${i + 1}`,
    kind: 'bay',
    pose: { x: DRIVE_X + (i - 4.5) * BAY_W, z: LOT.maxZ - BAY_L / 2, heading: 0 },
    length: BAY_L,
    width: BAY_W,
  });
}
// North row, split either side of the driveway mouth: nose toward the north edge.
[-11.2, -8.6, -6.0, 6.0, 8.6, 11.2].forEach((dx, i) => {
  bays.push({
    id: `N${i + 1}`,
    kind: 'bay',
    pose: { x: DRIVE_X + dx, z: LOT.minZ + BAY_L / 2, heading: Math.PI },
    length: BAY_L,
    width: BAY_W,
  });
});
// West and east rows: nose toward the edge.
for (let i = 0; i < 5; i++) {
  bays.push({
    id: `W${i + 1}`,
    kind: 'bay',
    pose: { x: LOT.minX + BAY_L / 2, z: 166 + i * BAY_W, heading: -Math.PI / 2 },
    length: BAY_L,
    width: BAY_W,
  });
  bays.push({
    id: `E${i + 1}`,
    kind: 'bay',
    pose: { x: LOT.maxX - BAY_L / 2, z: 166 + i * BAY_W, heading: Math.PI / 2 },
    length: BAY_L,
    width: BAY_W,
  });
}

export const TOWN: MapDef = {
  id: 'maple-grove',
  name: 'Maple Grove',
  nodes,
  roads,
  zones: [
    {
      id: 'test_centre',
      name: 'Test Centre',
      kind: 'lot',
      rect: LOT,
      // From the lot's north edge up to the south kerb of Orchard Lane (z = 110 + 3.4).
      driveway: { minX: DRIVE_X - 3.5, maxX: DRIVE_X + 3.5, minZ: 113.4, maxZ: LOT.minZ },
      roadId: 'D4-E4',
      bays,
    },
  ],
  pois: [{ id: 'lot_centre', pose: { x: DRIVE_X, z: 175, heading: Math.PI }, note: 'Middle of the Test Centre car park, facing the exit' }],
};
