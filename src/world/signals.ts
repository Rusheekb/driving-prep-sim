import type { Compass, JurisdictionProfile, RoadNetwork, SignalColour, SignalSystem, WalkState } from '../core/types';
import { AXIS_OF } from './layout';

const AMBER = 3.5;
const ALL_RED = 1.5;
const GREEN_MAJOR = 16;
const GREEN_MINOR = 10;
const FLASH = 5;

type Axis = 'NS' | 'EW';

interface Plan {
  /** Green time for each axis. */
  green: Record<Axis, number>;
  cycle: number;
  offset: number;
}

interface AxisState {
  colour: SignalColour;
  /** Seconds until `colour` changes. */
  remaining: number;
  /** Seconds of green left on this axis (0 when not green). */
  greenLeft: number;
}

/**
 * Fixed-time two-phase signals: EW green → amber → all red → NS green → amber →
 * all red. Deterministic; nodes are staggered so the town is not synchronised.
 */
export function createSignalSystem(net: RoadNetwork, profile: Pick<JurisdictionProfile, 'rules'>): SignalSystem & { readonly time: number } {
  const redAmber = profile.rules.trafficLightSequence === 'red_redamber_green_amber';
  const plans = new Map<string, Plan>();
  let index = 0;
  for (const node of net.nodes.values()) {
    if (node.control !== 'signal') continue;
    const green: Record<Axis, number> = { NS: GREEN_MINOR, EW: GREEN_MINOR };
    for (const arm of Object.values(node.arms)) {
      if (net.roads.get(arm.roadId)!.speedClass === 'arterial') green[AXIS_OF[arm.dir]] = GREEN_MAJOR;
    }
    const cycle = green.EW + green.NS + 2 * (AMBER + ALL_RED);
    plans.set(node.id, { green, cycle, offset: (index * 7.3) % cycle });
    index++;
  }
  let time = 0;

  function axisState(plan: Plan, axis: Axis): AxisState {
    const other: Axis = axis === 'EW' ? 'NS' : 'EW';
    // Phase order: EW green, EW amber, all red, NS green, NS amber, all red.
    const startOfAxis = axis === 'EW' ? 0 : plan.green.EW + AMBER + ALL_RED;
    let t = (time + plan.offset - startOfAxis) % plan.cycle;
    if (t < 0) t += plan.cycle;
    const g = plan.green[axis];
    if (t < g) return { colour: 'green', remaining: g - t, greenLeft: g - t };
    if (t < g + AMBER) return { colour: 'amber', remaining: g + AMBER - t, greenLeft: 0 };
    // Red until the cycle wraps; the last ALL_RED seconds may show red+amber.
    const redEnd = plan.cycle;
    const redAmberStart = redEnd - ALL_RED;
    void other;
    if (redAmber && t >= redAmberStart) return { colour: 'red_amber', remaining: redEnd - t, greenLeft: 0 };
    return { colour: 'red', remaining: (redAmber ? redAmberStart : redEnd) - t, greenLeft: 0 };
  }

  return {
    get time() {
      return time;
    },
    update(dt: number): void {
      time += dt;
    },
    getState(nodeId: string, arm: Compass): SignalColour {
      const plan = plans.get(nodeId);
      return plan ? axisState(plan, AXIS_OF[arm]).colour : 'green';
    },
    timeToChange(nodeId: string, arm: Compass): number {
      const plan = plans.get(nodeId);
      return plan ? axisState(plan, AXIS_OF[arm]).remaining : Infinity;
    },
    getWalkState(crosswalkId: string): WalkState {
      const xw = net.crosswalks.get(crosswalkId);
      if (!xw || !xw.signalised || !xw.nodeId || !xw.arm) return 'walk';
      const plan = plans.get(xw.nodeId);
      if (!plan) return 'walk';
      // A crosswalk on arm X crosses the traffic of X's axis: walk while the OTHER axis has green.
      const crossed = AXIS_OF[xw.arm];
      const parallel = axisState(plan, crossed === 'EW' ? 'NS' : 'EW');
      if (parallel.colour !== 'green') return 'dont_walk';
      return parallel.greenLeft <= FLASH ? 'flashing' : 'walk';
    },
  };
}
