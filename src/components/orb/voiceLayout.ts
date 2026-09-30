import * as THREE from "three";
import { GLASS_RADIUS } from "./layout";

/**
 * Where a voice sits in the orb. Time isn't an axis: each voice is a comet at
 * its current pitch, and its tail is where it has just been.
 *
 * - Up: pitch. Low notes sit low in the orb, high notes high.
 * - Around: the note. In the harmony view by its place on the circle of
 *   fifths, so a chord reads as a compact shape; in the melody view in
 *   semitone order, one turn per octave, so a rising line spirals up.
 * - Out: loudness. A loud note reaches for the glass; as it fades it falls
 *   back toward the axis.
 *
 * Everything stays inside the glass: how far out a voice can go shrinks
 * toward the top and bottom of the orb.
 */

/** C4 sits at the orb's equator. */
export const PITCH_CENTRE = 60;
/** Height per octave: C1 to C7 spans most of the orb. */
export const HEIGHT_PER_OCTAVE = 0.235;
/** Highest and lowest a voice goes (about C8 and C0). */
export const MAX_HEIGHT = 0.86;
/** Furthest out a voice goes, as a share of the glass's radius at its height. */
export const REACH = 0.9;
/** A sounding note never sits quite on the axis, where the angle would be lost. */
export const OUT_MIN = 0.1;
/** Loudness range drawn: this many dB below the stem's peak lands on the axis. */
export const LOUDNESS_DB = 30;

/**
 * Camera elevation in each view (radians above the equator): a little above
 * for the harmony view, so chords read as shapes, nearly side-on for the
 * melody helix, so height reads as pitch.
 */
export const HARMONY_ELEVATION = 0.5;
export const MELODY_ELEVATION = 0.22;

/** Position of a pitch class on the circle of fifths, in steps (C=0, G=1, ... F=11). */
export const fifthsStep = (pitchClass: number) => (((pitchClass * 7) % 12) + 12) % 12;

const TAU = Math.PI * 2;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Height of a pitch in the orb. */
export const pitchHeight = (midi: number) =>
  clamp(((midi - PITCH_CENTRE) / 12) * HEIGHT_PER_OCTAVE, -MAX_HEIGHT, MAX_HEIGHT);

/** Furthest out a voice can go at height y: just inside the glass. */
export const reachAt = (y: number) => REACH * Math.sqrt(Math.max(0, GLASS_RADIUS * GLASS_RADIUS - y * y));

/**
 * How far out a level puts a note, 0 (the axis) to 1 (the reach): decibels
 * below the stem's peak, so it follows loudness as heard. `level` is relative
 * to the stem's own peak (0-1).
 */
export const loudnessOut = (level: number) =>
  level <= 0 ? 0 : clamp(1 + (20 * Math.log10(level)) / LOUDNESS_DB, 0, 1);

/**
 * The angle of a pitch in a blend of the views (0 = harmony, 1 = melody).
 * Bends and vibrato show as a small sway in the harmony view (±50 cents =
 * ±0.1 rad around the note's spoke); in the melody view the angle follows
 * the pitch continuously. The morph turns the short way round.
 */
export const voiceAngle = (midi: number, blend: number) => {
  const nearest = Math.round(midi);
  const pitchClass = ((nearest % 12) + 12) % 12;
  const harmony = (fifthsStep(pitchClass) / 12) * TAU + (midi - nearest) * 0.2;
  if (blend <= 0) return harmony;
  const melody = (midi / 12) * TAU; // C lands at angle 0 in both views
  const k = blend >= 1 ? 1 : blend * blend * (3 - 2 * blend);
  return harmony + wrap(melody - harmony) * k;
};

/** A point from angle, height and how far out (0-1, see loudnessOut). */
export const placePoint = (theta: number, y: number, out: number, target: THREE.Vector3) => {
  const r = reachAt(y) * (OUT_MIN + (1 - OUT_MIN) * clamp(out, 0, 1));
  return target.set(r * Math.cos(theta), y, r * Math.sin(theta));
};

/** Where a pitch sounds at a given loudness (out, 0-1), in a blend of the views. */
export const voicePoint = (midi: number, blend: number, out: number, target: THREE.Vector3) =>
  placePoint(voiceAngle(midi, blend), pitchHeight(midi), out, target);

/** Shortest signed turn from angle a to angle b. */
export const turnBetween = (a: number, b: number) => wrap(b - a);

/** MIDI note of a vein (octave-major index, octave 1 first). */
export const veinMidi = (vein: number) => 24 + vein; // vein 0 = C1 = MIDI 24
