/**
 * A short synthesized demo, so the preview needs no recorded music.
 *
 * Part A (bright): C - G - Am - F - C - G, bouncy eighth-note melody up high,
 * plucked bass, hats and kick, open filter.
 * Part B (melancholy): Am - F - Fm - C - Fm - C. Quieter, lower, slower and
 * legato, darker filter, no drums, and the minor iv (Fm) "falling past home".
 * Those are the cues Warrenburg/Huron associate with melancholy.
 *
 * Works with a live AudioContext or an OfflineAudioContext.
 */

const BPM = 90;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;
export const PART_A_BARS = 6;
export const PART_B_BARS = 6;
export const DEMO_DURATION = (PART_A_BARS + PART_B_BARS) * BAR + 2.5;
export const PART_B_START = PART_A_BARS * BAR;

const NOTE_INDEX: Record<string, number> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6,
  G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

export const hz = (name: string) => {
  const m = /^([A-G](?:#|b)?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`Bad note ${name}`);
  const midi = (Number(m[2]) + 1) * 12 + NOTE_INDEX[m[1]];
  return 440 * Math.pow(2, (midi - 69) / 12);
};

type Chord = { root: string; tones: string[] };

const PART_A: Chord[] = [
  { root: "C2", tones: ["C4", "E4", "G4"] },
  { root: "G2", tones: ["B3", "D4", "G4"] },
  { root: "A2", tones: ["A3", "C4", "E4"] },
  { root: "F2", tones: ["A3", "C4", "F4"] },
  { root: "C2", tones: ["C4", "E4", "G4"] },
  { root: "G2", tones: ["B3", "D4", "G4"] },
];

const PART_B: Chord[] = [
  { root: "A1", tones: ["A3", "C4", "E4"] },
  { root: "F1", tones: ["F3", "A3", "C4"] },
  { root: "F1", tones: ["F3", "Ab3", "C4"] },
  { root: "C2", tones: ["G3", "C4", "E4"] },
  { root: "F1", tones: ["F3", "Ab3", "C4"] },
  { root: "C2", tones: ["G3", "C4", "E4"] },
];

// Eighth notes (null = rest).
const MELODY_A: Array<Array<string | null>> = [
  ["E5", "G5", "C6", "G5", "E5", "G5", "A5", "G5"],
  ["D5", "G5", "B5", "G5", "D5", "G5", "A5", "B5"],
  ["C6", "B5", "A5", "E5", "C5", "E5", "A5", "B5"],
  ["C6", "A5", "F5", "A5", "C6", "D6", "C6", "A5"],
  ["G5", "E5", "C5", "E5", "G5", "C6", "E6", "D6"],
  ["D6", "B5", "G5", "B5", "D6", null, "G5", null],
];

// [note, beats]: slow, narrow, descending.
const MELODY_B: Array<Array<[string, number]>> = [
  [["E4", 2], ["D4", 1], ["C4", 1]],
  [["C4", 2], ["A3", 2]],
  [["Ab3", 2], ["G3", 1], ["F3", 1]],
  [["G3", 3], ["C4", 1]],
  [["C4", 2], ["Ab3", 1], ["G3", 1]],
  [["G3", 2], ["E3", 2]],
];

class Voices {
  private noise: AudioBuffer;
  constructor(private ctx: BaseAudioContext, private out: AudioNode) {
    const length = Math.floor(ctx.sampleRate * 0.5);
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < length; i++) {
      seed = (seed * 16807) % 2147483647;
      data[i] = (seed / 2147483647) * 2 - 1;
    }
  }

  private envelope(gain: GainNode, start: number, attack: number, hold: number, release: number, peak: number) {
    const g = gain.gain;
    g.setValueAtTime(0, start);
    g.linearRampToValueAtTime(peak, start + attack);
    g.setValueAtTime(peak, start + Math.max(attack, hold));
    g.exponentialRampToValueAtTime(0.0001, start + Math.max(attack, hold) + release);
  }

  pad(tones: string[], start: number, duration: number, bright: boolean) {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = bright ? 2600 : 850;
    filter.Q.value = 0.6;
    const gain = this.ctx.createGain();
    this.envelope(gain, start, bright ? 0.04 : 0.7, duration, bright ? 0.5 : 1.6, bright ? 0.9 : 0.75);
    filter.connect(gain).connect(this.out);
    for (const tone of tones) {
      for (const detune of [-7, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = hz(tone);
        osc.detune.value = detune;
        const level = this.ctx.createGain();
        level.gain.value = 0.035;
        osc.connect(level).connect(filter);
        osc.start(start);
        osc.stop(start + duration + 2);
      }
    }
  }

  bass(note: string, start: number, duration: number, pluck: boolean) {
    const osc = this.ctx.createOscillator();
    osc.type = pluck ? "triangle" : "sine";
    osc.frequency.value = hz(note);
    const gain = this.ctx.createGain();
    this.envelope(gain, start, pluck ? 0.01 : 0.3, pluck ? 0.08 : duration, pluck ? 0.25 : 1.2, pluck ? 0.34 : 0.3);
    osc.connect(gain).connect(this.out);
    osc.start(start);
    osc.stop(start + duration + 1.5);
  }

  lead(note: string, start: number, duration: number, legato: boolean) {
    const osc = this.ctx.createOscillator();
    osc.type = legato ? "sine" : "square";
    osc.frequency.value = hz(note);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = legato ? 1800 : 3200;
    const gain = this.ctx.createGain();
    this.envelope(gain, start, legato ? 0.25 : 0.01, legato ? duration : 0.12, legato ? 0.9 : 0.2, legato ? 0.2 : 0.07);
    if (legato) {
      // Gentle vibrato.
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5;
      const depth = this.ctx.createGain();
      depth.gain.value = 6;
      lfo.connect(depth).connect(osc.detune);
      lfo.start(start);
      lfo.stop(start + duration + 1.2);
    }
    osc.connect(filter).connect(gain).connect(this.out);
    osc.start(start);
    osc.stop(start + duration + 1.2);
  }

  hat(start: number, accent: boolean) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 7000;
    const gain = this.ctx.createGain();
    this.envelope(gain, start, 0.001, 0.005, 0.05, accent ? 0.16 : 0.09);
    src.connect(filter).connect(gain).connect(this.out);
    src.start(start, (start * 7.31) % 0.3); // deterministic offset, so offline renders repeat exactly
    src.stop(start + 0.1);
  }

  kick(start: number) {
    const osc = this.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, start);
    osc.frequency.exponentialRampToValueAtTime(45, start + 0.14);
    const gain = this.ctx.createGain();
    this.envelope(gain, start, 0.002, 0.02, 0.28, 0.55);
    osc.connect(gain).connect(this.out);
    osc.start(start);
    osc.stop(start + 0.4);
  }
}

