/**
 * In-game HUD: instruction banner, coach panel, dashboard (speed, limit sign,
 * gear, indicators, tell-tales), observation strip, fault/praise toasts and
 * a heading-up minimap. DOM writes only happen when a shown value changes.
 */
import { blinkOn } from '../core/constants';
import { formatDistance, fromMps } from '../core/units';
import type { CameraMode, Fault, InstructionIcon, JurisdictionProfile, ScenarioState, SimContext, SpeedUnit } from '../core/types';
import { signStyleFor, signSvg } from '../signs';
import type { BuiltNetwork } from '../world/network';
import { type IconName, icon } from './icons';
import './hud.css';

export interface HudFrame {
  ctx: SimContext;
  scenario: ScenarioState;
  mirrors: { left: Box | null; centre: Box | null; right: Box | null };
  camera: CameraMode;
  device: 'keyboard' | 'gamepad' | 'touch';
  touchVisible: boolean;
}
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface HudOptions {
  root: HTMLElement;
  profile: JurisdictionProfile;
  network: BuiltNetwork;
  unit: SpeedUnit;
  feedback: 'coach' | 'exam';
  onPause(): void;
  onCamera(): void;
}
export interface Hud {
  attach(ctx: SimContext): void;
  update(frame: HudFrame): void;
  /** Show a transient message (e.g. camera name). */
  flash(text: string): void;
  dispose(): void;
}

const ICON_FOR: Record<InstructionIcon, IconName> = {
  straight: 'straight',
  left: 'turn-left',
  right: 'turn-right',
  uturn: 'u-turn',
  roundabout: 'roundabout',
  stop: 'stop-sign',
  park: 'parking',
  reverse: 'arrow-down',
  pull_over: 'map-pin',
  info: 'info',
  flag: 'flag',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text) n.textContent = text;
  return n;
};

/** Render coach text, turning [Key] tokens into key caps (or control names on touch). */
function coachNodes(text: string, device: HudFrame['device']): Node[] {
  const out: Node[] = [];
  for (const part of text.split(/(\[[^\]]+\])/g)) {
    if (!part) continue;
    const m = /^\[([^\]]+)\]$/.exec(part);
    if (m && device !== 'touch') out.push(el('kbd', 'll-kbd', m[1]!));
    else if (m) out.push(el('span', 'll-hud__ctl', TOUCH_NAMES[m[1]!] ?? m[1]!));
    else out.push(document.createTextNode(part));
  }
  return out;
}
const TOUCH_NAMES: Record<string, string> = {
  W: 'GAS', S: 'BRAKE', A: 'the wheel', D: 'the wheel', Q: '◄', E: '►', T: '⚠', Z: '◄ LOOK', X: 'BACK', C: 'LOOK ►',
  '1': 'L', '2': 'C', '3': 'R', P: 'P', R: 'R', N: 'N', F: 'D', Space: 'Ⓟ', L: '⋯ Lights', K: '⋯ Wipers', B: '⋯ Seatbelt', I: '⋯ Engine', H: '⋯ Horn', V: 'the camera button',
};

