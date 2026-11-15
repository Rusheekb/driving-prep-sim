/**
 * Road signs drawn as standalone SVG strings, in the style of each country's
 * sign system (simplified vector versions of the real designs). Pure string
 * generation: used for 3D sign textures, the HUD speed-limit sign, the sign
 * library and sign-recognition questions.
 */
import type { DrivingSide, JurisdictionProfile, SpeedUnit } from '../core/types';

export type SignFamily = 'us' | 'ca' | 'gb' | 'ie' | 'au' | 'nz' | 'de' | 'in';

export interface SignStyle {
  family: SignFamily;
  drivingSide: DrivingSide;
  unit: SpeedUnit;
  /** Text on the yield / give-way sign ('' = blank triangle). */
  yieldText: string;
}

export type SignKind =
  | 'stop'
  | 'yield'
  | 'all_way_plaque'
  | 'priority_road'
  | 'priority_to_right'
  | 'roundabout_mandatory'
  | 'speed_limit'
  | 'national_speed_limit'
  | 'school_zone'
  | 'no_entry'
  | 'one_way'
  | 'no_left_turn'
  | 'no_right_turn'
  | 'no_u_turn'
  | 'keep_left'
  | 'keep_right'
  | 'no_parking'
  | 'no_stopping'
  | 'roundabout'
  | 'pedestrian_crossing'
  | 'signal_ahead'
  | 'stop_ahead'
  | 'yield_ahead'
  | 'crossroads'
  | 'bend_left'
  | 'bend_right'
  | 'slippery_road'
  | 'road_narrows'
  | 'two_way_traffic'
  | 'road_works'
  | 'railway_crossing'
  | 'parking';

export interface SignInfo {
  name: string;
  meaning: string;
  category: 'priority' | 'regulatory' | 'warning' | 'information';
}

const FAMILY_BY_COUNTRY: Record<string, SignFamily> = { US: 'us', CA: 'ca', GB: 'gb', IE: 'ie', AU: 'au', NZ: 'nz', DE: 'de', IN: 'in' };

export function signStyleFor(profile: Pick<JurisdictionProfile, 'countryCode' | 'drivingSide' | 'speedUnit' | 'roadStyle'>): SignStyle {
  const family = FAMILY_BY_COUNTRY[profile.countryCode] ?? (profile.roadStyle.warningSign === 'yellow_diamond' ? 'us' : 'de');
  return { family, drivingSide: profile.drivingSide, unit: profile.speedUnit, yieldText: profile.roadStyle.yieldSignText };
}

/* ------------------------------- colours ---------------------------------- */

const RED = '#c8102e';
const YELLOW = '#ffcd00';
const SCHOOL = '#c4d600';
const ORANGE = '#f47b20';
const BLUE = '#0a57a4';
const GREEN = '#00703c';
const BLACK = '#111111';
const WHITE = '#ffffff';
const FONT = 'font-family="Arial, Helvetica, sans-serif" font-weight="700" text-anchor="middle"';

const usesDiamonds = (f: SignFamily): boolean => f === 'us' || f === 'ca' || f === 'au' || f === 'nz' || f === 'ie';
const northAmerican = (f: SignFamily): boolean => f === 'us' || f === 'ca';
const panelFamily = (f: SignFamily): boolean => f === 'us' || f === 'ca' || f === 'au' || f === 'nz';

/* ------------------------------ pictograms -------------------------------- */
/* Each returns markup drawn around (0,0) in a ±20 unit box, in the given colour. */

