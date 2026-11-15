/**
 * Renderer core: cameras, mirrors, environment (time of day, weather) and the
 * per-frame draw. Turns a SimContext into the picture the learner sees.
 */
import * as THREE from 'three';
import { PLAYER_SPEC } from '../core/constants';
import { clamp } from '../core/math';
import type { CameraMode, EnvironmentState, GraphicsQuality, JurisdictionProfile, LookDir, MirrorId, ScenarioState, SimContext } from '../core/types';
import type { BuiltNetwork } from '../world/network';
import type { SceneryLayout } from '../world/scenery';
import { type ActorsView, createActors } from './actors';
import { type WorldView, buildWorld } from './world';

export interface ViewState {
  camera: CameraMode;
  showMirrors: boolean;
  navLine: boolean;
  scenario: ScenarioState | null;
  reducedMotion: boolean;
}
export interface MirrorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface GameRenderer {
  readonly canvas: HTMLCanvasElement;
  loadWorld(input: { network: BuiltNetwork; profile: JurisdictionProfile; scenery: SceneryLayout; env: EnvironmentState }): void;
  unloadWorld(): void;
  render(ctx: SimContext, view: ViewState, realDt: number): void;
  /** Snap the camera to the car (new session / teleport). */
  resetCamera(): void;
  /** Mirror panels in CSS pixels relative to the canvas (null when hidden). */
  mirrorLayout(): Record<MirrorId, MirrorRect | null>;
  setQuality(q: GraphicsQuality): void;
  resize(): void;
  stats(): { fps: number; drawCalls: number; triangles: number };
  dispose(): void;
}

const QUALITY: Record<GraphicsQuality, { pixelRatio: number; shadows: boolean; mirrorEvery: number; mirrorScale: number }> = {
  low: { pixelRatio: 1, shadows: false, mirrorEvery: 3, mirrorScale: 0.5 },
  medium: { pixelRatio: 1.5, shadows: false, mirrorEvery: 2, mirrorScale: 0.75 },
  high: { pixelRatio: 2, shadows: true, mirrorEvery: 1, mirrorScale: 1 },
};

const LOOK_YAW: Record<LookDir, number> = { ahead: 0, left: 1, right: -1, back: 2 };

