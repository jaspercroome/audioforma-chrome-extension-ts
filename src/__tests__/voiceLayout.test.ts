import * as THREE from "three";
import { GLASS_RADIUS } from "../components/orb/layout";
import {
  fifthsStep,
  HEIGHT_PER_OCTAVE,
  loudnessOut,
  LOUDNESS_DB,
  OUT_MIN,
  pitchHeight,
  reachAt,
  turnBetween,
  veinMidi,
  voiceAngle,
  voicePoint,
} from "../components/orb/voiceLayout";
import { veinIndex } from "../utils/orbAnalysis";

const p = () => new THREE.Vector3();
const deg = (v: THREE.Vector3) => ((Math.atan2(v.z, v.x) * 180) / Math.PI + 360) % 360;
/** Signed angular difference in degrees, wrapped to (-180, 180]. */
const turn = (from: THREE.Vector3, to: THREE.Vector3) => ((deg(to) - deg(from) + 540) % 360) - 180;
const outFromAxis = (v: THREE.Vector3) => Math.hypot(v.x, v.z);

describe("voice layout", () => {
  it("orders pitch classes around the circle of fifths", () => {
    expect([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map(fifthsStep)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("puts pitch up: C4 on the equator, an octave a fixed step higher, the same in both views", () => {
    expect(pitchHeight(60)).toBe(0);
    expect(pitchHeight(72) - pitchHeight(60)).toBeCloseTo(HEIGHT_PER_OCTAVE);
    expect(pitchHeight(36)).toBeLessThan(pitchHeight(48));
    for (const blend of [0, 0.5, 1]) expect(voicePoint(67, blend, 0.7, p()).y).toBeCloseTo(pitchHeight(67));
  });

  it("puts a note on its fifths spoke in the harmony view and in semitone order in the melody view", () => {
    expect(deg(voicePoint(67, 0, 1, p()))).toBeCloseTo(30); // G
    expect(deg(voicePoint(65, 0, 1, p()))).toBeCloseTo(330); // F
    expect(Math.abs(turn(voicePoint(60, 0, 1, p()), voicePoint(61, 0, 1, p())))).toBeCloseTo(150); // C to C#: five steps
    expect(turn(voicePoint(60, 1, 1, p()), voicePoint(61, 1, 1, p()))).toBeCloseTo(30);
    expect(turn(voicePoint(48, 1, 1, p()), voicePoint(72, 1, 1, p()))).toBeCloseTo(0); // octaves line up
  });

  it("puts loudness out: silence at the axis, the stem's peak at the glass", () => {
    expect(loudnessOut(1)).toBe(1);
    expect(loudnessOut(0)).toBe(0);
    expect(loudnessOut(Math.pow(10, -LOUDNESS_DB / 20))).toBeCloseTo(0);
    expect(loudnessOut(0.5)).toBeGreaterThan(loudnessOut(0.25));
    const quiet = outFromAxis(voicePoint(64, 0, 0, p()));
    const loud = outFromAxis(voicePoint(64, 0, 1, p()));
    expect(quiet).toBeCloseTo(reachAt(pitchHeight(64)) * OUT_MIN);
    expect(loud).toBeCloseTo(reachAt(pitchHeight(64)));
  });

  it("keeps every voice inside the glass, however high, low or loud", () => {
    for (let midi = 0; midi <= 127; midi += 0.5) {
      for (const out of [0, 0.5, 1]) {
        for (const blend of [0, 0.3, 1]) {
          expect(voicePoint(midi, blend, out, p()).length()).toBeLessThan(GLASS_RADIUS * 0.98);
        }
      }
    }
  });

  it("morphs between the views by turning around the axis, at the same height and distance", () => {
    for (const midi of [43, 55.4, 67, 79]) {
      const r = outFromAxis(voicePoint(midi, 0, 0.8, p()));
      for (const blend of [0.25, 0.5, 0.75, 1]) {
        const at = voicePoint(midi, blend, 0.8, p());
        expect(outFromAxis(at)).toBeCloseTo(r);
        expect(at.y).toBeCloseTo(pitchHeight(midi));
      }
    }
    // Halfway, the angle is between the two views' angles, the short way round.
    const harmony = voiceAngle(61, 0);
    const melody = voiceAngle(61, 1);
    expect(Math.abs(turnBetween(harmony, voiceAngle(61, 0.5)))).toBeLessThan(Math.abs(turnBetween(harmony, melody)));
  });

  it("turns the short way round", () => {
    expect(turnBetween(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
    expect(turnBetween(Math.PI * 2 - 0.1, 0.1)).toBeCloseTo(0.2);
  });

  it("maps veins to MIDI notes", () => {
    expect(veinMidi(veinIndex(4, 0))).toBe(60); // C4
    expect(veinMidi(veinIndex(1, 9))).toBe(33); // A1
  });
});
