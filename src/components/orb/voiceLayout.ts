import * as THREE from "three";
import { octaveRadius } from "./layout";

/**
 * Where a voice's pitch sits in each view. Time isn't an axis: each voice is
 * a comet at its current pitch, and its tail is where it has just been.
 *
 * Harmony view (the orb's own layout, on the equator): around = the note's
 * place on the circle of fifths, out = octave. Chords read as compact shapes;
 * a scale zigzags, because a half step is five positions away on the circle.
 *
 * Melody view (a pitch helix, like the original Audioforma cylinder): around
 * = the note in semitone order, one turn per octave, so height is pitch. A
 * rising line spirals up; contour reads directly.
 */

export const HELIX_RADIUS = 0.9;
/** Height of C1; each octave climbs HELIX_OCTAVE_HEIGHT. */
export const HELIX_BOTTOM = -1.25;
export const HELIX_OCTAVE_HEIGHT = 0.36;
export const HELIX_LOWEST_MIDI = 24; // C1

/**
 * How far above the equator the camera looks in each view (radians): from
 * above for the flat harmony disc, nearly side-on for the helix.
 */
export const HARMONY_ELEVATION = 0.62;
export const MELODY_ELEVATION = 0.2;

/** Position of a pitch class on the circle of fifths, in steps (C=0, G=1, ... F=11). */
export const fifthsStep = (pitchClass: number) => (((pitchClass * 7) % 12) + 12) % 12;

const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export type Cylinder = { theta: number; r: number; y: number };

const harmonyTheta = (midi: number) => {
  const nearest = Math.round(midi);
  const pitchClass = ((nearest % 12) + 12) % 12;
  // Bends and vibrato show as a small sway around the note's spoke (±50 cents = ±0.1 rad).
  return (fifthsStep(pitchClass) / 12) * TAU + (midi - nearest) * 0.2;
};
const harmonyRadius = (midi: number, spread: number) => Math.max(0.12, octaveRadius(midi / 12 - 1, spread));
const melodyHeight = (midi: number) => HELIX_BOTTOM + ((midi - HELIX_LOWEST_MIDI) / 12) * HELIX_OCTAVE_HEIGHT;

/**
 * A pitch's place in a blend of the views (0 = harmony, 1 = melody), in
 * cylindrical coordinates: angle around the vertical axis, distance from it,
 * height. Tails are smoothed in these coordinates, so a leap swings around
 * the orb, the way a line moves on the circle, instead of cutting through it.
 */
export const voiceCylinder = (midi: number, blend: number, spread: number, out: Cylinder): Cylinder => {
  const theta = harmonyTheta(midi);
  const r = harmonyRadius(midi, spread);
  if (blend <= 0) {
    out.theta = theta;
    out.r = r;
    out.y = 0;
    return out;
  }
  // Ease so the morph starts and lands gently.
  const k = blend >= 1 ? 1 : blend * blend * (3 - 2 * blend);
  out.theta = theta + wrap((midi / 12) * TAU - theta) * k; // C lands at angle 0 in both views
  out.r = r + (HELIX_RADIUS - r) * k;
  out.y = melodyHeight(midi) * k;
  return out;
};

export const cylinderPoint = (c: Cylinder, out: THREE.Vector3) =>
  out.set(c.r * Math.cos(c.theta), c.y, c.r * Math.sin(c.theta));

const scratch: Cylinder = { theta: 0, r: 0, y: 0 };

/** A pitch's position in a blend of the views (0 = harmony, 1 = melody). */
export const voicePoint = (midi: number, blend: number, spread: number, out: THREE.Vector3) =>
  cylinderPoint(voiceCylinder(midi, blend, spread, scratch), out);

export const harmonyPoint = (midi: number, spread: number, out: THREE.Vector3) => voicePoint(midi, 0, spread, out);
export const melodyPoint = (midi: number, out: THREE.Vector3) => voicePoint(midi, 1, 1, out);

/** Shortest signed turn from angle a to angle b. */
export const turnBetween = (a: number, b: number) => wrap(b - a);

/** MIDI note of a vein (octave-major index, octave 1 first). */
export const veinMidi = (vein: number) => 24 + vein; // vein 0 = C1 = MIDI 24
