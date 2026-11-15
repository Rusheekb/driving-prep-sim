/**
 * Everything that moves or changes during a drive: vehicles (with working
 * lights), pedestrians, cones/barriers, the guidance line and target areas.
 * Meshes are modelled facing +Z and oriented with rotation.y = heading.
 */
import * as THREE from 'three';
import { blinkOn } from '../core/constants';
import { forwardOf, obbCorners, rightOf } from '../core/math';
import type { JurisdictionProfile, ScenarioState, SimContext, SimPedestrian, SimVehicle, StaticObstacle, TargetArea, Vec2, VehicleModel } from '../core/types';
import { GeoBuilder } from './geo';

export interface ActorsView {
  readonly group: THREE.Group;
  /** Guidance line + target areas (hidden in mirrors). */
  readonly overlays: THREE.Group;
  readonly playerObject: THREE.Group;
  sync(ctx: SimContext, opts: { scenario: ScenarioState | null; navLine: boolean; hidePlayerBody: boolean }): void;
  dispose(): void;
}

const GLASS = 0x1c2733;
const TYRE = 0x17191c;
const PLAYER_ID = 0;

/** Where the cabin sits for each body style: [start, end] as fractions of length from the rear, and roof taper. */
const CABIN: Record<VehicleModel, { from: number; to: number; taper: number; bodyH: number }> = {
  hatchback: { from: 0.06, to: 0.68, taper: 0.16, bodyH: 0.5 },
  sedan: { from: 0.22, to: 0.7, taper: 0.2, bodyH: 0.5 },
  suv: { from: 0.05, to: 0.7, taper: 0.1, bodyH: 0.52 },
  van: { from: 0.02, to: 0.82, taper: 0.06, bodyH: 0.5 },
  pickup: { from: 0.42, to: 0.76, taper: 0.12, bodyH: 0.55 },
  bus: { from: 0.01, to: 0.97, taper: 0.03, bodyH: 0.34 },
};

interface LightSet {
  brake: THREE.Mesh;
  left: THREE.Mesh;
  right: THREE.Mesh;
  reverse: THREE.Mesh;
  head: THREE.Mesh;
}

interface VehicleView {
  root: THREE.Group;
  body: THREE.Mesh;
  lights: LightSet;
  wheels: THREE.Object3D[];
  frontPivots: THREE.Object3D[];
  spin: number;
}

function bodyGeometry(v: SimVehicle, withWheels: boolean, learner: boolean): THREE.BufferGeometry {
  const { length: L, width: W, height: H, wheelbase } = v.spec;
  const g = new GeoBuilder();
  const cab = CABIN[v.model];
  const clearance = 0.26;
  const bodyTop = clearance + (H - clearance) * cab.bodyH;
  const colour = v.colour;
  const darker = new THREE.Color(colour).multiplyScalar(0.82).getHex();
  // Lower body with slightly inset bumpers.
  g.box(0, clearance, 0, W, bodyTop - clearance, L - 0.3, 0, colour);
  g.box(0, clearance + 0.04, L / 2 - 0.12, W * 0.94, (bodyTop - clearance) * 0.72, 0.24, 0, darker);
  g.box(0, clearance + 0.04, -L / 2 + 0.12, W * 0.94, (bodyTop - clearance) * 0.72, 0.24, 0, darker);
  // Cabin: a tapered prism, glass sides, body-coloured roof.
  const z0 = -L / 2 + L * cab.from;
  const z1 = -L / 2 + L * cab.to;
  const t = (z1 - z0) * cab.taper;
  const wb = W * 0.94 * 0.5;
  const wt = W * 0.8 * 0.5;
  const b = [
    { x: -wb, y: bodyTop, z: z1 },
    { x: wb, y: bodyTop, z: z1 },
    { x: wb, y: bodyTop, z: z0 },
    { x: -wb, y: bodyTop, z: z0 },
  ];
  const top = [
    { x: -wt, y: H, z: z1 - t * 1.6 },
    { x: wt, y: H, z: z1 - t * 1.6 },
    { x: wt, y: H, z: z0 + t * 0.7 },
    { x: -wt, y: H, z: z0 + t * 0.7 },
  ];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    g.quad(b[i]!, b[j]!, top[j]!, top[i]!, GLASS);
  }
  g.quad(top[0]!, top[1]!, top[2]!, top[3]!, colour);
  if (v.model === 'pickup') g.box(0, bodyTop, -L / 2 + L * 0.2, W * 0.9, 0.12, L * 0.38, 0, darker);
  // Dim lamp lenses (lit overlays are separate meshes).
  for (const s of [-1, 1]) {
    g.box(s * (W / 2 - 0.3), bodyTop - 0.3, L / 2 - 0.02, 0.36, 0.16, 0.06, 0, 0xd9dde2);
    g.box(s * (W / 2 - 0.3), bodyTop - 0.28, -L / 2 + 0.02, 0.36, 0.16, 0.06, 0, 0x6e1512);
  }
  g.box(0, clearance + 0.12, L / 2 - 0.0, 0.52, 0.13, 0.03, 0, 0xf2f2f2);
  g.box(0, clearance + 0.12, -L / 2 + 0.0, 0.52, 0.13, 0.03, 0, 0xf2d24a);
  if (learner) {
    // Roof sign so the learner's car is easy to pick out.
    g.box(0, H, (z0 + z1) / 2, 0.9, 0.24, 0.34, 0, 0xffffff, 0xffd23f);
    g.box(0, H + 0.03, (z0 + z1) / 2 + 0.171, 0.5, 0.17, 0.005, 0, 0xd2232a);
    g.box(0, H + 0.03, (z0 + z1) / 2 - 0.171, 0.5, 0.17, 0.005, 0, 0xd2232a);
  }
  if (withWheels) {
    const m = new THREE.Matrix4();
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        m.compose(new THREE.Vector3(sx * (W / 2 - 0.12), 0.32, (sz * wheelbase) / 2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)), new THREE.Vector3(1, 1, 1));
        g.addGeometry(WHEEL_GEO, m, TYRE);
      }
    }
  }
  return g.build();
}