export function createRenderer(canvas: HTMLCanvasElement, opts: { quality: GraphicsQuality }): GameRenderer {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.type = THREE.PCFShadowMap;
  let quality = opts.quality;

  const scene = new THREE.Scene();
  const fog = new THREE.Fog(0x9fd0f5, 150, 600);
  scene.fog = fog;
  const hemi = new THREE.HemisphereLight(0xe6f3ff, 0x70806a, 2.4);
  const sun = new THREE.DirectionalLight(0xfff3dd, 2.6);
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 320;
  const S = 70;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun, sun.target);

  const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 900);
  let width = 1;
  let height = 1;

  /* ---- player headlights ---- */
  const headlights: THREE.SpotLight[] = [];
  const headTargets: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const spot = new THREE.SpotLight(0xfff0cc, 0, 70, 0.55, 0.7, 1.1);
    spot.position.set(s * 0.6, 0.75, PLAYER_SPEC.length / 2);
    const target = new THREE.Object3D();
    target.position.set(s * 0.9, 0.1, PLAYER_SPEC.length / 2 + 22);
    spot.target = target;
    headlights.push(spot);
    headTargets.push(target);
  }

  // Soft pool of light on the road ahead (spotlights alone graze the flat road too thinly).
  const poolCanvas = document.createElement('canvas');
  poolCanvas.width = poolCanvas.height = 128;
  {
    const c2 = poolCanvas.getContext('2d')!;
    const grad = c2.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,244,214,0.9)');
    grad.addColorStop(0.5, 'rgba(255,240,200,0.35)');
    grad.addColorStop(1, 'rgba(255,240,200,0)');
    c2.fillStyle = grad;
    c2.fillRect(0, 0, 128, 128);
  }
  const poolTex = new THREE.CanvasTexture(poolCanvas);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }),
  );
  pool.position.set(0, 0.05, PLAYER_SPEC.length / 2 + 11);
  pool.scale.set(9, 1, 24);
  pool.visible = false;

  /* ---- cockpit (driver camera) ---- */
  const cockpit = new THREE.Group();
  const cockpitMat = new THREE.MeshLambertMaterial({ color: 0x1b1f26 });
  const bonnetMat = new THREE.MeshLambertMaterial({ color: 0xd8432e });
  const wheelRim = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.016, 8, 28), cockpitMat);
  {
    const { width: W, length: L } = PLAYER_SPEC;
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rx = 0): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.x = rx;
      cockpit.add(m);
      return m;
    };
    add(new THREE.BoxGeometry(W - 0.1, 0.1, 1.15), bonnetMat, 0, 0.9, L / 2 - 0.62, 0.06); // bonnet
    add(new THREE.BoxGeometry(W - 0.12, 0.26, 0.5), cockpitMat, 0, 0.82, 0.78); // dashboard
    for (const s of [-1, 1]) {
      add(new THREE.BoxGeometry(0.055, 0.8, 0.055), cockpitMat, s * (W / 2 - 0.06), 1.25, 0.98, -0.55); // A-pillars
      add(new THREE.BoxGeometry(0.1, 0.5, 2.6), cockpitMat, s * (W / 2 - 0.02), 0.7, -0.4); // doors
      add(new THREE.BoxGeometry(0.09, 0.62, 0.12), cockpitMat, s * (W / 2 - 0.08), 1.2, -0.42); // B-pillars
    }
    add(new THREE.BoxGeometry(W - 0.2, 0.06, 1.9), cockpitMat, 0, 1.53, -0.35); // roof
    add(new THREE.BoxGeometry(W - 0.2, 0.5, 0.1), cockpitMat, 0, 0.75, -1.5); // rear shelf
    wheelRim.rotation.x = -0.42;
    cockpit.add(wheelRim);
  }
  cockpit.visible = false;

  /* ---- mirrors ---- */
  const mirrorIds: MirrorId[] = ['left', 'centre', 'right'];
  const mirrorCams: Record<MirrorId, THREE.PerspectiveCamera> = {
    left: new THREE.PerspectiveCamera(24, 1.45, 0.4, 260),
    centre: new THREE.PerspectiveCamera(20, 3.2, 0.4, 320),
    right: new THREE.PerspectiveCamera(24, 1.45, 0.4, 260),
  };
  const mirrorTargets = {} as Record<MirrorId, THREE.WebGLRenderTarget>;
  const overlayScene = new THREE.Scene();
  const overlayCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
  const mirrorQuads = {} as Record<MirrorId, { frame: THREE.Mesh; image: THREE.Mesh; rect: MirrorRect | null }>;
  const unitQuad = new THREE.PlaneGeometry(1, 1);
  const frameIdle = new THREE.Color(0x10141c);
  const frameHot = new THREE.Color(0xffd23f);
  for (const id of mirrorIds) {
    const rt = new THREE.WebGLRenderTarget(64, 64, { depthBuffer: true });
    mirrorTargets[id] = rt;
    const frame = new THREE.Mesh(unitQuad, new THREE.MeshBasicMaterial({ color: frameIdle.clone(), toneMapped: false }));
    const image = new THREE.Mesh(unitQuad, new THREE.MeshBasicMaterial({ map: rt.texture, side: THREE.DoubleSide, toneMapped: false }));
    image.position.z = 0.1;
    overlayScene.add(frame, image);
    mirrorQuads[id] = { frame, image, rect: null };
  }
  let frameIndex = 0;

  function sizeMirrors(): void {
    const q = QUALITY[quality];
    const pr = renderer.getPixelRatio();
    const centreW = clamp(width * 0.27, 150, 430);
    const centreH = centreW / 3.2;
    const sideH = clamp(height * 0.16, 54, 130);
    const sideW = sideH * 1.45;
    const pad = Math.max(8, width * 0.012);
    const showSides = width >= 560;
    const rects: Record<MirrorId, MirrorRect | null> = {
      centre: { x: (width - centreW) / 2, y: pad, width: centreW, height: centreH },
      left: showSides ? { x: pad, y: pad, width: sideW, height: sideH } : null,
      right: showSides ? { x: width - pad - sideW, y: pad, width: sideW, height: sideH } : null,
    };
    for (const id of mirrorIds) {
      const r = rects[id];
      mirrorQuads[id].rect = r;
      if (!r) continue;
      mirrorTargets[id].setSize(Math.max(32, Math.round(r.width * pr * q.mirrorScale)), Math.max(32, Math.round(r.height * pr * q.mirrorScale)));
      const cy = height - r.y - r.height / 2;
      const cx = r.x + r.width / 2;
      mirrorQuads[id].frame.position.set(cx, cy, 0);
      mirrorQuads[id].frame.scale.set(r.width + 8, r.height + 8, 1);
      mirrorQuads[id].image.position.set(cx, cy, 0.1);
      // Negative x scale flips the picture so it reads like a real mirror.
      mirrorQuads[id].image.scale.set(-r.width, r.height, 1);
    }
    overlayCam.right = width;
    overlayCam.top = height;
    overlayCam.updateProjectionMatrix();
  }

  /* ---- rain ---- */
  const RAIN_N = 1100;
  const rainPos = new Float32Array(RAIN_N * 6);
  const rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) {
    rainSeed[i * 3] = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    rainSeed[i * 3 + 1] = (Math.sin(i * 78.233) * 12543.123) % 1;
    rainSeed[i * 3 + 2] = (Math.sin(i * 39.425) * 27183.77) % 1;
  }
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xcfd9e6, transparent: true, opacity: 0.5, depthWrite: false }));
  rain.frustumCulled = false;
  rain.visible = false;
  scene.add(rain);
  let rainClock = 0;

  /* ---- world state ---- */
  let world: WorldView | null = null;
  let actors: ActorsView | null = null;
  let profile: JurisdictionProfile | null = null;
  let env: EnvironmentState | null = null;
  let camYaw = 0;
  let lookYaw = 0;
  let needsSnap = true;
  let fps = 60;

  function applyEnvironment(e: EnvironmentState): void {
    const sky = new THREE.Color(e.timeOfDay === 'day' ? 0x8fcaf7 : e.timeOfDay === 'dusk' ? 0xf0a477 : 0x0a1224);
    let hemiI = e.timeOfDay === 'day' ? 2.4 : e.timeOfDay === 'dusk' ? 1.35 : 0.7;
    let sunI = e.timeOfDay === 'day' ? 2.6 : e.timeOfDay === 'dusk' ? 1.5 : 0.28;
    hemi.color.setHex(e.timeOfDay === 'night' ? 0x52648f : e.timeOfDay === 'dusk' ? 0xffd9b8 : 0xe6f3ff);
    hemi.groundColor.setHex(e.timeOfDay === 'night' ? 0x141a24 : 0x70806a);
    sun.color.setHex(e.timeOfDay === 'day' ? 0xfff3dd : e.timeOfDay === 'dusk' ? 0xff9d57 : 0x9fb4e6);
    const dir = e.timeOfDay === 'dusk' ? new THREE.Vector3(-0.8, 0.28, -0.35) : new THREE.Vector3(-0.45, 0.85, -0.3);
    sun.userData.dir = dir.normalize();
    if (e.weather === 'rain') {
      sky.lerp(new THREE.Color(e.timeOfDay === 'night' ? 0x0c111a : 0x8e98a3), 0.7);
      hemiI *= 0.8;
      sunI *= 0.45;
    } else if (e.weather === 'fog') {
      sky.set(e.timeOfDay === 'night' ? 0x1a1f28 : e.timeOfDay === 'dusk' ? 0xc9b3a4 : 0xc9d1d8);
      sunI *= 0.35;
    }
    hemi.intensity = hemiI;
    sun.intensity = sunI;
    scene.background = sky;
    fog.color.copy(sky);
    fog.far = Math.max(60, e.visibility);
    fog.near = e.weather === 'fog' ? 4 : fog.far * 0.35;
    camera.far = Math.max(200, fog.far + 50);
    camera.updateProjectionMatrix();
    rain.visible = e.weather === 'rain';
  }

  function applyQuality(): void {
    const q = QUALITY[quality];
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    renderer.shadowMap.enabled = q.shadows;
    sun.castShadow = q.shadows;
    resize();
  }

  function resize(): void {
    const parent = canvas.parentElement;
    const w = Math.max(1, parent ? parent.clientWidth : canvas.clientWidth);
    const h = Math.max(1, parent ? parent.clientHeight : canvas.clientHeight);
    width = w;
    height = h;
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    sizeMirrors();
  }
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (observer && canvas.parentElement) observer.observe(canvas.parentElement);
  window.addEventListener('resize', resize);
  applyQuality();

  const v3 = new THREE.Vector3();
  const lookAt = new THREE.Vector3();

  function placeCamera(ctx: SimContext, view: ViewState, dt: number): void {
    const p = ctx.player.vehicle;
    const side = profile && profile.drivingSide === 'left' ? 1 : -1; // driver's seat: +1 = right-hand side of the car
    const k = view.reducedMotion || needsSnap ? 1 : 1 - Math.exp(-dt * 12);
    // Look offset: left = +yaw. "Back" turns over the shoulder nearer the middle of the car.
    const look = ctx.player.look;
    const target = look === 'back' ? (view.camera === 'driver' ? -side * 2.75 : Math.PI) : LOOK_YAW[look] * (view.camera === 'chase' ? 1.35 : 1.45);
    let d = target - lookYaw;
    if (view.camera !== 'driver' && look === 'back' && lookYaw < 0) d = -Math.PI - lookYaw;
    lookYaw += d * k;
    if (look === 'ahead' && Math.abs(lookYaw) < 0.002) lookYaw = 0;

    const yawK = view.reducedMotion || needsSnap ? 1 : 1 - Math.exp(-dt * 5.5);
    let dy = p.heading - camYaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    camYaw += dy * (view.camera === 'chase' ? yawK : 1);
    needsSnap = false;

    const fx = Math.sin(p.heading);
    const fz = Math.cos(p.heading);
    const rx = -fz;
    const rz = fx;
    camera.up.set(0, 1, 0);
    if (view.camera === 'top') {
      camera.fov = 50;
      camera.position.set(p.x + fx * 5, 44, p.z + fz * 5);
      camera.up.set(Math.sin(camYaw), 0, Math.cos(camYaw));
      lookAt.set(p.x + fx * 5, 0, p.z + fz * 5);
    } else if (view.camera === 'chase') {
      camera.fov = 62;
      const a = camYaw + lookYaw;
      camera.position.set(p.x - Math.sin(a) * 8.2, 3.7, p.z - Math.cos(a) * 8.2);
      lookAt.set(p.x + Math.sin(a) * 9, 1.5, p.z + Math.cos(a) * 9);
    } else {
      const driver = view.camera === 'driver';
      camera.fov = driver ? 72 : 66;
      const a = p.heading + lookYaw;
      const fwd = driver ? 0.12 : 0.75;
      const lat = driver ? side * 0.36 : 0;
      const eye = driver ? 1.22 : 1.32;
      camera.position.set(p.x + fx * fwd + rx * lat, eye, p.z + fz * fwd + rz * lat);
      lookAt.set(camera.position.x + Math.sin(a) * 10, eye - (driver ? 0.3 : 0.55), camera.position.z + Math.cos(a) * 10);
    }
    camera.near = view.camera === 'driver' ? 0.12 : 0.3;
    camera.updateProjectionMatrix();
    camera.lookAt(lookAt);

    // Mirror cameras ride with the car and look backward.
    const back = p.heading + Math.PI;
    const place = (cam: THREE.PerspectiveCamera, right: number, forward: number, y: number, yaw: number): void => {
      cam.position.set(p.x + fx * forward + rx * right, y, p.z + fz * forward + rz * right);
      cam.lookAt(cam.position.x + Math.sin(yaw) * 20, y - 0.9, cam.position.z + Math.cos(yaw) * 20);
    };
    place(mirrorCams.centre, 0, -0.6, 1.36, back);
    // Door mirrors aim slightly outward: left mirror is on the car's left (−right).
    place(mirrorCams.left, -1.02, 0.55, 1.08, back - 0.2);
    place(mirrorCams.right, 1.02, 0.55, 1.08, back + 0.2);
    void v3;
  }

  return {
    canvas,
    loadWorld(input) {
      this.unloadWorld();
      profile = input.profile;
      env = input.env;
      world = buildWorld(input);
      actors = createActors({ profile: input.profile });
      scene.add(world.group, actors.group, actors.overlays);
      actors.playerObject.add(cockpit, pool, ...headlights, ...headTargets);
      const sideSign = input.profile.drivingSide === 'left' ? -1 : 1;
      wheelRim.position.set(sideSign * 0.36, 0.9, 0.6);
      applyEnvironment(input.env);
      needsSnap = true;
    },
    unloadWorld() {
      if (world) {
        scene.remove(world.group);
        world.dispose();
        world = null;
      }
      if (actors) {
        scene.remove(actors.group, actors.overlays);
        actors.dispose();
        actors = null;
      }
    },
    resetCamera() {
      needsSnap = true;
      lookYaw = 0;
    },
    render(ctx, view, realDt) {
      if (!world || !actors || !env) return;
      const dt = clamp(realDt, 0, 0.1);
      fps += ((dt > 0 ? 1 / dt : 60) - fps) * 0.05;
      frameIndex++;
      const p = ctx.player.vehicle;
      if (needsSnap) camYaw = p.heading;
      world.update(ctx);
      const driver = view.camera === 'driver';
      actors.sync(ctx, { scenario: view.scenario, navLine: view.navLine, hidePlayerBody: driver });
      cockpit.visible = driver;
      wheelRim.rotation.z = -p.steer * 4.2;
      placeCamera(ctx, view, dt);

      // Sun follows the player so the shadow map stays sharp.
      const dir = sun.userData.dir as THREE.Vector3;
      sun.target.position.set(p.x, 0, p.z);
      sun.position.set(p.x + dir.x * 160, dir.y * 160, p.z + dir.z * 160);

      const lightsOn = ctx.player.headlights !== 'off' && env.timeOfDay !== 'day';
      const high = ctx.player.headlights === 'high';
      for (const h of headlights) {
        h.intensity = lightsOn ? (high ? 320 : 190) : 0;
        h.distance = high ? 110 : 70;
      }
      pool.visible = lightsOn;
      pool.scale.z = high ? 40 : 24;
      pool.position.z = PLAYER_SPEC.length / 2 + (high ? 19 : 11);

      if (rain.visible) {
        rainClock += dt;
        const cx = camera.position.x;
        const cz = camera.position.z;
        for (let i = 0; i < RAIN_N; i++) {
          const sx = rainSeed[i * 3]!;
          const sy = rainSeed[i * 3 + 1]!;
          const sz = rainSeed[i * 3 + 2]!;
          const x = cx + sx * 26;
          const z = cz + sz * 26;
          const y = 14 - ((Math.abs(sy) * 16 + rainClock * 19) % 16);
          rainPos[i * 6] = x;
          rainPos[i * 6 + 1] = y;
          rainPos[i * 6 + 2] = z;
          rainPos[i * 6 + 3] = x + 0.08;
          rainPos[i * 6 + 4] = y - 0.75;
          rainPos[i * 6 + 5] = z;
        }
        rainGeo.attributes.position!.needsUpdate = true;
      }

      // Mirrors.
      const showMirrors = view.showMirrors && view.camera !== 'top';
      const q = QUALITY[quality];
      if (showMirrors) {
        const playerVisible = actors.playerObject.visible;
        actors.playerObject.visible = false;
        pool.visible = false;
        actors.overlays.visible = false;
        const shadows = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false;
        mirrorIds.forEach((id, i) => {
          const quad = mirrorQuads[id];
          const visible = quad.rect !== null;
          quad.frame.visible = quad.image.visible = visible;
          if (!visible) return;
          const recent = ctx.time - ctx.player.lastMirrorCheck[id] < 0.8;
          (quad.frame.material as THREE.MeshBasicMaterial).color.copy(recent ? frameHot : frameIdle);
          if (id !== 'centre' && q.mirrorEvery > 1 && (frameIndex + i) % q.mirrorEvery !== 0) return;
          if (id === 'centre' && q.mirrorEvery > 2 && frameIndex % 2 !== 0) return;
          renderer.setRenderTarget(mirrorTargets[id]);
          renderer.render(scene, mirrorCams[id]);
        });
        renderer.setRenderTarget(null);
        renderer.shadowMap.autoUpdate = shadows;
        actors.playerObject.visible = playerVisible;
        actors.overlays.visible = true;
        pool.visible = lightsOn;
      }

      renderer.autoClear = true;
      renderer.render(scene, camera);
      if (showMirrors) {
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(overlayScene, overlayCam);
        renderer.autoClear = true;
      }
    },
    mirrorLayout() {
      return { left: mirrorQuads.left.rect, centre: mirrorQuads.centre.rect, right: mirrorQuads.right.rect };
    },
    setQuality(q) {
      if (q === quality) return;
      quality = q;
      applyQuality();
    },
    resize,
    stats() {
      return { fps, drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    },
    dispose() {
      this.unloadWorld();
      observer?.disconnect();
      window.removeEventListener('resize', resize);
      for (const id of mirrorIds) mirrorTargets[id].dispose();
      rainGeo.dispose();
      renderer.dispose();
    },
  };
}
