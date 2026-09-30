import { emptyOrbFrame, OrbFrame, VEIN_COUNT } from "../utils/orbAnalysis";
import {
  BYTE_ATTACKS,
  BYTE_GLOBAL,
  BYTE_HITS,
  BYTE_LEVELS,
  FLOAT_BRIGHTNESS,
  FLOAT_ENERGY,
  FLOAT_FOCUS,
  FLOAT_HERE,
  FLOAT_HOME,
  FLOAT_LEAN,
  FLOAT_PITCH_CONFIDENCE,
  FLOAT_PITCH_HZ,
  FRAME_BYTES,
  FRAME_FLOATS,
  FrameBatch,
} from "./stemAnalysis";

/**
 * One stem's analysis frames, stored compactly (a few hundred bytes a frame)
 * as they arrive, and read back by time.
 */
export class StemTimeline {
  count = 0;
  private bytes = new Uint8Array(0);
  private floats = new Float32Array(0);

  constructor(readonly hopSeconds: number, readonly firstFrameSeconds: number) {}

  append(batch: FrameBatch) {
    if (batch.firstIndex !== this.count) {
      throw new Error(`Frames out of order: expected ${this.count}, got ${batch.firstIndex}`);
    }
    const count = this.count + batch.count;
    if (count * FRAME_BYTES > this.bytes.length) {
      const capacity = Math.max(count, this.count * 2, 256);
      const bytes = new Uint8Array(capacity * FRAME_BYTES);
      bytes.set(this.bytes.subarray(0, this.count * FRAME_BYTES));
      const floats = new Float32Array(capacity * FRAME_FLOATS);
      floats.set(this.floats.subarray(0, this.count * FRAME_FLOATS));
      this.bytes = bytes;
      this.floats = floats;
    }
    this.bytes.set(batch.bytes, this.count * FRAME_BYTES);
    this.floats.set(batch.floats, this.count * FRAME_FLOATS);
    this.count = count;
  }

  /** Time at which frame `index` is ready (its window has fully played). */
  timeOf(index: number) {
    return this.firstFrameSeconds + index * this.hopSeconds;
  }

  /** The latest frame ready at time `t`, or -1 before the first. Clamped to what has arrived. */
  indexAt(t: number) {
    if (this.count === 0) return -1;
    const index = Math.floor((t - this.firstFrameSeconds) / this.hopSeconds + 1e-9);
    return index < 0 ? -1 : Math.min(index, this.count - 1);
  }

  /** Song time up to which frames exist. */
  readyUntil() {
    return this.count === 0 ? 0 : this.timeOf(this.count - 1);
  }

  level(index: number, vein: number) {
    return this.bytes[index * FRAME_BYTES + BYTE_LEVELS + vein] / 255;
  }
  global(index: number, vein: number) {
    return this.bytes[index * FRAME_BYTES + BYTE_GLOBAL + vein] / 255;
  }
  attack(index: number, vein: number) {
    return this.bytes[index * FRAME_BYTES + BYTE_ATTACKS + vein] / 255;
  }
  hit(index: number, band: 0 | 1 | 2) {
    return this.bytes[index * FRAME_BYTES + BYTE_HITS + band] / 255;
  }
  pitchHz(index: number) {
    return this.floats[index * FRAME_FLOATS + FLOAT_PITCH_HZ];
  }
  pitchConfidence(index: number) {
    return this.floats[index * FRAME_FLOATS + FLOAT_PITCH_CONFIDENCE];
  }
  energy(index: number) {
    return this.floats[index * FRAME_FLOATS + FLOAT_ENERGY];
  }

  /** Fill an OrbFrame (reusing `out`) so the orb's own components can read this timeline. */
  toOrbFrame(index: number, out: OrbFrame = emptyOrbFrame()): OrbFrame {
    if (index < 0) {
      out.levels.fill(0);
      out.global.fill(0);
      out.attacks.fill(0);
      out.hits = { low: 0, mid: 0, high: 0 };
      out.energy = 0;
      out.here = { x: 0, y: 0 };
      out.lean = 0;
      out.focus = 0;
      out.time = -1;
      return out;
    }
    const b = index * FRAME_BYTES;
    for (let i = 0; i < VEIN_COUNT; i++) {
      out.levels[i] = this.bytes[b + BYTE_LEVELS + i] / 255;
      out.global[i] = this.bytes[b + BYTE_GLOBAL + i] / 255;
      out.attacks[i] = this.bytes[b + BYTE_ATTACKS + i] / 255;
    }
    out.hits = { low: this.hit(index, 0), mid: this.hit(index, 1), high: this.hit(index, 2) };
    const f = index * FRAME_FLOATS;
    out.energy = this.floats[f + FLOAT_ENERGY];
    out.here = { x: this.floats[f + FLOAT_HERE], y: this.floats[f + FLOAT_HERE + 1] };
    out.home = { x: this.floats[f + FLOAT_HOME], y: this.floats[f + FLOAT_HOME + 1] };
    out.lean = this.floats[f + FLOAT_LEAN];
    out.focus = this.floats[f + FLOAT_FOCUS];
    out.brightness = this.floats[f + FLOAT_BRIGHTNESS];
    out.time = this.timeOf(index);
    return out;
  }
}
