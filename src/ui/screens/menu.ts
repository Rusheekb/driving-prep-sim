/**
 * Main menu screens: home, first-run welcome, region picker, scenario lists
 * and the pre-drive briefing.
 */
import type { App, ScreenFactory } from '../../app/app';
import type { JurisdictionProfile, ScenarioCategory, ScenarioMeta, SessionSettings } from '../../core/types';
import { JURISDICTION_GROUPS } from '../../jurisdictions';
import { BRAND_NAME, logo } from '../brand';
import { type Child, h, mount } from '../dom';
import type { IconName } from '../icons';
import { btn, callout, card, chip, page, ring, section, seg, stars, toast } from '../kit';

const CATEGORY_INFO: Record<ScenarioCategory, { title: string; blurb: string; icon: IconName }> = {
  lesson: { title: 'Lessons', blurb: 'Step-by-step coaching, from your first drive to tricky junctions.', icon: 'book' },
  skill: { title: 'Skill practice', blurb: 'Short drills for manoeuvres and the things that fail tests.', icon: 'target' },
  test: { title: 'Mock test', blurb: 'An examiner, a route and your region\'s marking scheme.', icon: 'clipboard-check' },
  free: { title: 'Free drive', blurb: 'Explore the town in any weather, at any time of day.', icon: 'steering-wheel' },
};

const describeRegion = (p: JurisdictionProfile): string => `Drive on the ${p.drivingSide} · ${p.speedUnit} · ${p.licensingAuthority}`;

/** Best next thing to do: the first lesson not yet completed, else the mock test. */
function nextUp(app: App): ScenarioMeta {
  const list = app.scenarios();
  const p = app.profile();
  const undone = list.filter((s) => s.category === 'lesson').sort((a, b) => a.order - b.order).find((s) => !app.progress.bestFor(p.id, s.id));
  return undone ?? list.find((s) => s.id === 'test-full') ?? list[0]!;
}

function bestBadge(app: App, m: ScenarioMeta): Child {
  const best = app.progress.bestFor(app.profile().id, m.id);
  if (!best) return null;
  if (m.assessed) return chip(best.outcome === 'passed' ? 'Passed' : 'Not yet passed', best.outcome === 'passed' ? 'good' : 'warn');
  return stars(best.stars);
}

