import { noteNames } from "./consts";
import { NOTE_FREQUENCIES } from "./consts";


const frequencyToNote = (frequency:number) => {
  // Find the base frequency (C0) and calculate how many semitones above it our frequency is
  const baseFreq = NOTE_FREQUENCIES['C'];
  const semitones = 12 * Math.log2(frequency / baseFreq);

  // Calculate the octave and the note within that octave
  const octave = Math.floor(semitones / 12);
  const noteIndex = Math.round(semitones % 12);

  // Get the actual note name
  const note = noteNames[noteIndex as keyof typeof noteNames];
  // Calculate cents (how far off from the exact note frequency we are)
  const exactFrequency =
    NOTE_FREQUENCIES[note as keyof typeof NOTE_FREQUENCIES] *
    Math.pow(2, octave);
  const cents = Math.round(1200 * Math.log2(frequency / exactFrequency));

  return { note, octave, cents };
};

export const processPowerSpectrum = (
  amplitudeSpectrum:number[],
  audioContext:AudioContext,
) => {
  const sampleRate = audioContext.sampleRate;
  const binSize = sampleRate / (2 * amplitudeSpectrum.length);

  const keyOctaveAmps:Record<string, number> = {};

  amplitudeSpectrum.forEach((amplitude, index) => {
    const frequency = index * binSize;

    // Only process frequencies within the range of musical instruments
    if (frequency >= 20 && frequency <= 20000) {
      const { note, octave, cents } = frequencyToNote(frequency);
      const key = `${note}${octave}`;

      // Only consider amplitudes above a certain threshold to reduce noise
      if (amplitude > 0.01) {
        if (!keyOctaveAmps[key]) {
          keyOctaveAmps[key] = 0;
        }
        // Weight the amplitude based on how close it is to the exact note frequency
        const weight = 1 - Math.abs(cents) / 50; // 50 cents = quarter tone
        keyOctaveAmps[key] += amplitude * weight;
      }
    }
  });

  return keyOctaveAmps;
};