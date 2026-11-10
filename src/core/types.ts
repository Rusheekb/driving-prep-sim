/**
 * Learner Lane — shared contracts.
 *
 * This file is the single source of truth for the data shapes that cross
 * module boundaries. It contains TYPES ONLY (no runtime code) so that it can be
 * imported from anywhere, including the headless simulation core which must
 * never depend on the DOM or three.js.
 *
 * Conventions (see docs/ARCHITECTURE.md for the long version):
 *  - SI units everywhere inside the simulation: metres, seconds, m/s, radians.
 *  - World ground plane is X/Z (three.js convention, Y is up).
 *  - Compass: North = −Z, East = +X, South = +Z, West = −X.
 *  - Heading `h` (radians): forward vector = (sin h, cos h) in (x, z).
 *      h = 0 → South (+Z),  h = π/2 → East (+X),  h = π → North (−Z),  h = −π/2 → West (−X)
 *    A three.js object modelled facing +Z is oriented with `rotation.y = h`.
 *  - Right-hand vector of a heading = (−cos h, sin h). Turning RIGHT DECREASES heading.
 *  - `steer` inputs/angles are positive to the RIGHT.
 *  - `lateral` offsets are positive to the RIGHT of the direction of travel.
 */

/* ========================================================================== */
/* Geometry                                                                   */
/* ========================================================================== */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Pose {
  x: number;
  z: number;
  heading: number;
}

