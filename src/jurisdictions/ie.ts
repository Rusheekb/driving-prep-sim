import type { JurisdictionProfile } from '../core/types';

/** Ireland (the Republic). Speeds and distances are metric; traffic keeps left. */
export const IE: JurisdictionProfile = {
  id: 'ie',
  name: 'Ireland',
  country: 'Ireland',
  countryCode: 'IE',
  flag: '🇮🇪',
  licensingAuthority: 'Road Safety Authority (RSA); licences issued by the National Driver Licence Service (NDLS)',
  handbookName: 'Rules of the Road',
  handbookUrl: 'https://www.rsa.ie/services/learner-drivers/resources/rules-of-the-road',
  drivingSide: 'left',
  speedUnit: 'km/h',
  // Built-up area default is 50 km/h. Housing estates, town centres and school
  // approaches are commonly signed 30 km/h (and councils are extending this
  // through to March 2027); main through routes generally stay at 50 km/h.
  speedLimits: {
    residential: 30,
    urban: 50,
    arterial: 50,
    school: 30,
    lot: 15,
  },
  rules: {
    turnOnRed: 'prohibited',
    signalMinDistanceM: null,
    signalGuidanceDistanceM: 30,
    signalMinTimeLaneChangeS: 3,
    followingGapS: 2,
    uncontrolledPriority: 'priority_to_right',
    allWayStops: false,
    roundabout: {
      signalOnExit: true,
      signalOnApproach: 'by_exit_direction',
    },
    pedestrianPriority: 'on_or_waiting',
    trafficLightSequence: 'red_green_amber',
    headlightsInRain: true,
    notes: [
      'A red light means stop. You may not turn left on red. A green arrow (filter light) lets you go in the direction of the arrow if the way is clear.',
      'Lights go green, amber, red, then straight back to green. There is no red-and-amber phase. Amber means stop unless you are too close to stop safely.',
      'There is no set signalling distance. Check your mirrors, then signal in good time before moving off, turning, changing lanes or stopping.',
      'Keep at least a two-second gap ("only a fool breaks the two-second rule") and double it in the wet.',
      'Where roads of equal importance meet with no signs or markings, yield to traffic coming from your right. Right of way is never absolute, so always be ready to stop.',
      'Zebra crossings: you must yield to anyone on the crossing or waiting to cross.',
      'Roundabouts: yield to traffic already on the roundabout. Signal left for the first exit, give no signal on approach when going straight ahead, and signal right for later exits. Always signal left after passing the exit before yours.',
      'Use dipped headlights in heavy rain, fog, falling snow and whenever visibility is poor. The RSA also recommends dipped headlights or daytime running lights during the day.',
      'There are no all-way stops. Yield signs say YIELD, or GÉILL SLÍ in Gaeltacht areas.',
    ],
  },
  roadStyle: {
    centreLineColour: 'white',
    warningSign: 'yellow_diamond',
    speedLimitSign: 'red_circle',
    yieldSignText: 'YIELD',
    crosswalkStyle: 'zebra',
    trafficLightPlacement: 'near_side',
    signalHousing: 'black',
  },
  terms: {
    yield: 'yield',
    curb: 'kerb',
    turnSignal: 'indicator',
    parkingBrake: 'handbrake',
    crosswalk: 'pedestrian crossing',
    sidewalk: 'footpath',
    intersection: 'junction',
    roundabout: 'roundabout',
    trafficLight: 'traffic light',
    amber: 'amber',
    license: 'licence',
    roadTest: 'driving test',
    threePointTurn: 'turnabout',
    parallelPark: 'parallel park',
    examiner: 'tester',
    blindSpotCheck: 'blind spot check',
    observationRoutine: 'MSMM — Mirrors, Signal, Mirrors, Manoeuvre',
    accelerator: 'accelerator',
    parkingLot: 'car park',
    highway: 'motorway',
  },
  roadTest: {
    officialName: 'RSA Driving Test (Category B)',
    typicalDurationMin: 40,
    scoring: {
      style: 'fault_count',
      pointsPerMinor: 1,
      pointsPerSerious: 9,
      maxPoints: 8,
      seriousIsAutoFail: true,
      officiallyPublished: true,
      description:
        'Grade 1 faults are minor and do not count. You fail with one Grade 3 fault (dangerous or potentially dangerous), 4 of the same Grade 2 fault for one aspect, 6 Grade 2 faults under one heading, or 9 Grade 2 faults overall; the mock test counts every minor fault as a Grade 2.',
    },
    mockTestManeuvers: ['three_point_turn', 'reverse_straight', 'curbside_stop'],
    maneuverNotes:
      'The RSA lists a reverse around a corner, a turnabout (turning the car to face the other way), a hill start and parking at the kerb. It does not list an emergency stop or bay parking. The simulator uses a straight-line reverse in place of the corner reverse.',
    preDriveChecks: [
      'Questions on the Rules of the Road, including identifying road signs.',
      'Technical checks: explain how you would check items such as tyres, lights, reflectors, indicators, engine oil, coolant, windscreen washer fluid, steering, brakes and horn.',
      'Show how to use secondary controls such as wipers, demisters, fan, rear window heater and lights.',
      'Demonstrate hand signals.',
    ],
    automaticFailExamples: [
      'Any Grade 3 fault: dangerous or potentially dangerous driving, or total disregard of traffic controls.',
      'Going through a red light or a stop sign.',
      'Not yielding, so that another road user has to brake or swerve.',
      'Too many Grade 2 faults: 9 overall, 6 under one heading or 4 for the same aspect.',
    ],
    overview: [
      'Starts in the test centre with questions on the Rules of the Road and road signs, then technical checks at the car.',
      'About 30 to 40 minutes of driving over roughly 8 km in varied road and traffic conditions, following the directions the tester gives.',
      'Includes a reverse around a corner, a turnabout, a hill start and parking.',
      'You are marked on things like road position, observation, mirrors, signals, reaction to hazards, progress, speed, vehicle controls, traffic controls and right of way.',
      'You must have held your learner permit for at least 6 months and completed Essential Driver Training first.',
      'If you pass you get a Certificate of Competency, valid for 2 years, which you use to apply for your full licence.',
    ],
  },
  knowledgeTest: {
    officialName: 'Driver Theory Test',
    questionCount: 40,
    passMark: 35,
    timeLimitMin: 45,
    notes:
      'Multiple-choice test taken on a computer. You must pass the car (category B) theory test before you can apply for a learner permit. Other vehicle categories have their own tests.',
  },
  facts: {
    bacLimit: 0.05,
    bacLimitNovice: 0.02,
    bacNote:
      '50 mg of alcohol per 100 mL of blood (22 micrograms per 100 mL of breath). Learner, novice and professional drivers have a lower limit of 20 mg per 100 mL of blood (9 micrograms in breath). Every drink-driving offence brings a disqualification of at least 3 months. The only safe amount is none.',
    handheldPhoneBan: true,
    phoneNote:
      'Holding a mobile phone while driving is an offence. The fixed charge is €120 with 3 penalty points, and a court can impose more.',
    seatbeltNote:
      'Everyone in the car must wear a seat belt where one is fitted. The driver is responsible for passengers under 17 wearing a belt or using a suitable child seat.',
    minLearnerAge: '17',
    minSoloAge: '17½',
    schoolZoneNote:
      'Many schools have a periodic speed limit, usually 30 km/h, shown on an electronic sign that applies when children are arriving or leaving. You must stop when a school warden shows the stop sign.',
    schoolBusRule: null,
    extras: [
      {
        title: 'Learner permit rules',
        text: 'Learners must display L plates, be accompanied by someone who has held a full licence for at least 2 years, and must not drive on motorways. Car learners must complete 12 Essential Driver Training lessons and hold the permit for 6 months before taking the test, so the earliest you can drive alone is about 17½.',
      },
      {
        title: 'Novice drivers and N plates',
        text: 'For 2 years after getting your first full licence you must display N plates. Learners and novices are disqualified at 7 penalty points (12 for other drivers) and have the lower alcohol limit.',
      },
      {
        title: 'Speed limits are changing',
        text: 'The default limit on rural local roads dropped from 80 to 60 km/h in February 2025. Councils are lowering many built-up area limits from 50 to 30 km/h, due nationwide by 31 March 2027, so always go by the signs.',
      },
      {
        title: 'Overtaking cyclists',
        text: 'Dangerous overtaking of a cyclist is a specific offence with a €120 fixed charge and 3 penalty points. The recommended gap is at least 1 metre on roads up to 50 km/h and 1.5 metres on faster roads.',
      },
      {
        title: 'Learner permits no longer renew forever',
        text: 'Under rules that started on 1 November 2026, a third or fourth learner permit is only issued if you sat a driving test in the previous 2 years. There is no fifth permit: you start the learning process again. Check the RSA or NDLS for how this applies to you.',
      },
      {
        title: 'Metric units and Irish signs',
        text: 'Speed limits and distances are in kilometres. Warning signs are yellow diamonds, and in Gaeltacht areas signs are in Irish.',
      },
    ],
  },
  sources: [
    {
      title: 'Rules of the Road (RSA)',
      url: 'https://www.rsa.ie/services/learner-drivers/resources/rules-of-the-road',
    },
    {
      title: 'About the driving test in Ireland (RSA)',
      url: 'https://www.rsa.ie/services/learner-drivers/the-driving-test/what-it-is',
    },
    {
      title: 'RSA Driver Tester Marking Guidelines',
      url: 'https://www.rsa.ie/docs/default-source/services/s3.2-adi/making-your-mark-marking-guidelines-for-the-driving-test.pdf?sfvrsn=548e1e7d_11',
    },
    {
      title: 'Driving tests (Citizens Information)',
      url: 'https://www.citizensinformation.ie/en/travel-and-recreation/motoring/driving-tests/driving-test/',
    },
    {
      title: 'Driver theory test (Citizens Information)',
      url: 'https://www.citizensinformation.ie/en/travel-and-recreation/motoring/driving-tests/driver-theory-test/',
    },
    {
      title: 'Driving offences: alcohol limits and mobile phones (Citizens Information)',
      url: 'https://www.citizensinformation.ie/en/travel-and-recreation/motoring/driving-offences/driving-offences/',
    },
    {
      title: 'Slower Speeds, Safer Roads: speed limit changes (Department of Transport)',
      url: 'https://www.gov.ie/en/department-of-transport/campaigns/slower-speeds-safer-roads/',
    },
    {
      title: 'About learner permits in Ireland (RSA)',
      url: 'https://www.rsa.ie/services/learner-drivers/learner-permit/what-it-is',
    },
    {
      title: 'Road Traffic (Traffic and Parking) Regulations 1997, S.I. No. 182/1997',
      url: 'https://www.irishstatutebook.ie/eli/1997/si/182',
    },
    {
      title: 'Road Traffic (Traffic and Parking) (Amendment) Regulations 2024, S.I. No. 222/2024',
      url: 'https://www.irishstatutebook.ie/eli/2024/si/222/made/en/print',
    },
  ],
  lastReviewed: '2026-11-10',
};
