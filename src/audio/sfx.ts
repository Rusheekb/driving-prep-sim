/**
 * One-shot sound cues, synthesised from a handful of oscillators and filtered
 * noise bursts. Each cue is a plain data recipe (a list of voices) so the
 * sound design can be read, tweaked and sanity-checked without a browser;
 * `playVoices` turns a recipe into Web Audio nodes.
 *
 * Design brief: short, soft and friendly. Learners hear these for an hour at a
 * time, so nothing is harsh, and the fault cues correct rather than punish.
 */
import type { SfxName } from './types';

export type Wave = 'sine' | 'triangle' | 'sawtooth' | 'square';

/** Timing and loudness shared by every voice. Times are in seconds. */
interface VoiceShape {
  /** Start, relative to the start of the cue. */
  at: number;
  /** Peak linear gain. */
  gain: number;
  /** Fade-in time. */
  attack: number;
  /** Time held at the peak. */
  hold: number;
  /** Time to die away (to −60 dB). */
  release: number;
}

/** An oscillator, optionally gliding in pitch and softened by a low-pass filter. */
export interface ToneVoice extends VoiceShape {
  kind: 'tone';
  wave: Wave;
  /** Hz */
  freq: number;
  /** Pitch reached at the end of the voice, Hz. */
  glideTo?: number;
  /** Low-pass cutoff, Hz — takes the edge off sawtooth and square waves. */
  lowpass?: number;
}

/** A burst of filtered white noise: clicks, thuds, whooshes. */
export interface NoiseVoice extends VoiceShape {
  kind: 'noise';
  filter: 'lowpass' | 'bandpass' | 'highpass';
  /** Filter frequency, Hz. */
  freq: number;
  /** Filter frequency reached at the end of the voice, Hz. */
  sweepTo?: number;
  q: number;
}

export type SfxVoice = ToneVoice | NoiseVoice;

/* -------------------------------------------------------------------------- */
/* Recipe building blocks                                                     */
/* -------------------------------------------------------------------------- */

/** A struck note: near-instant attack, then it rings out over `ring` seconds. */
const pluck = (at: number, freq: number, gain: number, ring: number, wave: Wave = 'sine'): ToneVoice => ({
  kind: 'tone',
  wave,
  at,
  freq,
  gain,
  attack: 0.004,
  hold: 0,
  release: ring,
});

/** A small bell: a fundamental with two quieter, faster-fading overtones. */
const bell = (at: number, freq: number, gain: number, ring: number): ToneVoice[] => [
  pluck(at, freq, gain, ring),
  pluck(at, freq * 2, gain * 0.3, ring * 0.6),
  pluck(at, freq * 3, gain * 0.1, ring * 0.35),
];

/** A warm, rounded note for the gentler motifs: a sine with a quiet triangle an octave down. */
const soft = (at: number, freq: number, gain: number, ring: number): ToneVoice[] => [
  { ...pluck(at, freq, gain, ring), attack: 0.012 },
  { ...pluck(at, freq / 2, gain * 0.35, ring * 0.8, 'triangle'), attack: 0.012 },
];

/** A tone that slides from one pitch to another while it fades. */
const slide = (at: number, from: number, to: number, gain: number, length: number, wave: Wave = 'sine'): ToneVoice => ({
  kind: 'tone',
  wave,
  at,
  freq: from,
  glideTo: to,
  gain,
  attack: 0.005,
  hold: 0,
  release: length,
});

/** A mechanical click: a few milliseconds of band-passed noise. */
const click = (at: number, freq: number, gain: number, length = 0.02, q = 2.5): NoiseVoice => ({
  kind: 'noise',
  filter: 'bandpass',
  at,
  freq,
  q,
  gain,
  attack: 0.001,
  hold: 0,
  release: length,
});

/** A dull burst of low-passed noise: the body of a thud or clunk. */
const thud = (at: number, cutoff: number, gain: number, length: number): NoiseVoice => ({
  kind: 'noise',
  filter: 'lowpass',
  at,
  freq: cutoff,
  q: 0.7,
  gain,
  attack: 0.002,
  hold: 0,
  release: length,
});

/** Note frequencies, Hz (equal temperament, A4 = 440). */
const C4 = 261.63;
const E4 = 329.63;
const G4 = 392.0;
const A4 = 440.0;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const A5 = 880.0;
const C6 = 1046.5;
const E6 = 1318.51;
const G6 = 1567.98;
const C7 = 2093.0;
const E7 = 2637.02;

/** Starter motor: five quick "rr" pulses that end as the engine tone takes over (see STARTER_TIME). */
const starterWhirr: SfxVoice[] = [0, 1, 2, 3, 4].flatMap((i): SfxVoice[] => {
  const at = i * 0.085;
  return [
    {
      kind: 'tone',
      wave: 'sawtooth',
      at,
      freq: 150 + i * 6,
      glideTo: 185 + i * 6,
      lowpass: 900,
      gain: 0.1,
      attack: 0.018,
      hold: 0.03,
      release: 0.05,
    },
    { kind: 'noise', filter: 'bandpass', at, freq: 650, q: 1.2, gain: 0.25, attack: 0.018, hold: 0.03, release: 0.05 },
  ];
});