/** Axis-aligned rectangle on the ground plane. */
export interface Rect {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

/** Oriented bounding box footprint (centre + heading + half extents). */
export interface Obb {
  x: number;
  z: number;
  heading: number;
  /** Half extent along the heading direction. */
  halfLength: number;
  /** Half extent perpendicular to the heading direction. */
  halfWidth: number;
}

export type Compass = 'N' | 'E' | 'S' | 'W';

/* ========================================================================== */
/* Jurisdictions                                                              */
/* ========================================================================== */

export type DrivingSide = 'left' | 'right';
export type SpeedUnit = 'mph' | 'km/h';

/**
 * Road categories used by the simulator's town. Each jurisdiction maps a class
 * to the limit that would typically be posted on such a road there.
 *  - residential: quiet housing streets
 *  - urban:       ordinary two-lane town roads / collectors
 *  - arterial:    the multi-lane main road through town
 *  - school:      an active school zone on a residential street
 *  - lot:         car parks / test-centre yard
 */
export type SpeedClass = 'residential' | 'urban' | 'arterial' | 'school' | 'lot';

export type Severity = 'minor' | 'serious' | 'dangerous';

export interface SourceRef {
  title: string;
  url: string;
}

export interface RoadRules {
  /**
   * Turning on a red signal toward the NEAR (kerb) side — a right turn where
   * traffic keeps right, a left turn where traffic keeps left — after coming
   * to a complete stop and giving way.
   *  - 'allowed_after_stop': generally legal unless a sign prohibits it
   *  - 'signed_only': only where a sign/arrow specifically permits it
   *    (the simulator has no such signs, so it is treated as prohibited)
   *  - 'prohibited': never legal
   */
  turnOnRed: 'allowed_after_stop' | 'signed_only' | 'prohibited';
  /**
   * Legal minimum distance (metres) for signalling before a turn, or null when
   * the law only says "in good time" / "sufficient warning".
   */
  signalMinDistanceM: number | null;
  /** Distance (metres) before a turn the simulator expects the signal to be on. */
  signalGuidanceDistanceM: number;
  /** Seconds a signal should be shown before changing lanes or pulling out from the kerb. */
  signalMinTimeLaneChangeS: number;
  /** Recommended minimum following gap in seconds in good conditions. */
  followingGapS: number;
  /**
   * Priority between vehicles at an intersection with no signs, signals or markings.
   *  - 'priority_to_right': always give way to vehicles approaching from your right
   *  - 'first_to_arrive_then_right': first vehicle there goes first; in a tie give way to the right
   *  - 'no_priority': nobody has priority — approach with caution and negotiate
   */
  uncontrolledPriority: 'priority_to_right' | 'first_to_arrive_then_right' | 'no_priority';
  /** Whether all-way (4-way) stop intersections are used. When false the simulator replaces them with give-way/yield junctions. */
  allWayStops: boolean;
  roundabout: {
    /** Drivers are expected to signal when leaving the roundabout. */
    signalOnExit: boolean;
    /**
     * Signalling on the approach:
     *  - 'by_exit_direction': signal toward the side of your exit (none when going straight ahead)
     *  - 'none': do not signal on approach
     */
    signalOnApproach: 'by_exit_direction' | 'none';
  };
  /**
   * At an unsignalised marked pedestrian crossing drivers must give way to pedestrians who are
   *  - 'on_crossing': already on the crossing
   *  - 'on_or_waiting': on the crossing OR waiting to cross
   */
  pedestrianPriority: 'on_crossing' | 'on_or_waiting';
  /** 'red_redamber_green_amber' shows red+amber together before green (e.g. UK, Germany). */
  trafficLightSequence: 'red_green_amber' | 'red_redamber_green_amber';
  /** Headlights are legally required (or officially instructed) when wipers are in use / in rain. */
  headlightsInRain: boolean;
  /** Short plain-language notes on rules above where nuance matters (shown in the rules reference). */
  notes: string[];
}

export interface RoadStyle {
  /** Colour of the line separating opposing directions of traffic. */
  centreLineColour: 'yellow' | 'white';
  /** Shape/colour of hazard warning signs. */
  warningSign: 'yellow_diamond' | 'red_triangle';
  /**
   * Speed limit sign design:
   *  - 'us': white rectangle "SPEED LIMIT 25"
   *  - 'canada': white rectangle "MAXIMUM 50"
   *  - 'red_circle': white disc with a red ring and the number (UK, EU, India…)
   *  - 'red_circle_on_panel': red ring on a white rectangular panel (Australia, New Zealand)
   */
  speedLimitSign: 'us' | 'canada' | 'red_circle' | 'red_circle_on_panel';
  /** Text on the yield/give-way sign; empty string for a blank (symbol-only) triangle. */
  yieldSignText: string;
  /** Marking pattern used for ordinary pedestrian crossings. */
  crosswalkStyle: 'zebra' | 'parallel_lines';
  /** Where the primary signal heads are mounted relative to the junction. */
  trafficLightPlacement: 'far_side' | 'near_side';
  /** Colour of the traffic signal housing. */
  signalHousing: 'yellow' | 'black' | 'dark_green';
}

/** Local vocabulary used when generating instructions and feedback. All lower case unless a proper noun. */
export interface Terminology {
  /** 'yield' | 'give way' */
  yield: string;
  /** 'curb' | 'kerb' */
  curb: string;
  /** 'turn signal' | 'indicator' | 'blinker' */
  turnSignal: string;
  /** 'parking brake' | 'handbrake' */
  parkingBrake: string;
  /** 'crosswalk' | 'pedestrian crossing' | 'zebra crossing' */
  crosswalk: string;
  /** 'sidewalk' | 'pavement' | 'footpath' */
  sidewalk: string;
  /** 'intersection' | 'junction' */
  intersection: string;
  /** 'roundabout' | 'traffic circle' */
  roundabout: string;
  /** 'traffic light' | 'traffic signal' */
  trafficLight: string;
  /** 'yellow' | 'amber' */
  amber: string;
  /** 'license' | 'licence' */
  license: string;
  /** 'road test' | 'driving test' | 'drive test' */
  roadTest: string;
  /** 'three-point turn' | 'turn in the road' */
  threePointTurn: string;
  /** 'parallel park' | 'reverse parallel park' */
  parallelPark: string;
  /** 'examiner' | 'testing officer' */
  examiner: string;
  /** 'shoulder check' | 'head check' | 'blind spot check' */
  blindSpotCheck: string;
  /** e.g. 'SMOG — Signal, Mirror, Over the shoulder, Go' or 'MSM — Mirror, Signal, Manoeuvre' */
  observationRoutine: string;
  /** 'gas pedal' | 'accelerator' */
  accelerator: string;
  /** 'parking lot' | 'car park' */
  parkingLot: string;
  /** 'highway' | 'motorway' | 'freeway' | 'expressway' */
  highway: string;
}

export type ManeuverType =
  | 'parallel_park'
  | 'reverse_bay_park'
  | 'forward_bay_park'
  | 'three_point_turn'
  | 'reverse_straight'
  | 'curbside_stop'
  | 'emergency_stop';

export interface TestScoring {
  /**
   * How the real test is marked:
   *  - 'fault_count': count minor faults/errors; fail above `maxPoints` (each minor = `pointsPerMinor`, normally 1)
   *  - 'points_deducted': each fault carries points; fail above `maxPoints`
   */
  style: 'fault_count' | 'points_deducted';
  pointsPerMinor: number;
  /** Only used when `seriousIsAutoFail` is false. */
  pointsPerSerious: number;
  /** The test is failed when accumulated points EXCEED this number. */
  maxPoints: number;
  /** A single serious fault fails the test. */
  seriousIsAutoFail: boolean;
  /** True when the numbers above come from the licensing authority's published marking scheme. */
  officiallyPublished: boolean;
  /** One or two sentences explaining the real marking scheme in plain language. */
  description: string;
}

export interface RoadTestSpec {
  /** e.g. 'Behind-the-Wheel Drive Test', 'Practical Driving Test', 'G2 Road Test' */
  officialName: string;
  typicalDurationMin: number;
  scoring: TestScoring;
  /** Manoeuvres the simulator's mock test includes for this jurisdiction. */
  mockTestManeuvers: ManeuverType[];
  /** Plain-language summary of which manoeuvres the real test can include. */
  maneuverNotes: string;
  /** Checks done before driving (vehicle safety check, "show me, tell me", eyesight check …). */
  preDriveChecks: string[];
  /** Typical things that fail the test immediately. */
  automaticFailExamples: string[];
  /** 3–6 bullet points describing what happens on the real test. */
  overview: string[];
}

export interface KnowledgeTestSpec {
  /** e.g. 'Knowledge Test', 'Theory Test', 'Learner Permit Test' */
  officialName: string;
  questionCount: number;
  /** Number of correct answers required to pass. */
  passMark: number;
  timeLimitMin: number | null;
  notes: string;
}

export interface JurisdictionFacts {
  /** Blood alcohol limit for fully licensed adult drivers, in g/100 mL (e.g. 0.08). */
  bacLimit: number;
  /** Limit for learner / novice / under-age drivers, in g/100 mL (0 for zero tolerance). */
  bacLimitNovice: number;
  bacNote: string;
  /** Hand-held mobile phone use while driving is banned. */
  handheldPhoneBan: boolean;
  phoneNote: string;
  seatbeltNote: string;
  /** e.g. '15½', '17' */
  minLearnerAge: string;
  /** Minimum age to drive unsupervised (provisional/probationary counts). */
  minSoloAge: string;
  schoolZoneNote: string;
  /** Rule for passing a stopped school bus, or null where there is no special rule. */
  schoolBusRule: string | null;
  /** Other notable local rules worth teaching. */
  extras: { title: string; text: string }[];
}

export interface JurisdictionProfile {
  /** Stable id, e.g. 'us-ca', 'gb', 'ca-on', 'au-nsw', 'de', 'in' */
  id: string;
  /** Display name, e.g. 'California', 'Great Britain', 'Ontario' */
  name: string;
  country: string;
  /** ISO 3166-1 alpha-2 country code. */
  countryCode: string;
  /** Flag emoji. */
  flag: string;
  licensingAuthority: string;
  handbookName: string;
  handbookUrl: string;
  drivingSide: DrivingSide;
  speedUnit: SpeedUnit;
  /** Limits posted on the simulator's roads, expressed in `speedUnit`. */
  speedLimits: Record<SpeedClass, number>;
  rules: RoadRules;
  roadStyle: RoadStyle;
  terms: Terminology;
  roadTest: RoadTestSpec;
  knowledgeTest: KnowledgeTestSpec;
  facts: JurisdictionFacts;
  /** Severity overrides for the mock test (e.g. a rolling stop is an automatic fail). */
  faultSeverityOverrides?: Partial<Record<FaultCode, Severity>>;
  sources: SourceRef[];
  /** ISO date the data was last checked against the sources. */
  lastReviewed: string;
}

/* ========================================================================== */
/* Map definition (authoring format)                                          */
/* ========================================================================== */

/**
 * How an intersection is controlled.
 *  - signal:       traffic lights
 *  - allway_stop:  every approach has a stop sign (downgraded to yield_minor where `rules.allWayStops` is false)
 *  - stop_minor:   the minor axis has stop signs, the major axis has priority
 *  - yield_minor:  the minor axis has yield/give-way signs
 *  - uncontrolled: no signs or signals; `rules.uncontrolledPriority` applies
 *  - roundabout:   single-lane roundabout, entering traffic gives way
 *  - none:         a bend or continuation with exactly two arms; nothing to obey
 */
export type ControlType =
  | 'signal'
  | 'allway_stop'
  | 'stop_minor'
  | 'yield_minor'
  | 'uncontrolled'
  | 'roundabout'
  | 'none';

export interface MapNodeDef {
  id: string;
  x: number;
  z: number;
  control: ControlType;
  /** Axis that must stop / give way (for stop_minor, yield_minor and downgraded all-way stops). */
  minorAxis?: 'NS' | 'EW';
}

export interface MapRoadDef {
  id: string;
  /** Street name shown on the minimap and used in instructions. */
  name: string;
  /** Node ids. Roads are axis-aligned: `a` and `b` share an x or a z coordinate. */
  a: string;
  b: string;
  /** Number of lanes travelling a→b and b→a. `[n, 0]` is a one-way street. */
  lanes: [number, number];
  speedClass: SpeedClass;
  /** Kerbside parking strips on both sides (used for parallel parking and pulling over). */
  parkingStrip?: boolean;
  /** Unsignalised marked pedestrian crossing part-way along the road (0..1 from a to b). */
  midblockCrossing?: number;
}

/** A marked parking space. `pose` is where the CENTRE of a perfectly parked car sits and the way it faces. */
export interface BayDef {
  id: string;
  kind: 'bay' | 'parallel';
  pose: Pose;
  /** Dimension along `pose.heading`. */
  length: number;
  /** Dimension across `pose.heading`. */
  width: number;
}

export interface ZoneDef {
  id: string;
  name: string;
  kind: 'lot';
  /** Paved, drivable area. */
  rect: Rect;
  /** Paved driveway linking the lot to a road, crossing the sidewalk. */
  driveway: Rect;
  /** Road the driveway joins. */
  roadId: string;
  bays: BayDef[];
}

/** Named location that scenarios refer to (start positions, manoeuvre spots…). */
export interface MapPoi {
  id: string;
  pose: Pose;
  note: string;
}

export interface MapDef {
  id: string;
  name: string;
  nodes: MapNodeDef[];
  roads: MapRoadDef[];
  zones: ZoneDef[];
  pois: MapPoi[];
}

/* ========================================================================== */
/* Road network (derived at runtime for one jurisdiction)                     */
/* ========================================================================== */

export type Turn = 'left' | 'right' | 'straight' | 'uturn';

/** What traffic in a lane must obey at the end of that lane. */
export type LaneEndControl = 'signal' | 'stop' | 'yield' | 'none';

export interface RoadInfo {
  id: string;
  name: string;
  a: string;
  b: string;
  axis: 'NS' | 'EW';
  /** Node centre positions. */
  start: Vec2;
  end: Vec2;
  /** Lane ids travelling a→b / b→a, ordered from the centre line outward. */
  lanesAB: string[];
  lanesBA: string[];
  laneWidth: number;
  /** Total width of the travel lanes (excludes parking strips). */
  carriagewayWidth: number;
  /** Width of each kerbside parking strip (0 when the road has none). */
  parkingStripWidth: number;
  /** Distance from the road axis to each kerb (carriageway/2 + parking strip). */
  kerbOffset: number;
  sidewalkWidth: number;
  speedClass: SpeedClass;
  /** m/s */
  speedLimit: number;
  oneWay: boolean;
}

export interface LaneInfo {
  /** `${roadId}:${'ab' | 'ba'}:${index}` */
  id: string;
  roadId: string;
  /** Node the lane leaves and the node it arrives at. */
  from: string;
  to: string;
  /** Compass direction of travel. */
  travel: Compass;
  /** Arm of node `to` this lane arrives on (opposite of `travel`). */
  arrivalArm: Compass;
  /** 0 = lane nearest the centre line; increases toward the kerb. */
  index: number;
  /** Number of lanes in this direction of travel. */
  laneCount: number;
  /** Centre-line start (just clear of node `from`) and end (AT the stop/yield line of node `to`). */
  start: Vec2;
  end: Vec2;
  heading: number;
  length: number;
  width: number;
  /** m/s */
  speedLimit: number;
  speedClass: SpeedClass;
  /** Control at the end of the lane after jurisdiction mapping. Roundabout entries are 'yield'. */
  endControl: LaneEndControl;
  /** Connector ids leaving the end of this lane. */
  connectors: string[];
  /** Connector ids arriving at the start of this lane. */
  incoming: string[];
  /** Adjacent same-direction lanes (toward the centre line / toward the kerb), or null. */
  innerNeighbour: string | null;
  outerNeighbour: string | null;
  /** Unsignalised mid-block crossing this lane passes over, if any. `s` is where a vehicle must stop (before the crossing). */
  midblock: { crosswalkId: string; stopS: number; endS: number } | null;
}

export interface ConnectorConflict {
  /** Id of the conflicting connector at the same node. */
  other: string;
  /** Distance along THIS connector at which the paths meet. */
  s: number;
  /** Distance along the OTHER connector at which the paths meet. */
  otherS: number;
  /** 'cross' = paths cross; 'merge' = paths join into the same outgoing lane. */
  kind: 'cross' | 'merge';
}

/** A path through an intersection from the end of one lane to the start of another. */
export interface ConnectorInfo {
  /** `${fromLaneId}>${toLaneId}` */
  id: string;
  nodeId: string;
  from: string;
  to: string;
  turn: Turn;
  /** True when the movement cuts across oncoming traffic (left turn when keeping right, right turn when keeping left). */
  crossesOncoming: boolean;
  /** Roundabouts only: 1-based exit number counted in the direction of circulation. */
  exitNumber?: number;
  /** Polyline from the end of `from` to the start of `to`, sampled every ~1 m. */
  points: Vec2[];
  /** Cumulative distance of each point from the start (same length as `points`). */
  cumulative: number[];
  length: number;
  conflicts: ConnectorConflict[];
  /** Junction crosswalks this path crosses, with the distance along the connector to the middle of the crossing. */
  crosswalks: { id: string; s: number }[];
}

export interface NodeArm {
  /** Direction from the node centre to this arm. */
  dir: Compass;
  roadId: string;
  /** Priority role of this arm at the junction. */
  role: 'major' | 'minor' | 'equal';
  /** Lane ids arriving at the node on this arm / leaving the node on this arm. */
  incoming: string[];
  outgoing: string[];
  /** Stop/yield line across the incoming lanes; null when control is 'none' or the arm has no incoming lanes. */
  stopLine: { a: Vec2; b: Vec2 } | null;
  /** Distance from the node centre to the stop line / start of the junction area along this arm. */
  setback: number;
}

export interface NodeInfo {
  id: string;
  pos: Vec2;
  /** Effective control after jurisdiction mapping. */
  control: ControlType;
  /** Control as authored in the map. */
  declaredControl: ControlType;
  minorAxis: 'NS' | 'EW' | null;
  arms: Partial<Record<Compass, NodeArm>>;
  /** Radius of a circle around `pos` that contains the whole junction area (all connectors). */
  radius: number;
  roundabout: { islandRadius: number; outerRadius: number } | null;
  crosswalkIds: string[];
  connectorIds: string[];
}

export interface CrosswalkInfo {
  id: string;
  kind: 'junction' | 'midblock';
  /** Junction crosswalks: node and arm they belong to. */
  nodeId: string | null;
  arm: Compass | null;
  roadId: string;
  /** Kerb-to-kerb endpoints of the crossing's centre line. */
  a: Vec2;
  b: Vec2;
  /** Width of the crossing along the road's direction of travel. */
  width: number;
  /** True when pedestrians are controlled by the junction's signals. */
  signalised: boolean;
}

export interface ZoneInfo extends ZoneDef {}

/** A city block: land enclosed by roads (kerb to kerb, including sidewalks) where scenery is placed. */
export interface BlockInfo {
  id: string;
  /** Outer rectangle at the kerb lines. */
  rect: Rect;
  /** Rectangle inside the sidewalks where buildings may stand. */
  inner: Rect;
  /** Zone occupying part of this block, if any. */
  zoneId: string | null;
}

/** Where a point on the ground is, relative to the road network. */
export type SurfaceLocation =
  /** On a travel lane between junctions. */
  | { kind: 'lane'; road: RoadInfo; lane: LaneInfo; s: number; lateral: number }
  /** On a kerbside parking strip. `lane` is the adjacent travel lane; `s`/`lateral` are relative to it. */
  | { kind: 'parking_strip'; road: RoadInfo; lane: LaneInfo; s: number; lateral: number }
  /** Inside a junction area. `connector` is the nearest connector path (null if none within ~3 m). */
  | { kind: 'junction'; node: NodeInfo; connector: ConnectorInfo | null; s: number; lateral: number }
  /** In a parking lot or its driveway. */
  | { kind: 'zone'; zone: ZoneInfo; onDriveway: boolean }
  /** On a sidewalk (footpath/pavement). */
  | { kind: 'sidewalk'; road: RoadInfo | null }
  /** Anywhere else (inside a block, outside the map). */
  | { kind: 'offroad' };

/** One leg of a route: drive along a lane, then take a connector. */
export interface RouteLeg {
  laneId: string;
  /** Connector taken at the end of the lane; null on the final leg. */
  connectorId: string | null;
}

export interface RoadNetwork {
  readonly map: MapDef;
  readonly side: DrivingSide;
  /** Rectangle containing every road, sidewalk and zone. */
  readonly bounds: Rect;
  readonly nodes: ReadonlyMap<string, NodeInfo>;
  readonly roads: ReadonlyMap<string, RoadInfo>;
  readonly lanes: ReadonlyMap<string, LaneInfo>;
  readonly connectors: ReadonlyMap<string, ConnectorInfo>;
  readonly crosswalks: ReadonlyMap<string, CrosswalkInfo>;
  readonly zones: ReadonlyMap<string, ZoneInfo>;
  readonly blocks: readonly BlockInfo[];
  readonly pois: ReadonlyMap<string, MapPoi>;
  /** Classify a ground position. Must be fast (called many times per tick). */
  locate(p: Vec2): SurfaceLocation;
  /** Pose at distance `s` along a lane (clamped to the lane), optionally offset `lateral` metres to the right. */
  lanePose(laneId: string, s: number, lateral?: number): Pose;
  /** Pose at distance `s` along a connector polyline (clamped). */
  connectorPose(connectorId: string, s: number): Pose;
  /** Nearest travel lane to a point (ignoring junction areas), with projection. Null when farther than `maxDist`. */
  nearestLane(p: Vec2, maxDist?: number): { lane: LaneInfo; s: number; lateral: number } | null;
}

/* ========================================================================== */
/* Signals                                                                    */
/* ========================================================================== */

export type SignalColour = 'red' | 'red_amber' | 'green' | 'amber';
export type WalkState = 'walk' | 'flashing' | 'dont_walk';

export interface SignalSystem {
  update(dt: number): void;
  /**
   * Signal shown to traffic arriving at `nodeId` on arm `arm`
   * (e.g. a vehicle travelling north arrives on the 'S' arm → use `lane.arrivalArm`).
   * Returns 'green' for nodes that are not signal controlled.
   */
  getState(nodeId: string, arm: Compass): SignalColour;
  /** Seconds until the state returned by `getState` changes (Infinity when not signalised). */
  timeToChange(nodeId: string, arm: Compass): number;
  /** Pedestrian signal for a signalised crosswalk ('walk' for unsignalised crossings). */
  getWalkState(crosswalkId: string): WalkState;
}

/* ========================================================================== */
/* Vehicles, pedestrians, obstacles                                           */
/* ========================================================================== */

export interface VehicleSpec {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  /** Maximum front wheel angle, radians. */
  maxSteer: number;
  /** Peak forward acceleration, m/s². */
  maxAccel: number;
  /** Peak service-brake deceleration, m/s² (positive number). */
  maxBrake: number;
  /** Top speed forward, m/s. */
  maxSpeed: number;
  /** Top speed in reverse, m/s. */
  maxReverseSpeed: number;
}

export type VehicleModel = 'hatchback' | 'sedan' | 'suv' | 'van' | 'pickup' | 'bus';
export type IndicatorState = 'off' | 'left' | 'right' | 'hazard';

export interface SimVehicle {
  id: number;
  kind: 'player' | 'ai' | 'parked';
  model: VehicleModel;
  /** 0xRRGGBB body colour. */
  colour: number;
  spec: VehicleSpec;
  /** Position of the CENTRE of the vehicle's footprint. */
  x: number;
  z: number;
  heading: number;
  /** Signed speed along the heading, m/s (negative when reversing). */
  speed: number;
  /** Longitudinal acceleration, m/s². */
  accel: number;
  /** Current front wheel angle, radians, positive = right. */
  steer: number;
  indicator: IndicatorState;
  braking: boolean;
  reversing: boolean;
  headlights: boolean;
  /**
   * Where the vehicle is on the network, for AI vehicles (maintained by the traffic system):
   * exactly one of laneId / connectorId is non-null while driving.
   */
  nav: {
    laneId: string | null;
    connectorId: string | null;
    /** Distance along the current lane/connector. */
    s: number;
    /** Connector the vehicle intends to take at the end of its lane. */
    nextConnectorId: string | null;
  } | null;
}

export interface SimPedestrian {
  id: number;
  x: number;
  z: number;
  heading: number;
  /** m/s */
  speed: number;
  state: 'walking' | 'waiting' | 'crossing';
  /** Crosswalk the pedestrian is waiting at or using. */
  crosswalkId: string | null;
  /** Integer used by the renderer to vary appearance. */
  look: number;
}

export interface StaticObstacle {
  id: string;
  kind: 'cone' | 'building' | 'tree' | 'pole' | 'barrier';
  obb: Obb;
  height: number;
  /** Set once the player has struck it (cones are knocked over and stop being solid). */
  hit?: boolean;
}

/* ========================================================================== */
/* Player car and input                                                       */
/* ========================================================================== */

export type Gear = 'P' | 'R' | 'N' | 'D';
export type LookDir = 'ahead' | 'left' | 'right' | 'back';
export type MirrorId = 'left' | 'centre' | 'right';
export type HeadlightState = 'off' | 'low' | 'high';

/** One-shot commands (edge triggered). */
export type PlayerCommand =
  | { type: 'gear'; gear: Gear }
  /** Toggle: pressing the active direction again cancels it. */
  | { type: 'indicator'; value: 'left' | 'right' | 'hazard' | 'off' }
  | { type: 'handbrake' }
  | { type: 'headlights' }
  | { type: 'wipers' }
  | { type: 'seatbelt' }
  | { type: 'engine' }
  | { type: 'mirror'; mirror: MirrorId };

/** Snapshot of the driver's inputs for one simulation tick. */
export interface ControlInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** −1 (full left) .. +1 (full right) */
  steer: number;
  /** Direction the driver is looking (held). */
  look: LookDir;
  horn: boolean;
  /** Commands issued since the previous tick. */
  commands: PlayerCommand[];
}

