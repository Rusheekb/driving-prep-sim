/**
 * Keyboard, gamepad and touch → the simulator's ControlInput, plus a few UI
 * actions (pause, camera). The touch overlay is plain DOM so it works on any
 * phone or tablet.
 */
import type { ControlInput, Gear, LookDir, PlayerCommand } from '../core/types';
import { KEYBOARD_BINDINGS, keyTargetForCode } from './bindings';
import { applyDeadzone, pedalValue, stickSteer, triggerValue } from './steerMath';
import './touch.css';
import type { DeviceSample, InputDevice, InputSettings, TouchDisplayState, UiAction } from './types';
import { neutralSample } from './types';

export { GAMEPAD_BINDINGS, KEY_BINDINGS } from './bindings';
export type { InputDevice, TouchDisplayState, UiAction } from './types';

export interface InputOptions {
  /** Container the touch overlay is appended to. */
  touchRoot: HTMLElement;
  getSettings: () => InputSettings;
  /** Current car state so touch buttons can show it and the gamepad can step through gears. */
  getDisplayState?: () => TouchDisplayState | null;
}

export interface InputManager {
  /** Call once per rendered frame: current analog state; DRAINS queued commands. */
  poll(): ControlInput;
  onAction(handler: (a: UiAction) => void): () => void;
  /** When false, driving input is ignored (menus / pause); UI actions still fire. */
  setEnabled(enabled: boolean): void;
  lastDevice(): InputDevice;
  /** True while the touch overlay is on screen. */
  touchVisible(): boolean;
  /** Refresh touch button states; cheap. */
  refresh(): void;
  dispose(): void;
}

const GEARS: Gear[] = ['P', 'R', 'N', 'D'];
const WHEEL_LOCK = (100 * Math.PI) / 180;

