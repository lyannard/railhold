/** Helpers shared by the railgun and coilgun solvers. */

/**
 * Tracks the maximum of a sampled signal and refines it with a parabola through the three
 * samples around a local maximum (the step sizes may be unequal).
 */
export class PeakTracker {
  peak = 0;
  peakT = 0;
  private n = 0;
  private t0 = 0;
  private i0 = 0;
  private t1 = 0;
  private i1 = 0;

  add(t: number, I: number): void {
    if (this.n >= 2 && this.i1 > this.i0 && this.i1 >= I) this.refine(t, I);
    if (I > this.peak) {
      this.peak = I;
      this.peakT = t;
    }
    this.t0 = this.t1;
    this.i0 = this.i1;
    this.t1 = t;
    this.i1 = I;
    this.n++;
  }

  private refine(t2: number, i2: number): void {
    const u0 = this.t0 - this.t1;
    const u2 = t2 - this.t1;
    const dy0 = this.i0 - this.i1;
    const dy2 = i2 - this.i1;
    const det = u0 * u2 * (u0 - u2);
    if (det === 0) return;
    const a = (dy0 * u2 - dy2 * u0) / det;
    const b = (dy2 * u0 * u0 - dy0 * u2 * u2) / det;
    if (!(a < 0)) return;
    const uStar = -b / (2 * a);
    if (uStar < u0 || uStar > u2) return;
    const iStar = this.i1 - (b * b) / (4 * a);
    if (iStar > this.peak) {
      this.peak = iStar;
      this.peakT = this.t1 + uStar;
    }
  }
}

/**
 * True when every element is a finite number. A NaN or an infinity anywhere makes the sum
 * non-finite, so one pass and one test replace a per-element check in the solver hot loop.
 */
export function allFinite(y: Float64Array): boolean {
  let sum = 0;
  for (let i = 0; i < y.length; i++) sum += y[i];
  return Number.isFinite(sum);
}

/** Normalized gap between the ledger sum and the initial energy. */
export function closureResidual(sum_J: number, E0_J: number): number {
  return E0_J > 0 ? Math.abs(sum_J - E0_J) / E0_J : 0;
}
