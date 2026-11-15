/**
 * Settings, controls reference and about screens.
 */
import type { ScreenFactory } from '../../app/app';
import type { AppSettings } from '../../core/types';
import { GAMEPAD_BINDINGS, KEY_BINDINGS } from '../../input';
import { BRAND_NAME } from '../brand';
import { h, mount } from '../dom';
import { btn, callout, confirmDialog, page, section, seg, slider, toast, toggle } from '../kit';

export const settingsScreen: ScreenFactory = (app) => {
  const s = app.settings.get();
  const p = app.profile();
  const set = (patch: Partial<AppSettings>): void => app.settings.set(patch);
  return page(
    { title: 'Settings', onBack: () => app.back(), narrow: true },
    section(
      'Region and units',
      h(
        'div',
        { class: 'll-panel' },
        h('div', { class: 'll-rowflex' }, h('b', null, `${p.flag} ${p.name}`), btn('Change region', { size: 'sm', onClick: () => app.go({ name: 'region' }) })),
        seg(
          'Speed units',
          [
            { value: 'auto', label: `Local (${p.speedUnit})` },
            { value: 'mph', label: 'mph' },
            { value: 'km/h', label: 'km/h' },
          ],
          s.speedUnit,
          (v) => set({ speedUnit: v }),
        ),
      ),
    ),
    section(
      'Driving view',
      h(
        'div',
        { class: 'll-panel' },
        seg(
          'Default camera',
          [
            { value: 'chase', label: 'Behind', hint: 'Easiest for learning the controls.' },
            { value: 'hood', label: 'Bonnet', hint: 'A clear view of the road with no interior.' },
            { value: 'driver', label: 'Driver', hint: 'Most realistic. Mirrors and shoulder checks really matter.' },
            { value: 'top', label: 'Top', hint: 'Handy for parking practice.' },
          ],
          s.camera,
          (v) => set({ camera: v }),
        ),
        toggle('Show mirrors', s.showMirrors, (v) => set({ showMirrors: v }), 'Rear-view and door mirrors at the top of the screen.'),
        toggle('Guide line on the road', s.navLine, (v) => set({ navLine: v }), 'Shown in coaching mode only.'),
      ),
    ),
    section(
      'Sound',
      h(
        'div',
        { class: 'll-panel' },
        slider('Volume', s.volume, 0, 1, 0.05, (v) => set({ volume: v }), (v) => `${Math.round(v * 100)}%`),
        toggle('Speak instructions aloud', s.voice, (v) => set({ voice: v }), 'Uses your browser\'s built-in voice, where available.'),
      ),
    ),
    section(
      'Controls',
      h(
        'div',
        { class: 'll-panel' },
        seg(
          'Touch controls',
          [
            { value: 'auto', label: 'Automatic', hint: 'Appear when you touch the screen.' },
            { value: 'on', label: 'Always on' },
            { value: 'off', label: 'Off' },
          ],
          s.touchControls,
          (v) => set({ touchControls: v }),
        ),
        slider('Steering speed', s.steeringSensitivity, 0.5, 1.5, 0.05, (v) => set({ steeringSensitivity: v }), (v) => `${Math.round(v * 100)}%`),
        btn('See all controls', { icon: 'keyboard', onClick: () => app.go({ name: 'controls' }) }),
      ),
    ),
    section(
      'Graphics',
      h(
        'div',
        { class: 'll-panel' },
        seg(
          'Quality',
          [
            { value: 'low', label: 'Low', hint: 'Best for older phones and laptops.' },
            { value: 'medium', label: 'Medium', hint: 'A good balance.' },
            { value: 'high', label: 'High', hint: 'Sharper picture and shadows.' },
          ],
          s.graphics,
          (v) => set({ graphics: v }),
        ),
      ),
    ),
    section(
      'Accessibility',
      h(
        'div',
        { class: 'll-panel' },
        slider('Text size', s.textScale, 0.85, 1.4, 0.05, (v) => set({ textScale: v }), (v) => `${Math.round(v * 100)}%`),
        toggle('High contrast', s.highContrast, (v) => set({ highContrast: v })),
        toggle('Reduce motion', s.reducedMotion, (v) => set({ reducedMotion: v }), 'Turns off screen animations and camera swoops.'),
      ),
    ),
    section(
      'Your data',
      h(
        'div',
        { class: 'll-panel' },
        h('p', { class: 'll-muted' }, 'Progress is stored only in this browser. Nothing is sent anywhere.'),
        btn('Reset progress', {
          variant: 'danger',
          icon: 'trash',
          onClick: () =>
            void confirmDialog('Reset all progress?', 'Stars, history and theory results will be erased from this browser.', 'Reset', 'Keep', true).then((yes) => {
              if (yes) {
                app.progress.reset();
                toast('Progress reset');
              }
            }),
        }),
      ),
    ),
  );
};