const stroke = (c: string, w = 4): string => `fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;

const P = {
  person: (c: string): string =>
    `<circle cx="1" cy="-15" r="4" fill="${c}"/><path d="M1 -9 L0 3 M0 3 L-7 17 M0 3 L8 16 M-8 -1 L1 -8 L9 -2" ${stroke(c)}/>`,
  children: (c: string): string =>
    `<g transform="translate(-8 0)">${P.person(c)}</g><g transform="translate(9 5) scale(0.72)">${P.person(c)}</g>`,
  arrowUp: (c: string): string => `<path d="M0 18 V-6" ${stroke(c, 6)}/><path d="M0 -19 L10 -4 H-10 Z" fill="${c}"/>`,
  turn: (c: string, dir: 1 | -1): string =>
    `<g transform="scale(${dir} 1)"><path d="M-7 18 V0 Q-7 -8 1 -8 H6" ${stroke(c, 6)}/><path d="M18 -8 L4 -18 V2 Z" fill="${c}"/></g>`,
  uturn: (c: string, dir: 1 | -1): string =>
    `<g transform="scale(${dir} 1)"><path d="M9 18 V-4 A9 9 0 0 0 -9 -4 V4" ${stroke(c, 6)}/><path d="M-9 17 L-19 3 H1 Z" fill="${c}"/></g>`,
  keep: (c: string, dir: 1 | -1): string =>
    `<g transform="scale(${dir} 1) rotate(45)"><path d="M0 -14 V4" ${stroke(c, 6)}/><path d="M0 19 L10 4 H-10 Z" fill="${c}"/></g>`,
  roundabout: (c: string, anticlockwise: boolean): string => {
    const one = `<path d="M0 -13 A13 13 0 0 1 11.3 6.5" ${stroke(c, 4.5)}/><path d="M14.5 14 L16.5 2 L6 7 Z" fill="${c}"/>`;
    const ring = [0, 120, 240].map((a) => `<g transform="rotate(${a})">${one}</g>`).join('');
    return anticlockwise ? `<g transform="scale(-1 1)">${ring}</g>` : ring;
  },
  signals: (): string =>
    `<rect x="-8" y="-19" width="16" height="38" rx="4" fill="${BLACK}"/><circle cy="-12" r="4.6" fill="#e3262e"/><circle cy="0" r="4.6" fill="#ffb81c"/><circle cy="12" r="4.6" fill="#2fbf71"/>`,
  crossroads: (c: string): string => `<path d="M0 18 V-18" ${stroke(c, 8)}/><path d="M-16 0 H16" ${stroke(c, 5)}/>`,
  saltire: (c: string): string => `<path d="M-13 -13 L13 13 M13 -13 L-13 13" ${stroke(c, 6)}/>`,
  bend: (c: string, dir: 1 | -1): string =>
    `<g transform="scale(${dir} 1)"><path d="M-8 18 V8 Q-8 -4 4 -6" ${stroke(c, 6)}/><path d="M16 -9 L3 -17 L4 2 Z" fill="${c}"/></g>`,
  slippery: (c: string): string =>
    `<rect x="-9" y="-16" width="18" height="12" rx="3" fill="${c}"/><rect x="-11" y="-6" width="5" height="6" rx="1" fill="${c}"/><rect x="6" y="-6" width="5" height="6" rx="1" fill="${c}"/><path d="M-8 3 Q-13 8 -8 12 Q-3 16 -8 20 M8 3 Q3 8 8 12 Q13 16 8 20" ${stroke(c, 2.6)}/>`,
  narrows: (c: string): string => `<path d="M-13 18 V4 L-5 -6 V-18 M13 18 V4 L5 -6 V-18" ${stroke(c, 5)}/>`,
  twoWay: (c: string): string =>
    `<g transform="translate(-9 0) scale(0.8) rotate(180)">${P.arrowUp(c)}</g><g transform="translate(9 0) scale(0.8)">${P.arrowUp(c)}</g>`,
  works: (c: string): string =>
    `<circle cx="-2" cy="-13" r="4" fill="${c}"/><path d="M-3 -8 L-7 3 L-12 16 M-7 3 L0 9 L-1 17 M-4 -4 L6 2 M2 -6 L14 12" ${stroke(c, 3.6)}/><path d="M6 18 Q12 6 19 18 Z" fill="${c}"/>`,
  gate: (c: string): string => `<path d="M-17 -8 H17 M-17 6 H17 M-12 -14 V14 M0 -14 V14 M12 -14 V14" ${stroke(c, 3.6)}/>`,
  letterP: (c: string): string => `<text y="14" font-size="40" ${FONT} fill="${c}">P</text>`,
};

/* -------------------------------- frames ---------------------------------- */

interface Art {
  w: number;
  h: number;
  body: string;
}
const at = (x: number, y: number, s: number, inner: string): string => `<g transform="translate(${x} ${y}) scale(${s})">${inner}</g>`;

function diamond(pict: (c: string) => string, ground = YELLOW, scale = 1.25): Art {
  return {
    w: 100,
    h: 100,
    body:
      `<rect x="16" y="16" width="68" height="68" rx="6" transform="rotate(45 50 50)" fill="${ground}" stroke="${BLACK}" stroke-width="3"/>` +
      at(50, 50, scale, pict(BLACK)),
  };
}
function triangle(pict: (c: string) => string, scale = 0.95): Art {
  return {
    w: 100,
    h: 90,
    body:
      `<path d="M50 6 L95 84 H5 Z" fill="${WHITE}" stroke="${RED}" stroke-width="9" stroke-linejoin="round"/>` + at(50, 58, scale, pict(BLACK)),
  };
}
const warning = (f: SignFamily, pict: (c: string) => string, ground = YELLOW): Art => (usesDiamonds(f) ? diamond(pict, ground) : triangle(pict));

function ring(pict: (c: string) => string, slash: boolean, scale = 1.2): Art {
  return {
    w: 100,
    h: 100,
    body:
      `<circle cx="50" cy="50" r="44" fill="${WHITE}" stroke="${RED}" stroke-width="10"/>` +
      at(50, 50, scale, pict(BLACK)) +
      (slash ? `<path d="M20 20 L80 80" stroke="${RED}" stroke-width="9"/>` : ''),
  };
}
function panelProhibit(pict: (c: string) => string): Art {
  return {
    w: 100,
    h: 100,
    body:
      `<rect x="3" y="3" width="94" height="94" rx="8" fill="${WHITE}" stroke="${BLACK}" stroke-width="3"/>` +
      at(50, 50, 1.25, pict(BLACK)) +
      `<circle cx="50" cy="50" r="38" fill="none" stroke="${RED}" stroke-width="8"/><path d="M23 23 L77 77" stroke="${RED}" stroke-width="8"/>`,
  };
}
const prohibit = (f: SignFamily, pict: (c: string) => string): Art => (panelFamily(f) ? panelProhibit(pict) : ring(pict, true));

const blueDisc = (pict: (c: string) => string, scale = 1.5): Art => ({
  w: 100,
  h: 100,
  body: `<circle cx="50" cy="50" r="47" fill="${BLUE}" stroke="${WHITE}" stroke-width="3"/>` + at(50, 50, scale, pict(WHITE)),
});

function textPanel(lines: string[], opts: { fg?: string; bg?: string; pict?: string; w?: number; h?: number } = {}): Art {
  const w = opts.w ?? 80;
  const h = opts.h ?? 100;
  const fg = opts.fg ?? BLACK;
  const size = Math.min(17, (w - 14) / (Math.max(...lines.map((l) => l.length)) * 0.62));
  const top = opts.pict ? h * 0.62 : h / 2 - ((lines.length - 1) * size * 1.15) / 2 + size * 0.36;
  return {
    w,
    h,
    body:
      `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="6" fill="${opts.bg ?? WHITE}" stroke="${fg}" stroke-width="3"/>` +
      (opts.pict ? at(w / 2, h * 0.3, 1, opts.pict) : '') +
      lines.map((l, i) => `<text x="${w / 2}" y="${top + i * size * 1.15}" font-size="${size}" ${FONT} fill="${fg}">${l}</text>`).join(''),
  };
}

/* --------------------------------- signs ---------------------------------- */

function speedSign(style: SignStyle, value: number): Art {
  const num = (y: number, size: number, x = 40): string => `<text x="${x}" y="${y}" font-size="${size}" ${FONT} fill="${BLACK}">${value}</text>`;
  const digits = String(value).length;
  switch (style.family) {
    case 'us':
      return {
        w: 80,
        h: 100,
        body:
          `<rect x="2" y="2" width="76" height="96" rx="6" fill="${WHITE}" stroke="${BLACK}" stroke-width="3"/>` +
          `<text x="40" y="24" font-size="15" ${FONT} fill="${BLACK}">SPEED</text><text x="40" y="41" font-size="15" ${FONT} fill="${BLACK}">LIMIT</text>` +
          num(88, digits > 2 ? 40 : 48),
      };
    case 'ca':
      return {
        w: 80,
        h: 100,
        body:
          `<rect x="2" y="2" width="76" height="96" rx="6" fill="${WHITE}" stroke="${BLACK}" stroke-width="3"/>` +
          `<text x="40" y="24" font-size="13" ${FONT} fill="${BLACK}">MAXIMUM</text>` +
          num(70, digits > 2 ? 38 : 46) +
          `<text x="40" y="90" font-size="13" ${FONT} fill="${BLACK}">km/h</text>`,
      };
    case 'au':
    case 'nz':
      return {
        w: 80,
        h: 100,
        body:
          `<rect x="2" y="2" width="76" height="96" rx="6" fill="${WHITE}" stroke="${BLACK}" stroke-width="2.5"/>` +
          `<circle cx="40" cy="50" r="30" fill="${WHITE}" stroke="${RED}" stroke-width="8"/>` +
          num(62, digits > 2 ? 26 : 34),
      };
    default:
      return {
        w: 100,
        h: 100,
        body: `<circle cx="50" cy="50" r="44" fill="${WHITE}" stroke="${RED}" stroke-width="10"/>` + num(66, digits > 2 ? 36 : 46, 50),
      };
  }
}

function art(kind: SignKind, style: SignStyle, value?: number): Art {
  const f = style.family;
  const left = style.drivingSide === 'left';
  switch (kind) {
    case 'stop':
      return {
        w: 100,
        h: 100,
        body:
          `<path d="M31 4 H69 L96 31 V69 L69 96 H31 L4 69 V31 Z" fill="${RED}" stroke="${WHITE}" stroke-width="4"/>` +
          `<text x="50" y="61" font-size="30" ${FONT} fill="${WHITE}">STOP</text>`,
      };
    case 'yield': {
      const text = style.yieldText;
      const lines = text.split(' ');
      const na = northAmerican(f);
      return {
        w: 100,
        h: 90,
        body:
          `<path d="M5 6 H95 L50 84 Z" fill="${WHITE}" stroke="${RED}" stroke-width="${na ? 14 : 9}" stroke-linejoin="round"/>` +
          lines
            .map((l, i) => `<text x="50" y="${(lines.length > 1 ? 30 : 36) + i * 13}" font-size="${lines.length > 1 ? 12 : 13}" ${FONT} fill="${na || f === 'ie' ? RED : BLACK}">${l}</text>`)
            .join(''),
      };
    }
    case 'all_way_plaque':
      return textPanel(['ALL WAY'], { fg: WHITE, bg: RED, w: 100, h: 44 });
    case 'priority_road':
      return {
        w: 100,
        h: 100,
        body:
          `<rect x="15" y="15" width="70" height="70" rx="5" transform="rotate(45 50 50)" fill="${WHITE}" stroke="${BLACK}" stroke-width="2"/>` +
          `<rect x="27" y="27" width="46" height="46" rx="3" transform="rotate(45 50 50)" fill="${YELLOW}"/>`,
      };
    case 'priority_to_right':
      return triangle(P.saltire, 1);
    case 'roundabout_mandatory':
      return blueDisc((c) => P.roundabout(c, !left), 1.45);
    case 'speed_limit':
      return speedSign(style, value ?? (style.unit === 'mph' ? 30 : 50));
    case 'national_speed_limit':
      return {
        w: 100,
        h: 100,
        body: `<circle cx="50" cy="50" r="46" fill="${WHITE}" stroke="${BLACK}" stroke-width="3"/><path d="M78 18 L22 82" stroke="${BLACK}" stroke-width="14"/>`,
      };
    case 'school_zone': {
      if (northAmerican(f)) {
        return {
          w: 100,
          h: 100,
          body:
            `<path d="M50 4 L95 42 V95 H5 V42 Z" fill="${SCHOOL}" stroke="${BLACK}" stroke-width="3" stroke-linejoin="round"/>` + at(50, 58, 1.35, P.children(BLACK)),
        };
      }
      if (f === 'au') {
        const v = value ?? 40;
        return {
          w: 80,
          h: 100,
          body:
            `<rect x="2" y="2" width="76" height="96" rx="6" fill="${WHITE}" stroke="${BLACK}" stroke-width="2.5"/>` +
            `<rect x="6" y="6" width="68" height="26" rx="3" fill="${RED}"/><text x="40" y="17" font-size="10" ${FONT} fill="${WHITE}">SCHOOL</text><text x="40" y="28" font-size="10" ${FONT} fill="${WHITE}">ZONE</text>` +
            `<circle cx="40" cy="64" r="25" fill="${WHITE}" stroke="${RED}" stroke-width="7"/><text x="40" y="75" font-size="30" ${FONT} fill="${BLACK}">${v}</text>`,
        };
      }
      return warning(f, P.children);
    }
    case 'no_entry':
      if (northAmerican(f)) {
        return {
          w: 100,
          h: 100,
          body:
            `<rect x="2" y="2" width="96" height="96" rx="8" fill="${WHITE}" stroke="${BLACK}" stroke-width="2"/><circle cx="50" cy="50" r="44" fill="${RED}"/>` +
            `<rect x="14" y="42" width="72" height="16" fill="${WHITE}"/><text x="50" y="35" font-size="12" ${FONT} fill="${WHITE}">DO NOT</text><text x="50" y="76" font-size="12" ${FONT} fill="${WHITE}">ENTER</text>`,
        };
      }
      return {
        w: 100,
        h: 100,
        body: `<circle cx="50" cy="50" r="47" fill="${RED}" stroke="${WHITE}" stroke-width="3"/><rect x="14" y="41" width="72" height="18" fill="${WHITE}"/>`,
      };
    case 'one_way':
      return panelFamily(f)
        ? {
            w: 120,
            h: 44,
            body:
              `<rect x="2" y="2" width="116" height="40" rx="5" fill="${BLACK}" stroke="${WHITE}" stroke-width="2"/>` +
              `<path d="M10 22 H88 V10 L112 22 L88 34 V22" fill="${WHITE}" stroke="${WHITE}" stroke-width="12" stroke-linejoin="round"/>` +
              `<text x="52" y="27" font-size="14" ${FONT} fill="${BLACK}">ONE WAY</text>`,
          }
        : {
            w: 100,
            h: 100,
            body: `<rect x="3" y="3" width="94" height="94" rx="8" fill="${BLUE}" stroke="${WHITE}" stroke-width="3"/>` + at(50, 50, 1.9, P.arrowUp(WHITE)),
          };
    case 'no_left_turn':
      return prohibit(f, (c) => P.turn(c, -1));
    case 'no_right_turn':
      return prohibit(f, (c) => P.turn(c, 1));
    case 'no_u_turn':
      return prohibit(f, (c) => P.uturn(c, left ? -1 : 1));
    case 'keep_left':
    case 'keep_right': {
      const dir = kind === 'keep_left' ? -1 : 1;
      if (panelFamily(f)) return textPanel(['KEEP', dir < 0 ? 'LEFT' : 'RIGHT'], { pict: at(0, 0, 0.9, P.keep(BLACK, dir)) });
      return blueDisc((c) => P.keep(c, dir));
    }
    case 'no_parking':
      if (panelFamily(f)) return panelProhibit(P.letterP);
      return {
        w: 100,
        h: 100,
        body: `<circle cx="50" cy="50" r="44" fill="${BLUE}" stroke="${RED}" stroke-width="10"/><path d="M20 20 L80 80" stroke="${RED}" stroke-width="10"/>`,
      };
    case 'no_stopping':
      if (panelFamily(f)) return textPanel(['NO', 'STOPPING'], { fg: RED });
      return {
        w: 100,
        h: 100,
        body: `<circle cx="50" cy="50" r="44" fill="${BLUE}" stroke="${RED}" stroke-width="10"/><path d="M20 20 L80 80 M80 20 L20 80" stroke="${RED}" stroke-width="10"/>`,
      };
    case 'roundabout':
      return warning(f, (c) => P.roundabout(c, !left));
    case 'pedestrian_crossing':
      return warning(f, P.person, northAmerican(f) ? SCHOOL : YELLOW);
    case 'signal_ahead':
      return warning(f, () => P.signals());
    case 'stop_ahead':
      return diamond(
        (c) => `<path d="M-7 -1 H7 L14 6 V14 L7 21 H-7 L-14 14 V6 Z" fill="${RED}" transform="translate(0 -2) scale(0.9)"/>${at(0, -14, 0.5, P.arrowUp(c))}`,
      );
    case 'yield_ahead':
      return diamond(
        (c) => `<path d="M-13 2 H13 L0 22 Z" fill="${WHITE}" stroke="${RED}" stroke-width="4" stroke-linejoin="round"/>${at(0, -13, 0.5, P.arrowUp(c))}`,
      );
    case 'crossroads':
      return warning(f, P.crossroads);
    case 'bend_left':
      return warning(f, (c) => P.bend(c, -1));
    case 'bend_right':
      return warning(f, (c) => P.bend(c, 1));
    case 'slippery_road':
      return warning(f, P.slippery);
    case 'road_narrows':
      return warning(f, P.narrows);
    case 'two_way_traffic':
      return warning(f, P.twoWay);
    case 'road_works':
      return warning(f, P.works, northAmerican(f) ? ORANGE : YELLOW);
    case 'railway_crossing':
      if (northAmerican(f)) {
        return {
          w: 100,
          h: 100,
          body:
            `<circle cx="50" cy="50" r="46" fill="${YELLOW}" stroke="${BLACK}" stroke-width="3"/><path d="M19 19 L81 81 M81 19 L19 81" stroke="${BLACK}" stroke-width="8"/>` +
            `<text x="22" y="58" font-size="20" ${FONT} fill="${BLACK}">R</text><text x="78" y="58" font-size="20" ${FONT} fill="${BLACK}">R</text>`,
        };
      }
      return warning(f, P.gate);
    case 'parking':
      return northAmerican(f)
        ? { w: 100, h: 100, body: `<rect x="3" y="3" width="94" height="94" rx="8" fill="${WHITE}" stroke="${GREEN}" stroke-width="5"/>` + at(50, 52, 1.7, P.letterP(GREEN)) }
        : { w: 100, h: 100, body: `<rect x="3" y="3" width="94" height="94" rx="8" fill="${BLUE}" stroke="${WHITE}" stroke-width="3"/>` + at(50, 52, 1.7, P.letterP(WHITE)) };
  }
}

/** Standalone SVG markup for a sign (no width/height: the caller sizes it). */
export function signSvg(kind: SignKind, style: SignStyle, opts: { value?: number; title?: string } = {}): string {
  const a = art(kind, style, opts.value);
  const label = opts.title ?? signInfo(kind, style).name + (kind === 'speed_limit' && opts.value !== undefined ? ` ${opts.value} ${style.unit}` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a.w} ${a.h}" role="img" aria-label="${label}">${a.body}</svg>`;
}

