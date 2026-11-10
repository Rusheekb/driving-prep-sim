/**
 * Turns on-screen instruction text into something a speech synthesiser reads
 * naturally: key hints lose their brackets, arrows and unit abbreviations are
 * spoken as words, and decoration (emoji, bullets, markup) is dropped.
 *
 * Pure string functions. The patterns avoid look-behind so the module also
 * parses on older Safari versions.
 */

/** How the keys named in `[…]` hints are said aloud (looked up in lower case). */
const KEY_NAMES: Record<string, string> = {
  '↑': 'up arrow',
  '↓': 'down arrow',
  '←': 'left arrow',
  '→': 'right arrow',
  esc: 'Escape',
  space: 'Space bar',
  spacebar: 'Space bar',
  enter: 'Enter',
  return: 'Enter',
  ctrl: 'Control',
};

const ARROW_NAMES: Record<string, string> = {
  '↑': ' up arrow ',
  '↓': ' down arrow ',
  '←': ' left arrow ',
  '→': ' right arrow ',
};

/** Unit abbreviations that follow a number: [singular, plural]. */
const UNITS: Record<string, readonly [string, string]> = {
  'km/h': ['kilometre per hour', 'kilometres per hour'],
  mph: ['mile per hour', 'miles per hour'],
  'm/s': ['metre per second', 'metres per second'],
  km: ['kilometre', 'kilometres'],
  mi: ['mile', 'miles'],
  ft: ['foot', 'feet'],
  yd: ['yard', 'yards'],
  min: ['minute', 'minutes'],
  sec: ['second', 'seconds'],
  m: ['metre', 'metres'],
  s: ['second', 'seconds'],
};
// Longest alternatives first so "mph" is not read as metres followed by "ph".
const NUMBER_WITH_UNIT = /(\d+(?:\.\d+)?)\s*(km\/h|mph|m\/s|km|mi|ft|yd|min|sec|m|s)\b/g;

const ABBREVIATIONS: readonly (readonly [RegExp, string])[] = [
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\bapprox\./gi, 'approximately'],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\bkm\/h\b/gi, 'kilometres per hour'],
  [/\bmph\b/gi, 'miles per hour'],
];

const SYMBOLS: readonly (readonly [RegExp, string])[] = [
  [/&/g, ' and '],
  [/%/g, ' percent'],
  [/°/g, ' degrees'],
  [/×/g, ' times '],
  [/≥/g, ' at least '],
  [/≤/g, ' at most '],
  [/[≈~]\s*(?=\d)/g, 'about '],
  [/(\w)\s*\+\s*(?=\w)/g, '$1 plus '],
  [/\s=\s/g, ' equals '],
  [/…/g, '. '],
  [/[·•|]/g, ', '],
];

/** Pictographs, flags, dingbats and other symbols with no sensible reading, plus the joiners that glue emoji together. */
const UNSPEAKABLE = /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{So}\p{Sk}‍️⃣]/gu;

function sayKey(raw: string): string {
  const key = raw.trim();
  return KEY_NAMES[key.toLowerCase()] ?? key;
}

/** Rewrite `text` so that it reads well aloud. Returns '' when nothing speakable is left. */
export function cleanSpeechText(text: string): string {
  let out = String(text ?? '');

  // Markup tags ("<b>…</b>"). A real tag starts with a letter, so "speed < 30" survives.
  out = out.replace(/<\/?[a-z][^<>]*>/gi, ' ');

  // Key hints: "[Q]" → "Q", "[↑]" → "up arrow", "[Esc]" → "Escape".
  out = out.replace(/\[([^[\]\n]{1,14})\]/g, (_match, key: string) => ` ${sayKey(key)} `);

  // An arrow between two words is a sequence ("Mirror → Signal"); a lone arrow is an arrow key.
  out = out.replace(/->|[➜➔➡⇒⟶]/g, '→');
  out = out.replace(/([\w)])\s*→\s*(?=\w)/g, '$1, then ');
  out = out.replace(/[↑↓←→]/g, (arrow) => ARROW_NAMES[arrow] ?? ' ');

  // "50 km/h" → "50 kilometres per hour", "1 mi" → "1 mile".
  out = out.replace(NUMBER_WITH_UNIT, (_match, value: string, abbreviation: string) => {
    const [singular, plural] = UNITS[abbreviation]!;
    return `${value} ${Number(value) === 1 ? singular : plural}`;
  });
  for (const [pattern, spoken] of ABBREVIATIONS) out = out.replace(pattern, spoken);

  // Number ranges, then dashes used as punctuation.
  out = out.replace(/(\d)\s*[–—-]\s*(?=\d)/g, '$1 to ');
  out = out.replace(/\s[–—-]+\s|[–—]/g, ', ');

  // "W / S" → "W or S" (fractions such as 1/2 are left for the synthesiser).
  out = out.replace(/([^\d\s])\s*\/\s*(?=[^\d\s])/g, '$1 or ');

  for (const [pattern, spoken] of SYMBOLS) out = out.replace(pattern, spoken);

  // Emphasis markers, stray brackets, emoji and decorative symbols.
  out = out.replace(/[*_`#[\]{}]+/g, ' ');
  out = out.replace(UNSPEAKABLE, ' ');

  // Tidy the spacing and punctuation the steps above leave behind.
  return out
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/[,;:]\s*([.!?])/g, '$1')
    .replace(/([.!?])\s*[,;:]/g, '$1')
    .replace(/^[\s,;:.]+/, '')
    .replace(/[\s,;:]+$/, '')
    .trim();
}

/**
 * Rough time a synthesiser needs to say `text`, in seconds. Used only as a
 * safety net for browsers that sometimes never report the end of an utterance.
 */
export function estimateSpeechSeconds(text: string, rate = 1): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  const pace = Number.isFinite(rate) && rate > 0.1 ? rate : 1;
  return (0.5 + words / 2.4) / pace;
}
