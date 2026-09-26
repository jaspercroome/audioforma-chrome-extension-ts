import { AmpArray, AudioFeatures, noteNames } from "./consts";
import { LowPeak } from "./lowBand";
import { fifthsIndex, frequencyToNote, pitchClass } from "./notes";

/**
 * Turns one analysis frame into what the orb needs:
 *  - a level for each of 36 veins (12 pitch classes x 3 registers),
 *  - overall energy,
 *  - a first, rough "feeling" layer: where the harmony sits on the circle of
 *    fifths right now ("here"), a slow-moving sense of "home", and the lean
 *    between them (sharpward = brightening, flatward = darkening).
 *
 * Levels and energy use slow automatic gain so quiet and loud recordings both
 * fill the range while dynamics inside a song still read.
 */

export const BANDS = 3;
export const PITCH_CLASSES = 12;
export const VEIN_COUNT = BANDS * PITCH_CLASSES;

/** Register of an octave: 0 = low (up to B3, ~247 Hz), 1 = mid (C4-B5), 2 = high (C6 and up). */
export const bandForOctave = (octave: number) => (octave <= 3 ? 0 : octave <= 5 ? 1 : 2);

/** Harmony leans on the bass, so low notes count more toward "here". */
const HARMONY_BAND_WEIGHT = [1.5, 1, 0.6];
/**
 * A long-FFT bass peak is counted once, while the same tone in the 4096 frame
 * spreads over several log-spaced bins; this brings the two to a similar scale.
 */
const LOW_PEAK_WEIGHT = 2.5;

export type Vec2 = { x: number; y: number };

export type OrbFrame = {
  /** VEIN_COUNT levels, 0-1, indexed band * 12 + pitch class. */
  levels: Float32Array;
  /** Overall loudness, 0-1 after automatic gain. */
  energy: number;
  /** Harmonic centre of gravity on the circle of fifths (unit disk; angle 0 = C, positive = sharpward). */
  here: Vec2;
  /** Slow average of `here`: the sense of home. */
  home: Vec2;
  /** Signed lean of here relative to home: -1 flatward (darker) to +1 sharpward (brighter). */
  lean: number;
  /** How concentrated the harmony is, 0 (ambiguous) to 1 (a single note). */
  focus: number;
  /** Spectral brightness of the timbre, 0-1. */
  brightness: number;
  /** Seconds of audio analysed so far. */
  time: number;
};

export const emptyOrbFrame = (): OrbFrame => ({
  levels: new Float32Array(VEIN_COUNT),
  energy: 0,
  here: { x: 0, y: 0 },
  home: { x: 0, y: 0 },
  lean: 0,
  focus: 0,
  brightness: 0,
  time: 0,
});

