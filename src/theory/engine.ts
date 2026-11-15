/**
 * Theory-test practice. Most questions are GENERATED from the same verified
 * data the simulator runs on (jurisdiction profile + sign library), so they
 * can never drift from the rules the learner practises in the car.
 */
import { createRng } from '../core/rng';
import { formatDistance } from '../core/units';
import type { JurisdictionProfile, TheoryResult } from '../core/types';
import { signInfo, signStyleFor, signsFor } from '../signs';
import type { Question, QuestionBank, TheoryCategory } from './types';

export const CATEGORY_LABELS: Record<TheoryCategory, string> = {
  signs: 'Road signs',
  rules_of_the_road: 'Rules of the road',
  priority: 'Priority and giving way',
  speed: 'Speed',
  safe_driving: 'Safe driving',
  parking: 'Parking',
  alcohol_drugs: 'Alcohol and drugs',
  vulnerable_road_users: 'Vulnerable road users',
  conditions: 'Weather and night',
  vehicle_and_documents: 'Vehicle and licence',
  emergencies: 'Emergencies',
};

const q = (id: string, category: TheoryCategory, text: string, correct: string, wrong: string[], explanation: string, reference?: string): Question => {
  const question: Question = { id, category, text, options: [correct, ...wrong], answer: 0, explanation };
  if (reference) question.reference = reference;
  return question;
};

/** Sign-recognition questions for every sign in the local family. */
export function signQuestions(profile: JurisdictionProfile): Question[] {
  const style = signStyleFor(profile);
  const kinds = signsFor(style);
  const infos = kinds.map((k) => ({ kind: k, info: signInfo(k, style) }));
  return infos.map(({ kind, info }, i) => {
    // Distractors: other signs of the same category first, then any others, spread deterministically.
    const pool = [...infos.filter((o) => o.kind !== kind && o.info.category === info.category), ...infos.filter((o) => o.kind !== kind && o.info.category !== info.category)].map((o) => o.info.name);
    const wrong: string[] = [];
    for (let k = 0; wrong.length < 3 && k < pool.length; k++) {
      const pick = pool[(i * 7 + k * 3) % pool.length]!;
      if (pick !== info.name && !wrong.includes(pick)) wrong.push(pick);
    }
    const question = q(`gen/sign-${kind}`, 'signs', 'What does this sign mean?', info.name, wrong, info.meaning, `${profile.handbookName} — road signs`);
    question.sign = kind === 'speed_limit' ? { kind, value: profile.speedLimits.urban } : kind === 'school_zone' ? { kind, value: profile.speedLimits.school } : { kind };
    if (kind === 'speed_limit') {
      question.options = [`Maximum speed ${profile.speedLimits.urban} ${profile.speedUnit}`, `Minimum speed ${profile.speedLimits.urban} ${profile.speedUnit}`, `Recommended speed ${profile.speedLimits.urban} ${profile.speedUnit}`, `Route number ${profile.speedLimits.urban}`];
    }
    return question;
  });
}

