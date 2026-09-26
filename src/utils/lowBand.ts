/**
 * Bass pitch detection with a long FFT.
 *
 * At the 4096-sample frame the rest of the analysis uses, FFT bins are ~11.7 Hz
 * apart, which is three semitones around C2 and five around E1, so every low
 * note smears across its neighbours and the whole low register lights up.
 * The bass usually decides what chord you hear, so for notes below C4 we take
 * the last 16384 samples (~0.34 s), find spectral peaks, and refine each
 * peak's frequency with parabolic interpolation.
 */

export const LOW_FFT_SIZE = 16384;
const MIN_HZ = 30;
const MAX_HZ = 262; // up to C4; the 4096 frame resolves notes above this
const RELATIVE_FLOOR = 0.08; // ignore peaks under 8% of the strongest low peak
const PERSIST_CENTS = 40;
// Scale magnitudes to the units of Meyda's 4096-sample amplitude spectrum.
const UNIT_SCALE = 4096 / LOW_FFT_SIZE;

export type LowPeak = {
  frequency: number;
  /** Amplitude in the same units as sqrt(Meyda power) at a 4096 frame. */
  amplitude: number;
  /** 1 for peaks that persist from the previous frame (notes), lower for one-off transients. */
  harmonic: number;
};

/** In-place iterative radix-2 FFT. */
export const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = (-2 * Math.PI) / size;
    const wRe = Math.cos(step);
    const wIm = Math.sin(step);
    for (let start = 0; start < n; start += size) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < half; k++) {
        const a = start + k;
        const b = a + half;
        const tRe = re[b] * curRe - im[b] * curIm;
        const tIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
};

export class LowBandAnalyzer {
  private re = new Float64Array(LOW_FFT_SIZE);
  private im = new Float64Array(LOW_FFT_SIZE);
  private window = Float64Array.from(
    { length: LOW_FFT_SIZE },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (LOW_FFT_SIZE - 1))
  );
  private previous: number[] = [];

  constructor(private sampleRate: number) {}

  reset() {
    this.previous = [];
  }

  /** Peaks in the last LOW_FFT_SIZE samples of `samples` (raw, un-windowed audio). */
  analyze(samples: Float32Array): LowPeak[] {
    const n = LOW_FFT_SIZE;
    const offset = Math.max(0, samples.length - n);
    for (let i = 0; i < n; i++) {
      const s = offset + i < samples.length ? samples[offset + i] : 0;
      this.re[i] = s * this.window[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im);

    const binHz = this.sampleRate / n;
    const kMin = Math.max(2, Math.floor(MIN_HZ / binHz));
    const kMax = Math.min(n / 2 - 2, Math.ceil(MAX_HZ / binHz));
    const mag = (k: number) => Math.hypot(this.re[k], this.im[k]);

    let strongest = 0;
    for (let k = kMin; k <= kMax; k++) strongest = Math.max(strongest, mag(k));
    if (strongest <= 1e-9) {
      this.previous = [];
      return [];
    }

    const peaks: LowPeak[] = [];
    for (let k = kMin; k <= kMax; k++) {
      const m = mag(k);
      if (m < strongest * RELATIVE_FLOOR) continue;
      const left = mag(k - 1);
      const right = mag(k + 1);
      if (!(m > left && m >= right)) continue;
      // Parabolic interpolation on log magnitude.
      const a = Math.log(left + 1e-12);
      const b = Math.log(m + 1e-12);
      const c = Math.log(right + 1e-12);
      const denom = a - 2 * b + c;
      const p = denom === 0 ? 0 : (0.5 * (a - c)) / denom;
      const frequency = (k + p) * binHz;
      const amplitude = Math.exp(b - 0.25 * (a - c) * p) * UNIT_SCALE;
      const persists = this.previous.some((f) => Math.abs(1200 * Math.log2(frequency / f)) < PERSIST_CENTS);
      peaks.push({ frequency, amplitude, harmonic: persists ? 1 : 0.35 });
    }
    this.previous = peaks.map((p) => p.frequency);
    return peaks;
  }
}
