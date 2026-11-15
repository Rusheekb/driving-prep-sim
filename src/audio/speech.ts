/**
 * Spoken instructions through the browser's SpeechSynthesis API.
 *
 * The API is missing in some browsers, has no voices on some systems and
 * misbehaves in small ways on most, so this wrapper is defensive throughout:
 * every call is a silent no-op when speech is unavailable, and it never
 * throws.
 */
import { cleanSpeechText, estimateSpeechSeconds } from './speechText';
import { DEFAULT_SPEECH_LANG, normaliseLang, pickVoice } from './voices';

export interface Speech {
  /** `lang` is remembered when omitted. */
  setEnabled(enabled: boolean, lang?: string): void;
  /** 0..1; nothing is spoken at 0. */
  setVolume(volume: number): void;
  /** Call from a user gesture — some browsers refuse speech until a gesture has started some. */
  unlock(): void;
  /** Say `text`, replacing whatever is being said. */
  speak(text: string): void;
  stop(): void;
  dispose(): void;
}

const RATE = 1;
/** Pause between cancelling one utterance and starting the next; several engines drop an utterance queued in the same tick as a cancel. */
const RESTART_DELAY_MS = 60;

interface SpeechGlobals {
  speechSynthesis?: SpeechSynthesis;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
  navigator?: { language?: string };
}

function speechApi(): { synth: SpeechSynthesis; Utterance: typeof SpeechSynthesisUtterance } | null {
  try {
    const g = globalThis as SpeechGlobals;
    if (g.speechSynthesis && typeof g.SpeechSynthesisUtterance === 'function') {
      return { synth: g.speechSynthesis, Utterance: g.SpeechSynthesisUtterance };
    }
  } catch {
    // Access can be blocked in sandboxed frames.
  }
  return null;
}

/** The browser's own language when it is a flavour of English, otherwise a neutral default. */
function initialLang(): string {
  try {
    const language = (globalThis as SpeechGlobals).navigator?.language;
    if (language && normaliseLang(language).startsWith('en')) return language;
  } catch {
    // fall through
  }
  return DEFAULT_SPEECH_LANG;
}

/**
 * @param onSpeakingChange called with true when an utterance becomes audible
 *   and false when it ends, is cancelled or fails (used to duck other audio)
 */
export function createSpeech(onSpeakingChange: (speaking: boolean) => void): Speech {
  let enabled = false;
  let lang = initialLang();
  let volume = 1;
  let disposed = false;
  let primed = false;
  let speaking = false;
  // Holding the utterance also keeps it from being garbage-collected mid-speech, which loses its events in Chrome.
  let current: SpeechSynthesisUtterance | null = null;
  let startTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;

  const setSpeaking = (value: boolean): void => {
    if (speaking === value) return;
    speaking = value;
    onSpeakingChange(value);
  };

  const clearTimers = (): void => {
    if (startTimer !== null) clearTimeout(startTimer);
    if (watchdog !== null) clearTimeout(watchdog);
    startTimer = null;
    watchdog = null;
  };

  /** Events from an utterance that has since been replaced are ignored. */
  const finish = (utterance: SpeechSynthesisUtterance): void => {
    if (current !== utterance) return;
    current = null;
    clearTimers();
    setSpeaking(false);
  };

  const begin = (text: string): void => {
    const api = speechApi();
    if (!api || disposed || !enabled) return;
    try {
      const utterance = new api.Utterance(text);
      const voice = pickVoice(api.synth.getVoices(), lang);
      if (voice) utterance.voice = voice;
      utterance.lang = voice ? voice.lang.replace('_', '-') : lang;
      utterance.rate = RATE;
      utterance.pitch = 1;
      utterance.volume = volume;
      utterance.onstart = () => {
        if (current === utterance) setSpeaking(true);
      };
      utterance.onend = () => finish(utterance);
      utterance.onerror = () => finish(utterance);
      current = utterance;
      if (api.synth.paused) api.synth.resume();
      api.synth.speak(utterance);
      // Some engines occasionally never fire `end`; make sure the ducking is released regardless.
      watchdog = setTimeout(() => finish(utterance), (estimateSpeechSeconds(text, RATE) * 1.5 + 4) * 1000);
    } catch {
      current = null;
      clearTimers();
      setSpeaking(false);
    }
  };

  /** Cancel anything queued or playing. Returns true when the engine was busy. */
  const cancel = (): boolean => {
    clearTimers();
    const hadCurrent = current !== null;
    current = null;
    setSpeaking(false);
    const api = speechApi();
    if (!api) return false;
    try {
      const busy = hadCurrent || api.synth.speaking || api.synth.pending;
      if (busy) api.synth.cancel();
      return busy;
    } catch {
      return false;
    }
  };

  return {
    setEnabled(on, language) {
      if (disposed) return;
      if (language) lang = language;
      enabled = on;
      if (!on) {
        cancel();
        return;
      }
      try {
        // Voices load asynchronously in some browsers; asking early has them ready for the first instruction.
        speechApi()?.synth.getVoices();
      } catch {
        // ignore
      }
    },

    setVolume(v) {
      volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      if (volume <= 0) cancel();
    },

    unlock() {
      if (disposed || primed || !enabled) return;
      const api = speechApi();
      if (!api) return;
      primed = true;
      try {
        if (api.synth.speaking || api.synth.pending) return;
        const primer = new api.Utterance(' ');
        primer.volume = 0;
        api.synth.speak(primer);
      } catch {
        // ignore
      }
    },

    speak(text) {
      if (disposed || !enabled || volume <= 0 || !speechApi()) return;
      const spoken = cleanSpeechText(text);
      const wasBusy = cancel();
      if (!spoken) return;
      if (wasBusy) {
        startTimer = setTimeout(() => {
          startTimer = null;
          begin(spoken);
        }, RESTART_DELAY_MS);
      } else {
        begin(spoken);
      }
    },

    stop() {
      cancel();
    },

    dispose() {
      if (disposed) return;
      cancel();
      disposed = true;
    },
  };
}
