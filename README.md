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

The default view. A glass orb floats in a white studio; every note is a vein
wrapped around it.

- **Veins are notes.** 36 veins: 12 pitch classes in three registers. Low
  notes (up to B3) hug the glass as thick veins; mid (C4–B5) and high (C6 and
  up) notes float further out and get thinner.
- **Colour is the note's place on the circle of fifths**, one hue per step,
  warm on the sharp side (G orange, D amber, A yellow) and cool on the flat
  side (Bb purple, Eb violet, Ab blue). Glow and thickness follow volume, and
  light pulses travel along awake veins.
- **Each vein's orientation is its note's direction on the circle of fifths**,
  so notes a fifth apart run nearly parallel and clashing notes cross.
- **The inner light** takes its hue from the harmonic centre of gravity.
- **Mood lighting (experimental)** tracks a slow-moving sense of home and
  warms the room when the harmony leans sharpward of it, cools it when it
  leans flatward (the minor iv in a major key is the classic example).

### How the analysis works

1. Meyda extracts features from 4096-sample frames (~85 ms at 48 kHz).
2. `processPowerSpectrum` maps 48 log-spaced bins per octave to notes and
   scores each bin with a harmonic/percussive mask (median-filter HPSS), so
   drums and hiss don't light up notes.
3. `LowBandAnalyzer` handles notes below C4 with a 16384-sample FFT and peak
   interpolation, since 4096-sample bins are several semitones wide there.
4. `OrbAnalyzer` sums everything into vein levels (with automatic gain),
   energy, and the here/home/lean feeling layer.

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
