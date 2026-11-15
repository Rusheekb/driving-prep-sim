/**
 * All sound is synthesised with the Web Audio API (no audio files): a soft
 * engine note, the indicator relay, horn, rain and short cues — plus optional
 * spoken instructions through the browser's speech synthesis.
 */
import { blinkOn } from '../core/constants';
import type { IndicatorState } from '../core/types';
import { type Speech, createSpeech } from './speech';

export type SfxName = 'click' | 'fault_minor' | 'fault_serious' | 'praise' | 'instruction' | 'step' | 'success' | 'fail' | 'collision' | 'switch' | 'star';

export interface AudioFrame {
  /** Simulation time, for indicator sync. */
  time: number;
  engineOn: boolean;
  /** 0..1 */
  throttle: number;
  /** m/s, absolute */
  speed: number;
  indicator: IndicatorState;
  horn: boolean;
  raining: boolean;
}

export interface AudioEngine {
  /** Call from a user gesture; safe to call repeatedly. */
  unlock(): void;
  /** 0..1 master volume (0 mutes). */
  setVolume(v: number): void;
  setVoice(enabled: boolean, lang?: string): void;
  /** Call every frame while driving. */
  update(frame: AudioFrame): void;
  /** Stop continuous sounds (menus, pause). */
  silence(): void;
  play(name: SfxName): void;
  speak(text: string): void;
}

type Note = [freq: number, start: number, dur: number, type?: OscillatorType, gain?: number];

const CUES: Record<SfxName, Note[]> = {
  click: [[1400, 0, 0.03, 'square', 0.12]],
  switch: [[900, 0, 0.025, 'square', 0.12]],
  fault_minor: [
    [330, 0, 0.09, 'triangle', 0.3],
    [262, 0.1, 0.14, 'triangle', 0.3],
  ],
  fault_serious: [
    [330, 0, 0.12, 'sawtooth', 0.22],
    [233, 0.13, 0.12, 'sawtooth', 0.22],
    [175, 0.26, 0.22, 'sawtooth', 0.22],
  ],
  praise: [
    [660, 0, 0.07, 'sine', 0.3],
    [990, 0.07, 0.12, 'sine', 0.3],
  ],
  instruction: [
    [784, 0, 0.11, 'sine', 0.28],
    [988, 0.12, 0.16, 'sine', 0.28],
  ],
  step: [
    [523, 0, 0.08, 'sine', 0.26],
    [659, 0.08, 0.08, 'sine', 0.26],
    [784, 0.16, 0.14, 'sine', 0.26],
  ],
  success: [
    [523, 0, 0.12, 'triangle', 0.3],
    [659, 0.12, 0.12, 'triangle', 0.3],
    [784, 0.24, 0.12, 'triangle', 0.3],
    [1047, 0.36, 0.34, 'triangle', 0.32],
  ],
  fail: [
    [392, 0, 0.18, 'triangle', 0.28],
    [330, 0.2, 0.18, 'triangle', 0.28],
    [262, 0.4, 0.36, 'triangle', 0.28],
  ],
  collision: [
    [90, 0, 0.22, 'sawtooth', 0.5],
    [55, 0.04, 0.3, 'square', 0.4],
  ],
  star: [[1319, 0, 0.18, 'sine', 0.24]],
};

export function createAudio(): AudioEngine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let engineOsc: OscillatorNode | null = null;
  let engineOsc2: OscillatorNode | null = null;
  let engineGain: GainNode | null = null;
  let engineFilter: BiquadFilterNode | null = null;
  let hornGain: GainNode | null = null;
  let rainGain: GainNode | null = null;
  let volume = 0.7;
  let lastBlink = false;
  let rpm = 0;
  const speech: Speech = createSpeech(() => undefined);

  function init(): void {
    if (ctx || typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    master = ctx.createGain();
    master.gain.value = volume;
    master.connect(limiter).connect(ctx.destination);

    // Engine: two detuned oscillators through a low-pass filter.
    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 300;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc2 = ctx.createOscillator();
    engineOsc2.type = 'triangle';
    engineOsc.connect(engineFilter);
    engineOsc2.connect(engineFilter);
    engineFilter.connect(engineGain).connect(master);
    engineOsc.start();
    engineOsc2.start();

    // Horn: two tones.
    hornGain = ctx.createGain();
    hornGain.gain.value = 0;
    for (const f of [420, 505]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(hornGain);
      o.start();
    }
    const hornFilter = ctx.createBiquadFilter();
    hornFilter.type = 'lowpass';
    hornFilter.frequency.value = 1800;
    hornGain.connect(hornFilter).connect(master);

    // Rain: filtered noise loop.
    const len = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'bandpass';
    rainFilter.frequency.value = 2600;
    rainFilter.Q.value = 0.4;
    rainGain = ctx.createGain();
    rainGain.gain.value = 0;
    noise.connect(rainFilter).connect(rainGain).connect(master);
    noise.start();

    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
  }

  function tone([freq, start, dur, type = 'sine', gain = 0.25]: Note): void {
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + start;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
    o.connect(g).connect(master);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  const ramp = (param: AudioParam, value: number, tc = 0.06): void => {
    if (ctx) param.setTargetAtTime(value, ctx.currentTime, tc);
  };

  return {
    unlock() {
      init();
      if (ctx && ctx.state === 'suspended') void ctx.resume();
      speech.unlock();
    },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (master) ramp(master.gain, volume, 0.03);
      speech.setVolume(volume);
    },
    setVoice(enabled, lang) {
      speech.setEnabled(enabled, lang);
    },
    update(f) {
      if (!ctx || !engineOsc || !engineOsc2 || !engineGain || !engineFilter || !hornGain || !rainGain) return;
      // A simple automatic-gearbox feel: revs rise with speed inside each gear band, then drop.
      const band = (f.speed % 9) / 9;
      const target = f.engineOn ? 0.18 + band * 0.5 + f.throttle * 0.25 + Math.min(f.speed, 30) * 0.004 : 0;
      rpm += (target - rpm) * 0.08;
      const hz = 42 + rpm * 110;
      ramp(engineOsc.frequency, hz);
      ramp(engineOsc2.frequency, hz * 2.01);
      ramp(engineFilter.frequency, 220 + rpm * 900 + f.throttle * 400);
      ramp(engineGain.gain, f.engineOn ? 0.05 + f.throttle * 0.06 + rpm * 0.03 : 0, 0.12);
      ramp(hornGain.gain, f.horn ? 0.16 : 0, 0.015);
      ramp(rainGain.gain, f.raining ? 0.09 : 0, 0.4);
      // Indicator relay: tick on, tock off.
      const blink = f.indicator !== 'off' && blinkOn(f.time);
      if (f.indicator !== 'off' && blink !== lastBlink) tone([blink ? 2100 : 1500, 0, 0.022, 'square', 0.1]);
      lastBlink = blink;
    },
    silence() {
      if (!engineGain || !hornGain || !rainGain) return;
      ramp(engineGain.gain, 0, 0.05);
      ramp(hornGain.gain, 0, 0.02);
      ramp(rainGain.gain, 0, 0.1);
      speech.stop();
    },
    play(name) {
      if (!ctx || volume <= 0) return;
      for (const n of CUES[name]) tone(n);
    },
    speak(text) {
      speech.speak(text);
    },
  };
}
