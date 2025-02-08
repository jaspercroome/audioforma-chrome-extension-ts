import { noteNames, NOTE_FREQUENCIES, AudioFeatures } from './consts';
import { scalePow, scaleLinear } from 'd3-scale';

// Create a scale to weight amplitudes based on frequency
// More aggressive attenuation of lower frequencies
const frequencyWeighting = scalePow()
  .exponent(1.2)  // Gentler curve
  .domain([20, 20000])
  .range([0.3, 1.2]);  // Less extreme range

// Tonality scales
const flatnessToTonality = scaleLinear()
  .domain([0, 0.5])  // Wider range for flatness
  .range([1, 0])     // 1 = very tonal, 0 = very noisy
  .clamp(true);

const kurtosisToPercussiveness = scaleLinear()
  .domain([2, 10])   // Narrower, more reasonable range for kurtosis
  .range([0, 1])     // 0 = not percussive, 1 = very percussive
  .clamp(true);


const frequencyToNote = (frequency: number) => {
  // Find the base frequency (C0) and calculate how many semitones above it our frequency is
  const baseFreq = NOTE_FREQUENCIES['C'];
  const semitones = 12 * Math.log2(frequency / baseFreq);

  // Calculate the octave and the note within that octave
  const octave = Math.floor(semitones / 12);
  const noteIndex = Math.round(semitones % 12) % 12;

  // Get the actual note name
  const note = noteNames[noteIndex as keyof typeof noteNames];
  // Calculate cents (how far off from the exact note frequency we are)
  const exactFrequency =
    NOTE_FREQUENCIES[note as keyof typeof NOTE_FREQUENCIES] *
    Math.pow(2, octave);
  const cents = Math.round(1200 * Math.log2(frequency / exactFrequency));
  if (note === undefined) {
    console.log({ semitones, note, cents, frequency, noteIndex });
  }
  return { note, octave, cents };
};

const getFrequencyBin = (frequency: number, sampleRate: number, fftSize: number) => {
  return Math.round((frequency * fftSize) / sampleRate);
};

// Function to analyze the spectral characteristics of a frequency bin
const analyzeSpectralCharacteristics = (
  features: AudioFeatures,
): {
  tonality: number;      // How melodic/tonal vs noisy (0-1)
  brightness: number;    // Normalized spectral centroid
} => {
  const normalizedCentroid = features.spectralCentroid / (features.spectralRolloff || 1);
  
  // Combine flatness and kurtosis for tonality measure
  const tonalityFromFlatness = flatnessToTonality(features.spectralFlatness);
  const percussiveness = kurtosisToPercussiveness(features.spectralKurtosis);
  
  // Make the tonality measure more lenient
  const tonality = Math.max(
    (1 - percussiveness) * tonalityFromFlatness,
    tonalityFromFlatness * 0.8  // Ensure some tonality even with high percussiveness
  );

  return {
    tonality,
    brightness: normalizedCentroid
  };
};

export const processPowerSpectrum = (
  features: AudioFeatures,
  audioContext: AudioContext,
) => {
  const spectrum = features.powerSpectrum;
  const sampleRate = audioContext.sampleRate;
  const fftSize = spectrum.length * 2;

  // Process both components
  const processComponent = (spectrum: number[]) => {
    const keyOctaveAmps: Record<string, number> = {};
    const fullSpectrumAmps: Array<{
      note: string;
      octave: number;
      cents: number;
      amplitude: number;
      tonality: number;
      brightness: number;
    }> = [];

    // Define frequency range for logarithmic binning
    const minFreq = 20;
    const maxFreq = 20000;
    const binsPerOctave = 48;
    const numOctaves = Math.log2(maxFreq / minFreq);
    const totalBins = Math.floor(binsPerOctave * numOctaves);

    // Create logarithmically spaced frequency bins
    for (let i = 0; i < totalBins; i++) {
      const freq = minFreq * Math.pow(2, i / binsPerOctave);
      if (freq > maxFreq) break;

      const binLow = getFrequencyBin(freq, sampleRate, fftSize);
      const binHigh = getFrequencyBin(freq * Math.pow(2, 1/binsPerOctave), sampleRate, fftSize);
      
      let amplitude = 0;
      let count = 0;
      for (let bin = binLow; bin <= binHigh && bin < spectrum.length; bin++) {
        amplitude += spectrum[bin];
        count++;
      }
      amplitude = count > 0 ? amplitude / count : 0;

      const weight = frequencyWeighting(freq);
      amplitude *= weight;

      if (amplitude > 0.001) {
        const { note, octave, cents } = frequencyToNote(freq);
        const { tonality, brightness } = analyzeSpectralCharacteristics(features);
        const key = `${note}${octave}`;
        const centWeight = 1 - Math.abs(cents) / 50;
        
        if (!keyOctaveAmps[key]) {
          keyOctaveAmps[key] = 0;
        }
        keyOctaveAmps[key] += amplitude * centWeight;

        fullSpectrumAmps.push({
          note,
          octave,
          cents,
          amplitude: amplitude * centWeight,
          tonality,
          brightness
        });
      }
    }

    return { keyOctaveAmps, fullSpectrumAmps };
  };

  const result = processComponent(spectrum);

  // Split into melodic and percussive based on tonality
  const melodicAmps = result.fullSpectrumAmps.filter(point => point.tonality > 0.5);
  const percussiveAmps = result.fullSpectrumAmps.filter(point => point.tonality <= 0.5);

  return {
    keyOctaveAmps: result.keyOctaveAmps,
    fullSpectrumAmps: result.fullSpectrumAmps,
    melodic: { fullSpectrumAmps: melodicAmps },
    percussive: { fullSpectrumAmps: percussiveAmps }
  };
};