const WHEEL_GEO = new THREE.CylinderGeometry(0.32, 0.32, 0.24, 14);
const HUB_GEO = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 8);
const lightGeoCache = new Map<string, Record<keyof LightSet, THREE.BufferGeometry>>();

function lightGeometries(v: SimVehicle): Record<keyof LightSet, THREE.BufferGeometry> {
  const key = `${v.spec.length}|${v.spec.width}|${v.spec.height}|${v.model}`;
  let set = lightGeoCache.get(key);
  if (set) return set;
  const { length: L, width: W, height: H } = v.spec;
  const cab = CABIN[v.model];
  const bodyTop = 0.26 + (H - 0.26) * cab.bodyH;
  const make = (fn: (g: GeoBuilder) => void): THREE.BufferGeometry => {
    const g = new GeoBuilder();
    fn(g);
    return g.build();
  };
  // Right-hand side of a mesh facing +Z is −X (right vector of heading 0 is (−1, 0)).
  const sideX = (right: boolean): number => (right ? -1 : 1) * (W / 2 - 0.08);
  const indicator = (right: boolean) => (g: GeoBuilder): void => {
    g.box(sideX(right), bodyTop - 0.3, L / 2 - 0.0, 0.18, 0.17, 0.09, 0, 0xffffff);
    g.box(sideX(right), bodyTop - 0.28, -L / 2 + 0.0, 0.18, 0.17, 0.09, 0, 0xffffff);
    g.box((right ? -1 : 1) * (W / 2 + 0.01), bodyTop - 0.12, L * 0.18, 0.05, 0.08, 0.16, 0, 0xffffff);
  };
  set = {
    brake: make((g) => {
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.36), bodyTop - 0.29, -L / 2 - 0.01, 0.3, 0.18, 0.07, 0, 0xffffff);
      g.box(0, H - 0.12, -L / 2 + L * cab.from + 0.02, 0.5, 0.05, 0.04, 0, 0xffffff);
    }),
    left: make(indicator(false)),
    right: make(indicator(true)),
    reverse: make((g) => {
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.6), bodyTop - 0.29, -L / 2 - 0.01, 0.12, 0.12, 0.07, 0, 0xffffff);
    }),
    head: make((g) => {
      for (const s of [-1, 1]) g.box(s * (W / 2 - 0.34), bodyTop - 0.3, L / 2 + 0.01, 0.3, 0.17, 0.07, 0, 0xffffff);
    }),
  };
  lightGeoCache.set(key, set);
  return set;
}