export interface PlayerCar {
  vehicle: SimVehicle;
  gear: Gear;
  handbrake: boolean;
  engineOn: boolean;
  seatbelt: boolean;
  /** Mirrors `vehicle.indicator`. */
  indicator: IndicatorState;
  headlights: HeadlightState;
  wipers: boolean;
  horn: boolean;
  look: LookDir;
  /** Last applied analog inputs. */
  throttle: number;
  brake: number;
  steerInput: number;
  /** Sim time of the last check of each mirror (−Infinity if never). */
  lastMirrorCheck: Record<MirrorId, number>;
  /** Sim time the driver last looked over each shoulder / behind (−Infinity if never). */
  lastShoulderCheck: Record<'left' | 'right' | 'back', number>;
  /** Sim time and odometer reading when the current indicator was switched on (null when off). */
  indicatorSince: number | null;
  indicatorOdometer: number | null;
  /** Total distance travelled (forward + reverse), metres. */
  odometer: number;
  /** Seconds the car has been continuously stationary (|speed| < 0.15 m/s); 0 while moving. */
  stoppedFor: number;
  /** Surface under the centre of the car, refreshed every tick before traffic/rules run. */
  location: SurfaceLocation;
}

/* ========================================================================== */
/* Environment & settings                                                     */
/* ========================================================================== */

