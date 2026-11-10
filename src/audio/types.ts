import type { IndicatorState } from '../core/types';

/** Every one-shot sound cue the app can trigger with `AudioEngine.play`. */
export type SfxName =
  | 'ui_click'
  | 'ui_back'
  | 'fault_minor'
  | 'fault_serious'
  | 'praise'
  | 'instruction'
  | 'step_complete'
  | 'success'
  | 'fail'
  | 'collision'
  | 'gear'
  | 'seatbelt_on'
  | 'seatbelt_off'
  | 'handbrake_on'
  | 'handbrake_off'
  | 'engine_start'
  | 'engine_stop'
  | 'mirror_check'
  | 'switch'
  | 'countdown'
  | 'star';

/** What the car and its surroundings are doing right now, as far as the ears are concerned. */
export interface AudioFrame {
  /** simulation time, s (for indicator sync via blinkOn from src/core/constants.ts) */
  time: number;
  engineOn: boolean;
  /** 0..1 */
  throttle: number;
  /** m/s, absolute */
  speed: number;
  indicator: IndicatorState;
  horn: boolean;
  /** 0..1 intensity */
  rain: number;
  wipers: boolean;
  /** true when the tyres are being braked hard at speed */
  skid: boolean;
  /** camera is inside the car (slightly muffles outside sounds) */
  interior: boolean;
  paused: boolean;
}

export interface AudioEngine {
  /** must be called from a user gesture at least once; safe to call repeatedly */
  unlock(): void;
  /** 0..1 master volume (0 mutes) */
  setVolume(v: number): void;
  /**
   * enable/disable spoken instructions. `lang` is the BCP-47 tag of the accent
   * to speak the (English) text in, e.g. 'en-GB'; it is remembered when omitted.
   */
  setVoice(enabled: boolean, lang?: string): void;
  /** call every rendered frame while driving */
  update(frame: AudioFrame): void;
  /** stop continuous sounds (engine, rain, indicator, horn) — call when leaving the game or pausing */
  silence(): void;
  play(name: SfxName): void;
  /** speak an instruction (cancels the previous utterance); no-op when voice is disabled or unsupported */
  speak(text: string): void;
  stopSpeaking(): void;
  dispose(): void;
  /**
   * Development hook: RMS level (linear, 0..1) of what is currently reaching
   * the speakers. Used by the audio harness and its automated check.
   */
  debugLevel?(): number;
}
