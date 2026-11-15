/**
 * Geometry choices that are private to the world module (metres unless noted).
 * Dimensions shared with other modules live in `src/core/constants.ts`.
 */

/** Gap between the edge of the crossing carriageway and the near edge of a junction crosswalk. */
export const CROSSWALK_GAP = 0.5;

/**
 * Room left for the kerb to curve round the corner at junctions WITHOUT marked
 * crosswalks, so that a kerb-side turn has a drivable radius.
 */
export const KERB_CORNER_ALLOWANCE = 4.8;

/** Distance from the end of that kerb curve to the stop/give-way line at junctions without crosswalks. */
export const UNMARKED_LINE_GAP = 1.0;

/** Setback used where a node has no crossing road at all (a straight continuation). */
export const MIN_SETBACK = 3;

/** Parking strips end this far before each junction's stop line (the kerb builds out to the travel lane). */
export const PARKING_STRIP_CLEARANCE = 12;

/** Distance from the outer edge of a roundabout's circulating lane to the give-way line. */
export const ROUNDABOUT_YIELD_GAP = 1.5;

/** Vehicles stop this far before the near edge of a mid-block crossing. */
export const MIDBLOCK_STOP_GAP = 1.5;

/** Mid-block crossings must be at least this far from either end of the lanes that cross them. */
export const MIDBLOCK_MIN_CLEARANCE = 12;

/** Shortest lane (stop line to stop line) the builder accepts. */
export const MIN_LANE_LENGTH = 20;

/** Target distance between samples of a connector polyline. */
export const CONNECTOR_SPACING = 1;

/** Two connector paths conflict when their centre lines come within this distance. */
export const CONFLICT_DISTANCE = 1.2;

/** Paths that meet at less than this angle (radians) are merging rather than crossing. */
export const MERGE_ANGLE = (30 * Math.PI) / 180;

/** `locate()` reports the nearest connector inside a junction only when it is within this distance. */
export const CONNECTOR_SNAP_DISTANCE = 3;

/** Driveways flare out by this much on each side where they cross the sidewalk, so cars can turn in and out. */
export const DRIVEWAY_FLARE = 5.5;