export type Weather = 'clear' | 'rain' | 'fog';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type TrafficDensity = 'none' | 'light' | 'normal' | 'heavy';
export type PedestrianDensity = 'none' | 'few' | 'many';
/** How strictly mirror / shoulder checks are assessed. */
export type ObservationMode = 'off' | 'relaxed' | 'strict';
export type CameraMode = 'chase' | 'driver' | 'hood' | 'top';
export type GraphicsQuality = 'low' | 'medium' | 'high';

/** Options for one drive. */
export interface SessionSettings {
  weather: Weather;
  timeOfDay: TimeOfDay;
  traffic: TrafficDensity;
  pedestrians: PedestrianDensity;
  /** 'coach' shows hints and faults live; 'exam' stays silent until the end. */
  feedback: 'coach' | 'exam';
  observation: ObservationMode;
  /** Seed for all simulation randomness. */
  seed: number;
}

/** Persistent user preferences. */
export interface AppSettings {
  jurisdictionId: string;
  /** 'auto' follows the jurisdiction. */
  speedUnit: 'auto' | SpeedUnit;
  graphics: GraphicsQuality;
  showMirrors: boolean;
  camera: CameraMode;
  /** 0..1 */
  volume: number;
  /** Speak instructions aloud with the browser's speech synthesis. */
  voice: boolean;
  /** Show a guidance line on the road and turn arrows in coach mode. */
  navLine: boolean;
  touchControls: 'auto' | 'on' | 'off';
  /** 0.5..1.5 keyboard steering speed multiplier. */
  steeringSensitivity: number;
  reducedMotion: boolean;
  highContrast: boolean;
  /** UI text scale, 0.85..1.4 */
  textScale: number;
  /** Defaults applied to new sessions. */
  session: SessionSettings;
  /** True once the first-run region picker / welcome has been completed. */
  onboarded: boolean;
}

