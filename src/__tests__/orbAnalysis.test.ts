import { AmpPoint, NoteName } from "../utils/consts";
import { LowPeak } from "../utils/lowBand";
import { NOTE_COLORS_HEX, NOTE_COLORS_LINEAR } from "../utils/noteColors";
import { bandForOctave, OrbAnalyzer, PITCH_CLASSES, signedAngle } from "../utils/orbAnalysis";

const HOP = 4096 / 48000;
const point = (note: NoteName, octave: number, amplitude = 1e6): AmpPoint => ({
  note,
  octave,
  cents: 0,
  amplitude,
  rawAmplitude: amplitude,
  harmonicity: 1,
  tonality: 1,
  brightness: 0.3,
});
const bass = (hz: number, amplitude = 1000): LowPeak => ({ frequency: hz, amplitude, harmonic: 1 });
const features = { rms: 0.2, spectralCentroid: 60 };
const C_MAJOR = [point(NoteName.C, 4), point(NoteName.E, 4), point(NoteName.G, 4)];
const F_MINOR = [point(NoteName.F, 4), point(NoteName["G#"], 4), point(NoteName.C, 5)];
const analyzer = () => new OrbAnalyzer({ hopSeconds: HOP, sampleRate: 48000, fftSize: 4096 });
const run = (a: OrbAnalyzer, points: AmpPoint[], seconds: number, low?: LowPeak[]) => {
  let frame = a.update(points, features, low);
  for (let t = HOP; t < seconds; t += HOP) frame = a.update(points, features, low);
  return frame;
};

describe("OrbAnalyzer", () => {
  it("lights the veins of the notes that are playing", () => {
    const frame = run(analyzer(), C_MAJOR, 1);
    const mid = Array.from(frame.levels.slice(PITCH_CLASSES, 2 * PITCH_CLASSES));
    for (const pc of [0, 4, 7]) expect(mid[pc]).toBeGreaterThan(0.9);
    for (const pc of [1, 3, 6, 10]) expect(mid[pc]).toBe(0);
  });

  it("puts long-FFT bass peaks in the low register", () => {
    const frame = run(analyzer(), C_MAJOR, 1, [bass(65.41)]);
    expect(frame.levels[0]).toBeGreaterThan(0.9); // C, low band
    expect(Array.from(frame.levels.slice(1, PITCH_CLASSES)).every((v) => v === 0)).toBe(true);
  });

  it("points 'here' at C major's centre and leans flatward on the minor iv", () => {
    const a = analyzer();
    const home = run(a, C_MAJOR, 12, [bass(65.41)]);
    const angle = (Math.atan2(home.here.y, home.here.x) * 180) / Math.PI;
    expect(angle).toBeGreaterThan(0); // C (0) to E (120) on the circle of fifths
    expect(angle).toBeLessThan(60);
    expect(Math.abs(home.lean)).toBeLessThan(0.1);

    const shadow = run(a, F_MINOR, 1.5, [bass(43.65)]);
    expect(shadow.lean).toBeLessThan(-0.4);
  });

  it("reports quiet sections as lower energy than loud ones", () => {
    const a = analyzer();
    run(a, C_MAJOR, 5);
    const quiet = a.update(C_MAJOR, { rms: 0.05, spectralCentroid: 60 });
    let settled = quiet;
    for (let i = 0; i < 20; i++) settled = a.update(C_MAJOR, { rms: 0.05, spectralCentroid: 60 });
    expect(settled.energy).toBeLessThan(0.4);
  });
});

describe("helpers", () => {
  it("assigns registers by octave", () => {
    expect([2, 3, 4, 5, 6, 8].map(bandForOctave)).toEqual([0, 0, 1, 1, 2, 2]);
  });
  it("measures signed angles the short way round", () => {
    expect(signedAngle({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
    expect(signedAngle({ x: 1, y: 0 }, { x: 0, y: -1 })).toBeCloseTo(-Math.PI / 2);
  });
  it("gives every note a distinct, in-gamut colour", () => {
    expect(new Set(NOTE_COLORS_HEX).size).toBe(12);
    for (const rgb of NOTE_COLORS_LINEAR) for (const v of rgb) expect(v).toBeGreaterThanOrEqual(0);
  });
});