export function createActors(input: { profile: JurisdictionProfile }): ActorsView {
  void input;
  const group = new THREE.Group();
  group.name = 'actors';
  const overlays = new THREE.Group();
  overlays.name = 'overlays';
  const playerObject = new THREE.Group();
  playerObject.name = 'player';
  group.add(playerObject);

  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const lit = {
    brake: new THREE.MeshBasicMaterial({ color: 0xff2d1f, toneMapped: false }),
    left: new THREE.MeshBasicMaterial({ color: 0xffa21a, toneMapped: false }),
    right: new THREE.MeshBasicMaterial({ color: 0xffa21a, toneMapped: false }),
    reverse: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    head: new THREE.MeshBasicMaterial({ color: 0xfff3cf, toneMapped: false }),
  };
  const tyreMat = new THREE.MeshLambertMaterial({ color: TYRE });
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xb9bec4 });

  const vehicles = new Map<number, VehicleView>();
  const bodyGeos: THREE.BufferGeometry[] = [];

  function makeVehicle(v: SimVehicle): VehicleView {
    const isPlayer = v.kind === 'player';
    const root = isPlayer ? playerObject : new THREE.Group();
    const geo = bodyGeometry(v, !isPlayer, isPlayer);
    bodyGeos.push(geo);
    const body = new THREE.Mesh(geo, bodyMat);
    body.castShadow = true;
    root.add(body);
    const geos = lightGeometries(v);
    const lights = {} as LightSet;
    for (const k of Object.keys(geos) as (keyof LightSet)[]) {
      const m = new THREE.Mesh(geos[k], lit[k]);
      m.visible = false;
      root.add(m);
      lights[k] = m;
    }
    const wheels: THREE.Object3D[] = [];
    const frontPivots: THREE.Object3D[] = [];
    if (isPlayer) {
      const { width: W, wheelbase } = v.spec;
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const pivot = new THREE.Group();
          pivot.position.set(sx * (W / 2 - 0.12), 0.32, (sz * wheelbase) / 2);
          const spinner = new THREE.Group();
          const tyre = new THREE.Mesh(WHEEL_GEO, tyreMat);
          tyre.rotation.z = Math.PI / 2;
          const hub = new THREE.Mesh(HUB_GEO, hubMat);
          hub.rotation.z = Math.PI / 2;
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.05, 0.3), tyreMat);
          spinner.add(tyre, hub, spoke);
          pivot.add(spinner);
          root.add(pivot);
          wheels.push(spinner);
          if (sz > 0) frontPivots.push(pivot);
        }
      }
    }
    if (!isPlayer) group.add(root);
    return { root, body, lights, wheels, frontPivots, spin: 0 };
  }

  /* ---- pedestrians ---- */
  const SHIRTS = [0xd9534f, 0x3f7fbf, 0xf0ad4e, 0x5cb85c, 0x8e6bbf, 0x2f8f8f, 0xe8e2d0, 0x444b5a].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const TROUSERS = [0x2b3445, 0x4a4036, 0x30424f, 0x5a5f66].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8714a, 0x7a4a2e].map((c) => new THREE.MeshLambertMaterial({ color: c }));
  const torsoGeo = new THREE.BoxGeometry(0.42, 0.62, 0.24).translate(0, 1.11, 0);
  const headGeo = new THREE.SphereGeometry(0.135, 10, 8).translate(0, 1.6, 0);
  const legGeo = new THREE.BoxGeometry(0.15, 0.8, 0.17).translate(0, -0.4, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.56, 0.12).translate(0, -0.28, 0);
  interface PedView {
    root: THREE.Group;
    legs: THREE.Mesh[];
    arms: THREE.Mesh[];
    phase: number;
    lastX: number;
    lastZ: number;
  }
  const peds = new Map<number, PedView>();
  function makePed(p: SimPedestrian): PedView {
    const root = new THREE.Group();
    const shirt = SHIRTS[p.look % SHIRTS.length]!;
    const trousers = TROUSERS[(p.look >> 3) % TROUSERS.length]!;
    const skin = SKIN[(p.look >> 5) % SKIN.length]!;
    root.add(new THREE.Mesh(torsoGeo, shirt), new THREE.Mesh(headGeo, skin));
    const legs: THREE.Mesh[] = [];
    const arms: THREE.Mesh[] = [];
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(legGeo, trousers);
      leg.position.set(s * 0.1, 0.8, 0);
      const arm = new THREE.Mesh(armGeo, shirt);
      arm.position.set(s * 0.27, 1.38, 0);
      root.add(leg, arm);
      legs.push(leg);
      arms.push(arm);
    }
    const scale = (p.look >> 7) % 6 === 0 ? 0.72 : 0.94 + ((p.look >> 2) % 5) * 0.03;
    root.scale.setScalar(scale);
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true;
    });
    group.add(root);
    return { root, legs, arms, phase: (p.look % 10) * 0.6, lastX: p.x, lastZ: p.z };
  }

  /* ---- props ---- */
  const coneGeo = (() => {
    const g = new GeoBuilder();
    g.addGeometry(new THREE.ConeGeometry(0.2, 0.62, 12), new THREE.Matrix4().makeTranslation(0, 0.35, 0), 0xff6a1a);
    g.addGeometry(new THREE.CylinderGeometry(0.115, 0.15, 0.16, 12), new THREE.Matrix4().makeTranslation(0, 0.36, 0), 0xffffff);
    g.box(0, 0, 0, 0.42, 0.045, 0.42, 0, 0xe0560f);
    return g.build();
  })();
  const props = new Map<string, THREE.Object3D>();
  function makeProp(o: StaticObstacle): THREE.Object3D {
    let obj: THREE.Mesh;
    if (o.kind === 'cone') obj = new THREE.Mesh(coneGeo, bodyMat);
    else {
      const g = new GeoBuilder();
      const len = o.obb.halfLength * 2;
      for (let i = 0; i < 6; i++) g.box(0, 0.55, -len / 2 + (i + 0.5) * (len / 6), 0.08, 0.3, len / 6, 0, i % 2 ? 0xffffff : 0xd9342b);
      g.box(0, 0, -len / 2 + 0.2, 0.5, 0.55, 0.08, 0, 0x555b63);
      g.box(0, 0, len / 2 - 0.2, 0.5, 0.55, 0.08, 0, 0x555b63);
      const geo = g.build();
      bodyGeos.push(geo);
      obj = new THREE.Mesh(geo, bodyMat);
    }
    obj.castShadow = true;
    obj.position.set(o.obb.x, 0, o.obb.z);
    obj.rotation.y = o.obb.heading;
    group.add(obj);
    return obj;
  }

  /* ---- overlays ---- */
  const navMat = new THREE.MeshBasicMaterial({ color: 0x45b0ff, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide, toneMapped: false });
  const navMesh = new THREE.Mesh(new THREE.BufferGeometry(), navMat);
  navMesh.frustumCulled = false;
  overlays.add(navMesh);
  let navKey = '';
  function rebuildNav(route: readonly Vec2[], from: Vec2): void {
    // Start at the route point nearest the car and draw ~160 m ahead.
    let start = 0;
    let best = Infinity;
    for (let i = 0; i < route.length; i++) {
      const d = (route[i]!.x - from.x) ** 2 + (route[i]!.z - from.z) ** 2;
      if (d < best) {
        best = d;
        start = i;
      }
    }
    const pos: number[] = [];
    let travelled = 0;
    const half = 0.55;
    for (let i = start; i + 1 < route.length && travelled < 160; i++) {
      const a = route[i]!;
      const b = route[i + 1]!;
      const l = Math.hypot(b.x - a.x, b.z - a.z);
      if (l < 1e-4) continue;
      const px = (-(b.z - a.z) / l) * half;
      const pz = ((b.x - a.x) / l) * half;
      pos.push(a.x + px, 0.03, a.z + pz, a.x - px, 0.03, a.z - pz, b.x - px, 0.03, b.z - pz, a.x + px, 0.03, a.z + pz, b.x - px, 0.03, b.z - pz, b.x + px, 0.03, b.z + pz);
      travelled += l;
    }
    navMesh.geometry.dispose();
    navMesh.geometry = new THREE.BufferGeometry();
    navMesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }

  const targetGroup = new THREE.Group();
  overlays.add(targetGroup);
  let targetKey = '';
  const targetMats: Record<TargetArea['state'], THREE.MeshBasicMaterial> = {
    active: new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    done: new THREE.MeshBasicMaterial({ color: 0x2fbf71, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    pending: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  };
  function rebuildTargets(targets: readonly TargetArea[]): void {
    for (const c of [...targetGroup.children]) {
      (c as THREE.Mesh).geometry.dispose();
      targetGroup.remove(c);
    }
    for (const t of targets) {
      const g = new GeoBuilder();
      const cs = obbCorners(t.obb);
      for (let i = 0; i < 4; i++) g.line(cs[i]!, cs[(i + 1) % 4]!, t.kind === 'gate' ? 0.3 : 0.18, 0.035, 0xffffff);
      if (t.kind !== 'zone') {
        for (const c of cs) g.box(c.x, 0, c.z, 0.12, t.kind === 'gate' ? 1.6 : 0.5, 0.12, 0, 0xffffff);
      }
      const mesh = new THREE.Mesh(g.build(), targetMats[t.state]);
      mesh.userData.pulse = t.state === 'active';
      targetGroup.add(mesh);
    }
  }

  return {
    group,
    overlays,
    playerObject,
    sync(ctx, opts) {
      const on = blinkOn(ctx.time);
      const seen = new Set<number>();
      const all = [ctx.player.vehicle, ...ctx.vehicles];
      for (const v of all) {
        seen.add(v.id);
        let view = vehicles.get(v.id);
        if (!view) vehicles.set(v.id, (view = makeVehicle(v)));
        view.root.position.set(v.x, 0, v.z);
        view.root.rotation.y = v.heading;
        const l = view.lights;
        l.brake.visible = v.braking;
        l.reverse.visible = v.reversing;
        l.head.visible = v.headlights;
        l.left.visible = on && (v.indicator === 'left' || v.indicator === 'hazard');
        l.right.visible = on && (v.indicator === 'right' || v.indicator === 'hazard');
        if (v.id === PLAYER_ID) {
          view.body.visible = !opts.hidePlayerBody;
          for (const w of view.wheels) w.visible = !opts.hidePlayerBody;
          view.spin += (v.speed / 0.32) * (1 / 60);
          for (const w of view.wheels) w.rotation.x = view.spin;
          for (const p of view.frontPivots) p.rotation.y = -v.steer;
          if (opts.hidePlayerBody) l.brake.visible = l.reverse.visible = l.head.visible = l.left.visible = l.right.visible = false;
        }
      }
      for (const [id, view] of vehicles) {
        if (seen.has(id) || id === PLAYER_ID) continue;
        group.remove(view.root);
        vehicles.delete(id);
      }

      const seenPeds = new Set<number>();
      for (const p of ctx.pedestrians) {
        seenPeds.add(p.id);
        let view = peds.get(p.id);
        if (!view) peds.set(p.id, (view = makePed(p)));
        const moved = Math.hypot(p.x - view.lastX, p.z - view.lastZ);
        view.lastX = p.x;
        view.lastZ = p.z;
        view.phase += moved * 4.2;
        const swing = moved > 1e-4 ? Math.sin(view.phase) * 0.55 : 0;
        view.legs[0]!.rotation.x = swing;
        view.legs[1]!.rotation.x = -swing;
        view.arms[0]!.rotation.x = -swing * 0.7;
        view.arms[1]!.rotation.x = swing * 0.7;
        view.root.position.set(p.x, 0, p.z);
        view.root.rotation.y = p.heading;
      }
      for (const [id, view] of peds) {
        if (seenPeds.has(id)) continue;
        group.remove(view.root);
        peds.delete(id);
      }

      const seenProps = new Set<string>();
      for (const o of ctx.obstacles) {
        if (o.kind !== 'cone' && o.kind !== 'barrier') continue;
        seenProps.add(o.id);
        let obj = props.get(o.id);
        if (!obj) props.set(o.id, (obj = makeProp(o)));
        if (o.kind === 'cone') {
          obj.rotation.z = o.hit ? Math.PI / 2 - 0.25 : 0;
          obj.position.y = o.hit ? 0.2 : 0;
        }
      }
      for (const [id, obj] of props) {
        if (seenProps.has(id)) continue;
        group.remove(obj);
        props.delete(id);
      }

      const scenario = opts.scenario;
      const route = opts.navLine && scenario ? scenario.route : [];
      const pv = ctx.player.vehicle;
      const key = route.length >= 2 ? `${route.length}:${route[0]!.x.toFixed(1)}:${route[route.length - 1]!.x.toFixed(1)}:${route[route.length - 1]!.z.toFixed(1)}:${Math.round(pv.x / 12)}:${Math.round(pv.z / 12)}` : '';
      if (key !== navKey) {
        navKey = key;
        navMesh.visible = route.length >= 2;
        if (navMesh.visible) rebuildNav(route, pv);
      }
      const targets = scenario ? scenario.targets : [];
      const tKey = targets.map((t) => `${t.id}:${t.state}:${t.obb.x.toFixed(2)}:${t.obb.z.toFixed(2)}`).join('|');
      if (tKey !== targetKey) {
        targetKey = tKey;
        rebuildTargets(targets);
      }
      const pulse = 0.65 + 0.3 * Math.sin(ctx.time * 4);
      targetMats.active.opacity = pulse;
      void forwardOf;
      void rightOf;
    },
    dispose() {
      for (const g of bodyGeos) g.dispose();
      navMesh.geometry.dispose();
      for (const c of targetGroup.children) (c as THREE.Mesh).geometry.dispose();
      group.clear();
      overlays.clear();
    },
  };
}
