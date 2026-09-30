/**
 * Plays stems that arrive in chunks, all on one audio clock.
 *
 * Every chunk of every stem is scheduled at an exact time on the same
 * AudioContext, so the stems stay sample-aligned (separate <audio> elements
 * drift apart). Each stem has its own gain for mute and solo. When playback
 * catches up with what has arrived, the context is suspended, which freezes
 * the clock and every scheduled chunk with it, and resumed once there's
 * enough ahead again.
 */
export type StemAudioChunk = {
  /** Song time (seconds) where the chunk starts. */
  start: number;
  duration: number;
  /** One AudioBuffer per stem name. */
  buffers: Record<string, AudioBuffer>;
};

export class StemPlayer {
  readonly output: GainNode;
  private gains: Record<string, GainNode> = {};
  private chunks: StemAudioChunk[] = [];
  private sources: AudioBufferSourceNode[] = [];
  /** Context time at which song time 0 plays; null when stopped. */
  private origin: number | null = null;
  private muted = new Set<string>();
  private soloed: string | null = null;
  bufferedUntil = 0;

  constructor(readonly ctx: AudioContext, readonly stems: string[]) {
    this.output = ctx.createGain();
    this.output.connect(ctx.destination);
    for (const stem of stems) {
      const gain = ctx.createGain();
      gain.connect(this.output);
      this.gains[stem] = gain;
    }
  }

  get playing() {
    return this.origin !== null;
  }

  /** Current song time in seconds (frozen while the context is suspended). */
  songTime() {
    return this.origin === null ? 0 : Math.max(0, this.ctx.currentTime - this.origin);
  }

  addChunk(chunk: StemAudioChunk) {
    this.chunks.push(chunk);
    this.bufferedUntil = Math.max(this.bufferedUntil, chunk.start + chunk.duration);
    if (this.origin !== null) this.schedule(chunk);
  }

  play(from = 0) {
    this.stop();
    this.origin = this.ctx.currentTime + 0.08 - from;
    for (const chunk of this.chunks) {
      if (chunk.start + chunk.duration > from) this.schedule(chunk);
    }
  }

  stop() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* never started */
      }
      source.disconnect();
    }
    this.sources = [];
    this.origin = null;
  }

  setMuted(stem: string, muted: boolean) {
    if (muted) this.muted.add(stem);
    else this.muted.delete(stem);
    this.applyGains();
  }

  isMuted(stem: string) {
    return this.muted.has(stem);
  }

  setSolo(stem: string | null) {
    this.soloed = stem;
    this.applyGains();
  }

  get solo() {
    return this.soloed;
  }

  /** Whether a stem is currently heard (not muted, and not silenced by another's solo). */
  audible(stem: string) {
    return this.soloed ? this.soloed === stem : !this.muted.has(stem);
  }

  dispose() {
    this.stop();
    this.output.disconnect();
  }

  private applyGains() {
    const now = this.ctx.currentTime;
    for (const stem of this.stems) {
      this.gains[stem].gain.setTargetAtTime(this.audible(stem) ? 1 : 0, now, 0.03);
    }
  }

  private schedule(chunk: StemAudioChunk) {
    if (this.origin === null) return;
    const when = this.origin + chunk.start;
    const now = this.ctx.currentTime;
    // Arrived late: start partway in, so it still lines up with the song clock.
    const offset = Math.max(0, now - when);
    if (offset >= chunk.duration) return;
    for (const [stem, buffer] of Object.entries(chunk.buffers)) {
      const gain = this.gains[stem];
      if (!gain) continue;
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(Math.max(when, now), offset);
      source.onended = () => {
        this.sources = this.sources.filter((s) => s !== source);
        source.disconnect();
      };
      this.sources.push(source);
    }
  }
}
