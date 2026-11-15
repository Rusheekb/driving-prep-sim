import { describe, expect, it } from 'vitest';
import { PLAYER_SPEC } from '../core/constants';
import { angleDiff, forwardOf, rightOf } from '../core/math';
import type { SimVehicle, Vec2, VehicleModel } from '../core/types';
import { KMH_TO_MPS } from '../core/units';
import {
  CREEP_SPEED,
  GRAVITY,
  MAX_LATERAL_G,
  VEHICLE_SPECS,
  createVehicle,
  gripLimitedSteer,
  kerbTurningCircle,
  stepVehicle,
  turningRadius,
  vehicleObb,
} from './vehicle';
import type { DriveCommand } from './vehicle';

const DT = 1 / 60;
const NORTH = Math.PI;
const EAST = Math.PI / 2;
const KMH_50 = 50 * KMH_TO_MPS;

/** A command for an automatic in Drive with the engine running and nothing pressed. */
const cmd = (overrides: Partial<DriveCommand> = {}): DriveCommand => ({
  throttle: 0,
  brake: 0,
  steer: 0,
  direction: 1,
  handbrake: false,
  creep: true,
  power: true,
  ...overrides,
});

const car = (speed = 0, model: VehicleModel = 'hatchback'): SimVehicle =>
  createVehicle({ id: 1, kind: 'ai', model, pose: { x: 0, z: 0, heading: NORTH }, colour: 0x336699, speed });

function run(v: SimVehicle, command: DriveCommand, seconds: number, dt = DT, grip = 1): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) stepVehicle(v, command, dt, grip);
}

/** Step until the car is at rest; returns the distance covered and the time taken. */
function stop(v: SimVehicle, command: DriveCommand, dt = DT, grip = 1): { distance: number; time: number } {
  const from = { x: v.x, z: v.z };
  let steps = 0;
  while (v.speed !== 0 && steps < 100_000) {
    stepVehicle(v, command, dt, grip);
    steps++;
  }
  return { distance: Math.hypot(v.x - from.x, v.z - from.z), time: steps * dt };
}

const rearAxle = (v: SimVehicle): Vec2 => {
  const f = forwardOf(v.heading);
  return { x: v.x - (f.x * v.spec.wheelbase) / 2, z: v.z - (f.z * v.spec.wheelbase) / 2 };
};

describe('VEHICLE_SPECS', () => {
  it("uses the shared player spec for the learner's hatchback", () => {
    expect(VEHICLE_SPECS.hatchback).toEqual(PLAYER_SPEC);
  });

  it('describes believable vehicles', () => {
    for (const [model, spec] of Object.entries(VEHICLE_SPECS)) {
      expect(spec.width, model).toBeGreaterThan(1.5);
      expect(spec.width, model).toBeLessThan(2.6);
      expect(spec.length, model).toBeGreaterThan(spec.width * 2);
      expect(spec.wheelbase, model).toBeGreaterThan(spec.length * 0.45);
      expect(spec.wheelbase, model).toBeLessThan(spec.length * 0.7);
      expect(spec.maxSteer, model).toBeGreaterThan(0.5);
      expect(spec.maxSteer, model).toBeLessThan(0.85);
      expect(spec.maxAccel, model).toBeGreaterThan(1);
      expect(spec.maxBrake, model).toBeGreaterThan(spec.maxAccel);
      expect(spec.maxBrake, model).toBeLessThan(GRAVITY);
      expect(spec.maxSpeed, model).toBeGreaterThan(25);
      expect(spec.maxReverseSpeed, model).toBeGreaterThan(2);
      expect(spec.maxReverseSpeed, model).toBeLessThan(spec.maxSpeed);
    }
  });

  it('gives bigger vehicles bigger turning circles', () => {
    const circle = (m: VehicleModel): number => kerbTurningCircle(VEHICLE_SPECS[m]);
    expect(circle('hatchback')).toBeLessThan(circle('sedan'));
    expect(circle('sedan')).toBeLessThan(circle('van'));
    expect(circle('van')).toBeLessThan(circle('bus'));
    expect(circle('bus')).toBeLessThan(22);
  });

  it('keeps every car-sized model inside a standard parking bay', () => {
    for (const model of ['hatchback', 'sedan', 'suv', 'van', 'pickup'] as const) {
      expect(VEHICLE_SPECS[model].length, model).toBeLessThanOrEqual(5.2);
      expect(VEHICLE_SPECS[model].width, model).toBeLessThanOrEqual(2.0);
    }
  });
});

