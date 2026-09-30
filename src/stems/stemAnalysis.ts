import Meyda from "meyda";
import { AudioFeatures, BUFFER_SIZE, HOP_SIZE } from "../utils/consts";
import { harmonicHistoryFrames, HarmonicMask, processPowerSpectrum } from "../utils/processPowerSpectrum";
import { LowBandAnalyzer, LOW_FFT_SIZE } from "../utils/lowBand";
import { OrbAnalyzer, VEIN_COUNT } from "../utils/orbAnalysis";
import { NO_PITCH, YinDetector } from "../utils/pitch";

/**
 * How a stem is analysed and drawn:
 *  - melody: a single line (voice, horn): pitch-tracked, drawn as a comet.
 *  - bass: a single low line: pitch-tracked with a long FFT for low notes.
 *  - chords: several notes at once (piano, guitar): drawn as constellations.
 *  - drums: onsets only, drawn as rings on the glass.
 *  - mix: everything together, for the orb's centre light and mood.
 */
export type StemRole = "melody" | "bass" | "chords" | "drums" | "mix";

const PITCH_RANGE: Partial<Record<StemRole, [number, number]>> = {
  melody: [70, 1400],
  bass: [28, 420],
  chords: [60, 1400],
};

const STEM_FEATURES = [
  "powerSpectrum",
  "spectralCentroid",
  "spectralFlatness",
  "spectralKurtosis",
  "spectralRolloff",
  "rms",
] as const;

/** Bytes per frame: per-octave levels, cross-octave levels, attacks (0-255 each), then 3 drum hits. */
export const FRAME_BYTES = VEIN_COUNT * 3 + 3;
/** Floats per frame: pitch Hz, pitch confidence, energy, here x/y, home x/y, lean, focus, brightness. */
export const FRAME_FLOATS = 10;

export const BYTE_LEVELS = 0;
export const BYTE_GLOBAL = VEIN_COUNT;
export const BYTE_ATTACKS = VEIN_COUNT * 2;
export const BYTE_HITS = VEIN_COUNT * 3;
export const FLOAT_PITCH_HZ = 0;
export const FLOAT_PITCH_CONFIDENCE = 1;
export const FLOAT_ENERGY = 2;
export const FLOAT_HERE = 3;
export const FLOAT_HOME = 5;
export const FLOAT_LEAN = 7;
export const FLOAT_FOCUS = 8;
export const FLOAT_BRIGHTNESS = 9;

/** A run of consecutive frames, packed for cheap transfer out of a worker. */
export type FrameBatch = {
  firstIndex: number;
  count: number;
  bytes: Uint8Array;
  floats: Float32Array;
};

const toByte = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

/**
 * The orb's analysis, run incrementally on one stem as its audio arrives in
 * chunks of any size. Frames are exactly the ones analyzeBuffer would produce
 * for the whole stem: a 4096-sample window every 2048 samples.
 */
export class StemAnalyzer {
  readonly hopSeconds: number;
  /** Frame k is ready at firstFrameSeconds + k * hopSeconds. */
  readonly firstFrameSeconds: number;
  private buffer = new Float32Array(0);
  private bufferStart = 0; // absolute sample index of buffer[0]
  private bufferLength = 0;
  private nextFrame = 0;
  private readonly mask: HarmonicMask;
  private readonly orb: OrbAnalyzer;
  private readonly lowBand: LowBandAnalyzer | null;
  private readonly yin: YinDetector | null;
  private readonly historyNeeded: number;

  constructor(private readonly sampleRate: number, readonly role: StemRole) {
    this.hopSeconds = HOP_SIZE / sampleRate;
    this.firstFrameSeconds = BUFFER_SIZE / sampleRate;
    this.mask = new HarmonicMask(harmonicHistoryFrames(this.hopSeconds));
    this.orb = new OrbAnalyzer({ hopSeconds: this.hopSeconds, sampleRate, fftSize: BUFFER_SIZE });
    // The long FFT is the costliest step, and only the bass needs its precision
    // (the mix's low notes only feed the harmonic centre, where bins do fine).
    const needsLowBand = role === "bass";
    this.lowBand = needsLowBand ? new LowBandAnalyzer(sampleRate) : null;
    this.historyNeeded = needsLowBand ? LOW_FFT_SIZE : BUFFER_SIZE;
    const range = PITCH_RANGE[role];
    this.yin = range ? new YinDetector(sampleRate, { minHz: range[0], maxHz: range[1] }) : null;
  }

  /** Append mono samples and analyse every frame they complete. */
  push(samples: Float32Array): FrameBatch | null {
    this.append(samples);
    return this.analyseReady();
  }