/** Handbrake ratchet: five teeth, each a touch higher as the lever comes up. */
const ratchet: SfxVoice[] = [0, 1, 2, 3, 4].map((i) => click(i * 0.058, 1500 + i * 150, 0.7, 0.016, 3));

/* -------------------------------------------------------------------------- */
/* The cues                                                                   */
/* -------------------------------------------------------------------------- */

export const SFX: Record<SfxName, readonly SfxVoice[]> = {
  // A tiny tick.
  ui_click: [pluck(0, 1500, 0.1, 0.035, 'triangle'), click(0, 3200, 0.35, 0.012)],
  ui_back: [slide(0, 920, 560, 0.1, 0.07, 'triangle')],

  // Soft low "uh-oh": two short blips, the second a little lower.
  fault_minor: [...soft(0, E4, 0.2, 0.13), ...soft(0.15, C4 * 1.059, 0.2, 0.2)],
  // Firmer, descending a fourth — clearly "that mattered" without being a buzzer.
  fault_serious: [
    { kind: 'tone', wave: 'triangle', at: 0, freq: A4, lowpass: 1800, gain: 0.26, attack: 0.006, hold: 0.1, release: 0.12 },
    { kind: 'tone', wave: 'triangle', at: 0.2, freq: E4, lowpass: 1800, gain: 0.26, attack: 0.006, hold: 0.14, release: 0.25 },
    pluck(0, A4 / 2, 0.1, 0.2),
    pluck(0.2, E4 / 2, 0.1, 0.35),
  ],
  // Bright little up-chirp.
  praise: [slide(0, A5, E6, 0.12, 0.13), ...bell(0.09, E6, 0.09, 0.3)],
  // Sat-nav style "ding-dong" that asks for attention before an instruction.
  instruction: [...bell(0, D5, 0.17, 0.5), ...bell(0.17, G5, 0.17, 0.75)],
  // Ascending major triad.
  step_complete: [...bell(0, C5, 0.14, 0.35), ...bell(0.09, E5, 0.14, 0.35), ...bell(0.18, G5, 0.14, 0.6)],
  // Five-note fanfare: up the arpeggio, landing on a bright chord.
  success: [
    ...bell(0, C5, 0.14, 0.3),
    ...bell(0.11, E5, 0.14, 0.3),
    ...bell(0.22, G5, 0.14, 0.3),
    ...bell(0.33, C6, 0.15, 1.1),
    ...bell(0.46, E6, 0.1, 1.0),
    pluck(0.33, G5, 0.08, 1.0),
    pluck(0.33, C5, 0.07, 1.0, 'triangle'),
  ],
  // A sympathetic sigh down the triad — "not this time", never a buzzer.
  fail: [...soft(0, G4, 0.17, 0.45), ...soft(0.24, E4, 0.17, 0.45), ...soft(0.48, C4, 0.18, 1.0)],
  // Thud plus a short crunch.
  collision: [
    slide(0, 120, 42, 0.5, 0.3),
    thud(0, 420, 1.6, 0.24),
    { kind: 'noise', filter: 'bandpass', at: 0.005, freq: 1500, q: 0.7, gain: 0.55, attack: 0.002, hold: 0.02, release: 0.14 },
    { kind: 'noise', filter: 'bandpass', at: 0.06, freq: 2600, q: 1, gain: 0.25, attack: 0.002, hold: 0, release: 0.1 },
  ],
  // Soft selector clunk.
  gear: [slide(0, 170, 95, 0.22, 0.08), click(0, 1100, 0.4, 0.03, 1.2)],
  // Click-clack of the tongue going into the buckle.
  seatbelt_on: [click(0, 2600, 0.55, 0.02), click(0.085, 1900, 0.7, 0.028), pluck(0.085, 2900, 0.02, 0.09)],
  // Release click, then the webbing running back.
  seatbelt_off: [
    click(0, 2100, 0.65, 0.025),
    { kind: 'noise', filter: 'bandpass', at: 0.04, freq: 700, sweepTo: 1500, q: 1.5, gain: 0.2, attack: 0.04, hold: 0.1, release: 0.15 },
  ],
  handbrake_on: [...ratchet, slide(0.24, 150, 100, 0.12, 0.07)],
  handbrake_off: [click(0, 1700, 0.6, 0.02, 3), slide(0.03, 150, 85, 0.16, 0.1), thud(0.03, 1200, 0.3, 0.08)],
  engine_start: [...starterWhirr, thud(0.42, 700, 0.6, 0.16)],
  engine_stop: [slide(0, 75, 38, 0.2, 0.3, 'triangle'), click(0.02, 900, 0.25, 0.03, 1.5)],
  // Barely-there tick: acknowledges a mirror check without becoming a distraction.
  mirror_check: [pluck(0, 1250, 0.05, 0.05)],
  // Stalk click.
  switch: [click(0, 2800, 0.6, 0.014), pluck(0, 620, 0.04, 0.03, 'triangle')],
  countdown: [
    { kind: 'tone', wave: 'sine', at: 0, freq: A5, gain: 0.14, attack: 0.006, hold: 0.09, release: 0.08 },
    { kind: 'tone', wave: 'sine', at: 0, freq: A5 * 2, gain: 0.02, attack: 0.006, hold: 0.06, release: 0.06 },
  ],
  // Sparkle: three high bells in quick succession.
  star: [...bell(0, G6, 0.09, 0.5), ...bell(0.05, C7, 0.08, 0.6), ...bell(0.1, E7, 0.06, 0.7)],
};