export const homeScreen: ScreenFactory = (app) => {
  const p = app.profile();
  const list = app.scenarios();
  const next = nextUp(app);
  const lessons = list.filter((s) => s.category === 'lesson');
  const lessonsDone = lessons.filter((s) => app.progress.bestFor(p.id, s.id)).length;
  const readiness = app.progress.readiness(p, list);
  const mode = (category: ScenarioCategory, badge?: Child): HTMLElement => {
    const info = CATEGORY_INFO[category];
    const only = list.filter((s) => s.category === category);
    return card({ title: info.title, text: info.blurb, icon: info.icon, badge, onClick: () => (only.length === 1 ? app.go({ name: 'briefing', scenarioId: only[0]!.id }) : app.go({ name: 'scenarios', category })) });
  };
  return h(
    'div',
    { class: 'll-page ll-home' },
    h(
      'div',
      { class: 'll-page__inner' },
      h(
        'header',
        { class: 'll-home__hero' },
        logo({ size: 56, withWordmark: true }),
        h('h1', { class: 'll-sr-only', tabIndex: -1 }, BRAND_NAME),
        h('p', { class: 'll-home__tagline' }, 'Learn it here. Pass it out there.'),
        h(
          'button',
          { type: 'button', class: 'll-home__region', onClick: () => app.go({ name: 'region' }), 'aria-label': `Region: ${p.name}. Change region` },
          h('span', { class: 'll-home__flag', 'aria-hidden': 'true' }, p.flag),
          h('span', null, h('b', null, p.name), h('small', null, describeRegion(p))),
          chip('Change', 'accent'),
        ),
      ),
      section(
        'Pick up where you left off',
        card({
          title: next.title,
          text: next.summary,
          icon: next.assessed ? 'clipboard-check' : 'play',
          highlight: true,
          badge: chip(next.category === 'lesson' ? `Lesson ${next.order}` : CATEGORY_INFO[next.category].title, 'accent'),
          footer: [chip(`${next.estMinutes} min`, 'neutral', 'clock')],
          onClick: () => app.go({ name: 'briefing', scenarioId: next.id }),
        }),
      ),
      section(
        'Drive',
        h('div', { class: 'll-grid' }, mode('lesson', chip(`${lessonsDone} of ${lessons.length}`, lessonsDone === lessons.length ? 'good' : 'neutral')), mode('skill'), mode('test'), mode('free')),
      ),
      section(
        'Learn',
        h(
          'div',
          { class: 'll-grid' },
          card({ title: 'Theory test', text: `Practise for the ${p.knowledgeTest.officialName}: ${p.knowledgeTest.questionCount} questions, ${p.knowledgeTest.passMark} to pass.`, icon: 'help-circle', onClick: () => app.go({ name: 'theory' }) }),
          card({ title: 'Road signs', text: `Every sign you will meet in ${p.name}, and what to do about it.`, icon: 'stop-sign', onClick: () => app.go({ name: 'signs' }) }),
          card({ title: 'Local rules', text: `The key rules and how the ${p.terms.roadTest} works in ${p.name}.`, icon: 'globe', onClick: () => app.go({ name: 'rules' }) }),
          card({ title: 'Progress', text: 'Stars, history and what to work on next.', icon: 'chart', media: ring(readiness.score, 'ready', 56), onClick: () => app.go({ name: 'progress' }) }),
        ),
      ),
      h(
        'footer',
        { class: 'll-rowflex ll-home__footer' },
        btn('Settings', { variant: 'ghost', icon: 'settings', onClick: () => app.go({ name: 'settings' }) }),
        btn('Controls', { variant: 'ghost', icon: 'keyboard', onClick: () => app.go({ name: 'controls' }) }),
        btn('About', { variant: 'ghost', icon: 'info', onClick: () => app.go({ name: 'about' }) }),
      ),
    ),
  );
};

function regionPicker(app: App, onPick: () => void): HTMLElement {
  const current = app.settings.get().jurisdictionId;
  return h(
    'div',
    { class: 'll-stack' },
    ...JURISDICTION_GROUPS.map((g) =>
      section(
        `${g.flag} ${g.country}`,
        h(
          'div',
          { class: 'll-grid' },
          ...g.profiles.map((p) =>
            card({
              title: p.name,
              text: describeRegion(p),
              media: h('span', { class: 'll-card__icon ll-home__flag', 'aria-hidden': 'true' }, p.flag),
              highlight: p.id === current,
              badge: p.id === current ? chip('Selected', 'good', 'check') : null,
              onClick: () => {
                app.settings.set({ jurisdictionId: p.id, speedUnit: 'auto' });
                onPick();
              },
            }),
          ),
        ),
      ),
    ),
    h('p', { class: 'll-muted' }, 'Do not see your region? Pick the closest match. The driving skills transfer, but always check your own official handbook for local rules.'),
  );
}

export const regionScreen: ScreenFactory = (app) =>
  page(
    { title: 'Where are you learning to drive?', subtitle: 'Your region sets the side of the road, speed units, road signs, local rules and how the mock test is marked.', onBack: () => app.back() },
    regionPicker(app, () => {
      toast(`Region set to ${app.profile().name}`, 'good');
      app.back();
    }),
  );

