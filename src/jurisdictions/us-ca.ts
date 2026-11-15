import type { JurisdictionProfile } from '../core/types';

/**
 * California. Rules follow the DMV's California Driver's Handbook and the
 * California Vehicle Code; the mock test follows the DMV's Driving Performance
 * Evaluation (DPE) score sheet (form DL 32) and its published scoring criteria.
 */
export const US_CA: JurisdictionProfile = {
  id: 'us-ca',
  name: 'California',
  country: 'United States',
  countryCode: 'US',
  flag: '🇺🇸',
  licensingAuthority: 'California Department of Motor Vehicles (DMV)',
  handbookName: "California Driver's Handbook",
  handbookUrl: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/',
  drivingSide: 'right',
  speedUnit: 'mph',
  // 25 mph is the statutory limit in residential and business districts unless posted otherwise.
  // School zone: 25 mph within 500 feet of a school while children are present (the handbook figure);
  // some cities post 15 mph, and a statewide 20 mph school-zone limit starts on 1 January 2031 (AB 382).
  speedLimits: {
    residential: 25,
    urban: 30,
    arterial: 35,
    school: 25,
    lot: 10,
  },
  rules: {
    turnOnRed: 'allowed_after_stop',
    // Vehicle Code 22108 and the handbook: signal during the last 100 feet before turning.
    signalMinDistanceM: 30.48,
    signalGuidanceDistanceM: 30.48,
    // The handbook's only timed figure is 5 seconds, and it applies to freeway lane changes.
    signalMinTimeLaneChangeS: 3,
    followingGapS: 3,
    uncontrolledPriority: 'first_to_arrive_then_right',
    allWayStops: true,
    roundabout: {
      signalOnExit: true,
      signalOnApproach: 'none',
    },
    pedestrianPriority: 'on_crossing',
    trafficLightSequence: 'red_green_amber',
    headlightsInRain: true,
    notes: [
      'Right on red is allowed after a full stop unless a NO TURN ON RED sign is posted. Yield to pedestrians and traffic first. Never turn against a red arrow.',
      'Left on red is allowed only from a one-way street onto another one-way street, after a full stop.',
      'Signal for at least the last 100 feet before a turn, and before every lane change. On a freeway, signal at least 5 seconds before changing lanes.',
      'With no stop or yield signs, the first vehicle to reach the intersection goes first. If you arrive together, yield to the vehicle on your right. At a T-intersection, traffic on the through road goes first.',
      'All-way stops work the same way: first to stop goes first, and in a tie the driver on the right goes first.',
      'Pedestrians have the right-of-way in marked and unmarked crosswalks. Slow down and be ready to stop for anyone about to cross.',
      'Roundabouts: slow down, yield to traffic already in the roundabout, travel counter-clockwise and signal when you change lanes or exit.',
      'Headlights must be on when rain, snow or fog makes you use the wipers continuously, and from 30 minutes after sunset to 30 minutes before sunrise.',
      'The three-second rule is the minimum following distance. Leave more room in bad weather or behind large vehicles and motorcycles.',
    ],
  },
  roadStyle: {
    centreLineColour: 'yellow',
    warningSign: 'yellow_diamond',
    speedLimitSign: 'us',
    yieldSignText: 'YIELD',
    crosswalkStyle: 'parallel_lines',
    trafficLightPlacement: 'far_side',
    signalHousing: 'black',
  },
  terms: {
    yield: 'yield',
    curb: 'curb',
    turnSignal: 'turn signal',
    parkingBrake: 'parking brake',
    crosswalk: 'crosswalk',
    sidewalk: 'sidewalk',
    intersection: 'intersection',
    roundabout: 'roundabout',
    trafficLight: 'traffic light',
    amber: 'yellow',
    license: 'license',
    roadTest: 'drive test',
    threePointTurn: 'three-point turn',
    parallelPark: 'parallel park',
    examiner: 'examiner',
    blindSpotCheck: 'shoulder check',
    observationRoutine: 'SMOG — Signal, Mirror, Over the shoulder, Go',
    accelerator: 'gas pedal',
    parkingLot: 'parking lot',
    highway: 'freeway',
  },
  roadTest: {
    officialName: 'Behind-the-Wheel Drive Test',
    typicalDurationMin: 20,
    scoring: {
      style: 'fault_count',
      pointsPerMinor: 1,
      pointsPerSerious: 16,
      maxPoints: 15,
      seriousIsAutoFail: true,
      officiallyPublished: true,
      description:
        'You pass with no more than 15 errors on the scored maneuvers and no critical driving error; a single critical error fails the test. Missing more than 3 of the 6 locate-and-demonstrate items in the pre-drive check also fails.',
    },
    mockTestManeuvers: ['curbside_stop', 'reverse_straight', 'forward_bay_park'],
    maneuverNotes:
      'Every test includes pulling up alongside a curb and then backing in a straight line for three vehicle lengths, staying within 3 feet of the curb and looking over your right shoulder. There is no parallel parking, three-point turn or emergency stop. The test starts and ends in the DMV parking lot, so expect to finish by parking in a space (not scored as a separate maneuver).',
    preDriveChecks: [
      'Vehicle safety check: driver window, windshield, mirrors, turn signals, brake lights, tires, foot brake, horn, seat belts, passenger door and glove box. A defect here means the test is rescheduled.',
      'Locate and demonstrate six items: parking brake, arm signals, windshield wipers, defroster, emergency flashers and headlights. Four or more misses is a fail before you drive.',
      'Arm signals: left turn, right turn, and slowing or stopping.',
      'Bring your permit, proof of insurance and registration, and a licensed California driver aged 18 or over (25 or over if you are a minor).',
    ],
    automaticFailExamples: [
      'The examiner has to intervene, by word or by taking a control.',
      'Hitting a vehicle, person, animal or object you could have avoided, or driving over a curb or onto the sidewalk.',
      'Not stopping fully at a stop sign, red light or flashing red light.',
      'Driving 10 mph over the limit, or 10 mph under it when conditions do not call for it.',
      'Changing lanes, merging, pulling from the curb or backing without checking mirrors and blind spot.',
      'Making another driver or a pedestrian brake or swerve, or blocking an intersection.',
      'Not using wipers, defroster or headlights when weather or darkness requires them.',
      'Driving in the oncoming lane unnecessarily or turning from a lane marked for going straight.',
    ],
    overview: [
      'About 20 minutes, starting and finishing at the DMV office, in a vehicle you provide.',
      'It opens with the pre-drive safety check of the vehicle and its controls.',
      'The route covers parking-lot driving, residential and business streets, intersections, left and right turns and lane changes.',
      'You will pull over to a curb and back up in a straight line.',
      'The examiner only gives directions. Driver-assist features such as automated parking and adaptive cruise control may not be used.',
      'You get three attempts on one application; minors must wait 14 days before a retest.',
    ],
  },
  knowledgeTest: {
    officialName: 'Knowledge Test',
    questionCount: 36,
    passMark: 30,
    timeLimitMin: null,
    notes:
      "Figures are for a first license at 18 or over. Applicants under 18 take a 46-question test and need 38 correct. The DMV's permit page gives the pass mark simply as 80% and does not list question counts, so check the DMV site for the current format. Multiple choice, based on the Driver's Handbook, three attempts per application. Minors wait 7 days to retake.",
  },
  facts: {
    bacLimit: 0.08,
    bacLimitNovice: 0.01,
    bacNote:
      'The limit is 0.08% at 21 and over, and 0.01% if you are under 21 or on DUI probation. It is 0.04% in a vehicle that needs a commercial license or when carrying a passenger for hire. You can be arrested below the limit if you are impaired.',
    handheldPhoneBan: true,
    phoneNote:
      'Holding a phone to talk or text while driving is illegal. Adults may use a phone hands-free. Drivers under 18 may not use a phone or any wireless device at all, even hands-free, except to call for emergency help.',
    seatbeltNote:
      'The driver and every passenger must be belted. Children under 8 ride in a car seat or booster in the back seat unless they are 4 feet 9 inches or taller. Children under 2 ride rear-facing unless they weigh 40 pounds or are 40 inches tall.',
    minLearnerAge: '15½',
    minSoloAge: '16',
    schoolZoneNote:
      'The limit is 25 mph within 500 feet of a school while children are outside or crossing, unless a lower limit is posted. Some school zones are posted at 15 mph. A statewide 20 mph school-zone limit takes effect in 2031 and cities may adopt it sooner.',
    schoolBusRule:
      'When a school bus flashes red lights, traffic in both directions must stop and stay stopped until the lights go off. You do not need to stop if the bus is on the other side of a divided highway or a road with two or more lanes in each direction. Flashing yellow lights warn that the bus is about to stop.',
    extras: [
      {
        title: 'Move over, slow down',
        text: 'When you approach a stopped emergency vehicle, tow truck or Caltrans vehicle showing flashing lights, move over a lane if it is safe. If you cannot, slow down.',
      },
      {
        title: 'Passing bicyclists',
        text: 'Change lanes to pass a bicyclist when you can. If you cannot change lanes, leave at least 3 feet, or wait until there is room.',
      },
      {
        title: 'Right turns across a bike lane',
        text: 'Signal, look over your shoulder for bicyclists, then merge into the bike lane no more than 200 feet before the corner and make the turn from there.',
      },
      {
        title: '15 mph places',
        text: 'The limit is 15 mph in any alley and at a blind intersection, which is one with no stop signs where you cannot see 100 feet in both directions as you approach.',
      },
      {
        title: 'Curb colors',
        text: 'Red means no stopping, yellow is for loading, white is for brief passenger stops, green is time-limited parking and blue is for disabled permit holders only.',
      },
      {
        title: 'Provisional license limits',
        text: 'For the first 12 months, drivers under 18 may not drive between 11 PM and 5 AM or carry passengers under 20 unless a licensed driver aged 25 or over is in the car.',
      },
    ],
  },
  faultSeverityOverrides: {
    // DPE critical driving error "Dangerous maneuver": no mirror and blind-spot check when
    // changing lanes, merging, pulling from the curb or backing; blocking an intersection.
    no_blind_spot_check: 'serious',
    no_observation_moving_off: 'serious',
    no_observation_reversing: 'serious',
    blocked_junction: 'serious',
    // DPE critical driving error "Auxiliary equipment use": wipers, defroster or headlights
    // not used when weather or darkness requires them.
    no_headlights: 'serious',
    no_wipers: 'serious',
  },
  sources: [
    {
      title: "California Driver's Handbook (DMV)",
      url: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/',
    },
    {
      title: "Driver's Handbook, Section 7: Laws and Rules of the Road",
      url: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/laws-and-rules-of-the-road/',
    },
    {
      title: "Driver's Handbook, Section 6: Navigating the Roads",
      url: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/navigating-the-roads/',
    },
    {
      title: "Driver's Handbook, Section 8: Safe Driving",
      url: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/safe-driving/',
    },
    {
      title: "Driver's Handbook, Section 9: Alcohol and Drugs",
      url: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/alcohol-and-drugs/',
    },
    {
      title: "Driver's Handbook, Section 3: The Testing Process",
      url: 'https://www.dmv.ca.gov/portal/handbook/california-driver-handbook/the-testing-process/',
    },
    {
      title: 'DMV Driving Performance Evaluation (DPE) Scoring Criteria',
      url: 'https://www.dmv.ca.gov/portal/handbook/driving-test-criteria/driving-performance-evaluation-dpe-scoring-criteria/',
    },
    {
      title: 'DMV Pre-Drive Checklist (Safety Criteria)',
      url: 'https://www.dmv.ca.gov/portal/handbook/driving-test-criteria/pre-drive-checklist-safety-criteria/',
    },
    {
      title: 'DMV Driving Performance Evaluation score sheet (DL 32)',
      url: 'https://www.dmv.ca.gov/portal/uploads/2022/04/DL-32-2021-DPE-fully-accessible.pdf',
    },
    {
      title: "DMV: Instruction and Learner's Permits",
      url: 'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/instruction-permits/',
    },
  ],
  lastReviewed: '2026-11-10',
};