/* ========================================================================== */
/* Faults & scoring                                                           */
/* ========================================================================== */

export type FaultCategory =
  | 'observation'
  | 'signals'
  | 'speed'
  | 'positioning'
  | 'junctions'
  | 'right_of_way'
  | 'control'
  | 'manoeuvres'
  | 'safety';

export type FaultCode =
  // speed
  | 'speeding'
  | 'speeding_excessive'
  | 'speeding_school_zone'
  | 'too_slow'
  | 'too_fast_for_conditions'
  // signals
  | 'no_signal_turn'
  | 'late_signal_turn'
  | 'wrong_signal'
  | 'no_signal_lane_change'
  | 'no_signal_moving_off'
  | 'no_signal_pulling_over'
  | 'no_signal_roundabout_exit'
  | 'signal_left_on'
  // observation
  | 'no_mirror_check'
  | 'no_blind_spot_check'
  | 'no_observation_moving_off'
  | 'no_observation_reversing'
  | 'no_scan_at_junction'
  // stops & signals at junctions
  | 'rolling_stop'
  | 'ran_stop_sign'
  | 'stopped_over_line'
  | 'ran_red_light'
  | 'illegal_turn_on_red'
  | 'blocked_crosswalk'
  | 'blocked_junction'
  | 'unnecessary_stop'
  // right of way
  | 'failed_to_yield_vehicle'
  | 'failed_to_yield_pedestrian'
  | 'failed_to_yield_roundabout'
  | 'out_of_turn_at_stop'
  | 'undue_hesitation'
  // positioning
  | 'wrong_side_of_road'
  | 'wrong_way'
  | 'lane_straddling'
  | 'wrong_lane_for_turn'
  | 'wide_turn'
  | 'cut_corner'
  | 'unsafe_lane_change'
  | 'mounted_kerb'
  | 'off_road'
  | 'roundabout_wrong_way'
  // following
  | 'tailgating'
  // control
  | 'harsh_braking'
  | 'no_seatbelt'
  | 'handbrake_on'
  | 'no_headlights'
  | 'no_wipers'
  | 'not_secured'
  | 'coasting_in_neutral'
  // collisions
  | 'collision_vehicle'
  | 'collision_pedestrian'
  | 'collision_object'
  // manoeuvres
  | 'park_far_from_kerb'
  | 'park_not_straight'
  | 'park_outside_bay'
  | 'park_touched_kerb'
  | 'manoeuvre_too_many_moves'
  | 'manoeuvre_incomplete'
  | 'emergency_stop_slow'
  // examiner
  | 'ignored_instruction_unsafe';