export const welcomeScreen: ScreenFactory = (app) => {
  const finish = (): void => {
    app.settings.set({ onboarded: true });
    app.home();
  };
  const body = h('div', { class: 'll-stack ll-stack--lg' });
  const stepRegion = (): void => {
    mount(body, h('p', { class: 'll-lead' }, 'Welcome. First, where are you learning to drive? It changes the side of the road, the signs, the rules and how your test is marked.'),
      regionPicker(app, stepHow),
    );
  };
  const stepHow = (): void => {
    const p = app.profile();
    const s = app.settings.get();
    mount(body, callout('good', 'check-circle', h('b', null, `${p.flag} ${p.name}`), ` — ${describeRegion(p)}. You can change this any time.`),
      h(
        'div',
        { class: 'll-panel' },
        seg(
          'Driving view',
          [
            { value: 'chase', label: 'Behind the car', hint: 'Easiest to start with. Press V while driving to switch.' },
            { value: 'driver', label: "Driver's seat", hint: 'Most realistic: use your mirrors and look over your shoulder.' },
          ],
          s.camera === 'driver' ? 'driver' : 'chase',
          (v) => app.settings.set({ camera: v }),
        ),
        h('div', { class: 'll-prose' }, h('p', null, 'On a keyboard: W A S D or the arrow keys to drive, Q and E for the indicators. On a phone or tablet, on-screen controls appear when you touch the screen. Gamepads work too. The first lesson teaches everything.')),
      ),
      callout(
        'info',
        'info',
        'Learner Lane is a practice aid. It is not a substitute for lessons with a qualified instructor or for your official handbook, and rules change — always check ',
        h('a', { href: p.handbookUrl, target: '_blank', rel: 'noopener noreferrer', class: 'll-link' }, p.handbookName),
        '.',
      ),
      h(
        'div',
        { class: 'll-rowflex' },
        btn('Start the first lesson', {
          variant: 'primary',
          size: 'lg',
          icon: 'play',
          onClick: () => {
            app.settings.set({ onboarded: true });
            app.home();
            app.go({ name: 'briefing', scenarioId: 'lesson-controls' });
          },
        }),
        btn('Go to the menu', { size: 'lg', onClick: finish }),
      ),
    );
  };
  stepRegion();
  return page({ title: 'Welcome to Learner Lane', subtitle: 'A free driving-test simulator for learner drivers.', narrow: false }, body);
};

export const scenariosScreen: ScreenFactory<{ name: 'scenarios'; category: ScenarioCategory }> = (app, route) => {
  const info = CATEGORY_INFO[route.category];
  const p = app.profile();
  const list = app
    .scenarios()
    .filter((s) => s.category === route.category)
    .sort((a, b) => a.order - b.order);
  const next = nextUp(app);
  const extras: Child[] = [];
  if (route.category === 'test') {
    const rt = p.roadTest;
    extras.push(
      section(
        `The real ${rt.officialName}`,
        h(
          'div',
          { class: 'll-panel' },
          h('ul', { class: 'll-list' }, ...rt.overview.map((o) => h('li', null, o))),
          h('p', null, h('b', null, 'How it is marked: '), rt.scoring.description),
          rt.scoring.officiallyPublished ? null : callout('warn', 'warning-triangle', 'The authority does not publish its exact marking scheme, so the marking here is our best approximation.'),
          h('p', { class: 'll-muted' }, rt.maneuverNotes),
        ),
      ),
    );
  }
  return page(
    { title: info.title, subtitle: info.blurb, onBack: () => app.back() },
    h(
      'div',
      { class: route.category === 'lesson' ? 'll-path' : 'll-grid ll-grid--wide' },
      ...list.map((m) =>
        card({
          title: route.category === 'lesson' ? `${m.order}. ${m.title}` : m.title,
          text: m.summary,
          icon: route.category === 'lesson' ? 'book' : route.category === 'test' ? 'clipboard-check' : 'target',
          highlight: m.id === next.id,
          badge: bestBadge(app, m),
          footer: [chip(`${m.estMinutes} min`, 'neutral', 'clock'), chip(['', 'Beginner', 'Intermediate', 'Advanced'][m.difficulty]!, m.difficulty === 3 ? 'warn' : 'neutral'), m.id === next.id ? chip('Up next', 'accent') : null],
          onClick: () => app.go({ name: 'briefing', scenarioId: m.id }),
        }),
      ),
    ),
    ...extras,
  );
};

