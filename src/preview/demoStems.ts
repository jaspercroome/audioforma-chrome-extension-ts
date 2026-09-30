import { VoiceStem } from "../components/orb/Voices";
import { styleFor } from "../stems/styles";
import { DemoPart, renderDemoStems } from "./demoSong";

/**
 * The synthesized demo, one instrument per stem, named like Demucs stems so
 * they flow through exactly the same path as stems from the service. Being
 * perfectly separated, they show what the views do with clean input.
 */
const DEMO: Array<{ name: string; part: DemoPart; label: string }> = [
  { name: "vocals", part: "lead", label: "Lead" },
  { name: "piano", part: "pad", label: "Pad" },
  { name: "bass", part: "bass", label: "Bass" },
  { name: "drums", part: "drums", label: "Drums" },
];

export const DEMO_STEMS: VoiceStem[] = DEMO.map(({ name, label }) => ({
  name,
  style: { ...styleFor(name), label },
}));

export type DemoStems = {
  sampleRate: number;
  duration: number;
  /** Stereo channels per stem, as the service would send them. */
  channels: Record<string, Float32Array[]>;
  /** Mono per stem, for analysis. */
  mono: Record<string, Float32Array>;
  /** Everything summed, for muxing rendered clips. */
  mixBuffer: AudioBuffer;
};

export const loadDemoStems = async (sampleRate = 44100): Promise<DemoStems> => {
  const parts = await renderDemoStems(sampleRate);
  const channels: Record<string, Float32Array[]> = {};
  const mono: Record<string, Float32Array> = {};
  const length = parts.lead.length;
  const mixBuffer = new AudioBuffer({ length, numberOfChannels: 2, sampleRate });
  const mixL = mixBuffer.getChannelData(0);
  const mixR = mixBuffer.getChannelData(1);
  for (const { name, part } of DEMO) {
    const buffer = parts[part];
    const left = buffer.getChannelData(0).slice();
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : left.slice();
    channels[name] = [left, right];
    const m = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      m[i] = (left[i] + right[i]) / 2;
      mixL[i] += left[i];
      mixR[i] += right[i];
    }
    mono[name] = m;
  }
  return { sampleRate, duration: length / sampleRate, channels, mono, mixBuffer };
};