export function createHud(opts: HudOptions): Hud {
  const { profile, unit } = opts;
  const hud = el('div', 'll-hud');
  hud.dataset.feedback = opts.feedback;

  /* top: instruction */
  const top = el('div', 'll-hud__top');
  const banner = el('div', 'll-hud__banner');
  banner.setAttribute('aria-live', 'polite');
  const bannerIcon = el('span', 'll-hud__banner-icon');
  const bannerText = el('span', 'll-hud__banner-text');
  const bannerDist = el('span', 'll-hud__banner-dist');
  banner.append(bannerIcon, bannerText, bannerDist);
  const flashEl = el('div', 'll-hud__flash');
  top.append(banner, flashEl);

  /* buttons */
  const buttons = el('div', 'll-hud__buttons');
  const mkBtn = (name: IconName, label: string, fn: () => void): HTMLButtonElement => {
    const b = el('button', 'll-hud__btn');
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(name, { size: 22 }));
    b.addEventListener('click', fn);
    return b;
  };
  const tally = el('div', 'll-hud__tally');
  buttons.append(tally, mkBtn('camera', 'Change camera (V)', opts.onCamera), mkBtn('pause', 'Pause (Esc)', opts.onPause));

  /* toasts */
  const toasts = el('div', 'll-hud__toasts');
  toasts.setAttribute('aria-live', 'polite');

  /* coach + progress */
  const coach = el('div', 'll-hud__coach');
  const coachText = el('div', 'll-hud__coach-text');
  const progress = el('div', 'll-hud__progress');
  const progressBar = el('div', 'll-hud__progress-bar');
  progress.append(progressBar);
  coach.append(coachText, progress);

  /* dashboard */
  const dash = el('div', 'll-hud__dash');
  const indL = el('span', 'll-hud__ind ll-hud__ind--l', '◄');
  const indR = el('span', 'll-hud__ind ll-hud__ind--r', '►');
  const speedBox = el('div', 'll-hud__speed');
  const speedNum = el('span', 'll-hud__speed-num', '0');
  const speedUnit = el('span', 'll-hud__speed-unit', unit);
  speedBox.append(speedNum, speedUnit);
  const limit = el('div', 'll-hud__limit');
  const gears = el('div', 'll-hud__gears');
  const gearEls = (['P', 'R', 'N', 'D'] as const).map((g) => {
    const s = el('span', 'll-hud__gear', g);
    gears.append(s);
    return s;
  });
  const tells = el('div', 'll-hud__tells');
  const tell = (name: IconName, label: string): HTMLElement => {
    const t = el('span', 'll-hud__tell');
    t.title = label;
    t.append(icon(name, { size: 18 }));
    tells.append(t);
    return t;
  };
  const tHand = tell('handbrake', `${profile.terms.parkingBrake} on`);
  const tBelt = tell('seatbelt', 'Seatbelt');
  const tLights = tell('headlights', 'Headlights');
  const tWipers = tell('wipers', 'Wipers');
  const tEngine = tell('power', 'Engine');
  const obs = el('div', 'll-hud__obs');
  const obsEls = (['shoulderL', 'left', 'centre', 'right', 'shoulderR'] as const).map((k) => {
    const s = el('span', `ll-hud__obs-item ll-hud__obs-item--${k}`);
    s.append(icon(k.startsWith('shoulder') ? 'eye' : 'mirror', { size: 16 }));
    s.title = k === 'shoulderL' ? 'Left shoulder check' : k === 'shoulderR' ? 'Right shoulder check' : `${k} mirror`;
    obs.append(s);
    return s;
  });
  const lookLabel = el('div', 'll-hud__look');
  const row = el('div', 'll-hud__dash-row');
  row.append(indL, speedBox, limit, gears, indR);
  dash.append(lookLabel, obs, row, tells);

  /* minimap */
  const map = el('canvas', 'll-hud__map');
  const MAP = 168;
  map.width = MAP * 2;
  map.height = MAP * 2;
  const mctx = map.getContext('2d')!;
  const net = opts.network;
  const nb = net.bounds;
  const off = document.createElement('canvas');
  const OS = 2; // pixels per metre in the pre-rendered town
  off.width = Math.ceil((nb.maxX - nb.minX) * OS);
  off.height = Math.ceil((nb.maxZ - nb.minZ) * OS);
  {
    const c = off.getContext('2d')!;
    c.scale(OS, OS);
    c.translate(-nb.minX, -nb.minZ);
    c.lineCap = 'butt';
    for (const zone of net.zones.values()) {
      c.fillStyle = '#3b4763';
      c.fillRect(zone.rect.minX, zone.rect.minZ, zone.rect.maxX - zone.rect.minX, zone.rect.maxZ - zone.rect.minZ);
      c.fillRect(zone.driveway.minX, zone.driveway.minZ, zone.driveway.maxX - zone.driveway.minX, zone.driveway.maxZ - zone.driveway.minZ);
    }
    for (const road of net.roads.values()) {
      c.strokeStyle = '#56648a';
      c.lineWidth = road.carriagewayWidth + 3;
      c.beginPath();
      c.moveTo(road.start.x, road.start.z);
      c.lineTo(road.end.x, road.end.z);
      c.stroke();
    }
    for (const node of net.nodes.values()) {
      if (!node.roundabout) continue;
      c.fillStyle = '#56648a';
      c.beginPath();
      c.arc(node.pos.x, node.pos.z, node.roundabout.outerRadius + 2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#1b2540';
      c.beginPath();
      c.arc(node.pos.x, node.pos.z, node.roundabout.islandRadius - 1, 0, Math.PI * 2);
      c.fill();
    }
  }

  hud.append(top, buttons, toasts, coach, dash, map);
  opts.root.append(hud);

  /* ---- cached values so we only touch the DOM on change ---- */
  const cache: Record<string, unknown> = {};
  const set = (key: string, value: unknown, apply: () => void): void => {
    if (cache[key] === value) return;
    cache[key] = value;
    apply();
  };
  const signStyle = signStyleFor(profile);
  let unsub: (() => void)[] = [];
  let lastMap = 0;
  let minor = 0;
  let serious = 0;
  let flashTimer = 0;

  function toast(kind: 'minor' | 'serious' | 'dangerous' | 'good' | 'info', title: string, body: string, ms: number): void {
    const t = el('div', `ll-hud__toast ll-hud__toast--${kind}`);
    const head = el('div', 'll-hud__toast-head');
    head.append(icon(kind === 'good' ? 'check-circle' : kind === 'info' ? 'info' : 'warning-triangle', { size: 18 }), el('strong', '', title));
    if (kind !== 'good' && kind !== 'info') head.append(el('span', 'll-hud__sev', kind));
    t.append(head);
    if (body) t.append(el('div', 'll-hud__toast-body', body));
    toasts.prepend(t);
    while (toasts.children.length > 3) toasts.lastElementChild!.remove();
    window.setTimeout(() => t.classList.add('is-leaving'), ms - 300);
    window.setTimeout(() => t.remove(), ms);
  }

  const updateTally = (): void => {
    tally.textContent = '';
    if (opts.feedback !== 'coach' || minor + serious === 0) return;
    if (minor) tally.append(el('span', 'll-hud__chip ll-hud__chip--warn', `${minor} minor`));
    if (serious) tally.append(el('span', 'll-hud__chip ll-hud__chip--bad', `${serious} serious`));
  };

  return {
    attach(ctx) {
      unsub.forEach((u) => u());
      minor = serious = 0;
      updateTally();
      unsub = [
        ctx.events.on('fault', (f: Fault) => {
          if (f.severity === 'minor') minor++;
          else serious++;
          if (opts.feedback !== 'coach') return;
          updateTally();
          toast(f.severity, f.title, f.tip, f.severity === 'minor' ? 5200 : 7000);
        }),
        ctx.events.on('praise', (p) => {
          if (opts.feedback === 'coach') toast('good', p.text, '', 2400);
        }),
        ctx.events.on('coach', (c) => toast(c.tone === 'good' ? 'good' : c.tone === 'warn' ? 'minor' : 'info', c.text, '', 3800)),
      ];
    },
    flash(text) {
      flashEl.textContent = text;
      flashEl.classList.add('is-on');
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => flashEl.classList.remove('is-on'), 1400);
    },
    update(frame) {
      const { ctx, scenario } = frame;
      const p = ctx.player;
      const v = p.vehicle;

      // Layout around the mirror panels and touch controls.
      const cm = frame.mirrors.centre;
      set('topY', cm ? Math.round(cm.y + cm.height + 10) : 10, () => (top.style.top = `${cache.topY}px`));
      const sm = frame.mirrors.left;
      set('sideY', sm ? Math.round(sm.y + sm.height + 10) : 10, () => {
        toasts.style.top = `${cache.sideY}px`;
        buttons.style.top = `${cache.sideY}px`;
      });
      set('touch', frame.touchVisible, () => hud.classList.toggle('ll-hud--touch', frame.touchVisible));

      // Instruction.
      const ins = scenario.instruction;
      set('insId', ins ? ins.id : -1, () => {
        banner.classList.toggle('is-on', !!ins);
        if (!ins) return;
        bannerIcon.textContent = '';
        bannerIcon.append(icon(ICON_FOR[ins.icon], { size: 30 }));
        if (ins.exit) bannerIcon.append(el('b', 'll-hud__exit', String(ins.exit)));
        bannerText.textContent = ins.text;
        banner.classList.remove('is-new');
        void banner.offsetWidth;
        banner.classList.add('is-new');
      });
      const dist = ins && ins.distance !== null && ins.distance > 8 ? formatDistance(ins.distance, unit) : '';
      set('insDist', dist, () => (bannerDist.textContent = dist));

      // Coach text + progress.
      set('coach', `${scenario.coach ?? ''}|${frame.device}`, () => {
        coach.classList.toggle('is-on', !!scenario.coach);
        coachText.textContent = '';
        if (scenario.coach) coachText.append(...coachNodes(scenario.coach, frame.device));
      });
      set('progress', scenario.totalSteps > 1 ? scenario.step / scenario.totalSteps : -1, () => {
        const f = cache.progress as number;
        progress.hidden = f < 0;
        progressBar.style.width = `${Math.round(Math.max(0, f) * 100)}%`;
      });

      // Speed and limit.
      const speed = Math.round(Math.abs(fromMps(v.speed, unit)));
      set('speed', speed, () => (speedNum.textContent = String(speed)));
      const loc = p.location;
      const limitMps = loc.kind === 'lane' || loc.kind === 'parking_strip' ? loc.lane.speedLimit : loc.kind === 'zone' ? -1 : (cache.limitMps as number | undefined) ?? -1;
      cache.limitMps = limitMps;
      const limitVal = limitMps > 0 ? Math.round(fromMps(limitMps, unit)) : 0;
      set('limit', limitVal, () => {
        limit.innerHTML = limitVal ? signSvg('speed_limit', signStyle, { value: limitVal }) : '';
      });
      const over = limitVal ? Math.abs(fromMps(v.speed, unit)) - limitVal : 0;
      set('over', over > limitVal * 0.1 + 1 ? 'bad' : over > 1 ? 'warn' : '', () => (speedBox.dataset.over = cache.over as string));

      // Gear, indicators, tell-tales.
      set('gear', p.gear, () => gearEls.forEach((g) => g.classList.toggle('is-on', g.textContent === p.gear)));
      const on = blinkOn(ctx.time);
      set('indL', on && (p.indicator === 'left' || p.indicator === 'hazard'), () => indL.classList.toggle('is-on', cache.indL as boolean));
      set('indR', on && (p.indicator === 'right' || p.indicator === 'hazard'), () => indR.classList.toggle('is-on', cache.indR as boolean));
      set('hand', p.handbrake, () => tHand.classList.toggle('is-bad', p.handbrake));
      set('belt', p.seatbelt, () => tBelt.classList.toggle('is-bad', !p.seatbelt));
      set('lights', p.headlights, () => {
        tLights.classList.toggle('is-on', p.headlights !== 'off');
        tLights.classList.toggle('is-high', p.headlights === 'high');
      });
      set('wipers', p.wipers, () => tWipers.classList.toggle('is-on', p.wipers));
      set('engine', p.engineOn, () => tEngine.classList.toggle('is-bad', !p.engineOn));

      // Observation feedback.
      const recent = (t: number): boolean => ctx.time - t < 1;
      const flags = [recent(p.lastShoulderCheck.left), recent(p.lastMirrorCheck.left), recent(p.lastMirrorCheck.centre), recent(p.lastMirrorCheck.right), recent(p.lastShoulderCheck.right)];
      flags.forEach((f, i) => set(`obs${i}`, f, () => obsEls[i]!.classList.toggle('is-on', f)));
      const lookText = p.look === 'left' ? 'Looking left' : p.look === 'right' ? 'Looking right' : p.look === 'back' ? 'Looking behind' : '';
      set('look', lookText, () => (lookLabel.textContent = lookText));

      // Minimap (≤ 12 fps).
      if (ctx.time - lastMap > 0.08 || ctx.time < lastMap) {
        lastMap = ctx.time;
        const s = 1.15; // px per metre
        const cx = MAP;
        const cy = MAP * 1.25;
        const fx = Math.sin(v.heading);
        const fz = Math.cos(v.heading);
        const rx = -fz;
        const rz = fx;
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.clearRect(0, 0, MAP * 2, MAP * 2);
        mctx.save();
        mctx.beginPath();
        mctx.arc(MAP, MAP, MAP - 2, 0, Math.PI * 2);
        mctx.clip();
        mctx.fillStyle = 'rgba(12,18,32,0.82)';
        mctx.fillRect(0, 0, MAP * 2, MAP * 2);
        mctx.setTransform(rx * s * 2, -fx * s * 2, rz * s * 2, -fz * s * 2, cx - (v.x * rx + v.z * rz) * s * 2, cy + (v.x * fx + v.z * fz) * s * 2);
        mctx.drawImage(off, nb.minX, nb.minZ, nb.maxX - nb.minX, nb.maxZ - nb.minZ);
        if (scenario.route.length > 1) {
          mctx.strokeStyle = '#45b0ff';
          mctx.lineWidth = 3.4;
          mctx.lineJoin = 'round';
          mctx.beginPath();
          scenario.route.forEach((q, i) => (i ? mctx.lineTo(q.x, q.z) : mctx.moveTo(q.x, q.z)));
          mctx.stroke();
        }
        for (const t of scenario.targets) {
          mctx.fillStyle = t.state === 'done' ? '#2fbf71' : t.state === 'active' ? '#ffd23f' : 'rgba(255,255,255,0.5)';
          mctx.beginPath();
          mctx.arc(t.obb.x, t.obb.z, 3.4, 0, Math.PI * 2);
          mctx.fill();
        }
        mctx.fillStyle = '#e8ecf5';
        for (const o of ctx.vehicles) {
          if (o.kind !== 'ai') continue;
          mctx.beginPath();
          mctx.arc(o.x, o.z, 2.1, 0, Math.PI * 2);
          mctx.fill();
        }
        mctx.setTransform(1, 0, 0, 1, 0, 0);
        mctx.fillStyle = '#ffd23f';
        mctx.strokeStyle = '#0c1220';
        mctx.lineWidth = 3;
        mctx.beginPath();
        mctx.moveTo(cx, cy - 15);
        mctx.lineTo(cx + 10, cy + 11);
        mctx.lineTo(cx, cy + 5);
        mctx.lineTo(cx - 10, cy + 11);
        mctx.closePath();
        mctx.stroke();
        mctx.fill();
        mctx.restore();
      }
    },
    dispose() {
      unsub.forEach((u) => u());
      window.clearTimeout(flashTimer);
      hud.remove();
    },
  };
}
