import type { JurisdictionProfile } from '../core/types';

/**
 * Great Britain (England, Scotland and Wales). Northern Ireland has its own
 * testing authority (DVA) and its own edition of the Highway Code, so it is
 * deliberately not covered by this profile.
 */
export const GB: JurisdictionProfile = {
  id: 'gb',
  name: 'Great Britain',
  country: 'United Kingdom',
  countryCode: 'GB',
  flag: '🇬🇧',
  licensingAuthority: 'Driver and Vehicle Standards Agency (DVSA) for tests; DVLA for licences',
  handbookName: 'The Highway Code',
  handbookUrl: 'https://www.gov.uk/guidance/the-highway-code',
  drivingSide: 'left',
  speedUnit: 'mph',
  // Street-lit ("restricted") roads default to 30 mph in England and Scotland and 20 mph in Wales.
  // Signed 20 mph limits on housing streets and outside schools are common throughout Great Britain.
  speedLimits: {
    residential: 20,
    urban: 30,
    arterial: 30,
    school: 20,
    lot: 10,
  },
  rules: {
    turnOnRed: 'prohibited',
    signalMinDistanceM: null,
    signalGuidanceDistanceM: 30,
    signalMinTimeLaneChangeS: 3,
    followingGapS: 2,
    uncontrolledPriority: 'no_priority',
    allWayStops: false,
    roundabout: {
      signalOnExit: true,
      signalOnApproach: 'by_exit_direction',
    },
    pedestrianPriority: 'on_or_waiting',
    trafficLightSequence: 'red_redamber_green_amber',
    headlightsInRain: false,
    notes: [
      'Red means stop. You may never turn left on a red light. A green filter arrow lets you go in that direction only.',
      'Red and amber together also mean stop. Wait for green before you move.',
      'The Highway Code sets no signalling distance. Check your mirrors, then signal in plenty of time, and make sure the signal cannot mislead anyone.',
      'Leave at least a two-second gap on faster roads. At least double it on wet roads and leave far more on ice.',
      'At an unmarked junction nobody has priority. Slow down, look all around and be ready to give way.',
      'Zebra crossings: you should give way to people waiting to cross, and you must give way once someone has stepped onto the crossing.',
      'At junctions you should give way to pedestrians crossing or waiting to cross the road you are turning into or out of.',
      'Roundabouts: give way to traffic from your right. Signal left for the first exit and right for an exit to the right. Do not signal on approach for an exit in between. Always signal left after passing the exit before yours.',
      'There is no wipers-on, lights-on rule. Headlights are required at night and when visibility is seriously reduced (roughly when you cannot see 100 metres). Use dipped headlights in dull daytime weather so others can see you.',
      'Stop signs are uncommon and there are no all-way stops. At a stop sign you must stop completely at the line, then give way.',
    ],
  },
  roadStyle: {
    centreLineColour: 'white',
    warningSign: 'red_triangle',
    speedLimitSign: 'red_circle',
    yieldSignText: 'GIVE WAY',
    crosswalkStyle: 'zebra',
    trafficLightPlacement: 'near_side',
    signalHousing: 'black',
  },
  terms: {
    yield: 'give way',
    curb: 'kerb',
    turnSignal: 'indicator',
    parkingBrake: 'handbrake',
    crosswalk: 'pedestrian crossing',
    sidewalk: 'pavement',
    intersection: 'junction',
    roundabout: 'roundabout',
    trafficLight: 'traffic light',
    amber: 'amber',
    license: 'licence',
    roadTest: 'driving test',
    threePointTurn: 'turn in the road',
    parallelPark: 'parallel park',
    examiner: 'examiner',
    blindSpotCheck: 'blind spot check',
    observationRoutine: 'MSM — Mirrors, Signal, Manoeuvre',
    accelerator: 'accelerator',
    parkingLot: 'car park',
    highway: 'motorway',
  },
  roadTest: {
    officialName: 'Practical Driving Test',
    typicalDurationMin: 40,
    scoring: {
      style: 'fault_count',
      pointsPerMinor: 1,
      pointsPerSerious: 16,
      maxPoints: 15,
      seriousIsAutoFail: true,
      officiallyPublished: true,
      description:
        'You pass with no more than 15 driving faults (minors) and no serious or dangerous faults (majors). Repeating the same driving fault again and again can be marked as a serious fault.',
    },
    mockTestManeuvers: ['parallel_park', 'reverse_bay_park', 'forward_bay_park', 'emergency_stop'],
    maneuverNotes:
      'The examiner chooses one reversing exercise: parallel park at the side of the road, park in a bay (reverse in and drive out, or drive in and reverse out), or pull up on the right, reverse about two car lengths and rejoin traffic. Since 24 November 2025 about 1 test in 7 also includes an emergency stop. The pull up on the right exercise is not in the simulator.',
    preDriveChecks: [
      'Eyesight check: read a number plate from 20 metres (20.5 metres for an old-style plate). If you cannot, the test ends.',
      'One "tell me" vehicle safety question before you set off.',
      'One "show me" question while you are driving, such as washing the windscreen.',
    ],
    automaticFailExamples: [
      'Any serious fault (potentially dangerous) or dangerous fault (actual danger to anyone or to property).',
      'The examiner having to take action, for example using the dual controls.',
      'Going through a red light or not stopping at a stop sign.',
      'Pulling out at a junction so that another road user has to brake or swerve.',
      'Losing control so that the car mounts the pavement.',
      'Failing the eyesight check, which ends the test before you drive.',
    ],
    overview: [
      'Around 40 minutes of driving on a mix of roads and traffic conditions. The test is the same for manual and automatic cars.',
      'You drive independently by following a sat nav, traffic signs or both. Since November 2025 this can last for most or all of the drive. Going off route is not a fault in itself.',
      'You are asked to pull over and move off several times, including from behind a parked vehicle and possibly on a hill.',
      'One reversing exercise, and in some tests an emergency stop.',
      'The examiner marks driving faults, serious faults and dangerous faults.',
      'You are told the result and given feedback at the end of the drive.',
    ],
  },
  knowledgeTest: {
    officialName: 'Theory Test',
    questionCount: 50,
    passMark: 43,
    timeLimitMin: 57,
    notes:
      'You must also pass a hazard perception part in the same sitting: 14 video clips with 15 developing hazards, pass mark 44 out of 75. You need to pass both parts. The pass certificate lasts 2 years and you need it to book the driving test.',
  },
  facts: {
    bacLimit: 0.08,
    bacLimitNovice: 0.08,
    bacNote:
      'Scotland has a lower limit than the rest of Great Britain: 50 mg of alcohol per 100 mL of blood (0.05), or 22 micrograms per 100 mL of breath. England and Wales: 80 mg per 100 mL of blood (0.08), or 35 micrograms in breath. There is no separate limit for new drivers. The government consulted in 2026 on lowering the England and Wales limit, so check the current law. The only safe amount is none.',
    handheldPhoneBan: true,
    phoneNote:
      'It is illegal to hold and use a phone, sat nav, tablet or any device that can send or receive data while driving, even when stopped at lights or in a queue. The penalty is 6 points and a £200 fine, and you lose your licence if you passed your test in the last 2 years. Hands-free use is allowed only if you stay in full control.',
    seatbeltNote:
      'You must wear a seat belt if one is fitted. The driver is responsible for making sure children under 14 wear a seat belt or use the correct child car seat.',
    minLearnerAge: '17',
    minSoloAge: '17',
    schoolZoneNote:
      'There is no national school-zone speed limit, but many roads near schools have a signed 20 mph limit, sometimes only at school times. You must stop for a school crossing patrol showing a stop sign. Do not stop on yellow zigzag "School Keep Clear" markings.',
    schoolBusRule: null,
    extras: [
      {
        title: '20 mph default in Wales',
        text: 'Since 17 September 2023 the default limit on restricted roads in Wales (most street-lit roads in built-up areas) is 20 mph instead of 30 mph, unless signs show otherwise.',
      },
      {
        title: 'Lower drink-drive limit in Scotland',
        text: 'Scotland cut its limit in December 2014 to 50 mg of alcohol per 100 mL of blood (22 micrograms per 100 mL of breath). England and Wales remain at 80 mg.',
      },
      {
        title: 'Hierarchy of road users',
        text: 'Since 2022 the Highway Code says those who can do the most harm carry the most responsibility. Give way to pedestrians crossing or waiting to cross at junctions, and do not cut across cyclists or horse riders going straight ahead.',
      },
      {
        title: 'Passing cyclists and the Dutch Reach',
        text: 'Leave at least 1.5 metres when overtaking cyclists at up to 30 mph, and more at higher speeds. Open your door with the hand furthest from it so that you turn and look for cyclists.',
      },
      {
        title: 'New drivers: 6 points and you start again',
        text: 'Your licence is cancelled if you reach 6 or more penalty points within 2 years of passing your first test. You then need a new provisional licence and must pass the theory and driving tests again.',
      },
      {
        title: 'Learner rules',
        text: 'Learners must show L plates (D plates are also allowed in Wales) and be supervised by someone aged 21 or over who has held a full licence for that type of car for at least 3 years. Learners may only use motorways with an approved driving instructor in a dual-control car. You can drive a car at 16 if you get the enhanced rate of the mobility part of PIP (or Adult Disability Payment in Scotland).',
      },
    ],
  },
  sources: [
    { title: 'The Highway Code (GOV.UK)', url: 'https://www.gov.uk/guidance/the-highway-code' },
    {
      title: 'The Highway Code: Using the road, rules 159 to 203',
      url: 'https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203',
    },
    {
      title: 'Driving test: cars. What happens during the test (GOV.UK)',
      url: 'https://www.gov.uk/driving-test/what-happens-during-test',
    },
    {
      title: 'Driving test: cars. Driving test faults and your result (GOV.UK)',
      url: 'https://www.gov.uk/driving-test/driving-test-faults-result',
    },
    {
      title: 'DVSA examiner guidance DT1: car driving test',
      url: 'https://www.gov.uk/guidance/guidance-for-driving-examiners-carrying-out-driving-tests-dt1/1-car-driving-test',
    },
    {
      title: 'DVSA: Making adjustments to the driving test (November 2025)',
      url: 'https://despatch.blog.gov.uk/2025/11/19/making-adjustments-to-the-driving-test/',
    },
    {
      title: 'Theory test: cars. Pass mark and test result (GOV.UK)',
      url: 'https://www.gov.uk/theory-test/pass-mark-and-result',
    },
    { title: 'The drink drive limit (GOV.UK)', url: 'https://www.gov.uk/drink-drive-limit' },
    {
      title: 'Using a phone, sat nav or other device when driving (GOV.UK)',
      url: 'https://www.gov.uk/using-mobile-phones-when-driving-the-law',
    },
    {
      title: 'The Restricted Roads (20 mph Speed Limit) (Wales) Order 2022',
      url: 'https://www.legislation.gov.uk/wsi/2022/800/made',
    },
  ],
  lastReviewed: '2026-11-10',
};
