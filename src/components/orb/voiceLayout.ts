import * as THREE from "three";
import { octaveRadius } from "./layout";

/**
 * Where a voice's pitch sits in each view, and where time takes it.
 *
 * Harmony view (the orb's own layout): around = the note's place on the
 * circle of fifths, out = octave, up = time (older rises, like smoke). Chords
 * read as compact shapes; a scale zigzags, because a half step is five
 * positions away on the circle.
 *
 * Melody view (a pitch helix, like the original Audioforma cylinder): around
 * = the note in semitone order, one turn per octave, so height is pitch;
 * out = time (older drifts outward). A rising line spirals up; contour reads
 * directly.
 */

export const HELIX_RADIUS = 0.9;
/** Height of C1; each octave climbs HELIX_OCTAVE_HEIGHT. */
export const HELIX_BOTTOM = -1.25;
export const HELIX_OCTAVE_HEIGHT = 0.36;
export const HELIX_LOWEST_MIDI = 24; // C1

/** How far a point travels per second of age, in each view. */
export const TIME_RISE = 0.32;
/**
 * Height of "now" in the harmony view. A little below the centre, so the last
 * few seconds rise through the middle of the orb rather than its top half.
 */
export const HARMONY_NOW_Y = -0.55;
export const TIME_DRIFT = 0.14;

/** Position of a pitch class on the circle of fifths, in steps (C=0, G=1, ... F=11). */
export const fifthsStep = (pitchClass: number) => (((pitchClass * 7) % 12) + 12) % 12;

const TAU = Math.PI * 2;

export const harmonyPoint = (midi: number, age: number, spread: number, out: THREE.Vector3) => {
  const nearest = Math.round(midi);
  const pitchClass = ((nearest % 12) + 12) % 12;
  // Bends and vibrato show as a small sway around the note's spoke (±50 cents = ±0.1 rad).
  const angle = (fifthsStep(pitchClass) / 12) * TAU + (midi - nearest) * 0.2;
  const radius = Math.max(0.12, octaveRadius(midi / 12 - 1, spread));
  return out.set(radius * Math.cos(angle), HARMONY_NOW_Y + age * TIME_RISE, radius * Math.sin(angle));
};

export const melodyPoint = (midi: number, age: number, out: THREE.Vector3) => {
  const angle = (midi / 12) * TAU; // C lands at angle 0 in both views
  const radius = HELIX_RADIUS + age * TIME_DRIFT;
  const y = HELIX_BOTTOM + ((midi - HELIX_LOWEST_MIDI) / 12) * HELIX_OCTAVE_HEIGHT;
  return out.set(radius * Math.cos(angle), y, radius * Math.sin(angle));
};

const scratch = new THREE.Vector3();

/** Position in a blend of the two views: 0 = harmony, 1 = melody. */
export const voicePoint = (midi: number, age: number, blend: number, spread: number, out: THREE.Vector3) => {
  if (blend <= 0) return harmonyPoint(midi, age, spread, out);
  if (blend >= 1) return melodyPoint(midi, age, out);
  harmonyPoint(midi, age, spread, out);
  melodyPoint(midi, age, scratch);
  // Ease so the morph starts and lands gently.
  const k = blend * blend * (3 - 2 * blend);
  return out.lerp(scratch, k);
};

export type Cylinder = { theta: number; r: number; y: number };

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The same position as voicePoint, in cylindrical coordinates (angle around
 * the vertical axis, distance from it, height). Trails are smoothed in these
 * coordinates so a leap arcs around the orb, the way a line moves on the
 * circle, instead of cutting straight through the middle.
 */
export const voiceCylinder = (midi: number, age: number, blend: number, spread: number, out: Cylinder): Cylinder => {
  const nearest = Math.round(midi);
  const pitchClass = ((nearest % 12) + 12) % 12;
  const harmonyTheta = (fifthsStep(pitchClass) / 12) * TAU + (midi - nearest) * 0.2;
  const harmonyR = Math.max(0.12, octaveRadius(midi / 12 - 1, spread));
  const harmonyY = HARMONY_NOW_Y + age * TIME_RISE;
  if (blend <= 0) {
    out.theta = harmonyTheta;
    out.r = harmonyR;
    out.y = harmonyY;
    return out;
  }
  const melodyTheta = (midi / 12) * TAU;
  const melodyR = HELIX_RADIUS + age * TIME_DRIFT;
  const melodyY = HELIX_BOTTOM + ((midi - HELIX_LOWEST_MIDI) / 12) * HELIX_OCTAVE_HEIGHT;
  const k = blend >= 1 ? 1 : blend * blend * (3 - 2 * blend);
  out.theta = harmonyTheta + wrap(melodyTheta - harmonyTheta) * k;
  out.r = harmonyR + (melodyR - harmonyR) * k;
  out.y = harmonyY + (melodyY - harmonyY) * k;
  return out;
};

export const cylinderPoint = (c: Cylinder, out: THREE.Vector3) =>
  out.set(c.r * Math.cos(c.theta), c.y, c.r * Math.sin(c.theta));

/** Shortest signed turn from angle a to angle b. */
export const turnBetween = (a: number, b: number) => wrap(b - a);

/** MIDI note of a vein (octave-major index, octave 1 first). */
export const veinMidi = (vein: number) => 24 + vein; // vein 0 = C1 = MIDI 24
