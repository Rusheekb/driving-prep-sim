/**
 * Learner Lane — icon set.
 *
 * Every icon is drawn on a 24 × 24 grid with a 2 px round stroke in
 * `currentColor`, so icons inherit the text colour and scale crisply. The set
 * is hand-drawn for this project: no icon font, no network request.
 *
 * ```ts
 * icon('steering-wheel')                         // decorative (aria-hidden)
 * icon('warning-triangle', { label: 'Warning' }) // meaningful (role="img" + label)
 * icon('trophy', { size: 32, class: 'll-text-accent' })
 * ```
 */
import { svg } from './dom';

const OPEN =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';

/** Wrap path markup in the shared 24 × 24 stroke `<svg>` element. */
const s = (body: string): string => `${OPEN}${body}</svg>`;

const STAR_PATH = 'M12 3l2.53 6.12 6.6.51-5.04 4.3 1.55 6.44L12 16.9l-5.64 3.47 1.55-6.44-5.04-4.3 6.6-.51z';
const SPEAKER_PATH = 'M3.5 9.5h3.2L12 5.2v13.6l-5.3-4.3H3.5z';
const BRAKE_ARCS = 'M5.1 5.6a9.6 9.6 0 0 0 0 12.8M18.9 5.6a9.6 9.6 0 0 1 0 12.8';
const CLOUD_PATH = 'M7 15.5a3.75 3.75 0 0 1-.55-7.46 5.75 5.75 0 0 1 11.2.96A3.3 3.3 0 0 1 17.2 15.5z';