describe('createVehicle', () => {
  it('builds a vehicle at the pose with neutral state', () => {
    const v = createVehicle({
      id: 7,
      kind: 'ai',
      model: 'sedan',
      pose: { x: 12, z: -4, heading: EAST },
      colour: 0xff0000,
      speed: 9,
    });
    expect(v).toMatchObject({
      id: 7,
      kind: 'ai',
      model: 'sedan',
      colour: 0xff0000,
      x: 12,
      z: -4,
      heading: EAST,
      speed: 9,
      accel: 0,
      steer: 0,
      indicator: 'off',
      braking: false,
      reversing: false,
      headlights: false,
      nav: null,
    });
    expect(v.spec).toBe(VEHICLE_SPECS.sedan);
  });

  it('defaults to standing still and never gives a parked car speed', () => {
    const pose = { x: 0, z: 0, heading: 0 };
    expect(createVehicle({ id: 1, kind: 'ai', model: 'suv', pose, colour: 0 }).speed).toBe(0);
    expect(createVehicle({ id: 2, kind: 'parked', model: 'suv', pose, colour: 0, speed: 5 }).speed).toBe(0);
  });

  it('normalises the heading', () => {
    const v = createVehicle({ id: 1, kind: 'ai', model: 'van', pose: { x: 0, z: 0, heading: 3 * Math.PI }, colour: 0 });
    expect(v.heading).toBeCloseTo(Math.PI, 12);
  });
});

describe('vehicleObb', () => {
  it('is the footprint centred on the vehicle, grown by the margin', () => {
    const v = car();
    v.x = 3;
    v.z = -8;
    v.heading = 0.4;
    expect(vehicleObb(v)).toEqual({ x: 3, z: -8, heading: 0.4, halfLength: 2.1, halfWidth: 0.9 });
    const grown = vehicleObb(v, 0.5);
    expect(grown.halfLength).toBeCloseTo(2.6, 12);
    expect(grown.halfWidth).toBeCloseTo(1.4, 12);
  });
});

describe('stepVehicle — acceleration', () => {
  it('reaches 50 km/h from rest in 5–7 s at full throttle', () => {
    const v = car();
    let t = 0;
    while (v.speed < KMH_50 && t < 30) {
      stepVehicle(v, cmd({ throttle: 1 }), DT);
      t += DT;
    }
    expect(t).toBeGreaterThan(5);
    expect(t).toBeLessThan(7);
  });

  it('pulls hardest from rest and tapers toward top speed', () => {
    const slow = car(2);
    const fast = car(30);
    run(slow, cmd({ throttle: 1 }), 1);
    run(fast, cmd({ throttle: 1 }), 1);
    expect(slow.speed - 2).toBeGreaterThan(2.5);
    expect(fast.speed - 30).toBeLessThan(1.2);
    expect(fast.speed - 30).toBeGreaterThan(0.5);
  });

  it('approaches but never exceeds top speed', () => {
    const v = car();
    let fastest = 0;
    for (let i = 0; i < 150 / DT; i++) {
      stepVehicle(v, cmd({ throttle: 1 }), DT);
      fastest = Math.max(fastest, v.speed);
    }
    expect(fastest).toBeLessThanOrEqual(PLAYER_SPEC.maxSpeed);
    expect(v.speed).toBeGreaterThan(PLAYER_SPEC.maxSpeed * 0.98);
  });

  it('more throttle means a higher cruising speed', () => {
    const cruise = (throttle: number): number => {
      const v = car();
      run(v, cmd({ throttle }), 200);
      return v.speed;
    };
    const quarter = cruise(0.25);
    const half = cruise(0.5);
    expect(quarter).toBeGreaterThan(8);
    expect(quarter).toBeLessThan(20);
    expect(half).toBeGreaterThan(quarter + 5);
    expect(half).toBeLessThan(PLAYER_SPEC.maxSpeed);
  });

  it('moves the car along its heading', () => {
    const v = car();
    run(v, cmd({ throttle: 1 }), 2);
    expect(v.z).toBeLessThan(-3); // north is −Z
    expect(v.x).toBeCloseTo(0, 9);
    expect(v.heading).toBe(NORTH);
    expect(v.accel).toBeGreaterThan(2);
  });

  it('does nothing with the engine off or in neutral', () => {
    for (const command of [cmd({ throttle: 1, power: false }), cmd({ throttle: 1, direction: 0 })]) {
      const v = car();
      run(v, command, 3);
      expect(v.speed).toBe(0);
      expect(v.z).toBe(0);
    }
  });
});