/** Questions built from the jurisdiction profile. */
export function profileQuestions(p: JurisdictionProfile): Question[] {
  const t = p.terms;
  const r = p.rules;
  const f = p.facts;
  const ref = p.handbookName;
  const out: Question[] = [];
  const kerbSide = p.drivingSide === 'right' ? 'right' : 'left';
  const pct = (v: number): string => `${v.toFixed(2)}%`;

  // Alcohol.
  const bacs = [0.02, 0.03, 0.05, 0.08, 0.1].filter((v) => Math.abs(v - f.bacLimit) > 0.001);
  out.push(q('gen/bac', 'alcohol_drugs', `What is the legal blood alcohol limit for a fully licensed adult driver in ${p.name}?`, pct(f.bacLimit), bacs.slice(0, 3).map(pct), f.bacNote, ref));
  if (f.bacLimitNovice < f.bacLimit) {
    const opts = [0, 0.01, 0.02, 0.05, 0.08].filter((v) => Math.abs(v - f.bacLimitNovice) > 0.001 && v <= f.bacLimit + 0.001);
    out.push(q('gen/bac-novice', 'alcohol_drugs', `What blood alcohol limit applies to learner and novice drivers in ${p.name}?`, pct(f.bacLimitNovice), opts.slice(0, 3).map(pct), f.bacNote, ref));
  }
  // Following distance.
  const gaps = [1, 2, 3, 4].filter((g) => g !== r.followingGapS);
  out.push(
    q('gen/following-gap', 'safe_driving', 'In good, dry conditions, what is the minimum time gap you should leave behind the vehicle in front?', `${r.followingGapS} seconds`, gaps.map((g) => `${g} second${g === 1 ? '' : 's'}`), `The handbook's rule of thumb is a ${r.followingGapS}-second gap in good conditions — and more in rain, fog or at night.`, ref),
  );
  // Signalling distance.
  if (r.signalMinDistanceM !== null) {
    const d = r.signalMinDistanceM;
    const fmt = (m: number): string => formatDistance(m, p.speedUnit);
    out.push(q('gen/signal-distance', 'rules_of_the_road', `How far before a turn must you start signalling?`, `At least ${fmt(d)}`, [`At least ${fmt(d / 3)}`, `At least ${fmt(d * 3)}`, 'Only once you start to turn'], `The law requires a signal for at least the last ${fmt(d)} before the turn, so others have time to react.`, ref));
  }
  // Turn on red.
  const turn = kerbSide;
  const redRight = r.turnOnRed === 'allowed_after_stop' ? `Yes, after a complete stop, if it is clear and no sign forbids it` : r.turnOnRed === 'signed_only' ? 'Only where a sign or signal specifically permits it' : 'No — you must wait for a green signal';
  const redWrong = ['Yes, after a complete stop, if it is clear and no sign forbids it', 'Only where a sign or signal specifically permits it', 'No — you must wait for a green signal', 'Yes, without stopping, if no traffic is coming'].filter((o) => o !== redRight);
  out.push(q('gen/turn-on-red', 'rules_of_the_road', `The ${t.trafficLight} is red. May you turn ${turn}?`, redRight, redWrong, r.notes.find((n) => /red/i.test(n)) ?? `Turning ${turn} on red: ${redRight.toLowerCase()}.`, ref));
  // Uncontrolled junction.
  const prio =
    r.uncontrolledPriority === 'priority_to_right'
      ? 'Give way to vehicles coming from your right'
      : r.uncontrolledPriority === 'no_priority'
        ? 'Nobody has priority — slow down and be ready to give way'
        : 'The first vehicle to arrive goes first; if you arrive together, give way to the vehicle on your right';
  const prioWrong = ['Give way to vehicles coming from your right', 'Nobody has priority — slow down and be ready to give way', 'The first vehicle to arrive goes first; if you arrive together, give way to the vehicle on your right', 'The larger vehicle always goes first', 'Give way to vehicles coming from your left'].filter((o) => o !== prio).slice(0, 3);
  out.push(q('gen/uncontrolled', 'priority', `Two vehicles approach a ${t.intersection} with no signs, signals or road markings. Who goes first?`, prio, prioWrong, r.notes.find((n) => /no (stop|signs|sign)|unmarked|uncontrolled|priority/i.test(n)) ?? prio, ref));
  if (r.allWayStops) {
    out.push(q('gen/allway', 'priority', 'At an all-way stop, who goes first?', 'The vehicle that stopped first; in a tie, the vehicle on the right', ['The vehicle going straight ahead', 'The vehicle on the wider road', 'Whoever signals first'], 'Everyone stops, then drivers go in the order they arrived. If two arrive together, the driver on the left yields to the driver on the right.', ref));
  }
  // Roundabout.
  out.push(
    q('gen/roundabout', 'priority', `You are approaching a ${t.roundabout}. Who has priority?`, `Traffic already on the ${t.roundabout}`, [`Traffic entering the ${t.roundabout}`, 'The fastest vehicle', `Vehicles on the widest road`], `Slow down and ${t.yield} to traffic already circulating, then join when there is a safe gap, travelling ${p.drivingSide === 'left' ? 'clockwise' : 'counter-clockwise'}.`, ref),
  );
  // Pedestrians.
  const pedRight = r.pedestrianPriority === 'on_or_waiting' ? 'Pedestrians on the crossing and those waiting to cross' : 'Pedestrians who are on the crossing';
  out.push(
    q('gen/pedestrians', 'vulnerable_road_users', `At a marked ${t.crosswalk} without signals, who must you ${t.yield} to?`, pedRight, [pedRight === 'Pedestrians who are on the crossing' ? 'Nobody — pedestrians must wait for a gap' : 'Only pedestrians who have already reached your half of the road', 'Only children and elderly people', 'Only pedestrians who wave you to stop'], r.notes.find((n) => /pedestrian/i.test(n)) ?? pedRight, ref),
  );
  // Lights sequence.
  if (r.trafficLightSequence === 'red_redamber_green_amber') {
    out.push(q('gen/red-amber', 'rules_of_the_road', `What does red and ${t.amber} showing together mean?`, 'Stop — green is about to show, but do not go yet', ['Go if the way is clear', 'The signals are faulty', 'Turn only'], `Red and ${t.amber} together still mean stop. Wait for green before moving.`, ref));
  }
  out.push(q('gen/amber', 'rules_of_the_road', `What does a steady ${t.amber} ${t.trafficLight} mean?`, 'Stop, unless you are too close to stop safely', ['Speed up to clear the junction', 'Proceed with caution — you have priority', 'Stop only if pedestrians are crossing'], `${t.amber.charAt(0).toUpperCase() + t.amber.slice(1)} warns that red is next. Stop behind the line unless braking hard would be dangerous.`, ref));
  // Phones, seatbelts.
  out.push(q('gen/phone', 'safe_driving', `Is it legal to hold and use a mobile phone while driving in ${p.name}?`, f.handheldPhoneBan ? 'No' : 'Yes, but it is strongly discouraged', f.handheldPhoneBan ? ['Yes, while stopped at traffic lights', 'Yes, for calls under one minute', 'Yes, below 20 ' + p.speedUnit] : ['No, never', 'Only on motorways', 'Only at night'], f.phoneNote, ref));
  if (r.headlightsInRain) {
    out.push(q('gen/lights-rain', 'conditions', 'It is raining hard enough that you need your wipers. What else should you switch on?', 'Dipped (low-beam) headlights', ['Hazard warning lights', 'Full-beam (high-beam) headlights', 'Nothing else'], 'When visibility is reduced, dipped headlights help others see you. Hazard lights are for when you are a hazard, not for rain.', ref));
  }
  if (f.schoolBusRule) {
    out.push(q('gen/school-bus', 'vulnerable_road_users', 'A school bus ahead has stopped with its red lights flashing on an undivided two-lane road. What must you do?', 'Stop and stay stopped until the lights stop flashing', ['Slow down and pass carefully', 'Sound your horn and pass', 'Stop only if you are behind the bus'], f.schoolBusRule, ref));
  }
  out.push(q('gen/stop-sign', 'rules_of_the_road', 'What must you do at a stop sign?', 'Come to a complete stop at the line, then go when it is safe', ['Slow down and continue if it is clear', 'Stop only if other traffic is present', 'Stop for three seconds whatever the traffic'], 'A stop sign always means a complete stop — wheels still — before the line. Then give way and proceed when safe.', ref));
  // Test facts.
  const kt = p.knowledgeTest;
  out.push(q('gen/knowledge-pass', 'vehicle_and_documents', `The ${kt.officialName} for a car ${t.license} has ${kt.questionCount} questions. How many must you answer correctly to pass?`, String(kt.passMark), [kt.passMark - 4, kt.passMark - 8, kt.questionCount].filter((n) => n > 0 && n !== kt.passMark).map(String), kt.notes, p.licensingAuthority));
  out.push(q('gen/min-age', 'vehicle_and_documents', `What is the minimum age to hold a learner ${t.license} (permit) for a car in ${p.name}?`, f.minLearnerAge, ['14', '15', '16', '17', '18', '15½'].filter((a) => a !== f.minLearnerAge).slice(0, 3), `You can start learning at ${f.minLearnerAge} and drive unsupervised from ${f.minSoloAge}, subject to the licensing rules.`, p.licensingAuthority));
  return out;
}