export interface Fault {
  /** Unique within a session. */
  id: number;
  code: FaultCode;
  category: FaultCategory;
  severity: Severity;
  /** Sim time, seconds. */
  time: number;
  /** Where it happened. */
  x: number;
  z: number;
  /** Short title, e.g. "Rolling stop". */
  title: string;
  /** What happened, in plain language using local terminology. */
  detail: string;
  /** How to do it right next time. */
  tip: string;
}

export interface ScoreSummary {
  minor: number;
  serious: number;
  dangerous: number;
  /** Points accumulated under the jurisdiction's marking scheme. */
  points: number;
  maxPoints: number;
  passed: boolean;
  /** Reasons for failing, human readable (empty when passed). */
  failReasons: string[];
  /** e.g. "8 driving faults (15 allowed) · 0 serious · 0 dangerous" */
  headline: string;
}

/* ========================================================================== */
/* Scenarios                                                                  */
/* ========================================================================== */

export type ScenarioCategory = 'lesson' | 'skill' | 'test' | 'free';

export type SkillTag =
  | 'controls'
  | 'moving_off'
  | 'steering'
  | 'speed'
  | 'signals'
  | 'observation'
  | 'junctions'
  | 'stop_signs'
  | 'traffic_lights'
  | 'right_of_way'
  | 'roundabouts'
  | 'lane_changes'
  | 'pedestrians'
  | 'following'
  | 'parking'
  | 'reversing'
  | 'manoeuvres'
  | 'emergency_stop'
  | 'night'
  | 'weather'
  | 'hazards';

