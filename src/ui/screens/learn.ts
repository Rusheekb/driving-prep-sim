/**
 * Results, progress, local rules, sign library and theory quiz screens.
 */
import type { App, ScreenFactory } from '../../app/app';
import { formatDistance } from '../../core/units';
import type { Fault, FaultCode, SessionResult, Severity } from '../../core/types';
import { FAULTS } from '../../rules/catalog';
import { describeFault } from '../../rules/messages';
import { summariseFaults } from '../../rules/scoring';
import { type SignKind, signInfo, signStyleFor, signSvg, signsFor } from '../../signs';
import { CATEGORY_LABELS, type Quiz, type QuizMode, buildQuiz, getQuestionBank, gradeQuiz } from '../../theory/engine';
import type { TheoryCategory } from '../../theory/types';
import { buildRoadNetwork } from '../../world/network';
import { TOWN } from '../../world/town';
import { type Child, announce, h, mount } from '../dom';
import { icon } from '../icons';
import { type Tone, btn, callout, card, chip, confirmDialog, modal, page, progressBar, ring, section, seg, stars, stat } from '../kit';

const SEV_TONE: Record<Severity, Tone> = { minor: 'warn', serious: 'bad', dangerous: 'bad' };
const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const signEl = (svg: string, cls = 'll-sign'): HTMLElement => {
  const el = h('span', { class: cls });
  el.innerHTML = svg;
  return el;
};

/* --------------------------------- results -------------------------------- */

function reviewMap(app: App, result: SessionResult, onPick: (f: Fault | null) => void): { canvas: HTMLCanvasElement; highlight(id: number | null): void } {
  const net = buildRoadNetwork(TOWN, app.profile());
  const canvas = h('canvas', { class: 'll-review__map', role: 'img', 'aria-label': 'Map of your drive with fault locations' }) as HTMLCanvasElement;
  const W = 900;
  const b = net.bounds;
  const scale = W / (b.maxX - b.minX + 20);
  canvas.width = W;
  canvas.height = Math.round((b.maxZ - b.minZ + 20) * scale);
  const c = canvas.getContext('2d')!;
  const X = (x: number): number => (x - b.minX + 10) * scale;
  const Z = (z: number): number => (z - b.minZ + 10) * scale;
  let hot: number | null = null;
  const draw = (): void => {
    c.fillStyle = '#131b2e';
    c.fillRect(0, 0, canvas.width, canvas.height);
    for (const zone of net.zones.values()) {
      c.fillStyle = '#2b3654';
      c.fillRect(X(zone.rect.minX), Z(zone.rect.minZ), (zone.rect.maxX - zone.rect.minX) * scale, (zone.rect.maxZ - zone.rect.minZ) * scale);
      c.fillRect(X(zone.driveway.minX), Z(zone.driveway.minZ), (zone.driveway.maxX - zone.driveway.minX) * scale, (zone.driveway.maxZ - zone.driveway.minZ) * scale);
    }
    c.lineCap = 'round';
    for (const road of net.roads.values()) {
      c.strokeStyle = '#3b4a70';
      c.lineWidth = (road.carriagewayWidth + 2) * scale;
      c.beginPath();
      c.moveTo(X(road.start.x), Z(road.start.z));
      c.lineTo(X(road.end.x), Z(road.end.z));
      c.stroke();
    }
    for (const node of net.nodes.values()) {
      if (!node.roundabout) continue;
      c.fillStyle = '#3b4a70';
      c.beginPath();
      c.arc(X(node.pos.x), Z(node.pos.z), (node.roundabout.outerRadius + 1) * scale, 0, 7);
      c.fill();
      c.fillStyle = '#131b2e';
      c.beginPath();
      c.arc(X(node.pos.x), Z(node.pos.z), node.roundabout.islandRadius * scale, 0, 7);
      c.fill();
    }
    if (result.path.length > 1) {
      c.strokeStyle = '#45b0ff';
      c.lineWidth = 3;
      c.lineJoin = 'round';
      c.beginPath();
      result.path.forEach((p, i) => (i ? c.lineTo(X(p.x), Z(p.z)) : c.moveTo(X(p.x), Z(p.z))));
      c.stroke();
      const s = result.path[0]!;
      const e = result.path[result.path.length - 1]!;
      c.fillStyle = '#2fbf71';
      c.beginPath();
      c.arc(X(s.x), Z(s.z), 6, 0, 7);
      c.fill();
      c.fillStyle = '#f4f6fb';
      c.fillRect(X(e.x) - 5, Z(e.z) - 5, 10, 10);
    }
    c.font = '700 13px system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    result.faults.forEach((f, i) => {
      const isHot = f.id === hot;
      const r = isHot ? 15 : 11;
      c.fillStyle = f.severity === 'minor' ? '#ffb020' : '#f0555a';
      c.strokeStyle = isHot ? '#ffffff' : '#0c1220';
      c.lineWidth = isHot ? 3 : 2;
      c.beginPath();
      if (f.severity === 'minor') c.arc(X(f.x), Z(f.z), r, 0, 7);
      else {
        // Diamond for serious/dangerous so severity is not colour-only.
        c.moveTo(X(f.x), Z(f.z) - r - 2);
        c.lineTo(X(f.x) + r + 2, Z(f.z));
        c.lineTo(X(f.x), Z(f.z) + r + 2);
        c.lineTo(X(f.x) - r - 2, Z(f.z));
        c.closePath();
      }
      c.fill();
      c.stroke();
      c.fillStyle = '#0c1220';
      c.fillText(String(i + 1), X(f.x), Z(f.z) + 1);
    });
  };
  canvas.addEventListener('click', (ev) => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((ev.clientX - rect.left) / rect.width) * canvas.width;
    const mz = ((ev.clientY - rect.top) / rect.height) * canvas.height;
    let best: Fault | null = null;
    let bestD = 24 * 24;
    for (const f of result.faults) {
      const d = (X(f.x) - mx) ** 2 + (Z(f.z) - mz) ** 2;
      if (d < bestD) {
        bestD = d;
        best = f;
      }
    }
    onPick(best);
  });
  draw();
  return {
    canvas,
    highlight(id) {
      hot = id;
      draw();
    },
  };
}

