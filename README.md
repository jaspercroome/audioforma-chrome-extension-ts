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

## Preview without the extension

```
npm run build:preview
npx http-server preview-dist
```

Open `index.html`. The preview runs the same components and analysis on a
synthesized demo (bright C–G–Am–F, then a melancholy Am–F–Fm–C) or on an
audio file you drop in. `preview/audioforma-orb.html` is the page itself,
written without an `<html>` wrapper so it can also be published as a hosted
page; the build wraps it.
