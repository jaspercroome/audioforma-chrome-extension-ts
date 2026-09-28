import { AmpArray, AudioFeatures, noteNames } from "./consts";
import { LowPeak } from "./lowBand";
import { fifthsIndex, frequencyToNote, pitchClass } from "./notes";

/**
 * Turns one analysis frame into what the orb needs:
 *  - a level for every note in every octave (12 pitch classes x 8 octaves),
 *    and an attack value that spikes when a note starts,
 *  - drum hits, split into low (kick), mid (snare and body) and high (hats),
 *  - overall energy,
 *  - a first, rough "feeling" layer: where the harmony sits on the circle of
 *    fifths right now ("here"), a slow-moving sense of "home", and the lean
 *    between them (sharpward = brightening, flatward = darkening).
 *
 * Levels and energy use slow automatic gain so quiet and loud recordings both
 * fill the range while dynamics inside a song still read.
 */

export const PITCH_CLASSES = 12;
/** Octaves shown: 1 (C1, 33 Hz) to 8 (B8, 7.9 kHz). */
export const FIRST_OCTAVE = 1;
export const OCTAVES = 8;
export const VEIN_COUNT = OCTAVES * PITCH_CLASSES;

/** Index of a note's vein: octave-major, so each octave is a row of 12. */
export const veinIndex = (octave: number, pc: number) => (octave - FIRST_OCTAVE) * PITCH_CLASSES + pc;

/** Octaves below C4 come from the long-FFT bass analysis when it's available. */
const LOW_PEAK_MAX_OCTAVE = 3;

/** Harmony leans on the bass, so low notes count more toward "here". */
const harmonyWeight = (octave: number) => (octave <= 3 ? 1.5 : octave <= 5 ? 1 : 0.6);

/**
 * A long-FFT bass peak is counted once, while the same tone in the 4096 frame
 * spreads over several log-spaced bins; this brings the two to a similar scale.
 */
const LOW_PEAK_WEIGHT = 2.5;

/** Drum bands by octave: low (to ~130 Hz), mid (~130 Hz-4 kHz), high (above ~4 kHz). */
export type DrumBand = "low" | "mid" | "high";
export const DRUM_BANDS: DrumBand[] = ["low", "mid", "high"];
const drumBandForOctave = (octave: number): DrumBand | null =>
  octave <= 2 ? "low" : octave <= 7 ? "mid" : "high";

export type Vec2 = { x: number; y: number };

