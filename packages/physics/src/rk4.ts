/** Right-hand side of dy/dt = f(t, y). Writes the derivative into `dydt`. */
export type Rhs = (t_s: number, y: Float64Array, dydt: Float64Array) => void;

/** Classical fourth-order Runge-Kutta with preallocated scratch space (no allocation per step). */
export class Rk4 {
  readonly n: number;
  private readonly k1: Float64Array;
  private readonly k2: Float64Array;
  private readonly k3: Float64Array;
  private readonly k4: Float64Array;
  private readonly tmp: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.k1 = new Float64Array(n);
    this.k2 = new Float64Array(n);
    this.k3 = new Float64Array(n);
    this.k4 = new Float64Array(n);
    this.tmp = new Float64Array(n);
  }

  /**
   * Advance `y` in place by one step of size `h_s` starting at `t_s`.
   * `k1Ready` may carry f(t, y) when the caller already evaluated it; it is not modified.
   */
  step(rhs: Rhs, t_s: number, y: Float64Array, h_s: number, k1Ready?: Float64Array): void {
    const { n, k2, k3, k4, tmp } = this;
    let k1 = this.k1;
    if (k1Ready) k1 = k1Ready;
    else rhs(t_s, y, k1);
    const h2 = 0.5 * h_s;
    for (let i = 0; i < n; i++) tmp[i] = y[i] + h2 * k1[i];
    rhs(t_s + h2, tmp, k2);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + h2 * k2[i];
    rhs(t_s + h2, tmp, k3);
    for (let i = 0; i < n; i++) tmp[i] = y[i] + h_s * k3[i];
    rhs(t_s + h_s, tmp, k4);
    const h6 = h_s / 6;
    for (let i = 0; i < n; i++) y[i] += h6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
}
