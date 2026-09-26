import { fft, LowBandAnalyzer, LOW_FFT_SIZE } from "../utils/lowBand";
import { frequencyToNote } from "../utils/notes";

const SAMPLE_RATE = 48000;
const tone = (freqs: number[], length = LOW_FFT_SIZE) =>
  Float32Array.from({ length }, (_, i) =>
    freqs.reduce((sum, f) => sum + 0.3 * Math.sin((2 * Math.PI * f * i) / SAMPLE_RATE), 0)
  );

describe("fft", () => {
  it("puts a pure bin-centred tone in the right bin", () => {
    const n = 1024;
    const re = Float64Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 37 * i) / n));
    const im = new Float64Array(n);
    fft(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mags.indexOf(Math.max(...mags.slice(0, n / 2)))).toBe(37);
    expect(mags[37]).toBeCloseTo(n / 2, 3);
  });
});

describe("LowBandAnalyzer", () => {
  it.each([
    [41.2, "E", 1],
    [55.0, "A", 1],
    [65.41, "C", 2],
    [98.0, "G", 2],
    [146.83, "D", 3],
  ])("identifies %f Hz as %s%i", (hz, note, octave) => {
    const low = new LowBandAnalyzer(SAMPLE_RATE);
    const peaks = low.analyze(tone([hz]));
    const loudest = peaks.sort((a, b) => b.amplitude - a.amplitude)[0];
    expect(Math.abs(1200 * Math.log2(loudest.frequency / hz))).toBeLessThan(10);
    expect(frequencyToNote(loudest.frequency)).toMatchObject({ note, octave });
  });

  it("separates a bass note from its octave", () => {
    const low = new LowBandAnalyzer(SAMPLE_RATE);
    const peaks = low.analyze(tone([55, 110]));
    const notes = peaks.map((p) => frequencyToNote(p.frequency)).map((n) => `${n.note}${n.octave}`);
    expect(notes).toEqual(expect.arrayContaining(["A1", "A2"]));
  });

  it("marks peaks that persist between frames as harmonic", () => {
    const low = new LowBandAnalyzer(SAMPLE_RATE);
    expect(low.analyze(tone([65.41]))[0].harmonic).toBeLessThan(1);
    expect(low.analyze(tone([65.41]))[0].harmonic).toBe(1);
  });
});
