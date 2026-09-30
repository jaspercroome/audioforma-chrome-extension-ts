/**
 * Monophonic pitch tracking with YIN (de Cheveigné & Kawahara, 2002).
 *
 * On a full mix this fails, which is why the orb uses note bins instead. On a
 * separated stem (a horn, a voice, a bass line) it works well, and it gives
 * what bins can't: a continuous line with bends, slides and vibrato.
 */

export type PitchEstimate = {
  /** Fundamental frequency in Hz, or 0 when the frame is unpitched or silent. */
  hz: number;
  /** 0-1: how periodic the frame is (1 - YIN's aperiodicity at the chosen period). */
  confidence: number;
};

export const NO_PITCH: PitchEstimate = { hz: 0, confidence: 0 };

export type YinOptions = {
  minHz?: number;
  maxHz?: number;
  /** YIN's absolute threshold on the normalised difference. */
  threshold?: number;
  /** Frames quieter than this RMS are treated as silent. */
  silenceRms?: number;
};

export const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

export class YinDetector {
  private readonly decimation: number;
  private readonly rate: number;
  private readonly minHz: number;
  private readonly maxHz: number;
  private readonly threshold: number;
  private readonly silenceRms: number;
  private signal = new Float32Array(0);
  private diff = new Float32Array(0);

  constructor(sampleRate: number, options: YinOptions = {}) {
    this.minHz = options.minHz ?? 40;
    this.maxHz = options.maxHz ?? 1400;
    this.threshold = options.threshold ?? 0.15;
    this.silenceRms = options.silenceRms ?? 2e-3;
    // Work at ~22-24 kHz: plenty for fundamentals, and 4x less arithmetic.
    this.decimation = sampleRate >= 32000 ? 2 : 1;
    this.rate = sampleRate / this.decimation;
  }

  detect(frame: Float32Array): PitchEstimate {
    const d = this.decimation;
    const n = Math.floor(frame.length / d);
    if (this.signal.length !== n) this.signal = new Float32Array(n);
    const x = this.signal;
    let energy = 0;
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let k = 0; k < d; k++) sum += frame[i * d + k];
      x[i] = sum / d;
      energy += x[i] * x[i];
    }
    if (Math.sqrt(energy / Math.max(1, n)) < this.silenceRms) return NO_PITCH;

    const tauMax = Math.min(Math.floor(this.rate / this.minHz), Math.floor(n / 2));
    const tauMin = Math.max(2, Math.floor(this.rate / this.maxHz));
    const width = n - tauMax;
    if (tauMax <= tauMin + 2 || width <= 0) return NO_PITCH;
    if (this.diff.length !== tauMax + 1) this.diff = new Float32Array(tauMax + 1);
    const cmnd = this.diff;

    // Difference function, turned into the cumulative mean normalised difference.
    cmnd[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < width; j++) {
        const delta = x[j] - x[j + tau];
        sum += delta * delta;
      }
      running += sum;
      cmnd[tau] = running > 0 ? (sum * tau) / running : 1;
    }

    // The first dip under the threshold (then down to its bottom) is the period;
    // failing that, the deepest dip, if it is at least somewhat periodic.
    let tau = -1;
    for (let t = tauMin; t < tauMax; t++) {
      if (cmnd[t] < this.threshold) {
        while (t + 1 < tauMax && cmnd[t + 1] < cmnd[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      let best = tauMin;
      for (let t = tauMin + 1; t < tauMax; t++) if (cmnd[t] < cmnd[best]) best = t;
      if (cmnd[best] > 0.4) return NO_PITCH;
      tau = best;
    }

    // Parabolic interpolation around the dip for sub-sample precision.
    let period = tau;
    if (tau > 1 && tau < tauMax) {
      const a = cmnd[tau - 1];
      const b = cmnd[tau];
      const c = cmnd[tau + 1];
      const denominator = a - 2 * b + c;
      if (denominator > 1e-12) period = tau + (a - c) / (2 * denominator);
    }
    const hz = this.rate / period;
    if (!(hz >= this.minHz * 0.97 && hz <= this.maxHz * 1.03)) return NO_PITCH;
    return { hz, confidence: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
  }
}
