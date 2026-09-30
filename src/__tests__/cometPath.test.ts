import * as THREE from "three";
import {
  CometFrames,
  CometPath,
  CometShape,
  confirmPitches,
  RING_SPACING,
  springStep,
  tubeIndex,
  writeTube,
} from "../components/orb/cometPath";
import { voicePoint } from "../components/orb/voiceLayout";

const HOP = 2048 / 44100;

/** Frames from a list of pitches (NaN = rest), all at the same loudness. */
const framesFrom = (midi: number[], energy = 0.6): CometFrames => {
  const n = midi.length;
  const frames: CometFrames = {
    n,
    midi: new Float32Array(n),
    voiced: new Uint8Array(n),
    energy: new Float32Array(n).fill(energy),
    firstTime: 0,
    hop: HOP,
  };
  const firstPitch = midi.find((m) => !Number.isNaN(m)) ?? NaN;
  let last = firstPitch;
  midi.forEach((m, i) => {
    frames.voiced[i] = Number.isNaN(m) ? 0 : 1;
    if (!Number.isNaN(m)) last = m;
    frames.midi[i] = last; // rests keep the last pitch
  });
  return frames;
};

const shapeAt = (t: number, blend: number): CometShape => ({ t, tailSeconds: 2.5, blend, spread: 1, base: 0.01, gain: 0.015 });

const point = (path: CometPath, i: number) => new THREE.Vector3(path.x[i], path.y[i], path.z[i]);

/** The path's tightest bend: the smallest radius of curvature between neighbouring rings. */
const tightestBend = (path: CometPath) => {
  let tightest = Infinity;
  for (let i = 1; i + 1 < path.count; i++) {
    if (path.phrase[i - 1] !== path.phrase[i] || path.phrase[i + 1] !== path.phrase[i]) continue;
    const a = point(path, i).sub(point(path, i - 1));
    const b = point(path, i + 1).sub(point(path, i));
    const angle = a.angleTo(b);
    if (angle > 1e-6) tightest = Math.min(tightest, (a.length() + b.length()) / 2 / angle);
  }
  return tightest;
};

const build = (midi: number[], blend: number, extra = 0.01, rings = 1000) => {
  const path = new CometPath(200, rings);
  path.build(framesFrom(midi), shapeAt((midi.length - 1) * HOP + extra, blend));
  return path;
};