export const resultsScreen: ScreenFactory<{ name: 'results'; result: SessionResult }> = (app, route) => {
  const r = route.result;
  const p = app.profile();
  const unit = app.unit();
  const assessed = r.category === 'test';
  const good = r.outcome === 'passed' || r.outcome === 'completed';
  const headline =
    r.outcome === 'passed' ? 'Passed!' : r.outcome === 'failed' && assessed ? 'Not this time' : r.outcome === 'aborted' ? 'Drive ended early' : r.category === 'free' ? 'Drive review' : r.outcome === 'completed' ? 'Complete' : 'Not finished';
  const sub =
    r.outcome === 'passed'
      ? `You would have passed the ${p.roadTest.officialName} on that drive.`
      : assessed && r.outcome === 'failed'
        ? (r.endReason ?? r.score.failReasons[0] ?? 'Keep practising — see what to work on below.')
        : r.faults.length === 0
          ? 'A clean sheet — no faults recorded.'
          : `${r.faults.length} thing${r.faults.length === 1 ? '' : 's'} to work on. Details below.`;

  const rows = new Map<number, HTMLElement>();
  const map = reviewMap(app, r, (f) => {
    map.highlight(f ? f.id : null);
    if (f) rows.get(f.id)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    rows.forEach((el, id) => el.classList.toggle('is-hot', !!f && id === f.id));
  });
  const order = new Map(r.faults.map((f, i) => [f.id, i + 1]));
  const groups = summariseFaults(r.faults);
  const faultRow = (f: Fault): HTMLElement => {
    const row = h(
      'button',
      {
        type: 'button',
        class: 'll-fault',
        onClick: () => {
          map.highlight(f.id);
          rows.forEach((el, id) => el.classList.toggle('is-hot', id === f.id));
        },
      },
      h('span', { class: 'll-fault__n' }, String(order.get(f.id))),
      h('span', { class: 'll-fault__body' }, h('span', { class: 'll-fault__title' }, f.title, chip(f.severity, SEV_TONE[f.severity], f.severity === 'minor' ? undefined : 'warning-triangle'), h('span', { class: 'll-muted ll-fault__time' }, clock(f.time))), h('span', { class: 'll-fault__detail' }, f.detail), h('span', { class: 'll-fault__tip' }, icon('bulb', { size: 15 }), f.tip)),
    );
    rows.set(f.id, row);
    return row;
  };

  const praise = Object.entries(r.praise).filter(([, n]) => (n ?? 0) > 0);
  const praiseLabels: Record<string, string> = { full_stop: 'full stops', good_signal: 'well-timed signals', good_observation: 'good observations', yielded: 'times you gave way', good_gap: 'safe following', good_parking: 'neat parking', speed_control: 'good speed control', smooth_stop: 'smooth stops' };
  const s = p.roadTest.scoring;
  const list = app.scenarios();
  const idx = list.findIndex((m) => m.id === r.scenarioId);
  const nextLesson = r.category === 'lesson' ? list.filter((m) => m.category === 'lesson').sort((a, b) => a.order - b.order).find((m) => m.order > (list[idx]?.order ?? 0)) : undefined;

  return page(
    {
      title: headline,
      subtitle: `${r.scenarioTitle} · ${p.name}`,
      actions: [
        btn('Menu', { variant: 'ghost', icon: 'home', onClick: () => app.home() }),
        btn('Try again', { icon: 'restart', onClick: () => app.startScenario(r.scenarioId) }),
        nextLesson ? btn(`Next: ${nextLesson.title}`, { variant: 'primary', icon: 'arrow-right', onClick: () => (app.home(), app.go({ name: 'briefing', scenarioId: nextLesson.id })) }) : null,
      ],
    },
    h(
      'div',
      { class: ['ll-result', good ? 'll-result--good' : 'll-result--bad'] },
      h('div', { class: 'll-result__icon' }, icon(good ? 'trophy' : 'flag', { size: 44 })),
      h('div', { class: 'll-result__text' }, h('p', { class: 'll-result__sub' }, sub), r.category !== 'free' && r.outcome !== 'aborted' ? stars(r.stars) : null),
    ),
    h(
      'div',
      { class: 'll-stats' },
      stat(clock(r.durationS), 'Time', 'clock'),
      stat(formatDistance(r.distanceM, unit), 'Distance', 'route'),
      stat(String(r.score.minor), 'Minor', undefined, r.score.minor ? 'warn' : 'good'),
      stat(String(r.score.serious), 'Serious', undefined, r.score.serious ? 'bad' : 'good'),
      stat(String(r.score.dangerous), 'Dangerous', undefined, r.score.dangerous ? 'bad' : 'good'),
    ),
    assessed
      ? section(
          `Marked like the ${p.roadTest.officialName}`,
          h(
            'div',
            { class: 'll-panel' },
            h('div', { class: 'll-rowflex' }, h('b', null, s.style === 'fault_count' ? `${r.score.minor} of ${s.maxPoints} minor faults allowed` : `${r.score.points} of ${s.maxPoints} points`), chip(r.score.passed ? 'Within the limit' : 'Over the limit', r.score.passed ? 'good' : 'bad')),
            progressBar(Math.min(r.score.points, s.maxPoints), s.maxPoints, r.score.points > s.maxPoints ? 'bad' : 'good'),
            r.score.failReasons.length ? h('ul', { class: 'll-list' }, ...r.score.failReasons.map((x) => h('li', null, x))) : null,
            h('p', { class: 'll-muted' }, s.description),
            s.officiallyPublished ? null : callout('warn', 'warning-triangle', 'The official marking scheme is not fully published; this is our best approximation.'),
          ),
        )
      : null,
    praise.length ? section('What went well', h('div', { class: 'll-rowflex' }, ...praise.map(([k, n]) => chip(`${n} × ${praiseLabels[k] ?? k}`, 'good', 'check')))) : null,
    section(
      r.faults.length ? 'What to work on' : 'Faults',
      r.faults.length
        ? h(
            'div',
            { class: 'll-review' },
            h('div', { class: 'll-review__list' }, ...groups.flatMap((g) => [h('h3', { class: 'll-review__group' }, g.label, h('span', { class: 'll-muted' }, ` · ${g.faults.length}`)), ...g.faults.map(faultRow)])),
            h('div', { class: 'll-review__mapwrap' }, map.canvas, h('p', { class: 'll-muted ll-review__legend' }, 'Blue line: your drive. Circles: minor faults. Diamonds: serious or dangerous. Select a fault to find it on the map.')),
          )
        : h('div', { class: 'll-review' }, callout('good', 'check-circle', 'Nothing to report. That is exactly how an examiner likes it.'), h('div', { class: 'll-review__mapwrap' }, map.canvas)),
    ),
  );
};

