import { AmpPoint, NoteName } from "../utils/consts";
import { LowPeak } from "../utils/lowBand";
import { NOTE_COLORS_HEX, NOTE_COLORS_LINEAR } from "../utils/noteColors";
import { OrbAnalyzer, PITCH_CLASSES, signedAngle, veinIndex } from "../utils/orbAnalysis";

const HOP = 2048 / 48000;
const point = (note: NoteName, octave: number, amplitude = 1e6, harmonicity = 1): AmpPoint => ({
  note,
  octave,
  cents: 0,
  amplitude,
  rawAmplitude: amplitude,
  harmonicity,
  tonality: harmonicity,
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
const octaveRow = (levels: Float32Array, octave: number) =>
  Array.from(levels.slice(veinIndex(octave, 0), veinIndex(octave, 0) + PITCH_CLASSES));

describe("OrbAnalyzer", () => {
  it("lights each note in its own octave", () => {
    const frame = run(analyzer(), [...C_MAJOR, point(NoteName.A, 6, 3e5)], 1);
    const octave4 = octaveRow(frame.levels, 4);
    for (const pc of [0, 4, 7]) expect(octave4[pc]).toBeGreaterThan(0.9);
    for (const pc of [1, 3, 6, 9, 10]) expect(octave4[pc]).toBe(0);
    expect(octaveRow(frame.levels, 6)[9]).toBeGreaterThan(0.9); // A6, normalised within its octave
    expect(octaveRow(frame.levels, 5).every((v) => v === 0)).toBe(true);
  });

  it("puts long-FFT bass peaks in their octave", () => {
    const frame = run(analyzer(), C_MAJOR, 1, [bass(65.41), bass(49)]);
    expect(frame.levels[veinIndex(2, 0)]).toBeGreaterThan(0.9); // C2
    expect(frame.levels[veinIndex(1, 7)]).toBeGreaterThan(0.5); // G1 (49 Hz)
    expect(octaveRow(frame.levels, 3).every((v) => v === 0)).toBe(true);
  });

  it("spikes an attack when a note starts, not while it's held", () => {
    const a = analyzer();
    run(a, C_MAJOR, 0.5);
    const start = a.update([...C_MAJOR, point(NoteName.D, 5)], features);
    expect(start.attacks[veinIndex(5, 2)]).toBeGreaterThan(0.5);
    const held = a.update([...C_MAJOR, point(NoteName.D, 5)], features);
    expect(held.attacks[veinIndex(5, 2)]).toBe(0);
    expect(start.attacks[veinIndex(4, 0)]).toBe(0);
  });

  it("keeps silence and faint noise dark instead of turning them up", () => {
    const a = analyzer();
    run(a, C_MAJOR, 2);
    // Music stops; only a faint, steady noise floor remains (about -80 dBFS).
    const hiss = [NoteName.C, NoteName.E, NoteName.A].flatMap((n) => [4, 6, 8].map((o) => point(n, o, 1e-2, 0.6)));
    const frame = run(a, hiss, 30);
    expect(Math.max(...frame.levels)).toBeLessThan(0.05);
    expect(Math.max(...run(a, [], 1).levels)).toBe(0);
  });

  it("doesn't flash on ordinary frame-to-frame jitter", () => {
    const a = analyzer();
    run(a, C_MAJOR, 1);
    let flashes = 0;
    for (let i = 0; i < 200; i++) {
      const wobble = 1 + 0.25 * Math.sin(i * 2.3); // +-25% amplitude, every frame
      const frame = a.update(
        C_MAJOR.map((p) => ({ ...p, rawAmplitude: p.rawAmplitude * wobble * wobble })),
        features
      );
      flashes += frame.attacks.filter((v) => v > 0).length;
    }
    expect(flashes).toBe(0);
  });

  it("needs a broadband rise for a mid (snare) hit, not one plucked octave", () => {
    const a = analyzer();
    const floor = [...C_MAJOR, ...[3, 4, 5, 6, 7].map((o) => point(NoteName.D, o, 1e3, 0))];
    run(a, floor, 1);
    const pluck = a.update([...C_MAJOR, ...[3, 4, 6, 7].map((o) => point(NoteName.D, o, 1e3, 0)), point(NoteName.D, 5, 1e7, 0)], features);
    expect(pluck.hits.mid).toBe(0);
    run(a, floor, 1);
    const snare = a.update([...C_MAJOR, ...[3, 4, 5, 6, 7].map((o) => point(NoteName.D, o, 1e7, 0))], features);
    expect(snare.hits.mid).toBeGreaterThan(0.2);
  });

  it("detects drum hits in the right band", () => {
    const a = analyzer();
    const quiet = [...C_MAJOR, point(NoteName.C, 9, 1e3, 0), point(NoteName.C, 1, 1e3, 0)];
    run(a, quiet, 1);
    const hat = a.update([...C_MAJOR, point(NoteName.C, 9, 1e6, 0), point(NoteName.C, 1, 1e3, 0)], features);
    expect(hat.hits.high).toBeGreaterThan(0.2);
    expect(hat.hits.low).toBe(0);
    run(a, quiet, 0.5);
    const kick = a.update([...C_MAJOR, point(NoteName.C, 9, 1e3, 0), point(NoteName.G, 1, 1e6, 0.1)], features);
    expect(kick.hits.low).toBeGreaterThan(0.2);
    expect(kick.hits.high).toBe(0);
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
    let settled = a.update(C_MAJOR, { rms: 0.05, spectralCentroid: 60 });
    for (let i = 0; i < 40; i++) settled = a.update(C_MAJOR, { rms: 0.05, spectralCentroid: 60 });
    expect(settled.energy).toBeLessThan(0.4);
  });
});

describe("helpers", () => {
  it("indexes veins by octave, then pitch class", () => {
    expect(veinIndex(1, 0)).toBe(0);
    expect(veinIndex(2, 3)).toBe(15);
    expect(veinIndex(8, 11)).toBe(95);
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
