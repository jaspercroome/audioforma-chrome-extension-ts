import { AudioFeatures, AmpArray } from "./consts";
import { frequencyToNote } from "./notes";

// Plain-math versions of the d3 scales this file used to build on every import.
// Keeping the analysis free of d3 also lets it run under Jest (d3 is ESM-only).
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const WEIGHT_EXP = 1.2;
const WEIGHT_LO = Math.pow(MIN_FREQ, WEIGHT_EXP);
const WEIGHT_HI = Math.pow(MAX_FREQ, WEIGHT_EXP);

/** Same curve as before: ~0.3 below 2 kHz rising to 1.2 at 20 kHz. */
export const frequencyWeighting = (f: number) =>
  0.3 + 0.9 * ((Math.pow(f, WEIGHT_EXP) - WEIGHT_LO) / (WEIGHT_HI - WEIGHT_LO));

const flatnessToTonality = (flatness: number) => clamp01(1 - flatness / 0.5);
const kurtosisToPercussiveness = (kurtosis: number) => clamp01((kurtosis - 2) / 8);

const analyzeSpectralCharacteristics = (features: AudioFeatures) => {
  const brightness = features.spectralCentroid / (features.spectralRolloff || 1);
  const tonalityFromFlatness = flatnessToTonality(features.spectralFlatness);
  const percussiveness = kurtosisToPercussiveness(features.spectralKurtosis);
  const tonality = Math.max(
    (1 - percussiveness) * tonalityFromFlatness,
    tonalityFromFlatness * 0.8
  );
  return { tonality, brightness };
};

const median = (values: Float32Array | number[], scratch: number[]) => {
  scratch.length = 0;
  for (let i = 0; i < values.length; i++) scratch.push(values[i]);
  scratch.sort((a, b) => a - b);
  const mid = scratch.length >> 1;
  return scratch.length % 2 ? scratch[mid] : (scratch[mid - 1] + scratch[mid]) / 2;
};

const HISTORY_FRAMES = 5; // ~0.4 s at a 4096 hop
const FREQ_HALF_WIDTH = 12; // bins either side for the percussive estimate
// Separation margin (as in librosa's hpss): a bin only counts as harmonic when
// its sustained level clearly beats the local broadband level. Plain noise
// (sustained level ~= local level) then scores ~0.2 instead of ~0.5.
const MARGIN = 2;

/**
 * Per-bin harmonic/percussive soft mask (median-filtering HPSS, Fitzgerald 2010).
 * Sustained, peaky energy (notes) scores near 1; broadband energy (drums, hiss)
 * scores near 0. Replaces the old per-frame "tonality" gate, which dropped every
 * point whenever a frame had a little broadband noise in it.
 */
export class HarmonicMask {
  private history: Float32Array[] = [];
  private scratch: number[] = [];

  compute(spectrum: number[]): Float32Array {
    const n = spectrum.length;
    const frame = Float32Array.from(spectrum);
    this.history.push(frame);
    if (this.history.length > HISTORY_FRAMES) this.history.shift();

    const mask = new Float32Array(n);
    const column = new Float32Array(this.history.length);
    const windowVals: number[] = [];
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < this.history.length; t++) {
        column[t] = this.history[t].length === n ? this.history[t][k] : 0;
      }
      const harmonic = median(column, this.scratch);

      windowVals.length = 0;
      const lo = Math.max(0, k - FREQ_HALF_WIDTH);
      const hi = Math.min(n - 1, k + FREQ_HALF_WIDTH);
      for (let j = lo; j <= hi; j++) windowVals.push(frame[j]);
      const percussive = median(windowVals, this.scratch);

      const h2 = harmonic * harmonic;
      const p2 = MARGIN * MARGIN * percussive * percussive;
      mask[k] = h2 + p2 > 0 ? h2 / (h2 + p2) : 0;
    }
    return mask;
  }

  reset() {
    this.history = [];
  }
}

const defaultMask = new HarmonicMask();

const getFrequencyBin = (frequency: number, sampleRate: number, fftSize: number) =>
  Math.round((frequency * fftSize) / sampleRate);

export const processPowerSpectrum = (
  features: AudioFeatures,
  audioContext: { sampleRate: number },
  harmonicMask: HarmonicMask = defaultMask
) => {
  const spectrum = features.powerSpectrum;
  const sampleRate = audioContext.sampleRate;
  const fftSize = spectrum.length * 2;
  const mask = harmonicMask.compute(spectrum);
  // Frame-level timbre descriptors: computed once, not once per bin.
  const { brightness } = analyzeSpectralCharacteristics(features);

  const keyOctaveAmps: Record<string, number> = {};
  const fullSpectrumAmps: AmpArray = [];

  const binsPerOctave = 48;
  const totalBins = Math.floor(binsPerOctave * Math.log2(MAX_FREQ / MIN_FREQ));

  for (let i = 0; i < totalBins; i++) {
    const freq = MIN_FREQ * Math.pow(2, i / binsPerOctave);
    if (freq > MAX_FREQ) break;

    const binLow = getFrequencyBin(freq, sampleRate, fftSize);
    const binHigh = getFrequencyBin(freq * Math.pow(2, 1 / binsPerOctave), sampleRate, fftSize);

    let power = 0;
    let maskWeighted = 0;
    let count = 0;
    for (let bin = binLow; bin <= binHigh && bin < spectrum.length; bin++) {
      power += spectrum[bin];
      maskWeighted += spectrum[bin] * mask[bin];
      count++;
    }
    if (count === 0) continue;
    const rawAmplitude = power / count;
    const harmonicity = power > 0 ? maskWeighted / power : 0;
    const amplitude = rawAmplitude * frequencyWeighting(freq);

    if (amplitude > 0.001) {
      const { note, octave, cents } = frequencyToNote(freq);
      const key = `${note}${octave}`;
      const centWeight = 1 - Math.abs(cents) / 50;

      keyOctaveAmps[key] = (keyOctaveAmps[key] ?? 0) + amplitude * centWeight;

      fullSpectrumAmps.push({
        note,
        octave,
        cents,
        amplitude: amplitude * centWeight,
        rawAmplitude: rawAmplitude * centWeight,
        tonality: harmonicity,
        harmonicity,
        brightness,
      });
    }
  }

  return {
    keyOctaveAmps,
    fullSpectrumAmps,
    melodic: { fullSpectrumAmps: fullSpectrumAmps.filter((p) => p.harmonicity > 0.5) },
    percussive: { fullSpectrumAmps: fullSpectrumAmps.filter((p) => p.harmonicity <= 0.5) },
  };
};
