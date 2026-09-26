import Meyda from "meyda";
import { AudioFeatures, BUFFER_SIZE, FEATURE_EXTRACTORS } from "../utils/consts";
import { HarmonicMask, processPowerSpectrum } from "../utils/processPowerSpectrum";
import { emptyOrbFrame, OrbAnalyzer, OrbFrame } from "../utils/orbAnalysis";
import { LowBandAnalyzer, LOW_FFT_SIZE } from "../utils/lowBand";

export type Timeline = { frames: OrbFrame[]; hopSeconds: number; duration: number };

/**
 * Run the extension's analysis over a whole buffer, frame by frame, exactly as
 * the live Meyda analyzer would (same buffer size, hop, window and features).
 * Yields to the page every few frames so the UI stays responsive.
 */
export const analyzeBuffer = async (
  buffer: AudioBuffer,
  onProgress?: (fraction: number) => void
): Promise<Timeline> => {
  const sampleRate = buffer.sampleRate;
  const hopSeconds = BUFFER_SIZE / sampleRate;
  const signal = buffer.getChannelData(0); // Meyda's analyzer reads channel 0 too
  const mask = new HarmonicMask();
  const orb = new OrbAnalyzer({ hopSeconds, sampleRate, fftSize: BUFFER_SIZE });
  const lowBand = new LowBandAnalyzer(sampleRate);
  Meyda.bufferSize = BUFFER_SIZE;
  Meyda.sampleRate = sampleRate;

  const frames: OrbFrame[] = [];
  const count = Math.floor(signal.length / BUFFER_SIZE);
  for (let i = 0; i < count; i++) {
    const chunk = signal.slice(i * BUFFER_SIZE, (i + 1) * BUFFER_SIZE);
    const features = Meyda.extract([...FEATURE_EXTRACTORS], chunk) as unknown as AudioFeatures;
    const { fullSpectrumAmps } = processPowerSpectrum(features, { sampleRate }, mask);
    // The same last-16384-samples window the live AnalyserNode tap provides.
    const end = (i + 1) * BUFFER_SIZE;
    const recent = signal.subarray(Math.max(0, end - LOW_FFT_SIZE), end);
    frames.push(orb.update(fullSpectrumAmps, features, lowBand.analyze(recent)));
    if (i % 24 === 23) {
      onProgress?.(i / count);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(1);
  return { frames, hopSeconds, duration: buffer.duration };
};

/** Latest analysis frame available at time `t` (a frame lands once its buffer has filled). */
export const frameAt = (timeline: Timeline, t: number): OrbFrame => {
  const index = Math.floor(t / timeline.hopSeconds) - 1;
  if (index < 0 || timeline.frames.length === 0) return emptyOrbFrame();
  return timeline.frames[Math.min(index, timeline.frames.length - 1)];
};

/** 16-bit PCM WAV, for muxing audio into rendered clips. */
export const encodeWav = (buffer: AudioBuffer): ArrayBuffer => {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const bytes = 44 + length * channels * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const writeString = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, bytes - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, length * channels * 2, true);
  const data = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, data[c][i]));
      view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      offset += 2;
    }
  }
  return view.buffer;
};
