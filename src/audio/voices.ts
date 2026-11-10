/**
 * Choosing a speech-synthesis voice. Browsers expose anything from one robotic
 * voice to several dozen (including joke voices), in no useful order, so each
 * candidate is scored for how well its accent matches the jurisdiction and how
 * pleasant it is likely to sound. Pure functions over plain data.
 */

/** The parts of a `SpeechSynthesisVoice` the scoring looks at. */
export interface VoiceLike {
  name: string;
  /** BCP-47 tag; some platforms use an underscore ("en_GB"). */
  lang: string;
  /** True when the voice is synthesised on the device (works offline, starts instantly). */
  localService?: boolean;
  default?: boolean;
}

/** Used when no language was requested and the browser's own language is not English. */
export const DEFAULT_SPEECH_LANG = 'en-US';

/** Lower-case BCP-47 tag reduced to language and region: "en_GB" → "en-gb", "EN" → "en". */
export function normaliseLang(tag: string): string {
  const parts = String(tag ?? '')
    .trim()
    .toLowerCase()
    .split(/[-_]/)
    .filter(Boolean);
  const language = parts[0] ?? '';
  // Skip script subtags ("zh-Hans-CN"); a region is two letters or three digits.
  const region = parts.slice(1).find((part) => /^([a-z]{2}|\d{3})$/.test(part));
  return region ? `${language}-${region}` : language;
}

/**
 * Accents a listener would find the next most natural when their own is not
 * installed, best first. Anything not listed falls back to "any voice in the
 * same language".
 */
const RELATED_ACCENTS: Record<string, readonly string[]> = {
  'en-gb': ['en-ie', 'en-au', 'en-nz', 'en-za', 'en-in'],
  'en-ie': ['en-gb', 'en-au', 'en-nz'],
  'en-au': ['en-nz', 'en-gb', 'en-ie'],
  'en-nz': ['en-au', 'en-gb', 'en-ie'],
  'en-in': ['en-gb', 'en-ie', 'en-au'],
  'en-za': ['en-gb', 'en-au', 'en-nz'],
  'en-us': ['en-ca'],
  'en-ca': ['en-us', 'en-gb'],
};

/** Names that mark a higher-quality voice on the common platforms. */
const PREMIUM_NAME = /natural|neural|enhanced|premium|siri/i;
/** Low-fidelity voices. */
const ROBOTIC_NAME = /compact|espeak|festival|pico/i;
/** macOS / iOS novelty voices that are listed as ordinary English voices. */
const NOVELTY_NAME =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|pipe organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|princess|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/**
 * How suitable `voice` is for speaking text in `lang`. Zero means "wrong
 * language — do not use"; otherwise higher is better. The accent dominates,
 * the quality hints only break ties between voices of the same accent.
 */
export function scoreVoice(voice: VoiceLike, lang: string): number {
  const wanted = normaliseLang(lang);
  const have = normaliseLang(voice.lang);
  const language = wanted.split('-')[0];
  if (!language || have.split('-')[0] !== language) return 0;

  let score: number;
  if (have === wanted) score = 100;
  else if (!wanted.includes('-')) score = 80;
  else {
    const rank = (RELATED_ACCENTS[wanted] ?? []).indexOf(have);
    score = rank >= 0 ? 70 - 4 * rank : 45;
  }

  if (voice.localService) score += 8;
  if (voice.default) score += 2;
  if (PREMIUM_NAME.test(voice.name)) score += 6;
  if (ROBOTIC_NAME.test(voice.name)) score -= 4;
  // Enough to rank a joke voice below every ordinary voice of the language, whatever its accent.
  if (NOVELTY_NAME.test(voice.name)) score -= 70;
  return Math.max(1, score);
}

/**
 * The best available voice for `lang`. When no voice speaks that language at
 * all, any English voice is used instead (the simulator's text is English).
 * Returns null when there is nothing suitable — the caller then lets the
 * browser choose from the utterance's `lang`.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang: string): T | null {
  const best = (target: string): T | null => {
    let winner: T | null = null;
    let top = 0;
    for (const voice of voices) {
      const score = scoreVoice(voice, target);
      if (score > top) {
        top = score;
        winner = voice;
      }
    }
    return winner;
  };
  return best(lang) ?? (normaliseLang(lang).startsWith('en') ? null : best(DEFAULT_SPEECH_LANG));
}