describe('stepVehicle — coasting and creep', () => {
  it('creeps to walking pace in gear with no pedals, like an automatic', () => {
    const v = car();
    run(v, cmd(), 1);
    expect(v.speed).toBeGreaterThan(0.3);
    expect(v.speed).toBeLessThan(CREEP_SPEED);
    run(v, cmd(), 9);
    expect(v.speed).toBeGreaterThan(1.5);
    expect(v.speed).toBeLessThan(1.7);
    expect(v.speed).toBeCloseTo(CREEP_SPEED, 1);
  });

  it('creeps backwards in reverse', () => {
    const v = car();
    run(v, cmd({ direction: -1 }), 10);
    expect(v.speed).toBeCloseTo(-CREEP_SPEED, 1);
    expect(v.z).toBeGreaterThan(5); // facing north, so backwards is +Z
  });

  it('stays put without creep, in neutral or with the engine off', () => {
    for (const command of [cmd({ creep: false }), cmd({ direction: 0 }), cmd({ power: false })]) {
      const v = car();
      run(v, command, 5);
      expect(v.speed).toBe(0);
      expect(v.z).toBe(0);
    }
  });

  it('loses speed gently when coasting in gear', () => {
    const v = car(KMH_50);
    run(v, cmd(), 1);
    const lost = KMH_50 - v.speed;
    expect(lost).toBeGreaterThan(0.3);
    expect(lost).toBeLessThan(1.0);
  });

  it('settles back to creep speed from above without undershooting', () => {
    const v = car(6);
    let slowest = Infinity;
    for (let i = 0; i < 40 / DT; i++) {
      stepVehicle(v, cmd(), DT);
      slowest = Math.min(slowest, v.speed);
    }
    expect(v.speed).toBeCloseTo(CREEP_SPEED, 1);
    expect(slowest).toBeGreaterThan(CREEP_SPEED - 0.05);
  });

  it('rolls to a complete stop in neutral and stays there', () => {
    const v = car(3);
    const { time } = stop(v, cmd({ direction: 0 }));
    expect(time).toBeGreaterThan(10);
    expect(time).toBeLessThan(40);
    const rest = { x: v.x, z: v.z };
    run(v, cmd({ direction: 0 }), 2);
    expect(v.speed).toBe(0);
    expect({ x: v.x, z: v.z }).toEqual(rest);
  });

  it('coasts less freely in gear than in neutral', () => {
    const inGear = car(KMH_50);
    const neutral = car(KMH_50);
    run(inGear, cmd({ creep: false }), 3);
    run(neutral, cmd({ direction: 0 }), 3);
    expect(inGear.speed).toBeLessThan(neutral.speed);
  });
});