export type InstructionIcon =
  | 'straight'
  | 'left'
  | 'right'
  | 'uturn'
  | 'roundabout'
  | 'stop'
  | 'park'
  | 'reverse'
  | 'pull_over'
  | 'info'
  | 'flag';

/** An examiner / instructor instruction shown (and optionally spoken) to the driver. */
export interface Instruction {
  /** Monotonic id; changes whenever the instruction changes. */
  id: number;
  text: string;
  icon: InstructionIcon;
  /** Roundabout exit number, when relevant. */
  exit?: number;
  /** Distance to the point the instruction applies to, metres (updated live), or null. */
  distance: number | null;
}

/** An area highlighted in the world and on the minimap (parking bay, stopping box, finish gate). */
export interface TargetArea {
  id: string;
  kind: 'bay' | 'stop_box' | 'gate' | 'zone';
  obb: Obb;
  /** 'active' = go here now; 'done' = completed; 'pending' = later. */
  state: 'pending' | 'active' | 'done';
}

/** A prop a scenario places in the world. */
export type PropDef =
  | { kind: 'cone'; x: number; z: number }
  | { kind: 'parked_car'; pose: Pose; model?: VehicleModel; colour?: number }
  | { kind: 'barrier'; pose: Pose; length: number };

export interface ScenarioMeta {
  id: string;
  title: string;
  /** One-sentence description for the menu card. */
  summary: string;
  category: ScenarioCategory;
  skills: SkillTag[];
  /** 1 = beginner … 3 = advanced */
  difficulty: 1 | 2 | 3;
  estMinutes: number;
  /** Bullet points shown on the briefing screen: what you will practise and how it is assessed. */
  briefing: string[];
  /** Order within its category on the menu. */
  order: number;
  /** True for mock tests: pass/fail under the jurisdiction's marking scheme. Practice scenarios only earn stars. */
  assessed?: boolean;
  /** Session options this scenario dictates (e.g. the night lesson forces `timeOfDay: 'night'`); the briefing screen locks them. */
  forced?: Partial<SessionSettings>;
  /** Suggested defaults for options the learner may still change. */
  defaults?: Partial<SessionSettings>;
  /** False when no instructor demonstration (autopilot) is available for this scenario. */
  hasDemo?: boolean;
}

/** Live state of the running scenario, read by the HUD, renderer and app. */
export interface ScenarioState {
  meta: ScenarioMeta;
  status: 'running' | 'completed' | 'failed';
  /** Why the scenario ended early (e.g. "Collision with a pedestrian"), when status is 'failed'. */
  endReason: string | null;
  /** Current examiner instruction, or null. */
  instruction: Instruction | null;
  /** Instructor coaching text for guided lessons (may contain key names like [Q]); null when none. */
  coach: string | null;
  /** Polyline the driver should follow next (used for the nav line and minimap); empty when free. */
  route: Vec2[];
  targets: TargetArea[];
  /** Step progress for the progress bar. */
  step: number;
  totalSteps: number;
  /** Name of the manoeuvre being assessed right now, or null. */
  activeManeuver: ManeuverType | null;
}