  /** Flush the tail: pad with silence so the last partial window is analysed too. */
  finish(): FrameBatch | null {
    const end = this.bufferStart + this.bufferLength;
    const lastStart = Math.max(0, Math.ceil((end - BUFFER_SIZE) / HOP_SIZE)) * HOP_SIZE;
    const pad = Math.max(0, lastStart + BUFFER_SIZE - end);
    if (pad > 0) this.append(new Float32Array(pad));
    return this.analyseReady();
  }

  private append(samples: Float32Array) {
    const needed = this.bufferLength + samples.length;
    if (needed > this.buffer.length) {
      const grown = new Float32Array(Math.max(needed, this.buffer.length * 2, 1 << 16));
      grown.set(this.buffer.subarray(0, this.bufferLength));
      this.buffer = grown;
    }
    this.buffer.set(samples, this.bufferLength);
    this.bufferLength = needed;
  }

  private analyseReady(): FrameBatch | null {
    const end = this.bufferStart + this.bufferLength;
    const ready = Math.floor((end - BUFFER_SIZE) / HOP_SIZE) + 1 - this.nextFrame;
    if (ready <= 0) return null;
    const batch: FrameBatch = {
      firstIndex: this.nextFrame,
      count: ready,
      bytes: new Uint8Array(ready * FRAME_BYTES),
      floats: new Float32Array(ready * FRAME_FLOATS),
    };
    Meyda.bufferSize = BUFFER_SIZE;
    Meyda.sampleRate = this.sampleRate;
    for (let k = 0; k < ready; k++) this.analyseFrame(this.nextFrame + k, batch, k);
    this.nextFrame += ready;
    this.trim();
    return batch;
  }

  private analyseFrame(index: number, batch: FrameBatch, slot: number) {
    const start = index * HOP_SIZE - this.bufferStart;
    const window = this.buffer.slice(start, start + BUFFER_SIZE);
    const features = Meyda.extract([...STEM_FEATURES], window) as unknown as AudioFeatures;
    const { fullSpectrumAmps } = processPowerSpectrum(features, { sampleRate: this.sampleRate }, this.mask);
    let lowPeaks;
    if (this.lowBand) {
      const windowEnd = start + BUFFER_SIZE;
      lowPeaks = this.lowBand.analyze(this.buffer.subarray(Math.max(0, windowEnd - LOW_FFT_SIZE), windowEnd));
    }
    const frame = this.orb.update(fullSpectrumAmps, features, lowPeaks);
    const pitch = this.yin ? this.yin.detect(window) : NO_PITCH;

    const b = slot * FRAME_BYTES;
    for (let i = 0; i < VEIN_COUNT; i++) {
      batch.bytes[b + BYTE_LEVELS + i] = toByte(frame.levels[i]);
      batch.bytes[b + BYTE_GLOBAL + i] = toByte(frame.global[i]);
      batch.bytes[b + BYTE_ATTACKS + i] = toByte(frame.attacks[i]);
    }
    batch.bytes[b + BYTE_HITS] = toByte(frame.hits.low);
    batch.bytes[b + BYTE_HITS + 1] = toByte(frame.hits.mid);
    batch.bytes[b + BYTE_HITS + 2] = toByte(frame.hits.high);

    const f = slot * FRAME_FLOATS;
    batch.floats[f + FLOAT_PITCH_HZ] = pitch.hz;
    batch.floats[f + FLOAT_PITCH_CONFIDENCE] = pitch.confidence;
    batch.floats[f + FLOAT_ENERGY] = frame.energy;
    batch.floats[f + FLOAT_HERE] = frame.here.x;
    batch.floats[f + FLOAT_HERE + 1] = frame.here.y;
    batch.floats[f + FLOAT_HOME] = frame.home.x;
    batch.floats[f + FLOAT_HOME + 1] = frame.home.y;
    batch.floats[f + FLOAT_LEAN] = frame.lean;
    batch.floats[f + FLOAT_FOCUS] = frame.focus;
    batch.floats[f + FLOAT_BRIGHTNESS] = frame.brightness;
  }

  /** Drop samples no future frame (or the low-band window) will need. */
  private trim() {
    const keepFrom = Math.max(0, this.nextFrame * HOP_SIZE + BUFFER_SIZE - this.historyNeeded);
    const drop = keepFrom - this.bufferStart;
    if (drop < (1 << 15)) return; // not worth moving memory yet
    this.buffer.copyWithin(0, drop, this.bufferLength);
    this.bufferLength -= drop;
    this.bufferStart = keepFrom;
  }
}