const FIFTHS_UNIT = Array.from({ length: PITCH_CLASSES }, (_, pc) => {
  const angle = (fifthsIndex(noteNames[pc]) * Math.PI) / 6;
  return { x: Math.cos(angle), y: Math.sin(angle) };
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Signed angle from `from` to `to`, in (-pi, pi]. */
export const signedAngle = (from: Vec2, to: Vec2) => {
  const d = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
  return Math.atan2(Math.sin(d), Math.cos(d));
};

export type OrbAnalyzerOptions = {
  /** Seconds between analysis frames (bufferSize / sampleRate). */
  hopSeconds: number;
  sampleRate: number;
  fftSize: number;
  /** Time constant of the "home" average, seconds. */
  homeSeconds?: number;
};

export class OrbAnalyzer {
  private levelRef = new Float32Array(BANDS).fill(1e-6);
  private energyRef = 0.02;
  private meanSquare = 0;
  private home: Vec2 = { x: 0, y: 0 };
  private time = 0;
  private readonly opts: Required<OrbAnalyzerOptions>;

  constructor(opts: OrbAnalyzerOptions) {
    this.opts = { homeSeconds: 20, ...opts };
  }

  reset() {
    this.levelRef.fill(1e-6);
    this.energyRef = 0.02;
    this.meanSquare = 0;
    this.home = { x: 0, y: 0 };
    this.time = 0;
  }

  /**
   * @param lowPeaks Bass peaks from LowBandAnalyzer. When given, they replace
   *   the 4096-frame bins for the low register, which are too coarse to tell
   *   neighbouring bass notes apart.
   */
  update(
    points: AmpArray,
    features: Pick<AudioFeatures, "rms" | "spectralCentroid">,
    lowPeaks?: LowPeak[]
  ): OrbFrame {
    const { hopSeconds, sampleRate, fftSize, homeSeconds } = this.opts;
    this.time += hopSeconds;

    // 1. Sum harmonic amplitude per register and pitch class.
    const sums = new Float32Array(VEIN_COUNT);
    for (const p of points) {
      if (!(p.rawAmplitude > 0) || !(p.harmonicity > 0)) continue;
      const band = bandForOctave(p.octave);
      if (band === 0 && lowPeaks) continue;
      const pc = pitchClass(p.note);
      if (pc < 0 || Number.isNaN(pc)) continue;
      sums[band * PITCH_CLASSES + pc] += Math.sqrt(p.rawAmplitude) * p.harmonicity;
    }
    if (lowPeaks) {
      for (const peak of lowPeaks) {
        const { note, octave } = frequencyToNote(peak.frequency);
        if (bandForOctave(octave) !== 0) continue;
        sums[pitchClass(note)] += peak.amplitude * peak.harmonic * LOW_PEAK_WEIGHT;
      }
    }

    // 2. Automatic gain per register: a slowly decaying peak, with a floor tied
    //    to the loudest register so an empty register doesn't amplify noise.
    const decay = Math.exp(-hopSeconds / 6);
    const bandMax = new Float32Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      for (let pc = 0; pc < PITCH_CLASSES; pc++) {
        bandMax[b] = Math.max(bandMax[b], sums[b * PITCH_CLASSES + pc]);
      }
      this.levelRef[b] = Math.max(bandMax[b], this.levelRef[b] * decay);
    }
    const loudestRef = Math.max(...this.levelRef);
    const levels = new Float32Array(VEIN_COUNT);
    for (let b = 0; b < BANDS; b++) {
      const ref = Math.max(this.levelRef[b], loudestRef * 0.08, 1e-6);
      for (let pc = 0; pc < PITCH_CLASSES; pc++) {
        const v = sums[b * PITCH_CLASSES + pc] / ref;
        levels[b * PITCH_CLASSES + pc] = Math.pow(clamp(v, 0, 1), 1.4);
      }
    }

    // 3. Energy: RMS smoothed over ~0.35 s (a single 85 ms frame swings with
    //    every drum hit), then a slow automatic gain so sections keep their
    //    relative loudness.
    const rms = features.rms ?? 0;
    this.meanSquare += (rms * rms - this.meanSquare) * (1 - Math.exp(-hopSeconds / 0.35));
    const loudness = Math.sqrt(this.meanSquare);
    this.energyRef = Math.max(loudness, this.energyRef * Math.exp(-hopSeconds / 60), 0.02);
    const energy = clamp(loudness / this.energyRef, 0, 1);

    // 4. Harmonic centre of gravity on the circle of fifths.
    let wx = 0;
    let wy = 0;
    let total = 0;
    for (let pc = 0; pc < PITCH_CLASSES; pc++) {
      let w = 0;
      for (let b = 0; b < BANDS; b++) w += HARMONY_BAND_WEIGHT[b] * sums[b * PITCH_CLASSES + pc];
      wx += w * FIFTHS_UNIT[pc].x;
      wy += w * FIFTHS_UNIT[pc].y;
      total += w;
    }
    const here = total > 0 ? { x: wx / total, y: wy / total } : { x: 0, y: 0 };
    const focus = Math.hypot(here.x, here.y);

    // 5. Home drifts toward here, faster when the music is louder. It settles
    //    quickly at the start of a song, then slows to `homeSeconds`.
    const homeTau = Math.min(homeSeconds, 1.5 + 0.9 * this.time);
    const alpha = 1 - Math.exp(-hopSeconds / homeTau);
    const pull = alpha * (0.25 + 0.75 * energy);
    if (Math.hypot(this.home.x, this.home.y) < 1e-6 && focus > 0) {
      this.home = { ...here };
    } else {
      this.home = { x: this.home.x + pull * (here.x - this.home.x), y: this.home.y + pull * (here.y - this.home.y) };
    }
    const homeStrength = Math.hypot(this.home.x, this.home.y);
    const lean =
      clamp(signedAngle(this.home, here) / (Math.PI / 2), -1, 1) *
      smoothstep(0.02, 0.2, focus) *
      smoothstep(0.02, 0.12, homeStrength);

    // 6. Timbre brightness from the spectral centroid (Meyda reports a bin index).
    const centroidHz = ((features.spectralCentroid ?? 0) * sampleRate) / fftSize;
    const brightness = clamp(Math.log2(Math.max(centroidHz, 1) / 200) / Math.log2(8000 / 200), 0, 1);

    return { levels, energy, here, home: { ...this.home }, lean, focus, brightness, time: this.time };
  }
}
