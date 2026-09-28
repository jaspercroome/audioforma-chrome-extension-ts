import { FIRST_OCTAVE, OCTAVES } from "../../utils/orbAnalysis";

/**
 * Where things sit in the orb.
 *
 *  - Azimuth (around the vertical axis) is the note's place on the circle of fifths.
 *  - Distance from the centre is the octave: octave 1 near the core, octave 8
 *    furthest out. With the default spread, octaves 1-5 (up to ~1 kHz, where
 *    most instruments and voices have their fundamentals) sit inside the glass
 *    and octaves 6-8 (overtones and air) float outside it.
 *  - Latitude is time: the equator is now, and each note's last few seconds
 *    stream toward both poles.
 */

/** Seconds of history drawn along each vein, equator to tip. */
export const HISTORY_SECONDS = 4;
/** History samples per second (columns in the history texture). */
export const HISTORY_RATE = 48;
export const HISTORY_COLUMNS = HISTORY_SECONDS * HISTORY_RATE;
/** Veins stop short of the poles, where they would all converge. */
export const LATITUDE_MAX = (72 * Math.PI) / 180;
/** The glass shell's radius. */
export const GLASS_RADIUS = 1;

export const INNER_RADIUS = 0.22;
export const OUTER_REACH = 1.28;
export const CURVE = 1;

/** 0-1 position of an octave between the innermost and outermost shell. */
export const octaveFraction = (octave: number) => (octave - FIRST_OCTAVE) / (OCTAVES - 1);

/**
 * Radius of an octave's shell: evenly spaced, one step per octave. `spread`
 * scales the distance between octaves: 1 is the default (octave 8 at 1.5x the
 * glass), ~0.6 keeps everything inside the glass, and higher values push the
 * treble further out.
 */
export const octaveRadius = (octave: number, spread = 1) =>
  INNER_RADIUS + OUTER_REACH * spread * Math.pow(octaveFraction(octave), CURVE);

/** Radius of the outermost shell, for framing the camera. */
export const outerRadius = (spread = 1) => Math.max(GLASS_RADIUS, octaveRadius(FIRST_OCTAVE + OCTAVES - 1, spread));

/** Latitude (radians) that a moment `secondsAgo` has travelled to. */
export const latitudeFor = (secondsAgo: number) => (Math.min(secondsAgo, HISTORY_SECONDS) / HISTORY_SECONDS) * LATITUDE_MAX;