export function createInput(opts: InputOptions): InputManager {
  const commands: PlayerCommand[] = [];
  const handlers = new Set<(a: UiAction) => void>();
  let enabled = true;
  let device: InputDevice = 'keyboard';
  const emit = (a: UiAction): void => handlers.forEach((h) => h(a));

  /* ------------------------------ keyboard ------------------------------ */
  const down = new Set<string>();
  const lookStack: { code: string; dir: LookDir }[] = [];
  const isTyping = (t: EventTarget | null): boolean => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const target = keyTargetForCode(e.code);
    if (!target) return;
    if (target.kind === 'ui') {
      // Esc is left to dialogs/menus when the game is not running.
      if (!e.repeat && (enabled || target.action === 'pause')) {
        if (enabled) e.preventDefault();
        emit(target.action);
      }
      return;
    }
    if (!enabled) return;
    e.preventDefault();
    device = 'keyboard';
    if (e.repeat) return;
    down.add(e.code);
    if (target.kind === 'command') commands.push(target.command);
    else if (target.kind === 'look') lookStack.push({ code: e.code, dir: target.dir });
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    down.delete(e.code);
    const i = lookStack.findIndex((l) => l.code === e.code);
    if (i >= 0) lookStack.splice(i, 1);
  };
  const releaseAll = (): void => {
    down.clear();
    lookStack.length = 0;
    kThrottle = 0;
    kBrake = 0;
    touch.throttle = touch.brake = touch.steer = 0;
    touch.look = 'ahead';
    touch.horn = false;
    wheelAngle = 0;
    paintWheel();
  };
  const held = (hold: string): boolean =>
    KEYBOARD_BINDINGS.some((b) => b.target.kind === 'hold' && b.target.hold === hold && b.codes.some((c) => down.has(c)));
  let kThrottle = 0;
  let kBrake = 0;
  let kLast = performance.now();
  /** Digital keys become progressive pedals: quick to a moderate level, then building to full while held. */
  const ramp = (value: number, isDown: boolean, dt: number, quick: number): number => {
    if (!isDown) return Math.max(0, value - dt * 6);
    return value < quick ? Math.min(quick, value + dt * 4) : Math.min(1, value + dt * 0.75);
  };
  const keyboardSample = (): DeviceSample => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - kLast) / 1000);
    kLast = now;
    kThrottle = ramp(kThrottle, held('throttle'), dt, 0.55);
    kBrake = ramp(kBrake, held('brake'), dt, 0.42);
    return keyboardBase();
  };
  const keyboardBase = (): DeviceSample => ({
    throttle: kThrottle,
    brake: kBrake,
    steer: (held('steerRight') ? 1 : 0) - (held('steerLeft') ? 1 : 0),
    look: lookStack.length ? lookStack[lookStack.length - 1]!.dir : 'ahead',
    horn: held('horn'),
  });

  /* ------------------------------ gamepad ------------------------------- */
  let prevButtons: boolean[] = [];
  const gamepadSample = (): DeviceSample => {
    const s = neutralSample();
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard') ?? [...pads].find((p) => p && p.connected);
    if (!pad) {
      prevButtons = [];
      return s;
    }
    const pressed = pad.buttons.map((b) => b.pressed);
    const edge = (i: number): boolean => !!pressed[i] && !prevButtons[i];
    const sens = opts.getSettings().steeringSensitivity;
    s.steer = stickSteer(pad.axes[0] ?? 0, sens);
    s.throttle = triggerValue(pad.buttons[7]?.value ?? 0);
    s.brake = triggerValue(pad.buttons[6]?.value ?? 0);
    s.horn = !!pressed[2];
    const rx = applyDeadzone(pad.axes[2] ?? 0, 0.6);
    const ry = pad.axes[3] ?? 0;
    s.look = ry > 0.6 ? 'back' : rx < 0 ? 'left' : rx > 0 ? 'right' : 'ahead';
    if (enabled) {
      const state = opts.getDisplayState?.();
      const shift = (dir: 1 | -1): void => {
        const i = GEARS.indexOf(state ? state.gear : 'P');
        const next = GEARS[Math.max(0, Math.min(GEARS.length - 1, i + dir))]!;
        commands.push({ type: 'gear', gear: next });
      };
      if (edge(4)) commands.push({ type: 'indicator', value: 'left' });
      if (edge(5)) commands.push({ type: 'indicator', value: 'right' });
      if (edge(0)) commands.push({ type: 'handbrake' });
      if (edge(1)) shift(-1);
      if (edge(3)) shift(1);
      if (edge(14)) commands.push({ type: 'mirror', mirror: 'left' });
      if (edge(12)) commands.push({ type: 'mirror', mirror: 'centre' });
      if (edge(15)) commands.push({ type: 'mirror', mirror: 'right' });
      if (edge(13)) commands.push({ type: 'indicator', value: 'hazard' });
      if (edge(10)) commands.push({ type: 'seatbelt' });
      if (edge(11)) commands.push({ type: 'headlights' });
    }
    if (edge(9)) emit('pause');
    if (edge(8) && enabled) emit('camera');
    if (pressed.some(Boolean) || Math.abs(s.steer) > 0.2 || s.throttle > 0.1 || s.brake > 0.1) device = 'gamepad';
    prevButtons = pressed;
    return s;
  };

  /* ------------------------------- touch -------------------------------- */
  const touch = neutralSample();
  let wheelAngle = 0;
  let touchSeen = false;
  const root = document.createElement('div');
  root.className = 'll-touch';
  root.hidden = true;
  root.setAttribute('aria-label', 'Touch driving controls');
  opts.touchRoot.appendChild(root);

  const el = (tag: string, cls: string, html = ''): HTMLElement => {
    const n = document.createElement(tag);
    n.className = cls;
    n.innerHTML = html;
    return n;
  };
  /** A button that fires on pointer-down (no click delay) and optionally tracks being held. */
  const button = (cls: string, label: string, aria: string, onDown: () => void, onUp?: () => void): HTMLButtonElement => {
    const b = el('button', `ll-touch__btn ${cls}`, label) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-label', aria);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('is-down');
      device = 'touch';
      onDown();
    });
    const up = (): void => {
      b.classList.remove('is-down');
      onUp?.();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  };
  const cmd = (c: PlayerCommand) => (): void => {
    if (enabled) commands.push(c);
  };

  // Steering wheel.
  const wheel = el('div', 'll-touch__wheel');
  wheel.setAttribute('role', 'slider');
  wheel.setAttribute('aria-label', 'Steering wheel');
  const wheelFace = el(
    'div',
    'll-touch__wheel-face',
    '<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="50" cy="50" r="11" fill="currentColor"/><path d="M9 50H39M61 50H91M50 61V91" stroke="currentColor" stroke-width="8" stroke-linecap="round"/><rect x="46" y="3" width="8" height="11" rx="2" fill="#ffd23f"/></svg>',
  );
  wheel.appendChild(wheelFace);
  const paintWheel = (): void => {
    wheelFace.style.transform = `rotate(${(wheelAngle * 180) / Math.PI}deg)`;
  };
  let wheelPointer: number | null = null;
  let lastA = 0;
  const pointerAngle = (e: PointerEvent): number => {
    const r = wheel.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  wheel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    wheel.setPointerCapture(e.pointerId);
    wheelPointer = e.pointerId;
    lastA = pointerAngle(e);
    device = 'touch';
  });
  wheel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== wheelPointer) return;
    const a = pointerAngle(e);
    let d = a - lastA;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    lastA = a;
    wheelAngle = Math.max(-WHEEL_LOCK, Math.min(WHEEL_LOCK, wheelAngle + d));
    touch.steer = wheelAngle / WHEEL_LOCK;
    paintWheel();
  });
  const wheelUp = (e: PointerEvent): void => {
    if (e.pointerId !== wheelPointer) return;
    wheelPointer = null;
  };
  wheel.addEventListener('pointerup', wheelUp);
  wheel.addEventListener('pointercancel', wheelUp);

  // Pedals.
  const pedal = (cls: string, label: string, set: (v: number) => void): HTMLElement => {
    const p = el('div', `ll-touch__pedal ${cls}`, `<span>${label}</span>`);
    p.setAttribute('role', 'button');
    p.setAttribute('aria-label', label);
    const read = (e: PointerEvent): void => {
      const r = p.getBoundingClientRect();
      set(pedalValue(e.clientY - r.top, r.height));
    };
    p.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      p.setPointerCapture(e.pointerId);
      p.classList.add('is-down');
      device = 'touch';
      read(e);
    });
    p.addEventListener('pointermove', (e) => {
      if (p.classList.contains('is-down')) read(e);
    });
    const up = (): void => {
      p.classList.remove('is-down');
      set(0);
    };
    p.addEventListener('pointerup', up);
    p.addEventListener('pointercancel', up);
    return p;
  };
  const pedals = el('div', 'll-touch__pedals');
  pedals.append(
    pedal('ll-touch__pedal--brake', 'BRAKE', (v) => (touch.brake = v)),
    pedal('ll-touch__pedal--gas', 'GAS', (v) => (touch.throttle = v)),
  );

  // Left cluster: indicators + hazards.
  const left = el('div', 'll-touch__cluster ll-touch__cluster--left');
  const indL = button('ll-touch__btn--ind', '◄', 'Signal left', cmd({ type: 'indicator', value: 'left' }));
  const indR = button('ll-touch__btn--ind', '►', 'Signal right', cmd({ type: 'indicator', value: 'right' }));
  const haz = button('ll-touch__btn--small', '⚠', 'Hazard lights', cmd({ type: 'indicator', value: 'hazard' }));
  left.append(indL, haz, indR);

  // Right cluster: gears + parking brake.
  const right = el('div', 'll-touch__cluster ll-touch__cluster--right');
  const gearBtns = GEARS.map((g) => button('ll-touch__btn--gear', g, `Gear ${g}`, cmd({ type: 'gear', gear: g })));
  const hb = button('ll-touch__btn--small', 'Ⓟ', 'Parking brake', cmd({ type: 'handbrake' }));
  right.append(...gearBtns, hb);

  // Top clusters: observation.
  const look = (dir: Exclude<LookDir, 'ahead'>, label: string, aria: string): HTMLButtonElement =>
    button(
      'll-touch__btn--look',
      label,
      aria,
      () => (touch.look = dir),
      () => {
        if (touch.look === dir) touch.look = 'ahead';
      },
    );
  const obsL = el('div', 'll-touch__cluster ll-touch__cluster--obs-left');
  obsL.append(look('left', '◄ LOOK', 'Look over left shoulder'), button('ll-touch__btn--small', 'L', 'Check left mirror', cmd({ type: 'mirror', mirror: 'left' })), button('ll-touch__btn--small', 'C', 'Check centre mirror', cmd({ type: 'mirror', mirror: 'centre' })));
  const obsR = el('div', 'll-touch__cluster ll-touch__cluster--obs-right');
  obsR.append(button('ll-touch__btn--small', 'R', 'Check right mirror', cmd({ type: 'mirror', mirror: 'right' })), look('back', 'BACK', 'Look behind'), look('right', 'LOOK ►', 'Look over right shoulder'));

  // "More" panel.
  const more = el('div', 'll-touch__more');
  more.hidden = true;
  const moreBtn = button('ll-touch__btn--small ll-touch__btn--more', '⋯', 'More controls', () => (more.hidden = !more.hidden));
  const belt = button('ll-touch__btn--wide', 'Seatbelt', 'Seatbelt', cmd({ type: 'seatbelt' }));
  const eng = button('ll-touch__btn--wide', 'Engine', 'Engine start or stop', cmd({ type: 'engine' }));
  const lights = button('ll-touch__btn--wide', 'Lights', 'Headlights', cmd({ type: 'headlights' }));
  const wip = button('ll-touch__btn--wide', 'Wipers', 'Wipers', cmd({ type: 'wipers' }));
  const horn = button(
    'll-touch__btn--wide',
    'Horn',
    'Horn',
    () => (touch.horn = true),
    () => (touch.horn = false),
  );
  more.append(belt, eng, lights, wip, horn);
  right.append(moreBtn);
  root.append(wheel, pedals, left, right, obsL, obsR, more);

  const onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'touch') touchSeen = true;
  };
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', releaseAll);
  const onVisibility = (): void => {
    if (document.hidden) releaseAll();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const touchWanted = (): boolean => {
    const mode = opts.getSettings().touchControls;
    return enabled && (mode === 'on' || (mode === 'auto' && touchSeen));
  };

  const refresh = (): void => {
    const want = touchWanted();
    if (root.hidden === want) root.hidden = !want;
    if (!want) return;
    const s = opts.getDisplayState?.();
    if (!s) return;
    gearBtns.forEach((b, i) => b.classList.toggle('is-active', GEARS[i] === s.gear));
    indL.classList.toggle('is-active', s.indicator === 'left' || s.indicator === 'hazard');
    indR.classList.toggle('is-active', s.indicator === 'right' || s.indicator === 'hazard');
    haz.classList.toggle('is-active', s.indicator === 'hazard');
    hb.classList.toggle('is-alert', s.handbrake);
    belt.classList.toggle('is-active', s.seatbelt);
    eng.classList.toggle('is-active', s.engineOn);
    lights.classList.toggle('is-active', s.headlights !== 'off');
    lights.textContent = s.headlights === 'high' ? 'High beam' : 'Lights';
    wip.classList.toggle('is-active', s.wipers);
  };

  return {
    poll(): ControlInput {
      const k = keyboardSample();
      const g = gamepadSample();
      // Spring the touch wheel back to centre when released.
      if (wheelPointer === null && wheelAngle !== 0) {
        wheelAngle *= 0.78;
        if (Math.abs(wheelAngle) < 0.01) wheelAngle = 0;
        touch.steer = wheelAngle / WHEEL_LOCK;
        paintWheel();
      }
      const out: ControlInput = { throttle: 0, brake: 0, steer: 0, look: 'ahead', horn: false, commands: commands.splice(0) };
      if (!enabled) {
        out.commands = [];
        return out;
      }
      out.throttle = Math.max(k.throttle, g.throttle, touch.throttle);
      out.brake = Math.max(k.brake, g.brake, touch.brake);
      out.steer = [k.steer, g.steer, touch.steer].reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
      out.look = k.look !== 'ahead' ? k.look : touch.look !== 'ahead' ? touch.look : g.look;
      out.horn = k.horn || g.horn || touch.horn;
      return out;
    },
    onAction(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    setEnabled(value) {
      enabled = value;
      if (!value) {
        releaseAll();
        commands.length = 0;
      }
      refresh();
    },
    lastDevice: () => device,
    touchVisible: () => !root.hidden,
    refresh,
    dispose() {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', onVisibility);
      root.remove();
      handlers.clear();
    },
  };
}
