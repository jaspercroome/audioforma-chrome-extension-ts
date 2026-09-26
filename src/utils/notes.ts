import { NOTE_FREQUENCIES, noteAngles, noteNames, NoteName } from "./consts";

const C0 = NOTE_FREQUENCIES[NoteName.C];

export type NoteInfo = { note: NoteName; octave: number; cents: number };

/**
 * Map a frequency to its nearest equal-tempered note.
 *
 * Rounds to the nearest semitone *before* splitting into octave and pitch
 * class. The old version took the octave from the unrounded value, so energy
 * slightly flat of a C was filed under the C an octave down with a cents
 * offset of ~+1150 (and a weight of about -22).
 */
export const frequencyToNote = (frequency: number): NoteInfo => {
  const semitonesFromC0 = 12 * Math.log2(frequency / C0);
  const nearest = Math.round(semitonesFromC0);
  const octave = Math.floor(nearest / 12);
  const pitchClass = ((nearest % 12) + 12) % 12;
  const note = noteNames[pitchClass];
  const cents = Math.round((semitonesFromC0 - nearest) * 100);
  return { note, octave, cents };
};

const NOTE_KEY = /^([A-G]#?)(-?\d+)$/;

/**
 * Parse a "C#10"-style key. The old code read the octave from the last
 * character only, so octave 10 (16.7 kHz and up) was drawn as octave 0.
 */
export const parseNoteKey = (key: string): { note: NoteName; octave: number } | null => {
  const match = NOTE_KEY.exec(key);
  if (!match) return null;
  return { note: match[1] as NoteName, octave: Number(match[2]) };
};

/** Position of a pitch class around the circle of fifths: C=0, G=1, D=2 ... F=11. */
export const fifthsIndex = (note: NoteName): number => noteAngles[note] / 30;

/** Pitch class number (C=0 ... B=11). */
export const pitchClass = (note: NoteName): number =>
  Number(Object.keys(noteNames).find((k) => noteNames[Number(k)] === note));

/**
 * Angle (radians) of a note on the circle of fifths, shared by every 3D layer
 * so points, rings and segments line up. `offsetDeg` rotates the whole circle;
 * cents nudge within the note's 30° slice (±50 cents = ±15°).
 */
export const noteAngleRad = (note: NoteName, cents = 0, offsetDeg = -60): number =>
  ((noteAngles[note] + offsetDeg + (cents / 100) * 30) / 180) * Math.PI;