export const controlsScreen: ScreenFactory = (app) => {
  const table = (rows: readonly { label: string; keys: string[]; group: string }[]): HTMLElement => {
    const groups = [...new Set(rows.map((r) => r.group))];
    return h(
      'div',
      { class: 'll-grid ll-grid--wide' },
      ...groups.map((g) =>
        h(
          'div',
          { class: 'll-panel' },
          h('h2', { class: 'll-section__title' }, g),
          h('div', { class: 'll-table' }, ...rows.filter((r) => r.group === g).map((r) => h('div', { class: 'll-table__row' }, h('span', null, r.label), h('span', { class: 'll-keys' }, ...r.keys.map((k) => h('kbd', { class: 'll-kbd' }, k)))))),
        ),
      ),
    );
  };
  const body = h('div', { class: 'll-stack ll-stack--lg' });
  const show = (which: string): void => {
    if (which === 'keyboard') mount(body, table(KEY_BINDINGS));
    else if (which === 'gamepad') mount(body, table(GAMEPAD_BINDINGS));
    else
      mount(body, h(
          'div',
          { class: 'll-panel ll-prose' },
          h('p', null, h('b', null, 'Steering wheel'), ' (bottom left): drag it round with your thumb. It springs back when you let go.'),
          h('p', null, h('b', null, 'Pedals'), ' (bottom right): BRAKE and GAS. Press higher up a pedal for more.'),
          h('p', null, h('b', null, 'Above the wheel'), ': ◄ and ► indicators and the hazard lights.'),
          h('p', null, h('b', null, 'Above the pedals'), ': P R N D gears, the parking brake Ⓟ, and ⋯ for seatbelt, engine, lights, wipers and horn.'),
          h('p', null, h('b', null, 'Either side, mid-screen'), ': hold ◄ LOOK / LOOK ► to check over a shoulder, BACK to look behind, and tap L, C, R to check a mirror.'),
          h('p', null, 'Turn your phone sideways for the best view.'),
        ),
      );
  };
  const start = app.device();
  show(start);
  return page(
    { title: 'Controls', onBack: () => app.back() },
    seg(
      'Device',
      [
        { value: 'keyboard', label: 'Keyboard' },
        { value: 'touch', label: 'Touch' },
        { value: 'gamepad', label: 'Gamepad' },
      ],
      start,
      show,
    ),
    body,
    callout('info', 'eye', h('b', null, 'How observation is counted. '), 'Tap a mirror key and that mirror lights up: the check is logged. Hold a look key for a quarter of a second or more and it counts as a shoulder (blind-spot) check on that side. The row of icons above the speedometer confirms each one.'),
  );
};

export const aboutScreen: ScreenFactory = (app) => {
  const p = app.profile();
  return page(
    { title: `About ${BRAND_NAME}`, onBack: () => app.back(), narrow: true },
    h(
      'div',
      { class: 'll-panel ll-prose' },
      h('p', null, `${BRAND_NAME} is a free driving-test simulator. It lets you rehearse what an examiner looks for — observation, signalling, speed, junctions, manoeuvres — as often as you like, before you do it for real.`),
      h('p', null, 'Road rules differ from place to place, so the simulator adapts to your region: side of the road, signs, speed units, priority rules and the way the practical test is marked.'),
    ),
    callout(
      'warn',
      'warning-triangle',
      h('b', null, 'Practice aid only. '),
      `${BRAND_NAME} is not affiliated with any licensing authority and is no substitute for lessons with a qualified instructor or for the official handbook. Laws change; if anything here differs from your official handbook, the handbook is right. Never use this while driving.`,
    ),
    section(
      `Where the ${p.name} rules come from`,
      h('ul', { class: 'll-list' }, ...p.sources.map((s) => h('li', null, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', class: 'll-link' }, s.title)))),
      h('p', { class: 'll-muted' }, `Last reviewed ${p.lastReviewed}.`),
    ),
    section('Privacy', h('p', { class: 'll-muted' }, 'No account, no tracking, no ads. Your settings and progress are stored only in this browser and never leave your device.')),
    section('Credits', h('p', { class: 'll-muted' }, 'Built with three.js. Town, signs, sounds and vehicles are generated in code — nothing is downloaded while you play.')),
  );
};