/** Safety knowledge that holds everywhere. */
export const UNIVERSAL_QUESTIONS: Question[] = [
  q('uni/stopping-distance', 'speed', 'If you double your speed, roughly what happens to your braking distance?', 'It becomes about four times longer', ['It doubles', 'It stays the same', 'It becomes about three times longer'], 'Braking distance grows with the square of speed, so twice the speed needs about four times the distance.'),
  q('uni/wet-road', 'conditions', 'How should you change your following distance on a wet road?', 'At least double it', ['Keep it the same', 'Halve it so others cannot cut in', 'Follow the tail lights ahead closely'], 'Tyres have less grip on wet roads, so stopping takes much longer. Double your gap at least.'),
  q('uni/aquaplaning', 'conditions', 'Your car starts to aquaplane (hydroplane) on standing water. What should you do?', 'Ease off the accelerator and steer straight until the tyres grip again', ['Brake hard', 'Steer sharply to the side', 'Accelerate to get through quickly'], 'Braking or steering sharply can cause a skid. Lift off gently and keep the wheel straight until grip returns.'),
  q('uni/blind-spot', 'safe_driving', 'What is a blind spot?', 'An area around your vehicle that your mirrors do not show', ['A dark stretch of unlit road', 'The area directly ahead of the bonnet', 'A mirror that needs adjusting'], 'Mirrors cannot show everything beside and just behind you. Look over your shoulder before changing lanes or moving off.'),
  q('uni/fatigue', 'safe_driving', 'You feel sleepy while driving. What is the safest thing to do?', 'Stop somewhere safe and rest', ['Open the window and carry on', 'Turn the radio up', 'Drive faster to arrive sooner'], 'Fresh air and noise do not cure tiredness. Only rest does — stop in a safe place and take a break.'),
  q('uni/skid', 'conditions', 'The rear of your car starts to slide to the right. What should you do?', 'Ease off the pedals and steer gently to the right, into the skid', ['Brake hard and steer left', 'Accelerate firmly', 'Pull the parking brake'], 'Look and steer where you want to go — in the direction the rear is sliding — and stay off the brakes until you have grip.'),
  q('uni/tyres', 'vehicle_and_documents', 'What is the effect of under-inflated tyres?', 'Worse handling, longer stopping distances and higher fuel use', ['Better grip in the wet', 'Lower fuel use', 'No effect below 30'], 'Soft tyres overheat, wear quickly and make steering and braking less precise. Check pressures regularly when cold.'),
  q('uni/night-dazzle', 'conditions', 'An oncoming vehicle dazzles you with its headlights at night. What should you do?', 'Slow down and look toward the edge of your lane until it has passed', ['Flash your full beam back', 'Close your eyes briefly', 'Speed up to pass quickly'], 'Do not look at the lights. Slow down, keep to your side and use the edge of the road as a guide.'),
  q('uni/cyclist-pass', 'vulnerable_road_users', 'When passing a cyclist, how much room should you leave?', 'As much as you would for a car — wait if you cannot', ['Just enough to clear the handlebars', 'None if you sound the horn first', 'It does not matter at low speed'], 'Cyclists may wobble or swerve around drains and potholes. Give plenty of room, or hold back until it is safe.'),
  q('uni/large-vehicle', 'safe_driving', 'Why should you keep well back from a large truck or bus?', 'The driver cannot see you close behind, and you cannot see past it', ['Trucks brake more quickly than cars', 'To save fuel', 'Large vehicles have priority'], 'If you cannot see the truck’s mirrors, the driver cannot see you. Dropping back also gives you a view of the road ahead.'),
  q('uni/motorcycle', 'vulnerable_road_users', 'Before turning or emerging at a junction, why should you look especially carefully for motorcyclists?', 'They are narrow, easily hidden and often closer than they appear', ['They always travel slowly', 'They must give way to cars', 'They cannot stop quickly'], 'Many junction crashes happen because a driver "looked but did not see" a motorcycle. Take a second look.'),
  q('uni/children', 'vulnerable_road_users', 'A ball bounces into the road ahead between parked cars. What should you expect?', 'A child may run out after it — slow down and be ready to stop', ['Nothing — carry on', 'The ball to stop traffic for you', 'Other drivers to deal with it'], 'Children act on impulse. A ball, a pet or an ice-cream van are all clues to slow down and cover the brake.'),
  q('uni/emergency-vehicle', 'emergencies', 'An emergency vehicle is approaching from behind with lights and siren on. What should you do?', 'Stay calm, and pull over and stop where it is safe to let it pass', ['Stop immediately wherever you are', 'Speed up to stay ahead of it', 'Ignore it unless it is in your lane'], 'Make room without endangering anyone: signal, move over and stop if needed. Do not brake suddenly, block a junction or run a red light.'),
  q('uni/breakdown', 'emergencies', 'Your car breaks down on a busy road. What is the first thing to do?', 'Get the vehicle off the road if you can and switch on your hazard warning lights', ['Stand behind the car and wave at traffic', 'Open the bonnet and start repairs', 'Stay in the lane and call a friend'], 'Warn others and get to safety. Hazard lights tell approaching drivers you are stationary.'),
  q('uni/collision', 'emergencies', 'You are involved in a collision where someone is injured. What must you do?', 'Stop, give help, call the emergency services and exchange details', ['Drive on if your car still works', 'Move the injured person into your car', 'Wait until you get home to report it'], 'Every jurisdiction requires you to stop and give assistance and details. Leaving the scene is a serious offence.'),
  q('uni/mirrors-first', 'safe_driving', 'Why do you check your mirrors BEFORE signalling?', 'To know what is around you before you tell others what you intend to do', ['Because the signal dazzles the mirror', 'It makes no difference', 'To check the signal lamp works'], 'Mirrors first: if someone is already overtaking, signalling and moving would put you into their path.'),
  q('uni/speed-limit', 'speed', 'What does a speed limit mean?', 'The maximum you may drive in ideal conditions — often you should go slower', ['The speed you should always drive at', 'A recommended minimum', 'The average speed for that road'], 'A limit is not a target. Rain, fog, darkness, traffic and pedestrians all call for a lower speed.'),
  q('uni/parked-cars', 'safe_driving', 'What hazards should you expect when driving past a row of parked cars?', 'Doors opening, pedestrians stepping out and cars pulling away', ['None if you keep to the limit', 'Only cyclists', 'Only at night'], 'Leave about a door’s width where you can, slow down and watch for clues such as brake lights, exhaust or feet under vehicles.'),
  q('uni/horn', 'safe_driving', 'When should you use your horn?', 'To warn other road users of your presence when there is danger', ['To greet friends', 'To hurry up slow drivers', 'Whenever you pass a cyclist'], 'The horn is a warning device, not a way to express annoyance.'),
  q('uni/seatbelt', 'vehicle_and_documents', 'Who should wear a seatbelt?', 'Everyone in the vehicle, on every trip', ['Only the driver', 'Only front-seat occupants', 'Only on fast roads'], 'An unbelted passenger can be thrown forward with enormous force, injuring themselves and those in front.'),
  q('uni/fog', 'conditions', 'What lights should you use in thick fog?', 'Dipped headlights (and fog lights where fitted)', ['Full beam', 'Parking lights only', 'Hazard warning lights while moving'], 'Full beam reflects off fog and makes it harder to see. Use dipped headlights, slow down and increase your gap.'),
  q('uni/drugs', 'alcohol_drugs', 'Can prescription or over-the-counter medicines affect your driving?', 'Yes — some cause drowsiness or slow reactions; check the label or ask a pharmacist', ['No, only illegal drugs matter', 'Only if taken with food', 'Only for drivers over 60'], 'Many common medicines impair driving. It is your responsibility to check before you drive.'),
  q('uni/alcohol-time', 'alcohol_drugs', 'What is the only thing that reduces the alcohol in your body?', 'Time', ['Coffee', 'A cold shower', 'Fresh air'], 'Your liver removes alcohol at a fixed rate. Nothing speeds it up — the only safe plan is not to drive.'),
  q('uni/junction-view', 'priority', 'Your view at a junction is blocked by parked vehicles. What should you do?', 'Stop, then edge forward slowly until you can see', ['Pull out quickly before anything comes', 'Sound your horn and go', 'Wait for someone to wave you out'], '"Creep and peep": move forward slowly, looking both ways, and only emerge when you are sure it is clear.'),
];