export const SFX_NAMES = Object.keys(SFX) as SfxName[];

/** Indicator flasher relay: "tick" as the lamps light… */
export const RELAY_TICK: readonly SfxVoice[] = [click(0, 2500, 0.85, 0.018, 3), slide(0, 420, 300, 0.05, 0.03)];
/** …and a slightly lower "tock" as they go out. */
export const RELAY_TOCK: readonly SfxVoice[] = [click(0, 1750, 0.8, 0.02, 3), slide(0, 330, 230, 0.05, 0.03)];

/** One wiper cycle: a soft rubbery sweep across the glass, a beat, then the sweep back. */
export const WIPER_SWEEP: readonly SfxVoice[] = [
  { kind: 'noise', filter: 'bandpass', at: 0, freq: 480, sweepTo: 1000, q: 1.4, gain: 0.3, attack: 0.1, hold: 0.14, release: 0.22 },
  slide(0.42, 130, 90, 0.035, 0.05),
  { kind: 'noise', filter: 'bandpass', at: 0.6, freq: 1000, sweepTo: 480, q: 1.4, gain: 0.3, attack: 0.1, hold: 0.14, release: 0.22 },
  slide(1.02, 120, 85, 0.035, 0.05),
];

/** Total length of a recipe in seconds, including the final fade. */
export function recipeDuration(voices: readonly SfxVoice[]): number {
  return voices.reduce((end, v) => Math.max(end, v.at + v.attack + v.hold + v.release + END_FADE), 0);
}

/* -------------------------------------------------------------------------- */
/* Playback                                                                   */
/* -------------------------------------------------------------------------- */

/** The release decays exponentially to this fraction of the peak (−60 dB)… */
const RELEASE_FLOOR = 0.001;
/** …and a last short linear fade takes it to true zero, so stopping the source cannot click. */
const END_FADE = 0.008;

/**
 * Schedule every voice of a recipe on `ctx`, starting at context time `when`.
 * Nodes disconnect themselves when they finish; `onVoiceEnd` fires once per
 * voice so the caller can keep count of what is still sounding.
 *
 * @param noise a buffer of white noise shared by all noise voices
 * @returns the number of voices started
 */
export function playVoices(
  ctx: BaseAudioContext,
  dest: AudioNode,
  noise: AudioBuffer,
  voices: readonly SfxVoice[],
  when: number,
  onVoiceEnd?: () => void,
): number {
  for (const voice of voices) {
    const start = when + voice.at;
    const peakAt = start + voice.attack;
    const releaseAt = peakAt + voice.hold;
    const quietAt = releaseAt + voice.release;
    const end = quietAt + END_FADE;

    const envelope = ctx.createGain();
    envelope.gain.value = 0;
    envelope.gain.setValueAtTime(0, start);
    envelope.gain.linearRampToValueAtTime(voice.gain, peakAt);
    if (voice.hold > 0) envelope.gain.setValueAtTime(voice.gain, releaseAt);
    envelope.gain.exponentialRampToValueAtTime(voice.gain * RELEASE_FLOOR, quietAt);
    envelope.gain.linearRampToValueAtTime(0, end);
    envelope.connect(dest);

    const nodes: AudioNode[] = [envelope];
    let source: AudioScheduledSourceNode;
    if (voice.kind === 'tone') {
      const osc = ctx.createOscillator();
      osc.type = voice.wave;
      osc.frequency.setValueAtTime(voice.freq, start);
      if (voice.glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(voice.glideTo, quietAt);
      if (voice.lowpass !== undefined) {
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = voice.lowpass;
        lowpass.Q.value = 0.7;
        osc.connect(lowpass);
        lowpass.connect(envelope);
        nodes.push(lowpass);
      } else {
        osc.connect(envelope);
      }
      osc.start(start);
      source = osc;
    } else {
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = voice.filter;
      filter.frequency.setValueAtTime(voice.freq, start);
      if (voice.sweepTo !== undefined) filter.frequency.exponentialRampToValueAtTime(voice.sweepTo, quietAt);
      filter.Q.value = voice.q;
      src.connect(filter);
      filter.connect(envelope);
      nodes.push(filter);
      // Start each burst somewhere different in the noise so repeats are not identical.
      src.start(start, (start * 7.31) % noise.duration);
      source = src;
    }
    nodes.push(source);
    source.stop(end + 0.005);
    source.onended = () => {
      for (const node of nodes) node.disconnect();
      onVoiceEnd?.();
    };
  }
  return voices.length;
}
