/** Decimated record of a shot: current, speed and position against time. */
export interface ShotTrace {
  readonly t_s: number[];
  readonly I_A: number[];
  readonly v_m_s: number[];
  readonly x_m: number[];
}

/**
 * Keeps at most `maxPoints` samples. When the buffer fills, every second sample is dropped
 * and the sampling stride doubles, so memory is bounded however many steps the solver takes.
 */
export class TraceRecorder {
  private readonly cap: number;
  private readonly t: Float64Array;
  private readonly i: Float64Array;
  private readonly v: Float64Array;
  private readonly x: Float64Array;
  private n = 0;
  private stride = 1;
  private counter = 0;

  constructor(maxPoints: number) {
    this.cap = Math.max(4, maxPoints - (maxPoints % 2));
    this.t = new Float64Array(this.cap);
    this.i = new Float64Array(this.cap);
    this.v = new Float64Array(this.cap);
    this.x = new Float64Array(this.cap);
  }

  push(t_s: number, I_A: number, v_m_s: number, x_m: number): void {
    if (this.counter++ % this.stride !== 0) return;
    this.store(t_s, I_A, v_m_s, x_m);
  }

  /** Always records this sample (the final state of the shot). */
  finish(t_s: number, I_A: number, v_m_s: number, x_m: number): ShotTrace {
    if (this.n > 0 && this.t[this.n - 1] === t_s) this.n -= 1;
    this.store(t_s, I_A, v_m_s, x_m);
    return {
      t_s: Array.from(this.t.subarray(0, this.n)),
      I_A: Array.from(this.i.subarray(0, this.n)),
      v_m_s: Array.from(this.v.subarray(0, this.n)),
      x_m: Array.from(this.x.subarray(0, this.n)),
    };
  }

  private store(t_s: number, I_A: number, v_m_s: number, x_m: number): void {
    if (this.n === this.cap) this.compact();
    this.t[this.n] = t_s;
    this.i[this.n] = I_A;
    this.v[this.n] = v_m_s;
    this.x[this.n] = x_m;
    this.n++;
  }

  private compact(): void {
    const half = this.cap / 2;
    for (let k = 0; k < half; k++) {
      this.t[k] = this.t[2 * k];
      this.i[k] = this.i[2 * k];
      this.v[k] = this.v[2 * k];
      this.x[k] = this.x[2 * k];
    }
    this.n = half;
    this.stride *= 2;
  }
}
