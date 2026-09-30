# Audioforma

![build](https://github.com/jaspercroome/audioforma-chrome-extension-ts/workflows/build/badge.svg)

Chrome Extension, TypeScript and Visual Studio Code

## Prerequisites

- [node + npm](https://nodejs.org/) (Current Version)

## Option

- [Visual Studio Code](https://code.visualstudio.com/)

## Includes the following

- TypeScript
- Webpack
- React
- Jest
- Example Code
  - Chrome Storage
  - Options Version 2
  - content script
  - count up badge number
  - background

## Project Structure

- src: TypeScript source files
- public: public assets, including manifest.json
- dist: Chrome Extension directory
- dist/js: Generated JavaScript files

## Setup

```
npm install
```

## Import as Visual Studio Code project

...

## Build

```
npm run build
```

## Build in watch mode

### terminal

```
npm run watch
```

### Visual Studio Code

Run watch mode.

type `Ctrl + Shift + B`

## Load extension to chrome

Load `dist` directory

## Test

`npx jest` or `npm run test`

## Orb mode

The default view. A glass orb floats in a white studio. Every note in every
octave has its own vein (12 notes × 8 octaves = 96), and the orb is a chart
with three axes:

- **Around: the circle of fifths.** A note's direction from the centre is its
  place on the circle, so neighbours a fifth apart sit side by side and a
  tritone sits across the orb. Colour follows the same circle, one hue per
  step: warm on the sharp side (G orange, D amber, A yellow), cool on the flat
  side (Bb purple, Eb violet, Ab blue).
- **Out: the octave.** Octave 1 sits near the core and each octave is one
  step further out. At the default spread, octaves 1–5 (bass up to about
  1 kHz, where most voices and instruments live) are inside the glass and
  octaves 6–8 (overtones and air) float outside it. The **Octave spread**
  slider pulls them in or pushes them apart.
- **Up and down: time.** The equator is now. Each vein's last four seconds
  stream from the equator toward both poles, so a held note draws a long,
  even vein, a repeated note draws a string of beads, and a melody draws a
  staircase across neighbouring veins. Loudness is thickness.

On top of that:

- **Attacks** flash white at the equator the moment a note is struck.
- **Drum hits** etch rings into the glass that travel poleward with the
  veins, forming a beat grid: kicks draw wide rings, snares medium, hats fine.
  Kicks also give the orb a small heartbeat.
- **The seed of light** at the centre takes its hue from the harmonic centre
  of gravity.
- **Mood lighting (experimental)** tracks a slow-moving sense of home and
  warms the room when the harmony leans sharpward of it, cools it when it
  leans flatward (the minor iv in a major key is the classic example).

### How the analysis works

1. Meyda extracts features from 4096-sample frames every 2048 samples
   (~23 frames a second at 48 kHz).
2. `processPowerSpectrum` maps 48 log-spaced bins per octave to notes and
   scores each bin with a harmonic/percussive mask (median-filter HPSS over
   about 0.4 s), so drums and hiss don't light up notes.
3. `LowBandAnalyzer` handles notes below C4 with a 16384-sample FFT and peak
   interpolation, since 4096-sample bins are several semitones wide there.
4. `OrbAnalyzer` sums everything into one level per note and octave (with
   automatic gain per octave and an absolute floor, so silence and faint
   noise stay dark), detects note attacks against each note's recent peak,
   finds drum hits in the percussive part (low, mid and high bands), and
   tracks energy and the here/home/lean feeling layer.

## Voices mode: stems as separate bodies

The preview's **Voices** view draws each instrument on its own, from stems,
so you can watch, say, a horn line and the piano's chords move around each
other. There's no time axis: every voice is where it sounds now.

- **A melodic line** (voice, horn, bass) is a comet. It is pitch-tracked with
  YIN, which works on an isolated stem though not on a full mix, so the line
  is continuous: bends and slides show. The comet is a dot that glides from
  note to note and trails a solid stroke of where it has just been, paling as
  it ages and broken by rests.
- **Chords** (piano, guitar) are constellations: every clearly sounding note
  is a dot where it is, shrinking and falling back as it fades, and the chord
  sounding now is joined into its shape.
- **Drums** are the rings on the glass. With a drum stem, onsets are clean:
  no more bass notes counted as kicks. A hit flashes a ring at the equator
  that fades where it is.
- **Colour is the instrument.** M and S mute and solo stems; muted stems fade
  to a ghost, so you see what you hear.

Everything is inside the glass, on three axes:

- **Up: pitch.** C4 is at the equator; low notes sit low in the orb, high
  notes high.
- **Around: the note.** In the **Harmony** view, by its place on the circle of
  fifths, so voicings read as shapes: stacked fourths (the "So What" chord)
  sit on neighbouring spokes. In the **Melody** view, in semitone order, one
  turn per octave: a pitch helix, like the original Audioforma cylinder, so a
  rising line spirals up. Faint meridians mark the twelve notes (C's is
  darker); the switch between views animates.
- **Out: loudness.** A note at the stem's peak reaches for the glass; as it
  fades it falls back toward the middle (30 dB of range). How far out a voice
  can go narrows toward the top and bottom, following the glass.

The shapes are flat and matte, drawn after the glass rather than through it
(the glass renders what's inside it into a buffer without antialiasing, which
turned thin lines jagged).

How the comet moves (`cometPath.ts`): each pitch pulls it with a critically
damped spring (the smoothing in maath's `easing.damp`, in exact form), so it
never snaps into a new direction; it eases out of one note and into the next,
and a quick run rounds into a curve. A one-frame pitch glitch (an octave
error) is ignored: a new note has to hold for two frames. The path is sampled
finely, resampled evenly along its length and smoothed more further back, so
where the comet sat on a note and set off somewhere new, the tail relaxes
into a curve.

Stems come from:

- **Demo stems**: the synthesized demo rendered one instrument per stem.
- **Your stem service** ([audioforma-stems](https://github.com/jaspercroome/audioforma-stems),
  `/api/stream`): run it locally, open the preview from `localhost`, and
  choose a song. Stems stream back chunk by chunk while Demucs is still
  separating. All stems play from one audio clock, sample-aligned, and each is
  analysed in its own worker. Playback starts once enough is ready, and pauses
  to buffer if separation falls behind.

The code is in `src/stems/` (per-stem analysis, timelines, player, session,
service client, worker) and `src/components/orb/Voices.tsx` with
`voiceLayout.ts`.

## Preview without the extension

```
npm run build:preview
npx http-server preview-dist
```

Open `index.html`. The preview runs the same components and analysis on a
synthesized demo (bright C–G–Am–F, then a melancholy Am–F–Fm–C), on an audio
file you drop in, or on stems (see Voices mode). `preview/audioforma-orb.html`
is the page itself, written without an `<html>` wrapper so it can also be
published as a hosted page; the build wraps it. The build also emits
`stemWorker.js`, which the page loads from next to itself.