describe('stepVehicle — braking', () => {
  it('stops from 50 km/h in about 12–14 m on a dry road', () => {
    const v = car(KMH_50);
    const { distance, time } = stop(v, cmd({ brake: 1 }));
    expect(distance).toBeGreaterThan(12);
    expect(distance).toBeLessThan(14);
    expect(time).toBeGreaterThan(1.4);
    expect(time).toBeLessThan(2.2);
  });

  it('takes clearly longer to stop when grip is reduced', () => {
    const dry = stop(car(KMH_50), cmd({ brake: 1 }), DT, 1).distance;
    const wet = stop(car(KMH_50), cmd({ brake: 1 }), DT, 0.7).distance;
    expect(wet).toBeGreaterThan(dry * 1.2);
    expect(wet).toBeLessThan(dry * 1.6);
  });

  it('brakes in proportion to pedal pressure', () => {
    const gentle = stop(car(KMH_50), cmd({ brake: 0.3 })).distance;
    const firm = stop(car(KMH_50), cmd({ brake: 1 })).distance;
    expect(gentle).toBeGreaterThan(firm * 2);
  });

  it('stops exactly at zero without ever going backwards, and stays stopped', () => {
    const v = car(KMH_50);
    let previous = v.speed;
    let previousZ = v.z;
    for (let i = 0; i < 5 / DT; i++) {
      stepVehicle(v, cmd({ brake: 1 }), DT);
      expect(v.speed).toBeGreaterThanOrEqual(0);
      expect(v.speed).toBeLessThanOrEqual(previous);
      expect(v.z).toBeLessThanOrEqual(previousZ); // never rolls back south
      previous = v.speed;
      previousZ = v.z;
    }
    expect(v.speed).toBe(0);
    expect(v.accel).toBe(0);
    const rest = { x: v.x, z: v.z, heading: v.heading };
    run(v, cmd({ brake: 1 }), 3);
    expect(v.speed).toBe(0);
    expect({ x: v.x, z: v.z, heading: v.heading }).toEqual(rest);
  });

  it('stops exactly from reverse as well', () => {
    const v = car(-4);
    let previous = v.speed;
    for (let i = 0; i < 3 / DT; i++) {
      stepVehicle(v, cmd({ direction: -1, brake: 1 }), DT);
      expect(v.speed).toBeLessThanOrEqual(0);
      expect(v.speed).toBeGreaterThanOrEqual(previous);
      previous = v.speed;
    }
    expect(v.speed).toBe(0);
  });

  it('holds the car against creep while the brake is on and lets it go when released', () => {
    const v = car(KMH_50);
    stop(v, cmd({ brake: 0.6 }));
    const rest = v.z;
    run(v, cmd({ brake: 0.3 }), 2);
    expect(v.speed).toBe(0);
    expect(v.z).toBe(rest);
    run(v, cmd(), 6);
    expect(v.speed).toBeGreaterThan(1.4);
    expect(v.z).toBeLessThan(rest - 3);
  });

  it('lets a feathered brake slow the creep without stopping it', () => {
    const v = car();
    run(v, cmd({ brake: 0.05 }), 10);
    expect(v.speed).toBeGreaterThan(0.8);
    expect(v.speed).toBeLessThan(CREEP_SPEED - 0.1);
  });

  it('cannot be driven through the brakes', () => {
    const v = car();
    run(v, cmd({ throttle: 1, brake: 1 }), 3);
    expect(v.speed).toBe(0);
    expect(v.z).toBe(0);
  });

  it('builds braking force progressively rather than instantly', () => {
    const v = car(KMH_50);
    stepVehicle(v, cmd({ brake: 1 }), DT);
    expect(v.accel).toBeLessThan(0);
    expect(v.accel).toBeGreaterThan(-1.5);
    run(v, cmd({ brake: 1 }), 0.5);
    expect(v.accel).toBeLessThan(-8);
    expect(v.accel).toBeGreaterThan(-GRAVITY);
  });
});

describe('stepVehicle — reverse', () => {
  it('drives backwards and is limited to the reverse top speed', () => {
    const v = car();
    let fastest = 0;
    for (let i = 0; i < 30 / DT; i++) {
      stepVehicle(v, cmd({ direction: -1, throttle: 1 }), DT);
      fastest = Math.min(fastest, v.speed);
    }
    expect(fastest).toBeGreaterThanOrEqual(-PLAYER_SPEC.maxReverseSpeed);
    expect(v.speed).toBeLessThan(-PLAYER_SPEC.maxReverseSpeed * 0.95);
    expect(v.z).toBeGreaterThan(100);
    expect(v.x).toBeCloseTo(0, 9);
  });

  it('accelerates less briskly than in a forward gear', () => {
    const forward = car();
    const reverse = car();
    run(forward, cmd({ throttle: 1 }), 1);
    run(reverse, cmd({ direction: -1, throttle: 1 }), 1);
    expect(-reverse.speed).toBeLessThan(forward.speed);
    expect(-reverse.speed).toBeGreaterThan(1);
  });

  it('brings a car rolling forwards to rest before driving it backwards', () => {
    const v = car(0.4);
    const speeds: number[] = [];
    for (let i = 0; i < 2 / DT; i++) {
      stepVehicle(v, cmd({ direction: -1, throttle: 1 }), DT);
      speeds.push(v.speed);
    }
    expect(speeds).toContain(0);
    expect(v.speed).toBeLessThan(-1);
  });
});