/** Schedule the demo on `ctx`, starting at `start`. Returns the master node (connect it to hear it). */
export const scheduleDemo = (ctx: BaseAudioContext, start: number) => {
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -14;
  compressor.ratio.value = 3;
  master.connect(compressor);
  const voices = new Voices(ctx, master);

  PART_A.forEach((chord, bar) => {
    const t = start + bar * BAR;
    voices.pad(chord.tones, t, BAR, true);
    for (let i = 0; i < 8; i++) {
      voices.bass(i % 2 === 0 ? chord.root : chord.root.replace(/\d/, (d) => String(Number(d) + 1)), t + i * (BEAT / 2), BEAT / 2, true);
      voices.hat(t + i * (BEAT / 2), i % 2 === 1);
      const note = MELODY_A[bar][i];
      if (note) voices.lead(note, t + i * (BEAT / 2), BEAT / 2, false);
    }
    voices.kick(t);
    voices.kick(t + 2 * BEAT);
  });

  PART_B.forEach((chord, bar) => {
    const t = start + PART_B_START + bar * BAR;
    voices.pad(chord.tones, t, BAR, false);
    voices.bass(chord.root, t, BAR, false);
    let beat = 0;
    for (const [note, beats] of MELODY_B[bar]) {
      voices.lead(note, t + beat * BEAT, beats * BEAT * 0.95, true);
      beat += beats;
    }
  });

  return compressor;
};

/** Render the demo offline (for deterministic analysis and clips). */
export const renderDemoOffline = async (sampleRate = 48000) => {
  const ctx = new OfflineAudioContext(2, Math.ceil(DEMO_DURATION * sampleRate), sampleRate);
  scheduleDemo(ctx, 0.05).connect(ctx.destination);
  return ctx.startRendering();
};
