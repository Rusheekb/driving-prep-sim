/**
 * Learner Lane — brand mark.
 *
 * The mark is an L-plate: a rounded lane-marking-yellow square carrying an "L"
 * that is drawn as a road with a dashed centre line. It uses three flat
 * colours and no gradients or ids, so the same markup works inline, as a
 * favicon and at 16 px.
 *
 * ```ts
 * header.append(logo());                              // mark + wordmark
 * hero.append(logo({ size: 72, withWordmark: false })); // mark only
 * installFavicon();                                   // <link rel="icon"> from the mark
 * ```
 */
import { h, svg } from './dom';

export const BRAND_NAME = 'Learner Lane';
export const BRAND_TAGLINE = 'Learn the road before you take the test.';

/** Path of the road that forms the "L" (also used for its centre line). */
const L_ROAD = 'M23 12v25.5a7 7 0 0 0 7 7H50.5';

/** The logo mark as standalone SVG markup (64 × 64 viewBox). */
export const LOGO_SVG: string =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none">' +
  '<rect x="2" y="2" width="60" height="60" rx="15" fill="#ffd23f"/>' +
  '<rect x="4.75" y="4.75" width="54.5" height="54.5" rx="12.25" stroke="#161b2b" stroke-opacity=".16" stroke-width="1.5"/>' +
  `<path d="${L_ROAD}" stroke="#161b2b" stroke-width="14.5" stroke-linejoin="round"/>` +
  `<path d="${L_ROAD}" stroke="#ffffff" stroke-width="2.4" stroke-dasharray="5.2 4.6" stroke-dashoffset="-2.3"/>` +
  '</svg>';

/** The mark as a `data:` URL, e.g. for `<link rel="icon">` or a manifest. */
export function faviconDataUrl(): string {
  return `data:image/svg+xml,${encodeURIComponent(LOGO_SVG)}`;
}

/** Point the document's favicon at the logo mark (creates the `<link>` if needed). */
export function installFavicon(): void {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  link.type = 'image/svg+xml';
  link.href = faviconDataUrl();
}

export interface LogoOptions {
  /** Height of the mark in CSS px at the default text scale (default 40). */
  size?: number;
  /** Show the "Learner Lane" wordmark next to the mark (default true). */
  withWordmark?: boolean;
}

/**
 * The Learner Lane logo as an element (`role="img"`, labelled "Learner Lane").
 * Sizes are in rem so the logo follows the user's text scale.
 */
export function logo(opts: LogoOptions = {}): HTMLElement {
  const size = opts.size ?? 40;
  const withWordmark = opts.withWordmark ?? true;
  const mark = svg(LOGO_SVG);
  mark.setAttribute('class', 'll-logo__mark');
  mark.setAttribute('aria-hidden', 'true');
  mark.setAttribute('focusable', 'false');
  mark.removeAttribute('width');
  mark.removeAttribute('height');
  return h(
    'span',
    {
      class: ['ll-logo', { 'll-logo--mark-only': !withWordmark }],
      role: 'img',
      'aria-label': BRAND_NAME,
      style: { '--ll-logo-size': `${size / 16}rem` },
    },
    mark,
    withWordmark &&
      h('span', { class: 'll-logo__word', 'aria-hidden': true }, 'Learner', h('span', { class: 'll-logo__word-accent' }, 'Lane')),
  );
}