export const briefingScreen: ScreenFactory<{ name: 'briefing'; scenarioId: string }> = (app, route) => {
  const m = app.scenarios().find((s) => s.id === route.scenarioId);
  if (!m) return page({ title: 'Not found', onBack: () => app.back() });
  const p = app.profile();
  const saved = app.settings.get().session;
  const forced = m.forced ?? {};
  const choice: SessionSettings = { ...saved, ...m.defaults, ...forced };
  const opt = <K extends keyof SessionSettings>(key: K, label: string, options: { value: SessionSettings[K] & string; label: string; hint?: string }[]): HTMLElement =>
    seg(label, options, choice[key] as SessionSettings[K] & string, (v) => ((choice[key] as string) = v), key in forced);
  const start = (demo: boolean): void => {
    // Remember free choices for next time (not the ones this scenario dictated or defaulted).
    const remember: Partial<SessionSettings> = {};
    for (const k of ['weather', 'timeOfDay', 'traffic', 'pedestrians', 'feedback', 'observation'] as const) {
      if (!(k in forced) && !(m.defaults && k in m.defaults)) (remember as Record<string, string>)[k] = choice[k];
    }
    app.settings.set({ session: { ...saved, ...remember } });
    app.startScenario(m.id, choice, demo);
  };
  const best = app.progress.bestFor(p.id, m.id);
  return page(
    {
      title: m.title,
      subtitle: m.summary,
      onBack: () => app.back(),
      actions: [m.hasDemo === false ? null : btn('Watch a demo', { icon: 'eye', onClick: () => start(true), title: 'The instructor drives it first' }), btn('Start driving', { variant: 'primary', size: 'lg', icon: 'play', onClick: () => start(false) })],
    },
    h(
      'div',
      { class: 'll-grid ll-grid--wide' },
      h(
        'div',
        { class: 'll-panel' },
        h('h2', { class: 'll-section__title' }, m.assessed ? 'How it works' : "What you'll practise"),
        h('ul', { class: 'll-list' }, ...m.briefing.map((b) => h('li', null, b))),
        h('div', { class: 'll-rowflex' }, chip(`About ${m.estMinutes} min`, 'neutral', 'clock'), best ? (m.assessed ? chip(best.outcome === 'passed' ? 'Passed before' : 'Not yet passed', best.outcome === 'passed' ? 'good' : 'warn') : stars(best.stars)) : chip('New', 'accent')),
        m.assessed && !p.roadTest.scoring.officiallyPublished ? callout('warn', 'warning-triangle', 'Marking is our best approximation of the real scheme.') : null,
      ),
      h(
        'div',
        { class: 'll-panel' },
        h('h2', { class: 'll-section__title' }, 'Conditions'),
        opt('weather', 'Weather', [
          { value: 'clear', label: 'Clear' },
          { value: 'rain', label: 'Rain', hint: 'Less grip, longer stopping distances. Wipers and lights on.' },
          { value: 'fog', label: 'Fog', hint: 'Limited visibility. Slow down.' },
        ]),
        opt('timeOfDay', 'Time of day', [
          { value: 'day', label: 'Day' },
          { value: 'dusk', label: 'Dusk', hint: 'Headlights on.' },
          { value: 'night', label: 'Night', hint: 'Headlights on. Look further ahead.' },
        ]),
        opt('traffic', 'Traffic', [
          { value: 'none', label: 'None' },
          { value: 'light', label: 'Light' },
          { value: 'normal', label: 'Normal' },
          { value: 'heavy', label: 'Heavy' },
        ]),
        opt('pedestrians', 'Pedestrians', [
          { value: 'none', label: 'None' },
          { value: 'few', label: 'A few' },
          { value: 'many', label: 'Many' },
        ]),
      ),
      h(
        'div',
        { class: 'll-panel' },
        h('h2', { class: 'll-section__title' }, 'Feedback'),
        opt('feedback', 'During the drive', [
          { value: 'coach', label: 'Coach me', hint: 'Faults and tips appear as they happen, with a guide line on the road.' },
          { value: 'exam', label: 'Exam silence', hint: 'Like the real test: nothing until the end.' },
        ]),
        opt('observation', 'Mirror and shoulder checks', [
          { value: 'off', label: 'Not marked', hint: 'Concentrate on driving first.' },
          { value: 'relaxed', label: 'Relaxed', hint: 'Marked for lane changes, moving off and reversing.' },
          { value: 'strict', label: 'Strict', hint: `As an examiner would: mirrors before turns, ${p.terms.blindSpotCheck}s, looking both ways at junctions.` },
        ]),
      ),
    ),
  );
};
