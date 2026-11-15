/** Every tunable game number lives here (brief: "record it in one config file"). */

export const PROTOCOL_VERSION = 1;

export const GAME = {
  /** Simulation tick rate, Hz. */
  TICK_HZ: 60,
  /** Snapshot rate sent to clients, Hz. */
  SNAPSHOT_HZ: 20,
  /** Largest simulation time consumed in one loop turn, s (prevents a spiral of death). */
  MAX_CATCHUP_S: 0.25,
  BUILD_PHASE_S: 90,
  /** Time after the build phase for banks to charge before enemies appear, s. */
  CHARGE_PHASE_S: 10,
  WAVES: 10,
  MAX_PLAYERS: 4,
  ROOM_CODE_LENGTH: 6,
  /** Seat is held for a dropped client this long, s. */
  RECONNECT_GRACE_S: 60,
  HEARTBEAT_INTERVAL_S: 10,
  HEARTBEAT_TIMEOUT_S: 30,
  /** Idle rooms (nobody connected) are removed after this long, s. */
  EMPTY_ROOM_TTL_S: 90,

  /** Base hit points. */
  BASE_HP: 1500,
  /** Enemies despawn on reaching this distance from the base, m. */
  BASE_CONTACT_RADIUS_M: 14,
  /** Distance of the spawn line from the base, m. */
  SPAWN_DISTANCE_M: 520,
  /** Spawn lane bearings, degrees from north (+z). */
  LANE_BEARINGS_DEG: [-34, -11, 11, 34],
  /** Launcher emplacement spacing along the east axis, m. */
  EMPLACEMENT_SPACING_M: 10,

  /** Shared grid (brief section 5.1). */
  GRID: {
    /** Generation that exists with no players, W. */
    P_GEN_BASE_W: 60_000,
    /** Extra generation per seated player, W. */
    P_GEN_PER_PLAYER_W: 30_000,
    /** Buffer storage, J, and its largest discharge rate, W. */
    E_BUF_J: 800_000,
    P_BUF_MAX_W: 120_000,
    /** Charger rating and efficiency of each launcher. */
    P_CHARGER_MAX_W: 80_000,
    ETA_CHARGE: 0.9,
    /** A launcher fires once every bank holds this fraction of its target voltage. */
    READY_VOLTAGE_FRACTION: 0.98,
    /** Allocations below this fraction of demand show the brownout indicator. */
    BROWNOUT_FRACTION: 0.999,
  },

  /** Lowest selectable charge target as a fraction of the blueprint voltage. */
  MIN_CHARGE_TARGET: 0.3,
  /** Fire-control: largest elevation the aim solution may use, rad. */
  MAX_ELEVATION_RAD: 0.6,
  /** Height of the aim point above ground when solving for a hit, m. */
  AIM_HEIGHT_M: 1,
  /** Emplacement muzzle height, m. */
  MUZZLE_HEIGHT_M: 1.6,
  /** Projectiles are removed after this flight time, s, or on reaching the ground. */
  MAX_FLIGHT_TIME_S: 12,
  /** Build-phase budget for a run, credits, and the extra amount granted per wave. */
  BUILD_BUDGET: 16_000,
  BUILD_BUDGET_PER_WAVE: 2_500,

  /** Jammer rule (brief section 3). */
  JAMMER: { PERIOD_S: 8, RANGE_M: 300, DURATION_S: 2 },
  /** Shield zone rule. */
  SHIELD: { RADIUS_M: 26, B_T: 1.2 },

  /** Credits: per wave cleared and for efficiency (brief section 3). */
  CREDITS: { PER_WAVE_BASE: 700, PER_WAVE_STEP: 120, EFFICIENCY_BONUS_MAX: 1500, CAMPAIGN_COMPLETE_BONUS: 5000 },
  /** Score weights. */
  SCORE: { PER_KILL_HP_J: 0.02, EFFICIENCY_WEIGHT: 4000, BASE_HP_WEIGHT: 3 },
  STARTING_CREDITS: 1500,
  /** Muzzle energy over grid energy drawn at which the efficiency bonus is full. */
  EFFICIENCY_REF: 0.2,
  /** Shortest time between two shots of one launcher, s. */
  FIRE_MIN_INTERVAL_S: 0.15,
  /** Time the debrief stays up before the next build phase starts by itself, s. */
  DEBRIEF_S: 30,
  /** Largest number of messages one player may send per second before the host drops them. */
  MSG_RATE_PER_S: 120,
  /** Shots kept per account in the logbook. */
  LOGBOOK_SHOTS: 50,
} as const;

export const RANGE = {
  /** Target boards, m. */
  BOARD_DISTANCES_M: [50, 100, 200, 400],
  BOARD_HALF_WIDTH_M: 2,
  BOARD_HEIGHT_M: 3,
  /** Launcher height above ground, m. */
  MUZZLE_HEIGHT_M: 1.6,
  /** Elevation range of the range emplacement, mrad. */
  ELEVATION_MRAD: { min: -20, max: 150 },
} as const;