const BANKS = import.meta.glob<{ default: QuestionBank }>('./banks/*.ts', { eager: true });

/** Every question available for a jurisdiction: hand-written bank (if any) + generated + universal. */
export function getQuestionBank(profile: JurisdictionProfile): Question[] {
  const hand = Object.values(BANKS).find((m) => m.default && m.default.jurisdictionId === profile.id)?.default.questions ?? [];
  const seen = new Set<string>();
  return [...hand, ...profileQuestions(profile), ...UNIVERSAL_QUESTIONS, ...signQuestions(profile)].filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

export type QuizMode = 'quick' | 'mock' | 'signs' | 'mistakes' | { category: TheoryCategory };

export interface Quiz {
  title: string;
  questions: Question[];
  /** Correct answers needed to pass, or null for practice modes. */
  passMark: number | null;
  timeLimitS: number | null;
  /** Show the answer after each question (practice) or only at the end (mock). */
  instantFeedback: boolean;
}

export function buildQuiz(profile: JurisdictionProfile, mode: QuizMode, seed: number, missedIds: readonly string[] = []): Quiz {
  const rng = createRng(seed);
  const all = getQuestionBank(profile);
  const shuffle = <T>(items: T[]): T[] => {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = rng.int(0, i);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };
  let picked: Question[];
  let title: string;
  let passMark: number | null = null;
  let timeLimitS: number | null = null;
  if (mode === 'mock') {
    const kt = profile.knowledgeTest;
    const signs = shuffle(all.filter((x) => x.category === 'signs'));
    const rest = shuffle(all.filter((x) => x.category !== 'signs'));
    const nSigns = Math.min(signs.length, Math.round(kt.questionCount * 0.25));
    picked = shuffle([...rest.slice(0, kt.questionCount - nSigns), ...signs.slice(0, nSigns)]).slice(0, kt.questionCount);
    // Scale the pass mark if the bank is smaller than the real test.
    passMark = Math.ceil((kt.passMark / kt.questionCount) * picked.length);
    timeLimitS = kt.timeLimitMin ? kt.timeLimitMin * 60 : null;
    title = `Mock ${kt.officialName.toLowerCase()}`;
  } else if (mode === 'signs') {
    picked = shuffle(all.filter((x) => x.category === 'signs')).slice(0, 15);
    title = 'Road signs';
  } else if (mode === 'mistakes') {
    const set = new Set(missedIds);
    picked = shuffle(all.filter((x) => set.has(x.id))).slice(0, 20);
    if (!picked.length) picked = shuffle(all).slice(0, 10);
    title = 'Review my mistakes';
  } else if (mode === 'quick') {
    picked = shuffle(all).slice(0, 10);
    title = 'Quick 10';
  } else {
    picked = shuffle(all.filter((x) => x.category === mode.category)).slice(0, 20);
    title = CATEGORY_LABELS[mode.category];
  }
  // Shuffle the options of each question, keeping track of the right one.
  const questions = picked.map((question) => {
    const order = shuffle(question.options.map((_, i) => i));
    return { ...question, options: order.map((i) => question.options[i]!), answer: order.indexOf(question.answer) };
  });
  return { title, questions, passMark, timeLimitS, instantFeedback: mode !== 'mock' };
}

export function gradeQuiz(profile: JurisdictionProfile, quiz: Quiz, answers: readonly (number | null)[], finishedAt: number): { result: TheoryResult; missedIds: string[]; correctIds: string[] } {
  const byCategory: TheoryResult['byCategory'] = {};
  const missedIds: string[] = [];
  const correctIds: string[] = [];
  let correct = 0;
  quiz.questions.forEach((question, i) => {
    const ok = answers[i] === question.answer;
    const c = (byCategory[question.category] ??= { correct: 0, total: 0 });
    c.total++;
    if (ok) {
      c.correct++;
      correct++;
      correctIds.push(question.id);
    } else missedIds.push(question.id);
  });
  const total = quiz.questions.length;
  const passed = quiz.passMark !== null ? correct >= quiz.passMark : correct / Math.max(1, total) >= profile.knowledgeTest.passMark / profile.knowledgeTest.questionCount;
  return { result: { jurisdictionId: profile.id, finishedAt, total, correct, passed, byCategory }, missedIds, correctIds };
}
