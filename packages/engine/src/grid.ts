import { GAME } from '@railhold/shared';

export interface GridInput {
  readonly players: number;
  readonly buffer_J: number;
  /** Charger power each launcher asks for, W (zero when it is full). */
  readonly demand_W: readonly number[];
  readonly dt_s: number;
}

export interface GridResult {
  readonly gen_W: number;
  readonly alloc_W: number[];
  readonly buffer_J: number;
  /** Power drawn from the buffer this step, W (negative when the buffer charged). */
  readonly bufferFlow_W: number;
  readonly brownout: boolean[];
}

/** Total generation of a team of `players`, W. */
export function generation_W(players: number): number {
  return GAME.GRID.P_GEN_BASE_W + GAME.GRID.P_GEN_PER_PLAYER_W * players;
}

/**
 * Max-min fair split of `supply_W` over the demands (water filling): nobody gets more than they
 * asked for, and the unspent share of the small demands goes to the larger ones.
 */
export function waterFill(supply_W: number, demand_W: readonly number[]): number[] {
  const out = new Array<number>(demand_W.length).fill(0);
  const order = demand_W.map((_d, i) => i).filter((i) => demand_W[i] > 0).sort((a, b) => demand_W[a] - demand_W[b]);
  let left = Math.max(0, supply_W);
  let n = order.length;
  for (const i of order) {
    const share = left / n;
    const give = Math.min(demand_W[i], share);
    out[i] = give;
    left -= give;
    n -= 1;
  }
  return out;
}

/**
 * One step of the shared power grid (brief section 5.1). Generators serve demand first. If
 * demand is larger, the buffer covers the shortfall up to its discharge limit. If generation is
 * left over it charges the buffer up to its capacity. Power is always conserved:
 * sum(alloc) = gen - charge into buffer + discharge from buffer.
 */
export function stepGrid(inp: GridInput): GridResult {
  const G = GAME.GRID;
  const gen_W = generation_W(inp.players);
  const total = inp.demand_W.reduce((a, b) => a + b, 0);
  let buffer_J = inp.buffer_J;
  let supply_W = gen_W;
  let bufferFlow_W = 0;
  if (total > gen_W) {
    const dis_W = Math.min(G.P_BUF_MAX_W, buffer_J / inp.dt_s, total - gen_W);
    supply_W += dis_W;
    buffer_J -= dis_W * inp.dt_s;
    bufferFlow_W = dis_W;
  } else {
    const chg_W = Math.min(G.P_BUF_MAX_W, gen_W - total, (G.E_BUF_J - buffer_J) / inp.dt_s);
    const c = Math.max(0, chg_W);
    buffer_J += c * inp.dt_s;
    supply_W -= c;
    bufferFlow_W = -c;
  }
  const alloc_W = waterFill(supply_W, inp.demand_W);
  const brownout = alloc_W.map((a, i) => inp.demand_W[i] > 0 && a < G.BROWNOUT_FRACTION * inp.demand_W[i]);
  return { gen_W, alloc_W, buffer_J: Math.min(G.E_BUF_J, Math.max(0, buffer_J)), bufferFlow_W, brownout };
}