describe('stepVehicle — parking brake', () => {
  it('holds the car against creep', () => {
    const v = car();
    run(v, cmd({ handbrake: true }), 5);
    expect(v.speed).toBe(0);
    expect(v.z).toBe(0);
  });

  it('holds the car against creep on a wet road too', () => {
    const v = car();
    run(v, cmd({ handbrake: true }), 5, DT, 0.7);
    expect(v.speed).toBe(0);
  });

  it('holds against moderate throttle but drags heavily if driven hard against', () => {
    const moderate = car();
    run(moderate, cmd({ handbrake: true, throttle: 0.5 }), 3);
    expect(moderate.speed).toBe(0);

    const dragging = car();
    const free = car();
    run(dragging, cmd({ handbrake: true, throttle: 1 }), 5);
    run(free, cmd({ throttle: 1 }), 5);
    expect(dragging.speed).toBeGreaterThan(0.5);
    expect(dragging.speed).toBeLessThan(free.speed * 0.4);
  });

  it('brings a rolling car to rest and keeps it there', () => {
    const v = car(8);
    const { time } = stop(v, cmd({ direction: 0, handbrake: true }));
    expect(time).toBeGreaterThan(2);
    expect(time).toBeLessThan(4.5);
    run(v, cmd({ direction: 0, handbrake: true }), 1);
    expect(v.speed).toBe(0);
  });

  it('adds nothing on top of a full emergency stop', () => {
    const footOnly = stop(car(KMH_50), cmd({ brake: 1 })).distance;
    const both = stop(car(KMH_50), cmd({ brake: 1, handbrake: true })).distance;
    expect(both).toBeCloseTo(footOnly, 6);
  });
});