/** Width / height of the sign's viewBox. */
export function signAspect(kind: SignKind, style: SignStyle): number {
  const a = art(kind, style, 30);
  return a.w / a.h;
}

/** `data:` URL usable as an image source or texture. */
export const signDataUrl = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/* ------------------------------ which signs -------------------------------- */

const COMMON: SignKind[] = [
  'stop', 'yield', 'speed_limit', 'school_zone', 'no_entry', 'one_way', 'no_left_turn', 'no_right_turn', 'no_u_turn',
  'no_parking', 'roundabout', 'pedestrian_crossing', 'signal_ahead', 'crossroads', 'bend_left', 'bend_right',
  'slippery_road', 'road_narrows', 'two_way_traffic', 'road_works', 'railway_crossing', 'parking',
];

/** Signs that exist (in this simplified library) for a family. */
export function signsFor(style: SignStyle): SignKind[] {
  const f = style.family;
  const out = [...COMMON];
  out.push(style.drivingSide === 'left' ? 'keep_left' : 'keep_right');
  if (northAmerican(f)) out.push('all_way_plaque', 'stop_ahead', 'yield_ahead');
  if (!panelFamily(f) || f === 'au' || f === 'nz') out.push('no_stopping');
  if (f === 'gb' || f === 'de' || f === 'in' || f === 'ie') out.push('roundabout_mandatory');
  if (f === 'de') out.push('priority_road', 'priority_to_right');
  if (f === 'gb') out.push('national_speed_limit');
  return out;
}

