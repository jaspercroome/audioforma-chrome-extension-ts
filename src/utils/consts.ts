export type VisualSettings = {
  showKeySegments: boolean;
  showSoundFlower: boolean;
  showCircleOfFifths: boolean;
  keySegmentColor: string;
  pointSize: number;
  stickRadius: number;
  /** Orb: tint the room by the harmonic lean (experimental). */
  orbMood: boolean;
  /** Orb: slowly orbit the camera. */
  orbAutoRotate: boolean;
  /** Orb: distance between octave shells (1 = default; lower keeps them inside the glass). */
  orbSpread: number;
};

export type AudioFeatures = {
  powerSpectrum: number[];
  chroma: number[];
  spectralCentroid: number;
  spectralFlatness: number;
  spectralKurtosis: number;
  spectralRolloff: number;
  rms?: number;
  zcr?: number;
  perceptualSpread?: number;
}
export type AmpPoint = {
  note: NoteName;
  octave: number;
  cents: number;
  /** Treble-weighted amplitude (what the classic/3D views have always used). */
  amplitude: number;
  /** Unweighted amplitude, for harmony-oriented analysis. */
  rawAmplitude: number;
  /** Per-point harmonic score, 0 (percussive/noisy) to 1 (sustained, pitched). */
  harmonicity: number;
  /** Kept for compatibility; now equal to harmonicity. */
  tonality: number;
  brightness: number;
};
export type AmpArray = Array<AmpPoint>;
export const BUFFER_SIZE = 4096;
/**
 * Samples between analysis frames. Half the buffer, so frames overlap and the
 * visuals update every ~43 ms at 48 kHz instead of every ~85 ms.
 */
export const HOP_SIZE = 2048;

/** Meyda features every view needs; shared by the live analyzer and offline analysis. */
export const FEATURE_EXTRACTORS = [
  "powerSpectrum",
  "spectralCentroid",
  "spectralFlatness",
  "spectralKurtosis",
  "spectralRolloff",
  "chroma",
  "rms",
] as const;

export enum NoteName {
  'C' = 'C',
  'C#' = 'C#',
  'D' = 'D',
  'D#' = 'D#',
  'E' = 'E',
  'F' = 'F',
  'F#' = 'F#',
  'G' = 'G',
  'G#' = 'G#',
  'A' = 'A',
  'A#' = 'A#',
  'B' = 'B',
}

export const noteNames: { [key: number]: NoteName } = {
  0: NoteName.C,
  1: NoteName['C#'],
  2: NoteName.D,
  3: NoteName['D#'],
  4: NoteName.E,
  5: NoteName.F,
  6: NoteName['F#'],
  7: NoteName.G,
  8: NoteName['G#'],
  9: NoteName.A,
  10: NoteName['A#'],
  11: NoteName.B,
};
export const noteAngles: { [key in NoteName]: number } = {
  [NoteName.C]: 0,
  [NoteName['C#']]: 210,
  [NoteName.D]: 60,
  [NoteName['D#']]: 270,
  [NoteName.E]: 120,
  [NoteName.F]: 330,
  [NoteName['F#']]: 180,
  [NoteName.G]: 30,
  [NoteName['G#']]: 240,
  [NoteName.A]: 90,
  [NoteName['A#']]: 300,
  [NoteName.B]: 150,
};
export const NOTE_FREQUENCIES: { [key in NoteName]: number } = {
  [NoteName.C]: 16.35,
  [NoteName.D]: 18.35,
  [NoteName.E]: 20.6,
  [NoteName.F]: 21.83,
  [NoteName.G]: 24.5,
  [NoteName.A]: 27.5,
  [NoteName.B]: 30.87,
  [NoteName['C#']]: 17.32,
  [NoteName['D#']]: 19.45,
  [NoteName['F#']]: 23.12,
  [NoteName['G#']]: 25.96,
  [NoteName['A#']]: 29.14,
};

export const NOTES = Object.keys(NOTE_FREQUENCIES);

export const octaves = [0, 1, 2, 3, 4, 5, 6, 7].sort((a, b) => b - a);
/** Height between octave layers in the 3D view (shared by points, segments and flowers). */
export const OCTAVE_SPACING_3D = 1.5;
export const segmentArc = (Math.PI * 2) / Object.values(noteNames).length - 0.1;

export const defaultVisualSettings: VisualSettings = {
  showKeySegments: true,
  showSoundFlower: true,
  showCircleOfFifths: true,
  keySegmentColor: '#32ddef',
  pointSize: 0.05,
  stickRadius: 0.01,
  orbMood: true,
  orbAutoRotate: true,
  orbSpread: 1,
};

export const spotifyAccessTokenKey = 'af-spotifyAccessToken';
export const spotifyExpiryKey = 'af-spotifyExpiryTime';
export const spotifyRefreshTokenKey = 'af-spotifyRefreshToken';