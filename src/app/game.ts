/**
 * The driving part of the app: owns the canvas, renderer, input and HUD, runs
 * the fixed-step loop for one Session at a time and reports the result.
 */
import { SIM_DT } from '../core/constants';
import type { AppSettings, CameraMode, ControlInput, JurisdictionProfile, SessionResult, SessionSettings, SpeedUnit } from '../core/types';
import { type InputManager, createInput } from '../input';
import { type GameRenderer, createRenderer } from '../render/renderer';
import { type Autopilot, createAutopilot } from '../scenarios/autopilot';
import { type Session, createSession } from '../sim/session';
import { type Hud, createHud } from '../ui/hud';
import { type AudioEngine, createAudio } from '../audio';
import type { Store } from './settings';

export interface GameCallbacks {
  /** The scenario finished (completed or failed). `demo` = the instructor was driving. */
  onEnd(result: SessionResult, demo: boolean): void;
  /** The player asked to pause. */
  onPause(): void;
}

export interface Game {
  /** Start driving a scenario. With `demo`, the instructor's autopilot drives and the learner watches. */
  start(scenarioId: string, profile: JurisdictionProfile, settings: SessionSettings, opts?: { demo?: boolean }): void;
  isDemo(): boolean;
  /** Show the town behind the menus (no HUD, no input). */
  idle(profile: JurisdictionProfile): void;
  /** Freeze/unfreeze the simulation (pause menu). */
  setPaused(paused: boolean): void;
  /** End the current drive early and get its result (null if not driving). */
  abort(): SessionResult | null;
  isDriving(): boolean;
  readonly input: InputManager;
  readonly session: Session | null;
  readonly audio: AudioEngine;
  cycleCamera(): void;
}

const CAMERAS: CameraMode[] = ['chase', 'hood', 'driver', 'top'];
const CAMERA_NAMES: Record<CameraMode, string> = { chase: 'Chase view', hood: 'Bonnet view', driver: "Driver's view", top: 'Top view' };
const NO_INPUT: ControlInput = { throttle: 0, brake: 0, steer: 0, look: 'ahead', horn: false, commands: [] };