export const SIGN_KINDS: readonly SignKind[] = [
  ...COMMON, 'keep_left', 'keep_right', 'all_way_plaque', 'stop_ahead', 'yield_ahead', 'no_stopping', 'roundabout_mandatory',
  'priority_road', 'priority_to_right', 'national_speed_limit',
];

/* ------------------------------- meanings ---------------------------------- */

export function signInfo(kind: SignKind, style: SignStyle): SignInfo {
  const f = style.family;
  const gw = f === 'us' || f === 'ca' || f === 'ie' ? 'yield' : 'give way';
  const Gw = gw === 'yield' ? 'Yield' : 'Give way';
  const junction = northAmerican(f) ? 'intersection' : 'junction';
  const circ = style.drivingSide === 'left' ? 'clockwise' : 'counter-clockwise';
  const info = (name: string, meaning: string, category: SignInfo['category']): SignInfo => ({ name, meaning, category });
  switch (kind) {
    case 'stop':
      return info('Stop', `Come to a complete stop at the line, then ${gw} to all traffic and pedestrians before moving on.`, 'priority');
    case 'yield':
      return info(Gw, `Slow down and ${gw} to traffic on the road you are joining. Stop if you need to; go when it is clear.`, 'priority');
    case 'all_way_plaque':
      return info('All-way stop', 'Every approach has a stop sign. Stop, then go in the order vehicles arrived; in a tie, the driver on the right goes first.', 'priority');
    case 'priority_road':
      return info('Priority road', `You have priority at the ${junction}s ahead until the sign is cancelled.`, 'priority');
    case 'priority_to_right':
      return info('Junction with priority to the right', 'An unmarked junction is ahead: give way to traffic coming from your right.', 'warning');
    case 'roundabout_mandatory':
      return info('Roundabout', `Go round the roundabout ${circ}, giving way to traffic already on it.`, 'regulatory');
    case 'speed_limit':
      return info('Speed limit', `The fastest you may legally drive here, in ${style.unit}, in good conditions.`, 'regulatory');
    case 'national_speed_limit':
      return info('National speed limit applies', 'The national limit for this type of road and your vehicle applies (60 mph on single carriageways, 70 mph on dual carriageways and motorways for cars).', 'regulatory');
    case 'school_zone':
      return info(northAmerican(f) || f === 'au' ? 'School zone' : 'School / children', 'Children may be crossing or near the road. Slow down, obey any lower school limit and be ready to stop.', 'warning');
    case 'no_entry':
      return info(northAmerican(f) ? 'Do not enter' : 'No entry', 'You must not drive into this road from here: traffic comes toward you.', 'regulatory');
    case 'one_way':
      return info('One way', 'Traffic flows only in the direction of the arrow.', 'regulatory');
    case 'no_left_turn':
      return info('No left turn', 'You must not turn left here.', 'regulatory');
    case 'no_right_turn':
      return info('No right turn', 'You must not turn right here.', 'regulatory');
    case 'no_u_turn':
      return info('No U-turn', 'You must not turn round to go back the way you came.', 'regulatory');
    case 'keep_left':
      return info('Keep left', 'Pass to the left of the island or obstruction.', 'regulatory');
    case 'keep_right':
      return info('Keep right', 'Pass to the right of the island or obstruction.', 'regulatory');
    case 'no_parking':
      return info(panelFamily(f) ? 'No parking' : 'No waiting', 'You must not leave your vehicle parked here.', 'regulatory');
    case 'no_stopping':
      return info(f === 'gb' ? 'No stopping (clearway)' : 'No stopping', 'You must not stop here, not even to set down a passenger.', 'regulatory');
    case 'roundabout':
      return info('Roundabout ahead', `A roundabout is ahead. Slow down and be ready to ${gw} to traffic already on it.`, 'warning');
    case 'pedestrian_crossing':
      return info('Pedestrian crossing', `People may be crossing ahead. Slow down and be ready to stop and ${gw}.`, 'warning');
    case 'signal_ahead':
      return info('Traffic signals ahead', 'Traffic lights are ahead. Be ready to stop.', 'warning');
    case 'stop_ahead':
      return info('Stop sign ahead', 'A stop sign is ahead. Start slowing so you can stop smoothly at the line.', 'warning');
    case 'yield_ahead':
      return info('Yield sign ahead', 'A yield sign is ahead. Slow down and be ready to stop for traffic.', 'warning');
    case 'crossroads':
      return info(`Cross${northAmerican(f) ? 'road' : 'roads'} ahead`, `Another road crosses yours ahead. Watch for vehicles entering or crossing.`, 'warning');
    case 'bend_left':
      return info(northAmerican(f) ? 'Curve to the left' : 'Bend to the left', 'The road bends to the left ahead. Slow down before the bend.', 'warning');
    case 'bend_right':
      return info(northAmerican(f) ? 'Curve to the right' : 'Bend to the right', 'The road bends to the right ahead. Slow down before the bend.', 'warning');
    case 'slippery_road':
      return info(northAmerican(f) ? 'Slippery when wet' : 'Slippery road', 'The surface may be slippery. Slow down and avoid harsh braking or steering.', 'warning');
    case 'road_narrows':
      return info('Road narrows', 'The road gets narrower ahead. Be ready to adjust your position and speed.', 'warning');
    case 'two_way_traffic':
      return info('Two-way traffic', 'Traffic comes toward you on this road. Keep to your side.', 'warning');
    case 'road_works':
      return info(northAmerican(f) ? 'Road work ahead' : 'Road works', 'Workers or machinery may be in the road. Slow down and follow any temporary signs.', 'warning');
    case 'railway_crossing':
      return info(northAmerican(f) ? 'Railroad crossing' : 'Level crossing', 'A railway crosses the road ahead. Slow down, look and listen, and never stop on the tracks.', 'warning');
    case 'parking':
      return info('Parking', 'Parking is allowed here, subject to any times or conditions shown.', 'information');
  }
}