export type OrbFrame = {
  /** VEIN_COUNT levels, 0-1, indexed by veinIndex(octave, pitch class). */
  levels: Float32Array;
  /** VEIN_COUNT attack strengths, 0-1: how sharply each note just started. */
  attacks: Float32Array;
  /** Drum hit strengths this frame, 0 when there was no hit. */
  hits: Record<DrumBand, number>;
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
  attacks: new Float32Array(VEIN_COUNT),
  hits: { low: 0, mid: 0, high: 0 },
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

/**
 * Onset detector for one drum band: a hit is a sudden rise in percussive
 * energy relative to the previous frame and to the recent average, with a
 * short refractory period so one hit isn't counted twice.
 */
class DrumOnsets {
  private previous = 0;
  private average = 0;
  private peak = 1e-9;
  private sinceHit = Infinity;

  constructor(private hopSeconds: number) {}

  update(energy: number) {
    const { hopSeconds } = this;
    const rise = Math.log((energy + 1e-9) / (this.previous + 1e-9));
    this.peak = Math.max(energy, this.peak * Math.exp(-hopSeconds / 8));
    this.sinceHit += hopSeconds;
    const loudEnough = energy > 0.15 * this.peak && energy > 1.4 * this.average;
    let strength = 0;
    if (rise > 0.5 && loudEnough && this.sinceHit > 0.09) {
      strength = clamp(rise / 2, 0.2, 1) * clamp(energy / this.peak, 0.25, 1);
      this.sinceHit = 0;
    }
    this.average += (energy - this.average) * (1 - Math.exp(-hopSeconds / 0.6));
    this.previous = energy;
    return strength;
  }
}

export type OrbAnalyzerOptions = {
  /** Seconds between analysis frames (hop size / sample rate). */
  hopSeconds: number;
  sampleRate: number;
  fftSize: number;
  /** Time constant of the "home" average, seconds. */
  homeSeconds?: number;
};

export class OrbAnalyzer {
  private levelRef = new Float32Array(OCTAVES).fill(1e-6);
  private previousLevels = new Float32Array(VEIN_COUNT);
  private energyRef = 0.02;
  private meanSquare = 0;
  private home: Vec2 = { x: 0, y: 0 };
  private time = 0;
  private drums: Record<DrumBand, DrumOnsets>;
  private readonly opts: Required<OrbAnalyzerOptions>;

  constructor(opts: OrbAnalyzerOptions) {
    this.opts = { homeSeconds: 20, ...opts };
    this.drums = {
      low: new DrumOnsets(opts.hopSeconds),
      mid: new DrumOnsets(opts.hopSeconds),
      high: new DrumOnsets(opts.hopSeconds),
    };
  }

  /**
   * @param lowPeaks Bass peaks from LowBandAnalyzer. When given, they replace
   *   the 4096-frame bins for octaves 1-3, which are too coarse to tell
   *   neighbouring bass notes apart.
   */
  update(
    points: AmpArray,
    features: Pick<AudioFeatures, "rms" | "spectralCentroid">,
    lowPeaks?: LowPeak[]
  ): OrbFrame {
    const { hopSeconds, sampleRate, fftSize, homeSeconds } = this.opts;
    this.time += hopSeconds;

    // 1. Sum harmonic amplitude per note and octave; collect percussive energy per drum band.
    const sums = new Float32Array(VEIN_COUNT);
    const percussive: Record<DrumBand, number> = { low: 0, mid: 0, high: 0 };
    for (const p of points) {
      if (!(p.rawAmplitude > 0)) continue;
      const amplitude = Math.sqrt(p.rawAmplitude);
      const band = drumBandForOctave(p.octave);
      if (band) percussive[band] += amplitude * (1 - p.harmonicity);
      if (!(p.harmonicity > 0)) continue;
      if (p.octave < FIRST_OCTAVE || p.octave >= FIRST_OCTAVE + OCTAVES) continue;
      if (lowPeaks && p.octave <= LOW_PEAK_MAX_OCTAVE) continue;
      const pc = pitchClass(p.note);
      if (pc < 0 || Number.isNaN(pc)) continue;
      sums[veinIndex(p.octave, pc)] += amplitude * p.harmonicity;
    }
    if (lowPeaks) {
      for (const peak of lowPeaks) {
        const { note, octave } = frequencyToNote(peak.frequency);
        if (octave < FIRST_OCTAVE || octave > LOW_PEAK_MAX_OCTAVE) continue;
        sums[veinIndex(octave, pitchClass(note))] += peak.amplitude * peak.harmonic * LOW_PEAK_WEIGHT;
      }
    }

    // 2. Automatic gain per octave: a slowly decaying peak, with a floor tied to
    //    the loudest octave so a quiet octave's faint overtones stay dim.
    const decay = Math.exp(-hopSeconds / 6);
    for (let o = 0; o < OCTAVES; o++) {
      let max = 0;
      for (let pc = 0; pc < PITCH_CLASSES; pc++) max = Math.max(max, sums[o * PITCH_CLASSES + pc]);
      this.levelRef[o] = Math.max(max, this.levelRef[o] * decay);
    }
    const loudestRef = Math.max(...this.levelRef);
    const levels = new Float32Array(VEIN_COUNT);
    const attacks = new Float32Array(VEIN_COUNT);
    for (let o = 0; o < OCTAVES; o++) {
      const ref = Math.max(this.levelRef[o], loudestRef * 0.15, 1e-6);
      for (let pc = 0; pc < PITCH_CLASSES; pc++) {
        const i = o * PITCH_CLASSES + pc;
        levels[i] = clamp(sums[i] / ref, 0, 1);
        attacks[i] = clamp((levels[i] - this.previousLevels[i] - 0.08) * 2.2, 0, 1);
      }
    }
    this.previousLevels = levels;

    // 3. Drum hits.
    const hits = {
      low: this.drums.low.update(percussive.low),
      mid: this.drums.mid.update(percussive.mid),
      high: this.drums.high.update(percussive.high),
    };

    // 4. Energy: RMS smoothed over ~0.35 s (single frames swing with every drum
    //    hit), then a slow automatic gain so sections keep their relative loudness.
    const rms = features.rms ?? 0;
    this.meanSquare += (rms * rms - this.meanSquare) * (1 - Math.exp(-hopSeconds / 0.35));
    const loudness = Math.sqrt(this.meanSquare);
    this.energyRef = Math.max(loudness, this.energyRef * Math.exp(-hopSeconds / 60), 0.02);
    const energy = clamp(loudness / this.energyRef, 0, 1);

    // 5. Harmonic centre of gravity on the circle of fifths.
    let wx = 0;
    let wy = 0;
    let total = 0;
    for (let o = 0; o < OCTAVES; o++) {
      const weight = harmonyWeight(o + FIRST_OCTAVE);
      for (let pc = 0; pc < PITCH_CLASSES; pc++) {
        const w = weight * sums[o * PITCH_CLASSES + pc];
        wx += w * FIFTHS_UNIT[pc].x;
        wy += w * FIFTHS_UNIT[pc].y;
        total += w;
      }
    }
    const here = total > 0 ? { x: wx / total, y: wy / total } : { x: 0, y: 0 };
    const focus = Math.hypot(here.x, here.y);

    // 6. Home drifts toward here, faster when the music is louder. It settles
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

    // 7. Timbre brightness from the spectral centroid (Meyda reports a bin index).
    const centroidHz = ((features.spectralCentroid ?? 0) * sampleRate) / fftSize;
    const brightness = clamp(Math.log2(Math.max(centroidHz, 1) / 200) / Math.log2(8000 / 200), 0, 1);

    return { levels, attacks, hits, energy, here, home: { ...this.home }, lean, focus, brightness, time: this.time };
  }
}