export function createGame(root: HTMLElement, settings: Store<AppSettings>, callbacks: GameCallbacks): Game {
  const stage = document.createElement('div');
  stage.className = 'll-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'll-stage__canvas';
  canvas.setAttribute('aria-label', 'Driving view');
  const hudRoot = document.createElement('div');
  hudRoot.className = 'll-stage__layer';
  const touchRoot = document.createElement('div');
  touchRoot.className = 'll-stage__layer';
  stage.append(canvas, hudRoot, touchRoot);
  root.append(stage);

  const renderer: GameRenderer = createRenderer(canvas, { quality: settings.get().graphics });
  const audio = createAudio();
  audio.setVolume(settings.get().volume);
  const unlock = (): void => audio.unlock();
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  const VOICE_LANG: Record<string, string> = { US: 'en-US', GB: 'en-GB', IE: 'en-IE', CA: 'en-CA', AU: 'en-AU', NZ: 'en-NZ', IN: 'en-IN', DE: 'en-GB' };
  let session: Session | null = null;
  let hud: Hud | null = null;
  let driving = false;
  let paused = false;
  let pilot: Autopilot | null = null;
  let endTimer = 0;
  let unit: SpeedUnit = 'mph';

  const input = createInput({
    touchRoot,
    getSettings: () => settings.get(),
    getDisplayState: () => {
      if (!session) return null;
      const p = session.ctx.player;
      return { gear: p.gear, indicator: p.indicator, handbrake: p.handbrake, engineOn: p.engineOn, seatbelt: p.seatbelt, headlights: p.headlights, wipers: p.wipers, unit };
    },
  });
  input.setEnabled(false);
  input.onAction((a) => {
    if (!driving) return;
    if (a === 'pause') callbacks.onPause();
    else if (a === 'camera' && !paused) game.cycleCamera();
  });
  settings.subscribe((s) => {
    renderer.setQuality(s.graphics);
    audio.setVolume(s.volume);
  });

  function load(scenarioId: string, profile: JurisdictionProfile, sessionSettings: SessionSettings): void {
    hud?.dispose();
    hud = null;
    session?.dispose();
    session = createSession({ scenarioId, profile, settings: sessionSettings, steeringSensitivity: settings.get().steeringSensitivity });
    renderer.loadWorld({ network: session.network, profile, scenery: session.scenery, env: session.ctx.env });
    renderer.resetCamera();
    const su = settings.get().speedUnit;
    unit = su === 'auto' ? profile.speedUnit : su;
    endTimer = 0;
    paused = false;
  }

  let last = performance.now();
  let acc = 0;
  let frame = 0;
  function loop(now: number): void {
    requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!session) return;
    const s = settings.get();
    if (!paused) {
      acc += dt;
      let first = true;
      const polled = driving ? input.poll() : NO_INPUT;
      let steps = 0;
      while (acc >= SIM_DT && steps < 6) {
        session.tick(pilot ? pilot.input() : first ? polled : { ...polled, commands: [] });
        first = false;
        acc -= SIM_DT;
        steps++;
      }
      if (steps === 6) acc = 0;
    }
    renderer.render(
      session.ctx,
      { camera: driving ? s.camera : 'chase', showMirrors: driving && s.showMirrors, navLine: s.navLine && session.ctx.settings.feedback === 'coach', scenario: session.scenario, reducedMotion: s.reducedMotion },
      dt,
    );
    if (driving && !paused) {
      const pl = session.ctx.player;
      audio.update({ time: session.ctx.time, engineOn: pl.engineOn, throttle: pl.throttle, speed: Math.abs(pl.vehicle.speed), indicator: pl.indicator, horn: pl.horn, raining: session.ctx.env.weather === 'rain' });
    } else audio.silence();
    if (driving && hud) {
      hud.update({ ctx: session.ctx, scenario: session.scenario, mirrors: s.showMirrors && s.camera !== 'top' ? renderer.mirrorLayout() : { left: null, centre: null, right: null }, camera: s.camera, device: input.lastDevice(), touchVisible: input.touchVisible() });
      if (++frame % 6 === 0) input.refresh();
      if (session.ended && !paused) {
        endTimer += dt;
        if (endTimer > 1.6) {
          const result = session.result(Date.now());
          const wasDemo = pilot !== null;
          driving = false;
          pilot = null;
          input.setEnabled(false);
          hud.dispose();
          hud = null;
          callbacks.onEnd(result, wasDemo);
        }
      }
    }
  }
  requestAnimationFrame(loop);

  const game: Game = {
    input,
    audio,
    get session() {
      return session;
    },
    start(scenarioId, profile, sessionSettings, opts = {}) {
      load(scenarioId, profile, sessionSettings);
      pilot = opts.demo ? createAutopilot(session!) : null;
      driving = true;
      input.setEnabled(true);
      hud = createHud({
        root: hudRoot,
        profile,
        network: session!.network,
        unit,
        feedback: sessionSettings.feedback,
        onPause: () => callbacks.onPause(),
        onCamera: () => game.cycleCamera(),
      });
      hud.attach(session!.ctx);
      const events = session!.ctx.events;
      const coachOn = sessionSettings.feedback === 'coach';
      audio.setVoice(settings.get().voice, VOICE_LANG[profile.countryCode] ?? 'en-US');
      events.on('fault', (f) => coachOn && audio.play(f.severity === 'minor' ? 'fault_minor' : 'fault_serious'));
      events.on('praise', () => coachOn && audio.play('praise'));
      events.on('instruction', (ins) => {
        audio.play('instruction');
        audio.speak(ins.text);
      });
      events.on('step', () => audio.play('step'));
      events.on('collision', () => audio.play('collision'));
      events.on('command', () => audio.play('switch'));
      events.on('ended', (e) => audio.play(e.status === 'completed' ? 'success' : 'fail'));
      if (pilot) hud.flash('Instructor demo — press Esc to stop');
      canvas.focus();
    },
    isDemo: () => pilot !== null,
    idle(profile) {
      driving = false;
      pilot = null;
      input.setEnabled(false);
      load('idle', profile, { ...settings.get().session, traffic: 'normal', pedestrians: 'few', weather: 'clear', timeOfDay: 'day', feedback: 'exam', seed: 7 });
    },
    setPaused(value) {
      paused = value;
      input.setEnabled(driving && !value);
    },
    abort() {
      if (!driving || !session) return null;
      const result = session.result(Date.now(), !session.ended);
      driving = false;
      pilot = null;
      input.setEnabled(false);
      hud?.dispose();
      hud = null;
      return result;
    },
    isDriving: () => driving,
    cycleCamera() {
      const current = settings.get().camera;
      const next = CAMERAS[(CAMERAS.indexOf(current) + 1) % CAMERAS.length]!;
      settings.set({ camera: next });
      hud?.flash(CAMERA_NAMES[next]);
    },
  };
  return game;
}
