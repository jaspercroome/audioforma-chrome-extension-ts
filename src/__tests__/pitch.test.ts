import { hzToMidi, YinDetector } from "../utils/pitch";

const SR = 44100;
const N = 4096;

const tone = (hz: number, harmonics: number[] = [1], amp = 0.3) => {
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let v = 0;
    harmonics.forEach((a, k) => (v += a * Math.sin((2 * Math.PI * hz * (k + 1) * i) / SR)));
    out[i] = amp * v;
  }
  return out;
};

describe("YinDetector", () => {
  const yin = new YinDetector(SR, { minHz: 40, maxHz: 1400 });

  it.each([55, 110, 196, 440, 880, 1175])("finds a %i Hz sine", (hz) => {
    const p = yin.detect(tone(hz));
    expect(Math.abs(hzToMidi(p.hz) - hzToMidi(hz))).toBeLessThan(0.1); // within 10 cents
    expect(p.confidence).toBeGreaterThan(0.9);
  });

  it("finds the fundamental of a bright, horn-like tone, not an overtone", () => {
    const p = yin.detect(tone(233.08, [1, 0.8, 0.9, 0.6, 0.5, 0.4, 0.3])); // Bb3 with strong partials
    expect(Math.abs(hzToMidi(p.hz) - hzToMidi(233.08))).toBeLessThan(0.1);
  });

  it("finds a missing fundamental from its harmonics", () => {
    const p = yin.detect(tone(110, [0, 1, 0.8, 0.6]));
    expect(Math.abs(hzToMidi(p.hz) - hzToMidi(110))).toBeLessThan(0.15);
  });

  it("reports silence and noise as unpitched", () => {
    expect(yin.detect(new Float32Array(N)).hz).toBe(0);
    let seed = 1;
    const noise = new Float32Array(N).map(() => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.5;
    });
    const p = yin.detect(noise);
    expect(p.hz === 0 || p.confidence < 0.6).toBe(true);
  });

  it("converts Hz to MIDI", () => {
    expect(hzToMidi(440)).toBeCloseTo(69);
    expect(hzToMidi(261.63)).toBeCloseTo(60, 1);
  });
});
