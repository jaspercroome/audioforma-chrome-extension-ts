import { StemAnalyzer, FrameBatch } from "../stems/stemAnalysis";
import { StemTimeline } from "../stems/timeline";
import { veinIndex } from "../utils/orbAnalysis";
import { hzToMidi } from "../utils/pitch";

const SR = 44100;

/** A horn-ish line: a few notes with harmonics and short gaps between them. */
const melody = (notes: Array<[number, number]>) => {
  const total = notes.reduce((s, [, sec]) => s + sec, 0);
  const out = new Float32Array(Math.round(total * SR));
  let at = 0;
  for (const [hz, seconds] of notes) {
    const n = Math.round(seconds * SR);
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / 400, (n - i) / 2000);
      let v = 0;
      for (let h = 1; h <= 5; h++) v += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
      out[at + i] = 0.25 * env * (hz > 0 ? v : 0);
    }
    at += n;
  }
  return out;
};

const collect = (analyzer: StemAnalyzer, signal: Float32Array, pieces: number[]) => {
  const timeline = new StemTimeline(analyzer.hopSeconds, analyzer.firstFrameSeconds);
  let at = 0;
  let i = 0;
  while (at < signal.length) {
    const size = pieces[i++ % pieces.length];
    const batch = analyzer.push(signal.subarray(at, Math.min(signal.length, at + size)));
    if (batch) timeline.append(batch);
    at += size;
  }
  const tail = analyzer.finish();
  if (tail) timeline.append(tail);
  return timeline;
};

describe("StemAnalyzer", () => {
  const signal = melody([
    [233.08, 0.6], // Bb3
    [0, 0.15],
    [349.23, 0.6], // F4
    [0, 0.15],
    [293.66, 0.6], // D4
  ]);

  it("gives the same frames however the audio is chunked", () => {
    const whole = collect(new StemAnalyzer(SR, "melody"), signal, [signal.length]);
    const pieces = collect(new StemAnalyzer(SR, "melody"), signal, [1000, 7919, 333, 20000]);
    expect(pieces.count).toBe(whole.count);
    for (let k = 0; k < whole.count; k++) {
      expect(pieces.pitchHz(k)).toBe(whole.pitchHz(k));
      expect(pieces.global(k, veinIndex(3, 10))).toBe(whole.global(k, veinIndex(3, 10)));
    }
  });

  it("covers the whole stem, including the tail", () => {
    const t = collect(new StemAnalyzer(SR, "melody"), signal, [4096]);
    expect(t.readyUntil()).toBeGreaterThanOrEqual(signal.length / SR);
  });

  it("tracks the line's pitch and lights the right note", () => {
    const t = collect(new StemAnalyzer(SR, "melody"), signal, [5000]);
    const at = (seconds: number) => t.indexAt(seconds);
    const cases: Array<[number, number, number, number]> = [
      [0.45, 233.08, 3, 10], // Bb3
      [1.2, 349.23, 4, 5], // F4
      [1.95, 293.66, 4, 2], // D4
    ];
    for (const [seconds, hz, octave, pc] of cases) {
      const k = at(seconds);
      expect(Math.abs(hzToMidi(t.pitchHz(k)) - hzToMidi(hz))).toBeLessThan(0.2);
      expect(t.pitchConfidence(k)).toBeGreaterThan(0.8);
      expect(t.global(k, veinIndex(octave, pc))).toBeGreaterThan(0.5);
    }
    // In the gap there is no pitch.
    expect(t.pitchHz(at(0.72))).toBe(0);
  });

  it("packs frames that round-trip into orb frames", () => {
    const t = collect(new StemAnalyzer(SR, "mix"), signal, [8192]);
    const frame = t.toOrbFrame(t.indexAt(1.2));
    expect(frame.time).toBeCloseTo(t.timeOf(t.indexAt(1.2)));
    expect(frame.global[veinIndex(4, 5)]).toBeGreaterThan(0.5);
    expect(frame.energy).toBeGreaterThan(0);
  });

  it("rejects batches out of order", () => {
    const t = new StemTimeline(0.05, 0.1);
    const batch: FrameBatch = { firstIndex: 3, count: 1, bytes: new Uint8Array(291), floats: new Float32Array(10) };
    expect(() => t.append(batch)).toThrow();
  });
});