describe('stepVehicle — steering', () => {
  it('turns right (toward the east) from north when steering right, decreasing the heading', () => {
    const v = car(3);
    run(v, cmd({ steer: 0.3 }), 1);
    expect(angleDiff(v.heading, NORTH)).toBeLessThan(-0.1);
    expect(v.x).toBeGreaterThan(0.1); // east is +X
    expect(v.z).toBeLessThan(0);
    expect(v.steer).toBeCloseTo(0.3, 12);

    // Keep turning until the car faces roughly east: it must now be travelling +X.
    while (Math.abs(angleDiff(v.heading, EAST)) > 0.05) stepVehicle(v, cmd({ steer: 0.3 }), DT);
    const x = v.x;
    run(v, cmd(), 1);
    expect(v.x - x).toBeGreaterThan(1);
  });

  it('turns left (toward the west) when steering left, increasing the heading', () => {
    const v = car(3);
    run(v, cmd({ steer: -0.3 }), 1);
    expect(angleDiff(v.heading, NORTH)).toBeGreaterThan(0.1);
    expect(v.x).toBeLessThan(-0.1);
  });

  it('mirrors exactly between left and right', () => {
    const right = car(4);
    const left = car(4);
    run(right, cmd({ steer: 0.4, throttle: 0.3 }), 3);
    run(left, cmd({ steer: -0.4, throttle: 0.3 }), 3);
    expect(left.x).toBeCloseTo(-right.x, 9);
    expect(left.z).toBeCloseTo(right.z, 9);
    expect(angleDiff(left.heading, NORTH)).toBeCloseTo(-angleDiff(right.heading, NORTH), 9);
  });

  it('swings the tail toward the steered side when reversing', () => {
    const v = car();
    run(v, cmd({ direction: -1, steer: 0.4 }), 4);
    expect(v.speed).toBeLessThan(0);
    expect(v.z).toBeGreaterThan(1); // moving backwards = south
    expect(v.x).toBeGreaterThan(0.2); // tail goes right (east)
    expect(angleDiff(v.heading, NORTH)).toBeGreaterThan(0.1); // nose swings left
  });

  it('does not turn while stationary but still moves the wheels', () => {
    const v = car();
    run(v, cmd({ steer: 0.5, brake: 1 }), 1);
    expect(v.heading).toBe(NORTH);
    expect(v.x).toBe(0);
    expect(v.steer).toBe(0.5);
  });

  it('clamps the wheel angle to full lock', () => {
    const v = car();
    stepVehicle(v, cmd({ steer: 5, brake: 1 }), DT);
    expect(v.steer).toBe(PLAYER_SPEC.maxSteer);
    stepVehicle(v, cmd({ steer: -5, brake: 1 }), DT);
    expect(v.steer).toBe(-PLAYER_SPEC.maxSteer);
  });

  it('has a kerb-to-kerb turning circle of about 10–11 m at full lock', () => {
    expect(kerbTurningCircle(PLAYER_SPEC)).toBeGreaterThan(10);
    expect(kerbTurningCircle(PLAYER_SPEC)).toBeLessThan(11);

    // Measure it: creep round a full circle on full right lock and track the
    // outer (left) front wheel.
    const v = car();
    const spec = v.spec;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < 25 / DT; i++) {
      stepVehicle(v, cmd({ steer: spec.maxSteer }), DT);
      const f = forwardOf(v.heading);
      const r = rightOf(v.heading);
      const wheelX = v.x + (f.x * spec.wheelbase) / 2 - (r.x * spec.width) / 2;
      const wheelZ = v.z + (f.z * spec.wheelbase) / 2 - (r.z * spec.width) / 2;
      minX = Math.min(minX, wheelX);
      maxX = Math.max(maxX, wheelX);
      minZ = Math.min(minZ, wheelZ);
      maxZ = Math.max(maxZ, wheelZ);
    }
    expect(maxX - minX).toBeCloseTo(kerbTurningCircle(spec), 1);
    expect(maxZ - minZ).toBeCloseTo(kerbTurningCircle(spec), 1);
    expect(maxX - minX).toBeGreaterThan(10);
    expect(maxX - minX).toBeLessThan(11);
  });

  it('pivots about the rear axle on a circle of radius wheelbase / tan(steer)', () => {
    const v = car();
    const steer = 0.45;
    const radius = turningRadius(v.spec, steer);
    expect(radius).toBeCloseTo(v.spec.wheelbase / Math.tan(steer), 12);
    // Turning right, the centre of the turn is `radius` to the right of the rear axle.
    const start = rearAxle(v);
    const r0 = rightOf(v.heading);
    const centre = { x: start.x + r0.x * radius, z: start.z + r0.z * radius };
    for (let i = 0; i < 20 / DT; i++) {
      stepVehicle(v, cmd({ steer }), DT);
      const axle = rearAxle(v);
      expect(Math.hypot(axle.x - centre.x, axle.z - centre.z)).toBeCloseTo(radius, 6);
    }
    expect(turningRadius(v.spec, 0)).toBe(Infinity);
  });

  it('understeers instead of cornering harder than the tyres allow', () => {
    for (const grip of [1, 0.7]) {
      const v = car(20);
      const limit = MAX_LATERAL_G * GRAVITY * grip;
      let peak = 0;
      for (let i = 0; i < 1 / DT; i++) {
        const before = v.heading;
        stepVehicle(v, cmd({ steer: v.spec.maxSteer, throttle: 0.4 }), DT, grip);
        const lateral = (Math.abs(angleDiff(v.heading, before)) / DT) * v.speed;
        peak = Math.max(peak, lateral);
      }
      expect(peak).toBeLessThanOrEqual(limit * 1.01);
      expect(peak).toBeGreaterThan(limit * 0.9); // …but it does use the grip available
      expect(v.steer).toBe(v.spec.maxSteer); // the wheels are still where the driver put them
    }
  });

  it('reports the largest useful wheel angle for a speed', () => {
    const spec = PLAYER_SPEC;
    expect(gripLimitedSteer(spec, 0)).toBe(spec.maxSteer);
    expect(gripLimitedSteer(spec, 3)).toBe(spec.maxSteer);
    const at15 = gripLimitedSteer(spec, 15);
    expect(at15).toBeLessThan(spec.maxSteer);
    expect((15 * 15 * Math.tan(at15)) / spec.wheelbase).toBeCloseTo(MAX_LATERAL_G * GRAVITY, 9);
    expect(gripLimitedSteer(spec, 15, 0.7)).toBeLessThan(at15);
    expect(gripLimitedSteer(spec, 30)).toBeLessThan(at15);
  });
});