const ICON_DEFS = {
  /* ---- Driving ---------------------------------------------------------- */
  'steering-wheel': s(
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>' +
      '<path d="M3.2 10.4 9.6 11.4M20.8 10.4l-6.4 1M12 14.5V21"/>',
  ),
  car: s(
    '<path d="M5.2 11 6.7 6.4A2 2 0 0 1 8.6 5h6.8a2 2 0 0 1 1.9 1.4L18.8 11"/>' +
      '<rect x="3" y="11" width="18" height="6.5" rx="2"/>' +
      '<path d="M6.5 17.5V19.5M17.5 17.5V19.5M6.5 14.2h1.8M15.7 14.2h1.8"/>',
  ),
  road: s('<path d="M7.5 3 4 21M16.5 3 20 21M12 4v2.5M12 10.2v3M12 17.5V20"/>'),
  'traffic-light': s(
    '<rect x="7" y="2" width="10" height="16.5" rx="3"/>' +
      '<circle cx="12" cy="6.3" r="1.2"/><circle cx="12" cy="10.25" r="1.2"/><circle cx="12" cy="14.2" r="1.2"/>' +
      '<path d="M12 18.5V22M9 22h6"/>',
  ),
  'stop-sign': s('<path d="M8.27 3h7.46L21 8.27v7.46L15.73 21H8.27L3 15.73V8.27z"/><path d="M8 12h8"/>'),
  'yield-sign': s('<path d="M3.9 5h16.2a1 1 0 0 1 .87 1.5l-8.1 13.6a1 1 0 0 1-1.74 0L3.03 6.5A1 1 0 0 1 3.9 5z"/><path d="M8.6 9h6.8L12 14.7z"/>'),
  parking: s('<rect x="3.5" y="3.5" width="17" height="17" rx="3.5"/><path d="M9.5 17V7.5h3.25a3 3 0 0 1 0 6H9.5"/>'),
  roundabout: s(
    '<circle cx="12" cy="12" r="2.2"/><path d="M19.2 12A7.2 7.2 0 1 1 12 4.8"/><path d="M9.6 2.3 12.1 4.8 9.6 7.3"/>' +
      '<path d="M12 19.2V22M19.2 12H22"/>',
  ),
  'lane-change': s(
    '<path d="M8 21v-3.5c0-3.4 8-4.1 8-8V4"/><path d="M12.5 7.2 16 3.7l3.5 3.5"/><path d="M12 21v-2M12 5.5v-2M4 21V3"/>',
  ),
  'turn-left': s('<path d="M18.5 20.5V13a4 4 0 0 0-4-4h-9"/><path d="M10 4.5 5.5 9l4.5 4.5"/>'),
  'turn-right': s('<path d="M5.5 20.5V13a4 4 0 0 1 4-4h9"/><path d="M14 4.5 18.5 9 14 13.5"/>'),
  'u-turn': s('<path d="M18 20.5v-11a5 5 0 0 0-10 0V17"/><path d="M4 13l4 4.2 4-4.2"/>'),
  straight: s('<path d="M12 21V3.5"/><path d="M6.5 9 12 3.5 17.5 9"/>'),
  route: s(
    '<circle cx="6" cy="18.5" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/>' +
      '<path d="M8.5 18.5H15a3.25 3.25 0 0 0 0-6.5H9A3.25 3.25 0 0 1 9 5.5h6.5"/>',
  ),
  crosswalk: s('<path d="M4 20 7 4M9.3 20l1.2-16M14.7 20 13.5 4M20 20 17 4"/>'),
  pedestrian: s(
    '<circle cx="12.8" cy="4.3" r="1.8"/>' +
      '<path d="M11.8 9 10.2 14.2l3.3 2.8.7 4.5M10.2 14.2 8 21.5M7.5 12.5l1.3-2.7L11.8 9l2.7 3 3 1"/>',
  ),
  cone: s('<path d="M10.3 3.5h3.4L18 18.5H6z"/><path d="M3.5 21h17M8.7 9.5h6.6M7.4 14h9.2"/>'),
  'emergency-stop': s(`<circle cx="12" cy="12" r="6"/><path d="${BRAKE_ARCS}"/><path d="M12 8.8v3.7M12 15.2h.01"/>`),
  handbrake: s(`<circle cx="12" cy="12" r="6"/><path d="${BRAKE_ARCS}"/><path d="M10.6 15.2V8.8h1.9a1.9 1.9 0 0 1 0 3.8h-1.9"/>`),
  'gear-shift': s(
    '<circle cx="6" cy="5" r="2"/><circle cx="12" cy="5" r="2"/><circle cx="18" cy="5" r="2"/>' +
      '<circle cx="6" cy="19" r="2"/><circle cx="12" cy="19" r="2"/>' +
      '<path d="M6 7v10M12 7v10M18 7v3a2 2 0 0 1-2 2H6"/>',
  ),
  speedometer: s(
    '<path d="M5.2 18.2a9 9 0 1 1 13.6 0"/><path d="M12 12.3 15.8 8"/><circle cx="12" cy="12.3" r="1.3"/>' +
      '<path d="M6.3 12.3h.01M12 6.6v.01M17.7 12.3h.01"/>',
  ),
  mirror: s('<rect x="2.5" y="8.5" width="19" height="9" rx="3.5"/><path d="M12 8.5V4.5M9.5 4.5h5M7.5 14.5l2.5-3M12 14.5l1.5-1.8"/>'),
  seatbelt: s(
    '<circle cx="12" cy="5" r="2.5"/><path d="M6 21v-5.5A5.5 5.5 0 0 1 11.5 10h1a5.5 5.5 0 0 1 5.5 5.5V21"/>' +
      '<path d="M8.2 11.5 16.8 21M6 18.5h5.8"/>',
  ),
  headlights: s(
    '<path d="M13.5 5.5c3.9 0 7 2.9 7 6.5s-3.1 6.5-7 6.5c-1.4 0-2.5-2.9-2.5-6.5s1.1-6.5 2.5-6.5z"/>' +
      '<path d="M3.5 7.5h4M3.5 12h4M3.5 16.5h4"/>',
  ),
  wipers: s(
    '<path d="M3 9.5c5.5-4.3 12.5-4.3 18 0l-2.6 8.5H5.6z"/><path d="M12 18 16.3 9.8"/><path d="M8.3 12.8a6.5 6.5 0 0 1 6-3.6"/>',
  ),
  horn: s(
    '<path d="M2.5 12H5M5 9.5v5M5 10.7c5.3 0 8.3-1.9 10.5-5.2v13c-2.2-3.3-5.2-5.2-10.5-5.2"/>' +
      '<path d="M19 9l2-1M19 12h2.5M19 15l2 1"/>',
  ),
  hazard: s('<path d="M12 3 2.5 19.5h19z"/><path d="M12 9.6l-3.9 6.7h7.8z"/>'),
  key: s('<circle cx="7.5" cy="15.5" r="4"/><path d="M10.4 12.6 19.5 3.5M16 7l3 3M13.5 9.5l2 2"/>'),
  power: s('<path d="M12 3v8.5"/><path d="M6.7 6.8a7.8 7.8 0 1 0 10.6 0"/>'),

  /* ---- Learning & progress ---------------------------------------------- */
  book: s('<path d="M12 6.5C10.3 5 7.8 4.5 3 4.5V18c4.8 0 7.3.5 9 2 1.7-1.5 4.2-2 9-2V4.5c-4.8 0-7.3.5-9 2z"/><path d="M12 6.5V20"/>'),
  'clipboard-check': s(
    '<path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/>' +
      '<rect x="9" y="2.5" width="6" height="3.5" rx="1.2"/><path d="m8.8 13.3 2.2 2.2 4.2-4.7"/>',
  ),
  trophy: s(
    '<path d="M7.5 3.5h9V9a4.5 4.5 0 0 1-9 0z"/>' +
      '<path d="M7.5 5.5H4.2v1A3.8 3.8 0 0 0 8 10.3M16.5 5.5h3.3v1a3.8 3.8 0 0 1-3.8 3.8"/>' +
      '<path d="M12 13.5v3.5M8.5 20.5v-1.5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5M7 20.5h10"/>',
  ),
  medal: s(
    '<circle cx="12" cy="15" r="5.5"/><path d="M8.3 10.9 5 3.5h4.2L12 9.5M15.7 10.9 19 3.5h-4.2L13.4 6.5"/>' +
      '<path d="M11 14l1.2-.9v4.2"/>',
  ),
  star: s(`<path d="${STAR_PATH}"/>`),
  'star-filled': s(`<path d="${STAR_PATH}" fill="currentColor"/>`),
  sparkles: s(
    '<path d="M10 3.5 11.7 8.3a2 2 0 0 0 1.2 1.2L17.7 11.2l-4.8 1.7a2 2 0 0 0-1.2 1.2L10 18.9l-1.7-4.8a2 2 0 0 0-1.2-1.2L2.3 11.2l4.8-1.7a2 2 0 0 0 1.2-1.2z"/>' +
      '<path d="M18.5 2.5v4M16.5 4.5h4M19 16.5v4M17 18.5h4"/>',
  ),
  fire: s(
    '<path d="M12 21.5c3.9 0 6.7-2.7 6.7-6.4 0-2.5-1.2-4.5-2.8-6.3-.3 1.5-1 2.5-2.1 3.2.3-3.7-1.2-7-4.3-9.5.2 3.1-.9 5.1-2.3 7-1.1 1.5-1.9 3.2-1.9 5.6 0 3.7 2.8 6.4 6.7 6.4z"/>' +
      '<path d="M12 21.5c1.5 0 2.6-1.1 2.6-2.6 0-1.3-.8-2.3-2.6-3.9-1.8 1.6-2.6 2.6-2.6 3.9 0 1.5 1.1 2.6 2.6 2.6z"/>',
  ),
  flag: s('<path d="M5 21.5V3.5M5 4.5c2.5-1.5 4.8-1.5 7 0s4.5 1.5 7 0v9c-2.5 1.5-4.8 1.5-7 0s-4.5-1.5-7 0"/>'),
  target: s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
  chart: s('<path d="M4 3.5v15a2 2 0 0 0 2 2h14.5"/><path d="M8.5 16v-4M12.5 16V8M16.5 16v-6"/>'),
  bulb: s(
    '<path d="M9 17.5h6M10 21h4"/>' +
      '<path d="M8.5 14.5c-1.5-1.2-2.5-3-2.5-5a6 6 0 0 1 12 0c0 2-1 3.8-2.5 5-.3.3-.5.7-.5 1.2v1.8H9v-1.8c0-.5-.2-.9-.5-1.2z"/>',
  ),
  'thumbs-up': s(
    '<path d="M7.5 10.5 11.3 3.5a2.3 2.3 0 0 1 2.7 2.8l-.8 3.7h5a2.2 2.2 0 0 1 2.1 2.8l-1.7 6a2.2 2.2 0 0 1-2.1 1.7H7.5"/>' +
      '<rect x="3" y="10.5" width="4.5" height="10" rx="1"/>',
  ),

  /* ---- Places ----------------------------------------------------------- */
  map: s('<path d="M9 4 3 6.5V20l6-2.5 6 2.5 6-2.5V4l-6 2.5z"/><path d="M9 4v13.5M15 6.5V20"/>'),
  'map-pin': s('<path d="M12 21.5s-7-6.3-7-11.8a7 7 0 0 1 14 0c0 5.5-7 11.8-7 11.8z"/><circle cx="12" cy="9.7" r="2.5"/>'),
  globe: s(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/>' +
      '<path d="M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3z"/>',
  ),
  home: s('<path d="M4 10.3 12 3.8l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-5v6h-4A1.5 1.5 0 0 1 4 19z"/>'),

  /* ---- Controls & devices ----------------------------------------------- */
  settings: s(
    '<path d="M10.2 5.03l.38-2.52h2.84l.38 2.52 1.85.77 2.06-1.52 2.01 2.01-1.52 2.06.77 1.85 2.52.38v2.84l-2.52.38-.77 1.85 1.52 2.06-2.01 2.01-2.06-1.52-1.85.77-.38 2.52h-2.84l-.38-2.52-1.85-.77-2.06 1.52-2.01-2.01 1.52-2.06-.77-1.85-2.52-.38v-2.84l2.52-.38.77-1.85-1.52-2.06 2.01-2.01 2.06 1.52z"/>' +
      '<circle cx="12" cy="12" r="3"/>',
  ),
  sliders: s(
    '<path d="M4 6.5h8.5M17.5 6.5H20M4 12h2.5M11.5 12H20M4 17.5h9.5M18.5 17.5H20"/>' +
      '<circle cx="15" cy="6.5" r="2.3"/><circle cx="9" cy="12" r="2.3"/><circle cx="16" cy="17.5" r="2.3"/>',
  ),
  keyboard: s(
    '<rect x="2.5" y="6" width="19" height="12" rx="2.5"/>' +
      '<path d="M6.5 10h.01M10.2 10h.01M13.8 10h.01M17.5 10h.01M6.5 14h.01M17.5 14h.01M10 14h4"/>',
  ),
  gamepad: s(
    '<path d="M7.5 7h9a5 5 0 0 1 4.9 4l.9 4.3a2.5 2.5 0 0 1-4.5 2L16.2 15H7.8l-1.6 2.3a2.5 2.5 0 0 1-4.5-2L2.6 11a5 5 0 0 1 4.9-4z"/>' +
      '<path d="M8 9.5v3M6.5 11h3M15 12.2h.01M17.3 10h.01"/>',
  ),
  touch: s(
    '<path d="M9.5 13V7.3a1.75 1.75 0 0 1 3.5 0V12l4.3 1a2 2 0 0 1 1.5 2.3l-.6 3.4a3 3 0 0 1-3 2.5h-2.8a3 3 0 0 1-2.4-1.2l-3.3-4.4a1.5 1.5 0 0 1 2.2-2z"/>' +
      '<path d="M6.3 8.3a5 5 0 1 1 9.9 0"/>',
  ),
  camera: s(
    '<path d="M3 8.5a2 2 0 0 1 2-2h2.3l1.4-2.3h6.6l1.4 2.3H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  ),
  volume: s(`<path d="${SPEAKER_PATH}"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.3a8 8 0 0 1 0 11.4"/>`),
  'volume-off': s(`<path d="${SPEAKER_PATH}"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>`),
  maximize: s('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
  minimize: s('<path d="M9 4v4a1 1 0 0 1-1 1H4M20 9h-4a1 1 0 0 1-1-1V4M15 20v-4a1 1 0 0 1 1-1h4M4 15h4a1 1 0 0 1 1 1v4"/>'),

  /* ---- Conditions ------------------------------------------------------- */
  sun: s(
    '<circle cx="12" cy="12" r="4"/>' +
      '<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  ),
  moon: s('<path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8z"/>'),
  'cloud-rain': s(`<path d="${CLOUD_PATH}"/><path d="M8.5 18.5 7.7 21M12.4 18.5l-.8 2.5M16.3 18.5l-.8 2.5"/>`),
  fog: s(`<path d="${CLOUD_PATH}"/><path d="M4.5 18.7h15M7.5 21.7h9"/>`),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>'),
  calendar: s('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),

  /* ---- Status ----------------------------------------------------------- */
  check: s('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  'check-circle': s('<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.8 2.8L16 9.5"/>'),
  x: s('<path d="M6 6l12 12M18 6 6 18"/>'),
  'x-circle': s('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  'warning-triangle': s(
    '<path d="M10.3 4.4 2.7 17.5a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.5M12 17.2h.01"/>',
  ),
  info: s('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>'),
  'help-circle': s('<circle cx="12" cy="12" r="9"/><path d="M9.4 9.3a2.7 2.7 0 0 1 5.3.7c0 1.8-2.7 2.2-2.7 4M12 17.2h.01"/>'),
  lock: s('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2.2"/>'),
  eye: s('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>'),
  accessibility: s(
    '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="7.3" r="1"/>' +
      '<path d="M7.5 10.2c3 .9 6 .9 9 0M12 11v3.2M12 14.2l-2.3 4M12 14.2l2.3 4"/>',
  ),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),

  /* ---- Actions & navigation --------------------------------------------- */
  play: s('<path d="M7.5 4.8v14.4L19.5 12z"/>'),
  pause: s('<rect x="6" y="4.5" width="4" height="15" rx="1"/><rect x="14" y="4.5" width="4" height="15" rx="1"/>'),
  restart: s('<path d="M4.5 12A7.5 7.5 0 1 0 7 6.4L4.5 8.8"/><path d="M4.5 4.3v4.5H9"/>'),
  menu: s('<path d="M4 6.5h16M4 12h16M4 17.5h16"/>'),
  more: s('<path d="M5.5 12h.01M12 12h.01M18.5 12h.01"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>'),
  minus: s('<path d="M5 12h14"/>'),
  search: s('<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>'),
  trash: s('<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6 6.5l.8 12.6a1.5 1.5 0 0 0 1.5 1.4h7.4a1.5 1.5 0 0 0 1.5-1.4L18 6.5M10 10.5v6M14 10.5v6"/>'),
  download: s('<path d="M12 3.5v11.5M7 10.5l5 5 5-5M4.5 20h15"/>'),
  'external-link': s('<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>'),
  'arrow-left': s('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  'arrow-right': s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  'arrow-up': s('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  'arrow-down': s('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  'chevron-left': s('<path d="m14.5 6-6 6 6 6"/>'),
  'chevron-right': s('<path d="m9.5 6 6 6-6 6"/>'),
  'chevron-up': s('<path d="m6 14.5 6-6 6 6"/>'),
  'chevron-down': s('<path d="m6 9.5 6 6 6-6"/>'),
} as const;

/** Names of the hand-drawn icons, plus the aliases `cog` (= `settings`) and `streak` (= `fire`). */
export type IconName = keyof typeof ICON_DEFS | 'cog' | 'streak';

/** SVG markup for every icon (24 × 24, `stroke="currentColor"`). */
export const ICONS: Record<IconName, string> = {
  ...ICON_DEFS,
  cog: ICON_DEFS.settings,
  streak: ICON_DEFS.fire,
};

/** Every icon name, in catalogue order (handy for galleries and tests). */
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export interface IconOptions {
  /** Width and height in CSS px at the default text scale (default: `1.25em`, i.e. it follows the font size). */
  size?: number;
  /** Accessible name. Without it the icon is decorative and hidden from assistive technology. */
  label?: string;
  /** Extra class name(s). */
  class?: string;
}

/**
 * Create an icon element.
 * Decorative by default (`aria-hidden="true"`); pass `label` when the icon
 * conveys meaning on its own.
 */
export function icon(name: IconName, opts: IconOptions = {}): SVGElement {
  const el = svg(ICONS[name]);
  el.setAttribute('class', opts.class ? `ll-icon ${opts.class}` : 'll-icon');
  el.setAttribute('data-icon', name);
  el.setAttribute('focusable', 'false');
  el.removeAttribute('width');
  el.removeAttribute('height');
  if (opts.size) {
    // rem so that icons follow the user's text scale.
    const rem = `${opts.size / 16}rem`;
    el.style.width = rem;
    el.style.height = rem;
  }
  if (opts.label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', opts.label);
  } else {
    el.setAttribute('aria-hidden', 'true');
  }
  return el;
}
