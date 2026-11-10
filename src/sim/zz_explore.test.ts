import { it } from 'vitest';
import { createVehicle, stepVehicle, kerbTurningCircle, VEHICLE_SPECS } from './vehicle';
import type { DriveCommand } from './vehicle';
import { steeringReach } from './playerCar';
import { makeTestContext, drivePlayer, READY_TO_DRIVE, NORTH } from './testUtil';

const cmd = (o: Partial<DriveCommand> = {}): DriveCommand => ({ throttle: 0, brake: 0, steer: 0, direction: 1, handbrake: false, creep: true, power: true, ...o });
const car = (speed = 0) => createVehicle({ id: 1, kind: 'ai', model: 'hatchback', pose: { x: 0, z: 0, heading: Math.PI }, colour: 0, speed });

it('explore', () => {
  for (const dt of [1 / 60, 1 / 20]) {
    let v = car();
    let t = 0;
    while (v.speed < 50 / 3.6) { stepVehicle(v, cmd({ throttle: 1 }), dt); t += dt; }
    console.log('dt', dt.toFixed(4), '0-50', t.toFixed(2));
    while (v.speed < 100 / 3.6) { stepVehicle(v, cmd({ throttle: 1 }), dt); t += dt; }
    console.log('0-100', t.toFixed(2));
    for (const grip of [1, 0.7]) {
      v = car(50 / 3.6);
      const z0 = v.z;
      let n = 0;
      while (v.speed !== 0 && n++ < 10000) stepVehicle(v, cmd({ brake: 1 }), dt, grip);
      console.log('grip', grip, 'stop dist', (z0 - v.z).toFixed(2), 'time', (n * dt).toFixed(2));
    }
    v = car();
    for (let i = 0; i < 10 / dt; i++) stepVehicle(v, cmd(), dt);
    console.log('creep', v.speed.toFixed(3));
    v = car();
    for (let i = 0; i < 20 / dt; i++) stepVehicle(v, cmd({ throttle: 1, direction: -1 }), dt);
    console.log('reverse', v.speed.toFixed(3));
    v = car();
    for (let i = 0; i < 60 / dt; i++) stepVehicle(v, cmd({ throttle: 1, handbrake: true }), dt);
    console.log('handbrake full throttle', v.speed.toFixed(3));
    v = car();
    for (let i = 0; i < 120 / dt; i++) stepVehicle(v, cmd({ throttle: 1 }), dt);
    console.log('top', v.speed.toFixed(3));
    v = car(50/3.6);
    for (let i = 0; i < 1 / dt; i++) stepVehicle(v, cmd(), dt);
    console.log('coast 1s from 13.89 ->', v.speed.toFixed(3));
  }
  for (const m of Object.keys(VEHICLE_SPECS) as (keyof typeof VEHICLE_SPECS)[]) console.log(m, kerbTurningCircle(VEHICLE_SPECS[m]).toFixed(2));
  for (const s of [0, 3, 5, 6, 8, 10, 13.9, 20, 30]) console.log('reach', s, (steeringReach(VEHICLE_SPECS.hatchback, s) / 0.61).toFixed(3));
  // 90 degree turn
  const ctx = makeTestContext({ player: READY_TO_DRIVE });
  ctx.player.vehicle.speed = 5;
  drivePlayer(ctx, 1, { throttle: 0.12 }, [{ type: 'indicator', value: 'right' }]);
  let ticks = 0;
  while (ctx.player.vehicle.heading > Math.PI / 2 + 0.2 && ticks++ < 2000) drivePlayer(ctx, 1 / 60, { throttle: 0.12, steer: 1 });
  console.log('turn took', ticks / 60, 'speed', ctx.player.vehicle.speed.toFixed(2), 'ind', ctx.player.indicator, 'heading', ctx.player.vehicle.heading.toFixed(2), 'steer', ctx.player.vehicle.steer.toFixed(2));
  let t2 = 0;
  while (ctx.player.indicator !== 'off' && t2++ < 600) drivePlayer(ctx, 1 / 60, { throttle: 0.12 });
  console.log('cancel after', t2 / 60, 'heading', ctx.player.vehicle.heading.toFixed(2), 'x', ctx.player.vehicle.x.toFixed(1), 'z', ctx.player.vehicle.z.toFixed(1));
  // lane change at 13 m/s
  const c2 = makeTestContext({ player: READY_TO_DRIVE });
  c2.player.vehicle.speed = 13;
  drivePlayer(c2, 0.5, { throttle: 0.25 }, [{ type: 'indicator', value: 'left' }]);
  drivePlayer(c2, 0.35, { throttle: 0.25, steer: -1 });
  console.log('after steer: heading', ((c2.player.vehicle.heading - NORTH) * 180 / Math.PI).toFixed(2), 'wheel', (c2.player.vehicle.steer / 0.61).toFixed(3));
  drivePlayer(c2, 2.2, { throttle: 0.25 });
  drivePlayer(c2, 0.35, { throttle: 0.25, steer: 1 });
  drivePlayer(c2, 1.0, { throttle: 0.25 });
  console.log('lane change: x', c2.player.vehicle.x.toFixed(2), 'heading', ((c2.player.vehicle.heading - NORTH) * 180 / Math.PI).toFixed(2), 'ind', c2.player.indicator, 'speed', c2.player.vehicle.speed.toFixed(2));
});
