import * as THREE from "three";
import {
  cylinderPoint,
  fifthsStep,
  harmonyPoint,
  HELIX_OCTAVE_HEIGHT,
  melodyPoint,
  TIME_DRIFT,
  TIME_RISE,
  turnBetween,
  veinMidi,
  voiceCylinder,
  voicePoint,
} from "../components/orb/voiceLayout";
import { veinIndex } from "../utils/orbAnalysis";

const angle = (v: THREE.Vector3) => (Math.atan2(v.z, v.x) + Math.PI * 2) % (Math.PI * 2);
const deg = (v: THREE.Vector3) => (angle(v) * 180) / Math.PI;
const p = () => new THREE.Vector3();
/** Signed angular difference in degrees, wrapped to (-180, 180]. */
const turn = (from: THREE.Vector3, to: THREE.Vector3) => {
  const d = (deg(to) - deg(from) + 540) % 360;
  return d - 180;
};

describe("voice layout", () => {
  it("orders pitch classes around the circle of fifths", () => {
    expect([0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map(fifthsStep)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("puts a note on its fifths spoke in the harmony view, octave outward", () => {
    expect(deg(harmonyPoint(67, 0, 1, p()))).toBeCloseTo(30); // G
    expect(deg(harmonyPoint(65, 0, 1, p()))).toBeCloseTo(330); // F
    const c3 = harmonyPoint(48, 0, 1, p()).length();
    const c5 = harmonyPoint(72, 0, 1, p()).length();
    expect(c5).toBeGreaterThan(c3);
    expect(turn(harmonyPoint(48, 0, 1, p()), harmonyPoint(72, 0, 1, p()))).toBeCloseTo(0); // same spoke
  });

  it("makes a half step jump across the orb in harmony, but a small step on the helix", () => {
    expect(Math.abs(turn(harmonyPoint(60, 0, 1, p()), harmonyPoint(61, 0, 1, p())))).toBeCloseTo(150); // C to C#: five steps
    expect(turn(melodyPoint(60, 0, p()), melodyPoint(61, 0, p()))).toBeCloseTo(30);
  });

  it("climbs one turn per octave on the helix", () => {
    const low = melodyPoint(60, 0, p());
    const high = melodyPoint(72, 0, p());
    expect(high.y - low.y).toBeCloseTo(HELIX_OCTAVE_HEIGHT);
    expect(turn(low, high)).toBeCloseTo(0); // same angle, one octave up
  });

  it("moves older points along each view's time axis", () => {
    expect(harmonyPoint(60, 2, 1, p()).y - harmonyPoint(60, 0, 1, p()).y).toBeCloseTo(2 * TIME_RISE);
    const r0 = Math.hypot(melodyPoint(60, 0, p()).x, melodyPoint(60, 0, p()).z);
    const r2 = Math.hypot(melodyPoint(60, 2, p()).x, melodyPoint(60, 2, p()).z);
    expect(r2 - r0).toBeCloseTo(2 * TIME_DRIFT);
  });

  it("blends between the views", () => {
    const a = voicePoint(64, 1, 0, 1, p());
    const b = voicePoint(64, 1, 1, 1, p());
    const mid = voicePoint(64, 1, 0.5, 1, p());
    expect(a.distanceTo(harmonyPoint(64, 1, 1, p()))).toBeCloseTo(0);
    expect(b.distanceTo(melodyPoint(64, 1, p()))).toBeCloseTo(0);
    expect(mid.distanceTo(a.clone().lerp(b, 0.5))).toBeCloseTo(0);
  });

  it("gives the same positions in cylindrical coordinates", () => {
    const c = { theta: 0, r: 0, y: 0 };
    for (const blend of [0, 1]) {
      for (const midi of [30, 55.3, 67, 90]) {
        const direct = voicePoint(midi, 1.5, blend, 1, p());
        const viaCylinder = cylinderPoint(voiceCylinder(midi, 1.5, blend, 1, c), p());
        expect(direct.distanceTo(viaCylinder)).toBeCloseTo(0, 5);
      }
    }
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
