/**
 * Every tunable number of the physics package lives here.
 * Changing a value changes results, so bump `physicsVersion` in index.ts when you do.
 */
export const PHYSICS_CONFIG = {
  /** Largest railgun time step, s (brief section 4.3). */
  RAIL_DT_MAX_S: 1e-6,
  /** Largest coilgun time step, s. The brief gives no coilgun cap; see docs/PHYSICS.md. */
  COIL_DT_MAX_S: 1e-5,
  /** Railgun steps per characteristic time (brief section 4.3). */
  STEPS_PER_CHAR_TIME: 500,
  /**
   * Coilgun steps per characteristic time. The brief fixes 500 for the railgun only; the coil
   * winding time constant L/R is resolved with 100 steps here, which keeps RK4 error far below
   * the 0.01 % convergence requirement (verified in test/convergence.test.ts).
   */
  COIL_STEPS_PER_CHAR_TIME: 100,
  /** Hard cap on steps per shot (brief section 4.3). */
  MAX_STEPS: 400_000,
  /** Shots longer than this end as FIZZLE, s (brief section 4.3). */
  MAX_SHOT_TIME_S: 0.05,
  /** Earliest time at which a FIZZLE can be declared, s. */
  FIZZLE_MIN_TIME_S: 1e-4,
  /** FIZZLE when total current falls below this fraction of the peak. */
  FIZZLE_CURRENT_FRACTION: 1e-3,
  /** FIZZLE needs speed below this, m/s. */
  FIZZLE_SPEED_M_S: 1,
  /** Largest number of points in a returned trace. */
  TRACE_MAX_POINTS: 600,
  /** Energy closure tolerance as a fraction of the initial bank energy (brief section 4.3). */
  CLOSURE_TOLERANCE: 1e-3,
  /** Currents at or below this are treated as zero when a thyristor turns off, A. */
  CURRENT_ZERO_EPS_A: 1e-6,
  /** Shortest step the event splitter will take, s. */
  MIN_EVENT_STEP_S: 1e-13,
  /** Rails count as damaged above this fraction of the melting point (brief section 4.3). */
  RAIL_SOFTENING_FRACTION: 0.6,
  /** Smallest d/GMR the rail inductance model accepts (brief section 4.3). */
  MIN_RAIL_SPACING_RATIO: 1.5,
  /** Geometric-mean-radius factor for a rectangular conductor (brief section 4.3). */
  RECT_GMR_FACTOR: 0.2235,
  /** Coil insulation temperature limit, K (brief section 4.4). */
  COIL_INSULATION_LIMIT_K: 420,
  /** Winding pitch as a multiple of the bare wire diameter (enamel plus packing gap). */
  WIRE_PITCH_FACTOR: 1.05,
  /** Corner smoothing radius of the slug-coil overlap, as a fraction of the shorter length. */
  OVERLAP_SMOOTHING_FRACTION: 0.1,
  /** Smallest centre spacing of coil stages, in coil outer diameters (brief section 4.4). */
  MIN_STAGE_SPACING_DIAMETERS: 1,
  /** Maximum number of parallel railgun capacitor modules. */
  MAX_RAIL_MODULES: 4,
  /** Maximum number of coilgun stages. */
  MAX_COIL_STAGES: 10,
  /** Trigger jitter is clamped to this many standard deviations. */
  JITTER_CLAMP_SIGMAS: 3,
  /** Fixed external ballistics step, s (brief section 4.6). */
  FLIGHT_DT_S: 1 / 240,
  /** ISA troposphere ceiling used by the atmosphere model, m. */
  ISA_MAX_ALTITUDE_M: 11000,
  /** Default magnetic shape factor for eddy braking (brief section 4.7). */
  EDDY_KAPPA: 1.0,
  /** Rail bore wall cooling limit for firing, K (game rule, used by canFire). */
  LAUNCHER_FIRE_LIMIT_K: 400,
} as const;