describe("comet path", () => {
  it("steps its spring exactly: two half steps land where one full step does", () => {
    const whole = { x: 0, v: 0.3 };
    const halves = { x: 0, v: 0.3 };
    springStep(whole, 1, 0.05, 28);
    springStep(halves, 1, 0.025, 28);
    springStep(halves, 1, 0.025, 28);
    expect(halves.x).toBeCloseTo(whole.x, 10);
    expect(halves.v).toBeCloseTo(whole.v, 10);
  });

  it("settles on a new note without overshooting from rest", () => {
    const s = { x: 0, v: 0 };
    let highest = 0;
    for (let i = 0; i < 100; i++) {
      springStep(s, 1, 0.01, 2 / 0.07);
      highest = Math.max(highest, s.x);
    }
    expect(highest).toBeLessThanOrEqual(1 + 1e-9);
    expect(s.x).toBeCloseTo(1, 4);
  });

  it("ignores a one-frame glitch and moves to a real change a frame late", () => {
    const midi = new Float32Array([60, 60, 72, 60, 60, 64, 64, 64, NaN, 67, 67.3, 67.6]);
    confirmPitches(midi, midi.length);
    expect(Array.from(midi.slice(0, 5))).toEqual([60, 60, 60, 60, 60]); // octave glitch gone
    expect(Array.from(midi.slice(5, 8))).toEqual([60, 64, 64]); // held a frame, then moves
    expect(Number.isNaN(midi[8])).toBe(true);
    expect(Array.from(midi.slice(9))).toEqual([67, 67.3, 67.6].map(Math.fround)); // a slide passes straight through
  });

  it("rounds every change of direction: no corners, even where the comet nearly stops", () => {
    // A staircase (around the circle of fifths, then out an octave, and so
    // on) in the harmony view, and a run up the helix in the melody view. A
    // lag that follows each note directly turns a corner at every step.
    const stairs = [48, 55, 67, 74, 86, 93];
    const run = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
    for (const [notes, blend] of [
      [stairs, 0],
      [run, 1],
    ] as const) {
      for (const hold of [2, 3, 6]) {
        const midi: number[] = [];
        for (const note of notes) for (let k = 0; k < hold; k++) midi.push(note);
        const path = build(midi, blend);
        expect(path.count).toBeGreaterThan(60);
        expect(tightestBend(path)).toBeGreaterThan(0.03);
      }
    }
  });

  it("spaces rings evenly along the path, however fast the comet moves", () => {
    const midi: number[] = [];
    for (const note of [60, 61, 60, 61, 60, 61]) midi.push(note, note, note, note); // half steps swing across the circle
    const path = build(midi, 0, 0.01, 4000);
    let widest = 0;
    for (let i = 1; i < path.count; i++) {
      if (path.phrase[i] === path.phrase[i - 1]) widest = Math.max(widest, point(path, i).distanceTo(point(path, i - 1)));
    }
    expect(widest).toBeLessThan(RING_SPACING * 1.4); // the ring at a phrase's end may sit a little further on
    // With fewer rings to spare, they spread out evenly instead of running out before the head.
    const short = build(midi, 0, 0.01, 300);
    expect(short.count).toBeLessThanOrEqual(300);
    expect(short.sounding).toBe(true);
    expect(point(short, short.count - 1).distanceTo(short.head)).toBeLessThan(1e-6);
  });

  it("keeps the head moving smoothly from one frame to the next", () => {
    const midi = [60, 60, 60, 67, 67, 67, 64, 64, 64, 72, 72];
    const path = new CometPath(200, 1000);
    for (let k = 3; k < midi.length - 1; k++) {
      path.build(framesFrom(midi.slice(0, k + 1)), shapeAt((k + 1) * HOP - 1e-6, 1));
      const before = path.head.clone();
      path.build(framesFrom(midi.slice(0, k + 2)), shapeAt((k + 1) * HOP, 1));
      expect(path.head.distanceTo(before)).toBeLessThan(1e-4);
    }
  });

  it("never jerks the head: its velocity changes gradually, even when a new note starts", () => {
    // Sample the head every 2 ms across a leap of a major third. A lag that
    // follows each note directly jumps to full speed the moment the note
    // changes (about 80% of its top speed in one step); the spring eases in.
    const midi = [60, 60, 60, 60, 64, 64, 64, 64, 64, 64];
    const path = new CometPath(200, 1000);
    const dt = 0.002;
    const heads: THREE.Vector3[] = [];
    for (let t = 3 * HOP; t < 7 * HOP; t += dt) {
      const frames = Math.floor(t / HOP + 1e-9) + 1;
      path.build(framesFrom(midi.slice(0, frames)), shapeAt(t, 1));
      heads.push(path.head.clone());
    }
    const velocity = heads.slice(1).map((h, i) => h.clone().sub(heads[i]).divideScalar(dt));
    const top = Math.max(...velocity.map((v) => v.length()));
    let jolt = 0;
    for (let i = 1; i < velocity.length; i++) jolt = Math.max(jolt, velocity[i].distanceTo(velocity[i - 1]));
    expect(top).toBeGreaterThan(5);
    expect(jolt / top).toBeLessThan(0.25);
  });

  it("starts a phrase on its note after a rest, with round ends and nothing across the gap", () => {
    const midi = [60, 60, 60, 60, 60, 60, 62, 62, 62, NaN, NaN, NaN, NaN, NaN, NaN, 67, 67, 67, 69, 69, 71, 71];
    const path = build(midi, 1, 0.02);
    let start = -1;
    for (let i = 1; i < path.count && start < 0; i++) if (path.phrase[i] !== path.phrase[i - 1]) start = i;
    expect(start).toBeGreaterThan(0);
    expect(path.phrase[path.count - 1]).toBe(1); // two phrases
    // The new phrase starts on its note: no swoop over from the last one.
    expect(point(path, start).distanceTo(voicePoint(67, 1, 1, new THREE.Vector3()))).toBeLessThan(1e-5);
    // Each phrase's ends taper to a point (but not the head's).
    expect(path.radius[start]).toBe(0);
    expect(path.radius[start - 1]).toBe(0);
    expect(path.sounding).toBe(true);
    expect(path.radius[path.count - 1]).toBeGreaterThan(0.01);
    expect(path.headRadius).toBeCloseTo(0.01 + 0.015 * 0.6, 3);
  });

  it("doesn't pile up rings where the comet sits still", () => {
    const path = build(new Array(50).fill(64), 0, 0.03);
    expect(path.count).toBeLessThanOrEqual(2);
    expect(path.sounding).toBe(true);
  });

  it("wraps a tube around the path at its radius", () => {
    const path = build([60, 60, 62, 62, 64, 64, 65, 65, 67, 67, 69, 69], 1);
    const segments = 8;
    const position = new Float32Array(path.count * segments * 3);
    const normal = new Float32Array(path.count * segments * 3);
    const rings = writeTube(path, 1, segments, position, normal);
    expect(rings).toBe(path.count);
    for (let i = 0; i < rings; i += 7) {
      const centre = point(path, i);
      for (let j = 0; j < segments; j++) {
        const v = (i * segments + j) * 3;
        const at = new THREE.Vector3(position[v], position[v + 1], position[v + 2]);
        expect(at.distanceTo(centre)).toBeCloseTo(path.radius[i], 6);
        expect(Math.hypot(normal[v], normal[v + 1], normal[v + 2])).toBeCloseTo(1, 5);
      }
    }
    expect(tubeIndex(rings, segments).length).toBe((rings - 1) * segments * 6);
  });
});
