import { AnalysisChannel, createAnalysisChannel } from "./analysisHost";
import { StemPlayer } from "./player";
import { StemAnalyzer } from "./stemAnalysis";
import { styleFor, StemStyle } from "./styles";
import { StemTimeline } from "./timeline";

export type StemMeta = {
  sampleRate: number;
  stems: string[];
  /** Seconds, when known up front (the service says so in its meta event). */
  duration: number;
  model?: string;
};

export type PlaybackPhase = "waiting" | "playing" | "buffering" | "ended";

export type SessionOptions = {
  useWorker?: boolean;
  /** Start playing on its own once enough is ready. */
  autoplay?: boolean;
  onError?: (message: string) => void;
};

/** Seconds of stems (and their analysis) to have ready before starting or resuming. */
const START_AHEAD = 3;
const RESUME_AHEAD = 2.5;
/** Pause to buffer when playback gets this close to the end of what's ready. */
const UNDERRUN_MARGIN = 0.2;

/**
 * One song's stems: plays them in sync as chunks arrive and analyses each one
 * (plus their sum, for the orb's centre light and mood) as it goes.
 */
export class StemSession {
  readonly player: StemPlayer;
  readonly stems: Array<{ name: string; style: StemStyle }>;
  readonly timelines: Record<string, StemTimeline> = {};
  readonly mix: StemTimeline;
  playback: PlaybackPhase = "waiting";
  /** Audio seconds received so far, and when separation finished. */
  received = 0;
  streamEnded = false;
  /** Separation speed in audio seconds per second (from the service), 0 if unknown. */
  speed = 0;
  private channels: Record<string, AnalysisChannel> = {};
  private finished = new Set<string>();
  private disposed = false;
  private readonly autoplay: boolean;
  private static readonly MIX = "__mix";

  constructor(readonly ctx: AudioContext, readonly meta: StemMeta, options: SessionOptions = {}) {
    this.autoplay = options.autoplay ?? true;
    this.stems = meta.stems.map((name, i) => ({ name, style: styleFor(name, i) }));
    this.player = new StemPlayer(ctx, meta.stems);
    const probe = new StemAnalyzer(meta.sampleRate, "drums");
    const makeTimeline = () => new StemTimeline(probe.hopSeconds, probe.firstFrameSeconds);
    const open = (key: string, role: StemStyle["role"], timeline: StemTimeline) => {
      this.channels[key] = createAnalysisChannel(
        meta.sampleRate,
        role,
        {
          onBatch: (batch) => !this.disposed && timeline.append(batch),
          onFinished: () => this.finished.add(key),
          onError: (message) => options.onError?.(`Analysis of ${key} failed: ${message}`),
        },
        { useWorker: options.useWorker }
      );
    };
    for (const { name, style } of this.stems) {
      this.timelines[name] = makeTimeline();
      open(name, style.role, this.timelines[name]);
    }
    this.mix = makeTimeline();
    open(StemSession.MIX, "mix", this.mix);
  }

  /** A chunk of every stem: `audio[stem]` holds one Float32Array per channel. */
  addChunk(start: number, audio: Record<string, Float32Array[]>) {
    if (this.disposed) return;
    const { sampleRate } = this.meta;
    let frames = 0;
    const buffers: Record<string, AudioBuffer> = {};
    let mix: Float32Array | null = null;
    for (const { name } of this.stems) {
      const channels = audio[name];
      if (!channels?.length) continue;
      frames = channels[0].length;
      const buffer = this.ctx.createBuffer(channels.length, frames, sampleRate);
      channels.forEach((data, c) => buffer.copyToChannel(data, c));
      buffers[name] = buffer;

      const mono = new Float32Array(frames);
      for (const data of channels) for (let i = 0; i < frames; i++) mono[i] += data[i] / channels.length;
      if (!mix) mix = new Float32Array(frames);
      for (let i = 0; i < frames; i++) mix[i] += mono[i];
      this.channels[name].push(mono);
    }
    if (mix) this.channels[StemSession.MIX].push(mix);
    const duration = frames / sampleRate;
    this.player.addChunk({ start, duration, buffers });
    this.received = Math.max(this.received, start + duration);
  }

  /** No more chunks are coming. */
  endStream() {
    if (this.streamEnded) return;
    this.streamEnded = true;
    Object.values(this.channels).forEach((channel) => channel.finish());
  }

  get duration() {
    return this.streamEnded ? this.received : Math.max(this.meta.duration, this.received);
  }

  /** Song time up to which both audio and analysis are ready. */
  readyUntil() {
    let ready = this.player.bufferedUntil;
    const keys = [...this.stems.map((s) => s.name), StemSession.MIX];
    for (const key of keys) {
      if (this.finished.has(key)) continue;
      const timeline = key === StemSession.MIX ? this.mix : this.timelines[key];
      ready = Math.min(ready, timeline.readyUntil());
    }
    return ready;
  }

  get fullyReady() {
    return this.streamEnded && this.finished.size === this.stems.length + 1;
  }

  songTime() {
    return this.player.songTime();
  }

  play(from = 0) {
    this.player.play(from);
    this.playback = "playing";
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  stop() {
    this.player.stop();
    this.playback = "waiting";
  }

  /** Is enough ready to play through, given how fast separation is going? */
  private canStart() {
    if (this.fullyReady) return true;
    const ready = this.readyUntil();
    const duration = this.duration;
    if (ready >= duration - 0.05) return this.streamEnded;
    if (this.speed >= 1.05 || this.speed === 0) return ready >= Math.min(START_AHEAD, duration);
    // Slower than real time: wait until the rest can arrive before playback needs it.
    return ready >= duration * (1 - this.speed) + START_AHEAD;
  }

  /** Call regularly (a few times a second): starts, buffers and resumes playback. */
  tick() {
    if (this.disposed) return;
    const t = this.songTime();
    if (this.playback === "waiting") {
      if (this.autoplay && this.canStart()) this.play(0);
      return;
    }
    if (this.playback === "playing") {
      if (t >= this.duration - 0.02 && this.streamEnded) {
        this.playback = "ended";
      } else if (!this.fullyReady && this.readyUntil() - t < UNDERRUN_MARGIN) {
        this.playback = "buffering";
        void this.ctx.suspend();
      }
    } else if (this.playback === "buffering") {
      if (this.fullyReady || this.readyUntil() - t > RESUME_AHEAD) {
        this.playback = "playing";
        void this.ctx.resume();
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.player.dispose();
    Object.values(this.channels).forEach((channel) => channel.dispose());
  }
}
