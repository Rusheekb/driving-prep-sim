/**
 * The Web Audio node graph: continuous layers (engine, road, rain, horn, tyre
 * scrub), cyclic cues (indicator relay, wipers) and the one-shot bus, all
 * summed through a gentle compressor and the master volume.
 *
 *   engine ─────────────────────────┐
 *   rain patter, relay, wipers ─────┤
 *   road · rain · horn · skid ─► outside (low-pass when the camera is inside)
 *                                   ├─► loops ─┐
 *   one-shots ─────────────────────────► sfx ──┼─► duck ─► compressor ─► master ─► speakers
 *
 * Click-free by construction: every continuous source runs from creation with
 * its gain at zero, every level or pitch change is a `setTargetAtTime` glide,
 * and one-shot voices carry their own fade-in / fade-out envelopes.
 */
import { clamp } from '../core/math';
import { indicatorCue, wiperCue } from './cues';
import { createDrivetrain, engineVoice, stepDrivetrain } from './drivetrain';
import type { DrivetrainState } from './drivetrain';
import { playVoices, RELAY_TICK, RELAY_TOCK, SFX, WIPER_SWEEP } from './sfx';
import type { AudioFrame, SfxName } from './types';

export interface AudioGraph {
  /** Follow the car. `dt` is the wall-clock time since the previous call, s. */
  update(frame: AudioFrame, dt: number): void;
  /** Fade out everything continuous; the next `update` fades it back in. */
  silence(): void;
  play(name: SfxName): void;
  /** 0..1 */
  setVolume(volume: number): void;
  /** Lower everything a little while an instruction is being spoken. */
  setDucked(ducked: boolean): void;
  /** RMS of the master output (development hook). */
  level(): number;
  dispose(): void;
}

/** Gain after the compressor at full volume; offsets the compressor's built-in make-up gain. */
const MASTER_TRIM = 0.55;
/** Level of everything else while speech is playing. */
const DUCK_LEVEL = 0.5;
/** One-shots are scheduled this far ahead so their fade-ins are never cut short, s. */
const LOOKAHEAD = 0.01;
/** The same cue is not restarted within this time (several faults in one frame → one sound), s. */
const MIN_RETRIGGER = 0.045;
/** Upper bound on simultaneously sounding one-shot voices. */
const MAX_VOICES = 64;
/** Seconds of white noise shared by every noise layer. */
const NOISE_SECONDS = 2;

const unit = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

/** Deterministic white noise so the layers sound the same on every run. */
function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let state = 0x2f6e2b1;
  for (let i = 0; i < data.length; i++) {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    data[i] = (state >>> 0) / 2147483648 - 1;
  }
  return buffer;
}

