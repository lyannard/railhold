import { Flight, G0, flightParamsFor, simulateCoilgun, simulateRailgun } from '@railhold/physics';
import { flightAtRange } from '../src/index.ts';

export { flightParamsFor, simulateCoilgun, simulateRailgun };

/** Vacuum flight (no drag): drop below the launch line at a given range and the time taken. */
export function flightAtRangeSelfCheck(v0: number, range: number): { drop: number; time: number } {
  const params = { mass_kg: 1, frontalArea_m2: 1e-4, gravity_m_s2: G0, cdOverride: 0 };
  const f = flightAtRange(params, v0, 0, range, 10);
  void Flight;
  return { drop: 10 - f.height_m, time: f.time_s };
}