/* ========================================================================== */
/* Simulation context & events                                                */
/* ========================================================================== */

export interface EnvironmentState {
  weather: Weather;
  timeOfDay: TimeOfDay;
  /** Tyre grip multiplier (1 dry, lower in rain). */
  grip: number;
  /** How far the driver can see clearly, metres. */
  visibility: number;
  /** True when headlights are required (night, dusk, rain where the law says so, fog). */
  headlightsRequired: boolean;
  /** True when it is raining hard enough to need wipers. */
  wipersRequired: boolean;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [min, max). */
  range(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
  /** Independent child generator. */
  fork(): Rng;
}

export interface CollisionEvent {
  with: 'vehicle' | 'parked_vehicle' | 'pedestrian' | 'obstacle';
  /** Closing speed at impact, m/s. */
  impactSpeed: number;
  /** Id of the other vehicle/pedestrian/obstacle. */
  otherId: number | string;
  x: number;
  z: number;
}

export type PraiseKind =
  | 'full_stop'
  | 'good_signal'
  | 'good_observation'
  | 'smooth_stop'
  | 'yielded'
  | 'good_gap'
  | 'good_parking'
  | 'speed_control';

export interface SimEvents {
  fault: Fault;
  collision: CollisionEvent;
  /** Emitted whenever the active instruction changes. */
  instruction: Instruction;
  /** Short coaching toast. */
  coach: { text: string; tone: 'info' | 'good' | 'warn' };
  /** Positive reinforcement for doing something right. */
  praise: { kind: PraiseKind; text: string };
  /** A scenario step was completed. */
  step: { index: number; total: number; label: string };
  /** The scenario finished. */
  ended: { status: 'completed' | 'failed'; reason: string | null };
  /** A player command was applied (for sounds / HUD flashes). */
  command: PlayerCommand;
  /** The player sounded the horn (rising edge). */
  horn: {};
  /** A signalised junction changed state (for AI/render hooks). */
  signal: { nodeId: string };
  /**
   * An AI vehicle had to brake firmly (≥ ~3 m/s²). `forPlayer` is true when the
   * player's car was the obstacle it reacted to. Used by the rule monitor as
   * supporting evidence for right-of-way faults.
   */
  aiBrake: { vehicleId: number; decel: number; forPlayer: boolean };
}

export interface EventBus<E> {
  on<K extends keyof E>(type: K, handler: (payload: E[K]) => void): () => void;
  emit<K extends keyof E>(type: K, payload: E[K]): void;
  clear(): void;
}

/** Everything the simulation subsystems share. Mutated in place every tick. */
export interface SimContext {
  /** Simulation time in seconds since the session started. */
  time: number;
  /** Tick counter. */
  frame: number;
  profile: JurisdictionProfile;
  settings: SessionSettings;
  network: RoadNetwork;
  signals: SignalSystem;
  env: EnvironmentState;
  player: PlayerCar;
  /** Every non-player vehicle: AI traffic and parked cars. */
  vehicles: SimVehicle[];
  pedestrians: SimPedestrian[];
  obstacles: StaticObstacle[];
  rng: Rng;
  events: EventBus<SimEvents>;
}

/* ========================================================================== */
/* Results & progress                                                         */
/* ========================================================================== */

export interface SessionResult {
  scenarioId: string;
  scenarioTitle: string;
  category: ScenarioCategory;
  jurisdictionId: string;
  feedback: 'coach' | 'exam';
  /** Epoch milliseconds when the session finished (stamped by the app, not the sim). */
  finishedAt: number;
  durationS: number;
  distanceM: number;
  /** 'passed'/'failed' for tests and assessed scenarios; 'completed' for free drive; 'aborted' when the user quit. */
  outcome: 'passed' | 'failed' | 'completed' | 'aborted';
  endReason: string | null;
  faults: Fault[];
  score: ScoreSummary;
  stars: 0 | 1 | 2 | 3;
  /** Down-sampled trace of the drive for the review map. */
  path: { x: number; z: number; t: number }[];
  praise: Partial<Record<PraiseKind, number>>;
}

export interface TheoryResult {
  jurisdictionId: string;
  finishedAt: number;
  total: number;
  correct: number;
  passed: boolean;
  /** Per-category { correct, total }. */
  byCategory: Record<string, { correct: number; total: number }>;
}

export interface ProgressData {
  version: 1;
  /** Best result per `${jurisdictionId}/${scenarioId}`. */
  best: Record<string, { stars: number; outcome: string; faults: number; at: number }>;
  /** Most recent sessions, newest first (capped). */
  history: Pick<
    SessionResult,
    'scenarioId' | 'scenarioTitle' | 'category' | 'jurisdictionId' | 'finishedAt' | 'outcome' | 'stars' | 'durationS'
  >[];
  /** Count of faults by code across all sessions, for "things to work on". */
  faultCounts: Partial<Record<FaultCode, number>>;
  theory: TheoryResult[];
  /** Ids of theory questions answered wrongly and not yet answered correctly since (for "review my mistakes"). */
  theoryMissed?: string[];
  /** Totals for fun stats. */
  totals: { sessions: number; distanceM: number; timeS: number };
}