export function createAudioGraph(ctx: AudioContext): AudioGraph {
  const sources: AudioScheduledSourceNode[] = [];
  const noiseBuffer = createNoiseBuffer(ctx);

  /* ---- node helpers ------------------------------------------------------ */

  const gainNode = (value: number, dest: AudioNode): GainNode => {
    const node = ctx.createGain();
    node.gain.value = value;
    node.connect(dest);
    return node;
  };
  const filterNode = (type: BiquadFilterType, frequency: number, q: number, dest: AudioNode): BiquadFilterNode => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    node.connect(dest);
    return node;
  };
  const oscillator = (type: OscillatorType, frequency: number, detune: number, dest: AudioNode): OscillatorNode => {
    const node = ctx.createOscillator();
    node.type = type;
    node.frequency.value = frequency;
    node.detune.value = detune;
    node.connect(dest);
    node.start();
    sources.push(node);
    return node;
  };
  /** A looping noise source; each layer reads the shared buffer from a different place and speed. */
  const noiseSource = (rate: number, offset: number, dest: AudioNode): void => {
    const node = ctx.createBufferSource();
    node.buffer = noiseBuffer;
    node.loop = true;
    node.playbackRate.value = rate;
    node.connect(dest);
    node.start(0, offset);
    sources.push(node);
  };

  /**
   * Glide a parameter toward `value` with time constant `tau`. Remembers the
   * last target per parameter so a steady value costs nothing per frame.
   */
  const targets = new WeakMap<AudioParam, number>();
  const glide = (param: AudioParam, value: number, tau: number): void => {
    const previous = targets.get(param);
    if (previous !== undefined && Math.abs(previous - value) <= 1e-4 * Math.max(1, Math.abs(value))) return;
    targets.set(param, value);
    param.setTargetAtTime(value, ctx.currentTime, tau);
  };

  /* ---- output chain ------------------------------------------------------ */

  let volume = 1;
  const master = gainNode(0, ctx.destination);
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.knee.value = 12;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  compressor.connect(master);
  const duck = gainNode(1, compressor);
  const sfxBus = gainNode(1, duck);
  const loops = gainNode(0, duck);
  const outside = filterNode('lowpass', 15000, 0.5, loops);

  /* ---- engine ------------------------------------------------------------ */

  const engineGain = gainNode(0, loops);
  const engineFilter = filterNode('lowpass', 300, 0.9, engineGain);
  // Two sawtooths a few cents apart beat slowly against each other (the
  // "lumpiness" of a real engine); a triangle an octave up adds body that
  // small laptop speakers can reproduce.
  const engineOscs: readonly (readonly [OscillatorNode, number])[] = [
    [oscillator('sawtooth', 27, 0, gainNode(0.5, engineFilter)), 1],
    [oscillator('sawtooth', 27, -9, gainNode(0.3, engineFilter)), 1],
    [oscillator('triangle', 54, 6, gainNode(0.55, engineFilter)), 2],
  ];
  const hissGain = gainNode(0, loops);
  const hissFilter = filterNode('bandpass', 300, 0.8, hissGain);
  noiseSource(1, 0.11, hissFilter);

  /* ---- road & wind ------------------------------------------------------- */

  const roadGain = gainNode(0, outside);
  const roadFilter = filterNode('lowpass', 300, 0.6, roadGain);
  noiseSource(0.83, 0.57, roadFilter);

  /* ---- rain -------------------------------------------------------------- */

  const rainGain = gainNode(0, outside);
  noiseSource(1.07, 0.93, filterNode('highpass', 1100, 0.5, filterNode('lowpass', 6500, 0.5, rainGain)));
  // Drumming on the roof — an inside sound, so it bypasses the outside filter.
  const patterGain = gainNode(0, loops);
  noiseSource(0.91, 1.41, filterNode('bandpass', 340, 0.6, patterGain));

  /* ---- tyre scrub -------------------------------------------------------- */

  const skidGain = gainNode(0, outside);
  const skidFilter = filterNode('bandpass', 900, 3, skidGain);
  noiseSource(1.19, 1.73, skidFilter);

  /* ---- horn -------------------------------------------------------------- */

  const hornGain = gainNode(0, outside);
  const hornFilter = filterNode('lowpass', 2000, 0.7, hornGain);
  oscillator('sawtooth', 420, 0, gainNode(0.5, hornFilter));
  oscillator('sawtooth', 500, 0, gainNode(0.5, hornFilter));

  const layerGains = [engineGain, hissGain, roadGain, rainGain, patterGain, skidGain, hornGain];

  /* ---- state ------------------------------------------------------------- */

  let disposed = false;
  let silent = true;
  let drive: DrivetrainState = createDrivetrain({ engineOn: false, speed: 0, throttle: 0 });
  let indicatorLit = false;
  let wiperCooldown = 0;
  let activeVoices = 0;
  const lastPlayed = new Map<SfxName, number>();
  const onVoiceEnd = (): void => {
    activeVoices--;
  };

  let analyser: AnalyserNode | null = null;
  let samples: Float32Array<ArrayBuffer> | null = null;

  return {
    update(frame, dt) {
      if (disposed) return;
      const speed = Number.isFinite(frame.speed) ? Math.abs(frame.speed) : 0;
      const rain = unit(frame.rain);

      if (silent) {
        // Coming back from silence: pick up the engine where the car is now,
        // without replaying the start-up sequence.
        silent = false;
        drive = createDrivetrain(frame);
        glide(loops.gain, 1, 0.02);
      } else {
        drive = stepDrivetrain(drive, frame, dt);
      }

      // Engine.
      const voice = engineVoice(drive);
      const muffle = frame.interior ? 0.8 : 1;
      for (const [osc, multiple] of engineOscs) glide(osc.frequency, voice.frequency * multiple, 0.03);
      glide(engineFilter.frequency, voice.cutoff * muffle, 0.06);
      glide(engineGain.gain, voice.gain, voice.gain > 0 ? 0.08 : 0.16);
      glide(hissFilter.frequency, voice.hissFrequency, 0.06);
      glide(hissGain.gain, voice.hiss * muffle, 0.1);

      // Road and wind noise build with speed whether or not the engine is running.
      const pace = clamp(speed / 30, 0, 1);
      glide(roadFilter.frequency, 240 + 650 * pace, 0.2);
      glide(roadGain.gain, 0.5 * pace ** 1.5, 0.2);

      // Rain; the outside filter is what the cabin does to everything beyond the glass.
      glide(outside.frequency, frame.interior ? 1500 : 15000, 0.12);
      glide(rainGain.gain, 0.16 * rain, 0.3);
      glide(patterGain.gain, (frame.interior ? 0.3 : 0.08) * rain, 0.3);

      // Tyre scrub: higher and louder the faster the car is sliding.
      glide(skidFilter.frequency, 750 + 40 * Math.min(speed, 20), 0.05);
      glide(skidGain.gain, frame.skid ? 0.5 * clamp(speed / 6, 0.35, 1) : 0, frame.skid ? 0.02 : 0.09);

      // Horn: fast on, fast off.
      glide(hornGain.gain, frame.horn ? 0.17 : 0, frame.horn ? 0.008 : 0.03);

      // Indicator relay and wipers are scheduled as one-shots on the loop bus.
      const now = ctx.currentTime;
      const relay = indicatorCue(indicatorLit, frame.indicator, frame.time);
      indicatorLit = relay.lit;
      if (relay.cue) playVoices(ctx, loops, noiseBuffer, relay.cue === 'tick' ? RELAY_TICK : RELAY_TOCK, now + LOOKAHEAD);
      const wiper = wiperCue(wiperCooldown, frame.wipers, dt);
      wiperCooldown = wiper.cooldown;
      if (wiper.sweep) playVoices(ctx, loops, noiseBuffer, WIPER_SWEEP, now + LOOKAHEAD);
    },

    silence() {
      if (disposed) return;
      silent = true;
      indicatorLit = false;
      glide(loops.gain, 0, 0.03);
      for (const layer of layerGains) glide(layer.gain, 0, 0.05);
    },

    play(name) {
      const recipe = SFX[name];
      if (disposed || !recipe) return;
      const now = ctx.currentTime;
      const last = lastPlayed.get(name);
      if (last !== undefined && now - last < MIN_RETRIGGER) return;
      if (activeVoices + recipe.length > MAX_VOICES) return;
      lastPlayed.set(name, now);
      activeVoices += playVoices(ctx, sfxBus, noiseBuffer, recipe, now + LOOKAHEAD, onVoiceEnd);
    },

    setVolume(v) {
      if (disposed) return;
      volume = unit(v);
      // Squared: equal steps of the slider sound like equal steps of loudness.
      glide(master.gain, MASTER_TRIM * volume * volume, 0.02);
    },

    setDucked(ducked) {
      if (disposed) return;
      glide(duck.gain, ducked ? DUCK_LEVEL : 1, ducked ? 0.06 : 0.25);
    },

    level() {
      if (disposed) return 0;
      if (!analyser) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        samples = new Float32Array(analyser.fftSize);
        master.connect(analyser);
      }
      if (!samples) return 0;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
      return Math.sqrt(sum / samples.length);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // already stopped
        }
      }
      master.disconnect();
    },
  };
}
