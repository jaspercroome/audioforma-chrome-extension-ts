import Meyda from "meyda";
import { HarmonicMask, processPowerSpectrum } from "../utils/processPowerSpectrum";
import { AudioFeatures, BUFFER_SIZE } from "../utils/consts";
import { parseNoteKey } from "../utils/notes";

const SAMPLE_RATE = 48000;
const C_MAJOR = [130.81, 261.63, 329.63, 392.0];

const makeRandom = (seed: number) => () => {
  seed = (seed * 16807) % 2147483647;
  return (seed / 2147483647) * 2 - 1;
};

const frame = (freqs: number[], noise: number, seed: number) => {
  const random = makeRandom(seed);
  const signal = new Float32Array(BUFFER_SIZE);
  for (let i = 0; i < BUFFER_SIZE; i++) {
    let v = 0;
    for (const f of freqs) v += 0.2 * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE);
    signal[i] = v + noise * random();
  }
  return signal;
};

const features = (signal: Float32Array): AudioFeatures => {
  Meyda.bufferSize = BUFFER_SIZE;
  Meyda.sampleRate = SAMPLE_RATE;
  return Meyda.extract(
    ["powerSpectrum", "spectralCentroid", "spectralFlatness", "spectralKurtosis", "spectralRolloff", "chroma"],
    signal
  ) as unknown as AudioFeatures;
};

const run = (freqs: number[], noise: number, frames = 6) => {
  const mask = new HarmonicMask();
  let result = processPowerSpectrum(features(frame(freqs, noise, 1)), { sampleRate: SAMPLE_RATE }, mask);
  for (let i = 2; i <= frames; i++) {
    result = processPowerSpectrum(features(frame(freqs, noise, i)), { sampleRate: SAMPLE_RATE }, mask);
  }
  return result;
};

describe("processPowerSpectrum", () => {
  it("keeps the notes of a chord when there is broadband noise underneath", () => {
    // The old per-frame tonality gate dropped every point for this input.
    const { melodic } = run(C_MAJOR, 0.1);
    const notes = new Set(melodic.fullSpectrumAmps.map((p) => p.note));
    expect(notes.has("C" as never)).toBe(true);
    expect(notes.has("E" as never)).toBe(true);
    expect(notes.has("G" as never)).toBe(true);
  });

  it("scores noise as mostly non-harmonic", () => {
    const { fullSpectrumAmps } = run([], 0.3);
    const harmonic = fullSpectrumAmps.filter((p) => p.harmonicity > 0.5).length;
    expect(harmonic / Math.max(1, fullSpectrumAmps.length)).toBeLessThan(0.35);
  });

  it("produces only well-formed keys and no negative amplitudes", () => {
    const { keyOctaveAmps } = run(C_MAJOR, 0.1, 3);
    for (const [key, value] of Object.entries(keyOctaveAmps)) {
      expect(parseNoteKey(key)).not.toBeNull();
      expect(value).toBeGreaterThanOrEqual(0);
    }
  });
});