/* -------------------------------- progress -------------------------------- */

export const progressScreen: ScreenFactory = (app) => {
  const p = app.profile();
  const data = app.progress.get();
  const list = app.scenarios();
  const ready = app.progress.readiness(p, list);
  const unit = app.unit();
  const top = (Object.entries(data.faultCounts) as [FaultCode, number][]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const history = data.history.filter((x) => x.jurisdictionId === p.id).slice(0, 12);
  const theory = data.theory.filter((t) => t.jurisdictionId === p.id).slice(0, 8);
  const row = (cat: 'lesson' | 'skill' | 'test'): Child =>
    h(
      'div',
      { class: 'll-grid' },
      ...list
        .filter((m) => m.category === cat)
        .sort((a, b) => a.order - b.order)
        .map((m) => {
          const best = app.progress.bestFor(p.id, m.id);
          return card({ title: m.title, badge: best ? (m.assessed ? chip(best.outcome === 'passed' ? 'Passed' : 'Not yet', best.outcome === 'passed' ? 'good' : 'warn') : stars(best.stars)) : chip('Not tried', 'neutral'), onClick: () => app.go({ name: 'briefing', scenarioId: m.id }) });
        }),
    );
  return page(
    { title: 'Progress', subtitle: `${p.flag} ${p.name}`, onBack: () => app.back() },
    h(
      'div',
      { class: 'll-panel ll-ready' },
      ring(ready.score, 'test ready', 120),
      h('div', { class: 'll-stack' }, ...ready.factors.map((f) => h('div', null, h('div', { class: 'll-rowflex' }, h('b', null, f.label), h('span', { class: 'll-muted' }, f.detail)), progressBar(f.value, 1, f.value >= 1 ? 'good' : 'accent')))),
    ),
    h('div', { class: 'll-stats' }, stat(String(data.totals.sessions), 'Drives', 'steering-wheel'), stat(clock(data.totals.timeS), 'Time driving', 'clock'), stat(formatDistance(data.totals.distanceM, unit), 'Distance', 'route')),
    top.length
      ? section('Things to work on', h('div', { class: 'll-grid ll-grid--wide' }, ...top.map(([code, n]) => card({ title: FAULTS[code].title, text: describeFault(code, p).tip, badge: chip(`${n}×`, 'warn'), icon: 'bulb' }))))
      : callout('info', 'info', 'Drive a lesson and your results will build up here.'),
    section('Lessons', row('lesson')),
    section('Skills', row('skill')),
    section('Mock tests', row('test')),
    history.length ? section('Recent drives', h('div', { class: 'll-table' }, ...history.map((x) => h('div', { class: 'll-table__row' }, h('span', null, x.scenarioTitle), h('span', { class: 'll-muted' }, new Date(x.finishedAt).toLocaleDateString()), chip(x.outcome, x.outcome === 'passed' || x.outcome === 'completed' ? 'good' : x.outcome === 'failed' ? 'bad' : 'neutral'))))) : null,
    theory.length ? section('Theory results', h('div', { class: 'll-table' }, ...theory.map((t) => h('div', { class: 'll-table__row' }, h('span', null, `${t.correct} / ${t.total}`), h('span', { class: 'll-muted' }, new Date(t.finishedAt).toLocaleDateString()), chip(t.passed ? 'Pass' : 'Below pass mark', t.passed ? 'good' : 'warn'))))) : null,
  );
};

/* ---------------------------------- rules --------------------------------- */

export const rulesScreen: ScreenFactory = (app) => {
  const p = app.profile();
  const r = p.rules;
  const f = p.facts;
  const t = p.terms;
  const style = signStyleFor(p);
  const u = p.speedUnit;
  const fact = (label: string, text: string): HTMLElement => h('div', { class: 'll-fact' }, h('dt', null, label), h('dd', null, text));
  const limit = (label: string, v: number): HTMLElement => h('div', { class: 'll-limit' }, signEl(signSvg('speed_limit', style, { value: v })), h('span', null, label));
  const dist = r.signalMinDistanceM !== null ? `at least ${formatDistance(r.signalMinDistanceM, u)} before a turn (legal minimum)` : `in good time — about ${formatDistance(r.signalGuidanceDistanceM, u)} before a turn`;
  return page(
    { title: `Local rules: ${p.name}`, subtitle: `From ${p.handbookName} and ${p.licensingAuthority}. Last reviewed ${p.lastReviewed}.`, onBack: () => app.back() },
    callout('info', 'info', 'A summary for practice. Laws change and details matter — always check the official handbook: ', h('a', { href: p.handbookUrl, target: '_blank', rel: 'noopener noreferrer', class: 'll-link' }, p.handbookName), '.'),
    h('div', { class: 'll-stats' }, stat(p.drivingSide === 'left' ? 'Left' : 'Right', 'Side of the road'), stat(u, 'Speed unit'), stat(f.minLearnerAge, 'Learner age'), stat(f.minSoloAge, 'Solo age'), stat(`${f.bacLimit.toFixed(2)}%`, 'Alcohol limit')),
    section(
      'Speed limits in this simulator',
      h('div', { class: 'll-panel' }, h('div', { class: 'll-limits' }, limit('Residential streets', p.speedLimits.residential), limit('Town roads', p.speedLimits.urban), limit('Main Street', p.speedLimits.arterial), limit('School zone', p.speedLimits.school)), h('p', { class: 'll-muted' }, `Typical posted limits for ${p.name}. ${f.schoolZoneNote}`)),
    ),
    section(
      'Rules of the road',
      h(
        'dl',
        { class: 'll-panel ll-facts' },
        fact('Signalling', `Signal ${dist}, and for about ${r.signalMinTimeLaneChangeS} seconds before changing lanes.`),
        fact('Following distance', `Leave at least ${r.followingGapS} seconds behind the vehicle in front; more in bad weather.`),
        fact(`Turning on a red ${t.trafficLight}`, r.turnOnRed === 'allowed_after_stop' ? `Turning ${p.drivingSide === 'right' ? 'right' : 'left'} on red is allowed after a complete stop, unless a sign forbids it.` : r.turnOnRed === 'signed_only' ? 'Only where a sign or signal specifically allows it.' : 'Not allowed. Wait for green.'),
        fact(`Unmarked ${t.intersection}s`, r.uncontrolledPriority === 'priority_to_right' ? 'Give way to traffic from your right.' : r.uncontrolledPriority === 'no_priority' ? 'Nobody has priority: approach slowly and be ready to give way.' : 'First to arrive goes first; in a tie, the driver on the right goes.'),
        fact('Pedestrian crossings', r.pedestrianPriority === 'on_or_waiting' ? `Give way to people on the ${t.crosswalk} and people waiting to cross.` : `Give way to people on the ${t.crosswalk}.`),
        fact(`${t.roundabout.charAt(0).toUpperCase() + t.roundabout.slice(1)}s`, `Give way to traffic already on it and go round ${p.drivingSide === 'left' ? 'clockwise' : 'counter-clockwise'}.${r.roundabout.signalOnExit ? ' Signal as you leave.' : ''}`),
        fact('Alcohol', f.bacNote),
        fact('Phones', f.phoneNote),
        fact('Seatbelts', f.seatbeltNote),
        f.schoolBusRule ? fact('School buses', f.schoolBusRule) : null,
      ),
    ),
    section('Good to know', h('ul', { class: 'll-list ll-panel' }, ...r.notes.map((n) => h('li', null, n)))),
    f.extras.length ? section('Local specials', h('div', { class: 'll-grid ll-grid--wide' }, ...f.extras.map((e) => card({ title: e.title, text: e.text, icon: 'bulb' })))) : null,
    section(
      `The ${p.roadTest.officialName}`,
      h(
        'div',
        { class: 'll-panel' },
        h('ul', { class: 'll-list' }, ...p.roadTest.overview.map((o) => h('li', null, o))),
        h('p', null, h('b', null, 'Marking: '), p.roadTest.scoring.description),
        h('p', null, h('b', null, 'Manoeuvres: '), p.roadTest.maneuverNotes),
        h('p', null, h('b', null, 'Before you drive:')),
        h('ul', { class: 'll-list' }, ...p.roadTest.preDriveChecks.map((o) => h('li', null, o))),
        h('p', null, h('b', null, 'Instant fails include:')),
        h('ul', { class: 'll-list' }, ...p.roadTest.automaticFailExamples.map((o) => h('li', null, o))),
      ),
    ),
    section(`The ${p.knowledgeTest.officialName}`, h('div', { class: 'll-panel' }, h('p', null, `${p.knowledgeTest.questionCount} questions; ${p.knowledgeTest.passMark} correct to pass${p.knowledgeTest.timeLimitMin ? `; ${p.knowledgeTest.timeLimitMin} minutes` : ''}.`), h('p', { class: 'll-muted' }, p.knowledgeTest.notes), btn('Practise theory', { variant: 'primary', icon: 'help-circle', onClick: () => app.go({ name: 'theory' }) }))),
    section('Sources', h('ul', { class: 'll-list' }, ...p.sources.map((s) => h('li', null, h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', class: 'll-link' }, s.title))))),
  );
};

/* ---------------------------------- signs --------------------------------- */

export const signsScreen: ScreenFactory = (app) => {
  const p = app.profile();
  const style = signStyleFor(p);
  const kinds = signsFor(style);
  const value = (k: SignKind): number | undefined => (k === 'speed_limit' ? p.speedLimits.urban : k === 'school_zone' ? p.speedLimits.school : undefined);
  const grid = h('div', { class: 'll-signs' });
  const show = (cat: string): void => {
    mount(grid, ...kinds
        .filter((k) => cat === 'all' || signInfo(k, style).category === cat)
        .map((k) => {
          const info = signInfo(k, style);
          return h(
            'button',
            {
              type: 'button',
              class: 'll-signs__tile',
              onClick: () => {
                const m = modal({ title: info.name, body: [signEl(signSvg(k, style, { value: value(k) }), 'll-sign ll-sign--big'), h('p', null, info.meaning)], actions: [btn('Close', { variant: 'primary', onClick: () => m.close() })], onClose: () => m.close() });
              },
            },
            signEl(signSvg(k, style, { value: value(k) })),
            h('span', null, info.name),
          );
        }),
    );
  };
  show('all');
  return page(
    { title: 'Road signs', subtitle: `${kinds.length} signs as they look in ${p.name}. Select one to see what it means.`, onBack: () => app.back(), actions: [btn('Quiz me', { variant: 'primary', icon: 'help-circle', onClick: () => app.go({ name: 'quiz', mode: 'signs' }) })] },
    seg(
      'Show',
      [
        { value: 'all', label: 'All' },
        { value: 'priority', label: 'Priority' },
        { value: 'regulatory', label: 'Rules' },
        { value: 'warning', label: 'Warnings' },
        { value: 'information', label: 'Information' },
      ],
      'all',
      show,
    ),
    grid,
  );
};

/* --------------------------------- theory --------------------------------- */

export const theoryScreen: ScreenFactory = (app) => {
  const p = app.profile();
  const kt = p.knowledgeTest;
  const bank = getQuestionBank(p);
  const counts = new Map<TheoryCategory, number>();
  for (const x of bank) counts.set(x.category, (counts.get(x.category) ?? 0) + 1);
  const missed = (app.progress.get().theoryMissed ?? []).length;
  const best = app.progress.get().theory.filter((t) => t.jurisdictionId === p.id && t.total >= 20).sort((a, b) => b.correct / b.total - a.correct / a.total)[0];
  const go = (mode: QuizMode): void => app.go({ name: 'quiz', mode });
  return page(
    { title: 'Theory test', subtitle: `${p.flag} ${kt.officialName}: ${kt.questionCount} questions, ${kt.passMark} correct to pass${kt.timeLimitMin ? `, ${kt.timeLimitMin} minutes` : ''}.`, onBack: () => app.back() },
    h(
      'div',
      { class: 'll-grid ll-grid--wide' },
      card({ title: 'Quick 10', text: 'Ten mixed questions with the answer explained after each one.', icon: 'play', highlight: true, onClick: () => go('quick') }),
      card({ title: 'Full mock test', text: `Test length and pass mark as in ${p.name}. Results at the end.`, icon: 'clipboard-check', badge: best ? chip(`Best ${best.correct}/${best.total}`, best.passed ? 'good' : 'warn') : null, onClick: () => go('mock') }),
      card({ title: 'Road signs', text: 'Fifteen signs: what do they mean?', icon: 'stop-sign', onClick: () => go('signs') }),
      card({ title: 'Review my mistakes', text: missed ? `${missed} question${missed === 1 ? '' : 's'} to revisit.` : 'Questions you get wrong will collect here.', icon: 'restart', onClick: () => go('mistakes') }),
    ),
    section('By topic', h('div', { class: 'll-grid' }, ...[...counts.entries()].map(([cat, n]) => card({ title: CATEGORY_LABELS[cat], badge: chip(`${n}`, 'neutral'), onClick: () => go({ category: cat }) })))),
    h('p', { class: 'll-muted' }, kt.notes),
    callout('info', 'info', `Questions here are written for practice and built from ${p.handbookName}. They are not the official questions.`),
  );
};

export const quizScreen: ScreenFactory<{ name: 'quiz'; mode: QuizMode }> = (app, route) => {
  const p = app.profile();
  const style = signStyleFor(p);
  const quiz: Quiz = buildQuiz(p, route.mode, Math.floor(Math.random() * 1e9), app.progress.get().theoryMissed ?? []);
  const answers: (number | null)[] = quiz.questions.map(() => null);
  let index = 0;
  let finished = false;
  const startedAt = Date.now();
  const body = h('div', { class: 'll-quiz' });
  const timer = h('span', { class: 'll-chip ll-chip--info' });
  let tick = 0;

  const finish = (): void => {
    if (finished) return;
    finished = true;
    window.clearInterval(tick);
    const { result, missedIds, correctIds } = gradeQuiz(p, quiz, answers, Date.now());
    app.progress.recordTheory(result, missedIds, correctIds);
    const pass = quiz.passMark !== null ? result.passed : null;
    announce(`Finished. ${result.correct} of ${result.total} correct.`);
    mount(body, h('div', { class: ['ll-result', pass === false ? 'll-result--bad' : 'll-result--good'] }, h('div', { class: 'll-result__icon' }, icon(pass === false ? 'flag' : 'trophy', { size: 44 })), h('div', { class: 'll-result__text' }, h('p', { class: 'll-result__big' }, `${result.correct} / ${result.total}`), h('p', { class: 'll-result__sub' }, quiz.passMark !== null ? (result.passed ? `That is a pass (${quiz.passMark} needed).` : `${quiz.passMark} needed to pass. Review the ones you missed below.`) : 'Every answer you review makes the real thing easier.'))),
      h('div', { class: 'll-rowflex' }, btn('Theory menu', { onClick: () => app.back() }), btn('Go again', { variant: 'primary', icon: 'restart', onClick: () => app.go({ name: 'quiz', mode: route.mode }, true) })),
      section(
        'Review',
        ...quiz.questions.map((x, i) => {
          const ok = answers[i] === x.answer;
          return h(
            'div',
            { class: ['ll-panel', 'll-quiz__review'] },
            h('div', { class: 'll-rowflex' }, chip(ok ? 'Correct' : 'Missed', ok ? 'good' : 'bad', ok ? 'check' : 'x'), h('b', null, `${i + 1}. ${x.text}`)),
            x.sign ? signEl(signSvg(x.sign.kind, style, { value: x.sign.value }), 'll-sign ll-sign--mid') : null,
            h('p', null, h('b', null, 'Answer: '), x.options[x.answer]!),
            !ok && answers[i] !== null ? h('p', { class: 'll-muted' }, `You chose: ${x.options[answers[i]!]}`) : null,
            h('p', { class: 'll-muted' }, x.explanation),
          );
        }),
      ),
    );
  };

  const render = (): void => {
    const x = quiz.questions[index];
    if (!x) return finish();
    const chosen = answers[index];
    const reveal = quiz.instantFeedback && chosen !== null;
    const options = x.options.map((text, i) => {
      const state = reveal ? (i === x.answer ? 'is-correct' : i === chosen ? 'is-wrong' : '') : chosen === i ? 'is-chosen' : '';
      return h(
        'button',
        {
          type: 'button',
          class: ['ll-quiz__option', state],
          disabled: reveal,
          onClick: () => {
            answers[index] = i;
            if (quiz.instantFeedback) announce(i === x.answer ? 'Correct.' : `Not quite. The answer is: ${x.options[x.answer]}`);
            render();
          },
        },
        h('span', { class: 'll-quiz__key' }, String.fromCharCode(65 + i)),
        h('span', null, text),
        reveal && i === x.answer ? icon('check-circle', { size: 20 }) : reveal && i === chosen ? icon('x-circle', { size: 20 }) : null,
      );
    });
    const next = (): void => {
      index++;
      render();
    };
    mount(body, h('div', { class: 'll-rowflex' }, chip(`Question ${index + 1} of ${quiz.questions.length}`, 'accent'), chip(CATEGORY_LABELS[x.category], 'neutral'), quiz.timeLimitS ? timer : null),
      progressBar(index, quiz.questions.length),
      h('div', { class: 'll-panel' }, x.sign ? signEl(signSvg(x.sign.kind, style, { value: x.sign.value }), 'll-sign ll-sign--big') : null, h('h2', { class: 'll-quiz__text' }, x.text), h('div', { class: 'll-quiz__options' }, ...options)),
      reveal ? callout(chosen === x.answer ? 'good' : 'warn', chosen === x.answer ? 'check-circle' : 'info', h('b', null, chosen === x.answer ? 'Correct. ' : 'Not quite. '), x.explanation, x.reference ? h('div', { class: 'll-muted' }, x.reference) : null) : null,
      h(
        'div',
        { class: 'll-rowflex' },
        !quiz.instantFeedback && index > 0 ? btn('Previous', { variant: 'ghost', icon: 'arrow-left', onClick: () => (index--, render()) }) : null,
        quiz.instantFeedback ? (reveal ? btn(index + 1 < quiz.questions.length ? 'Next question' : 'See results', { variant: 'primary', icon: 'arrow-right', onClick: next }) : null) : btn(index + 1 < quiz.questions.length ? 'Next' : 'Finish test', { variant: 'primary', icon: 'arrow-right', onClick: next, disabled: chosen === null }),
      ),
    );
    (body.querySelector<HTMLElement>(reveal ? '.ll-btn--primary' : '.ll-quiz__option') ?? body).focus?.();
  };

  if (quiz.timeLimitS) {
    const update = (): void => {
      const left = Math.max(0, quiz.timeLimitS! - (Date.now() - startedAt) / 1000);
      timer.textContent = `${clock(left)} left`;
      if (left <= 0) finish();
    };
    update();
    tick = window.setInterval(update, 1000);
  }
  const onKey = (e: KeyboardEvent): void => {
    if (finished || !body.isConnected) return document.removeEventListener('keydown', onKey);
    const n = '1234abcd'.indexOf(e.key.toLowerCase());
    if (n < 0) return;
    const opts = body.querySelectorAll<HTMLButtonElement>('.ll-quiz__option');
    opts[n % 4]?.click();
  };
  document.addEventListener('keydown', onKey);
  render();
  return page(
    {
      title: quiz.title,
      subtitle: quiz.instantFeedback ? 'Pick an answer (keys 1–4 or A–D work too).' : 'Answers are shown at the end, like the real test.',
      narrow: true,
      onBack: () => {
        if (finished || answers.every((a) => a === null)) return app.back();
        void confirmDialog('Leave the quiz?', 'Your answers so far will be lost.', 'Leave', 'Stay').then((yes) => {
          if (yes) {
            window.clearInterval(tick);
            app.back();
          }
        });
      },
    },
    body,
  );
};