describe('stepVehicle — robustness', () => {
  /** A little drive that exercises acceleration, steering, braking and reversing. */
  function drive(dt: number): SimVehicle {
    const v = car();
    run(v, cmd({ throttle: 1 }), 3, dt);
    run(v, cmd({ throttle: 0.4, steer: 0.2 }), 2, dt);
    run(v, cmd({ steer: -0.35 }), 2, dt);
    run(v, cmd({ brake: 0.7 }), 3, dt);
    run(v, cmd({ direction: -1, throttle: 0.6, steer: 0.5 }), 3, dt);
    return v;
  }

  it('gives nearly the same result at 20 Hz as at 60 Hz', () => {
    const fine = drive(1 / 60);
    const coarse = drive(1 / 20);
    expect(Math.hypot(coarse.x - fine.x, coarse.z - fine.z)).toBeLessThan(0.75);
    expect(Math.abs(angleDiff(coarse.heading, fine.heading))).toBeLessThan(0.05);
    expect(coarse.speed).toBeCloseTo(fine.speed, 1);
  });

  it('keeps key figures stable at 20 Hz', () => {
    const v = car(KMH_50);
    const { distance } = stop(v, cmd({ brake: 1 }), 1 / 20);
    expect(distance).toBeGreaterThan(12);
    expect(distance).toBeLessThan(14);

    const creeping = car();
    run(creeping, cmd(), 10, 1 / 20);
    expect(creeping.speed).toBeCloseTo(CREEP_SPEED, 1);
  });

  it('integrates an over-long step in sub-steps', () => {
    const big = car(5);
    const small = car(5);
    stepVehicle(big, cmd({ throttle: 0.8, steer: 0.3 }), 0.5);
    for (let i = 0; i < 10; i++) stepVehicle(small, cmd({ throttle: 0.8, steer: 0.3 }), 0.05);
    expect(big.x).toBeCloseTo(small.x, 9);
    expect(big.z).toBeCloseTo(small.z, 9);
    expect(big.heading).toBeCloseTo(small.heading, 9);
    expect(big.speed).toBeCloseTo(small.speed, 9);
  });

  it('ignores zero, negative and non-finite time steps', () => {
    for (const dt of [0, -0.1, NaN, Infinity]) {
      const v = car(5);
      stepVehicle(v, cmd({ throttle: 1, steer: 0.2 }), dt);
      expect(v).toMatchObject({ x: 0, z: 0, heading: NORTH, speed: 5 });
    }
  });

  it('treats nonsense pedal and steering values as released', () => {
    const v = car();
    run(v, cmd({ throttle: NaN, brake: NaN, steer: NaN }), 2);
    expect(Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.heading)).toBe(true);
    expect(v.steer).toBe(0);
    expect(v.speed).toBeGreaterThan(0); // simply creeping
    expect(v.speed).toBeLessThan(CREEP_SPEED);

    const pinned = car();
    run(pinned, cmd({ throttle: 7 }), 1);
    const reference = car();
    run(reference, cmd({ throttle: 1 }), 1);
    expect(pinned.speed).toBe(reference.speed);
  });

  it('is deterministic', () => {
    expect(drive(1 / 60)).toEqual(drive(1 / 60));
  });

  it('works for every model', () => {
    for (const model of Object.keys(VEHICLE_SPECS) as VehicleModel[]) {
      const v = car(0, model);
      run(v, cmd({ throttle: 1 }), 6);
      expect(v.speed, model).toBeGreaterThan(5);
      expect(v.speed, model).toBeLessThan(v.spec.maxSpeed);
      const { distance } = stop(v, cmd({ brake: 1 }));
      expect(distance, model).toBeGreaterThan(2);
      expect(distance, model).toBeLessThan(40);
    }
  });
});
