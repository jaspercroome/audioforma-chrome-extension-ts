import * as THREE from "three";
import { Cylinder, cylinderPoint, turnBetween, voiceCylinder } from "./voiceLayout";

/**
 * A comet's path: where a melodic line has been over the last few seconds,
 * as it actually moved, ready to be drawn as a tube.
 *
 * 1. Each pitch pulls the comet with a critically damped spring: the
 *    smoothing in maath's easing.damp (Unity's SmoothDamp), here in its exact
 *    form. The spring's velocity never jumps, so the comet never snaps into a
 *    new direction: it eases out of one note and into the next, and a quick
 *    run rounds into a curve. It runs in cylindrical coordinates, so a leap
 *    swings around the orb instead of cutting through it.
 * 2. The spring is sampled finely in time. Exact steps compose, so the
 *    samples lie on one path however it's cut, and the head moves on smoothly
 *    between analysis frames.
 * 3. The path is resampled evenly along its length (where the comet sat still
 *    nothing piles up, and fast swings get as many rings as slow ones), then
 *    smoothed along its length, more further back: the tail relaxes, rounding
 *    the elbow where the comet sat on a note and set off in a new direction.
 * 4. Radii follow loudness and taper with age; each phrase ends round.
 */

/** How quickly the comet settles on a new note (the spring's smooth time, seconds). */
export const SMOOTH_TIME = 0.07;
/** Spring steps per analysis frame. */
const STEPS_PER_FRAME = 32;
/** Spacing of the tube's rings along the path, at least. */
export const RING_SPACING = 0.004;
/**
 * Width of the smoothing along the path (a Gaussian's sigma, world units):
 * right behind the head, and from RELAX_DISTANCE back along the tail on.
 */
const ROUNDING_NEW = 0.012;
const ROUNDING_OLD = 0.07;
const RELAX_DISTANCE = 0.6;
/** Widest smoothing window, in rings each side. */
const MAX_REACH = 48;
/** A new pitch must agree with the next frame (within this many semitones) before the line moves to it. */
const CONFIRM_SEMITONES = 0.6;
/** How steeply a tube's radius may change along it (radius per unit length). */
const MAX_SLOPE = 0.5;
/** Longest the head runs on past the newest frame (when analysis falls behind). */
const MAX_OVERRUN = 0.5;

export type Spring = { x: number; v: number };

/**
 * One step of a critically damped spring toward `target`, exact for any dt:
 * two half steps land where one full step does.
 */
export const springStep = (s: Spring, target: number, dt: number, omega: number) => {
  const d = s.x - target;
  const e = Math.exp(-omega * dt);
  const temp = (s.v + omega * d) * dt;
  s.v = (s.v - omega * temp) * e;
  s.x = target + (d + temp) * e;
};

/**
 * Hold a new pitch back until a second frame agrees with it (the line moves a
 * frame later), so a one-frame glitch, an octave error or a stray note, never
 * pulls the comet off course. Slides and vibrato change a little each frame
 * and pass straight through. Causal: a frame never changes once it's been
 * drawn. NaN (no pitch) passes through.
 */
export const confirmPitches = (midi: Float32Array, n: number) => {
  let previousRaw = NaN;
  let previousOut = NaN;
  for (let i = 0; i < n; i++) {
    const raw = midi[i];
    let out = raw;
    if (!Number.isNaN(raw) && !Number.isNaN(previousRaw) && !Number.isNaN(previousOut)) {
      out = Math.abs(raw - previousRaw) <= CONFIRM_SEMITONES ? raw : previousOut;
    }
    previousRaw = raw;
    previousOut = out;
    midi[i] = out;
  }
};

/** The frames a path is built from, oldest first. */
export type CometFrames = {
  /** Frames in use. */
  n: number;
  /** The line's pitch per frame (rests keep the last pitch; NaN before the first). */
  midi: Float32Array;
  /** 1 where the line sounds, 0 in rests. */
  voiced: Uint8Array;
  /** Loudness per frame, 0..1. */
  energy: Float32Array;
  /** Time of frame 0 and the spacing of frames (seconds). */
  firstTime: number;
  hop: number;
};

export type CometShape = {
  /** Now: the head is here. */
  t: number;
  /** Older than this isn't drawn (it's still stepped through). */
  tailSeconds: number;
  /** Layout blend (0 harmony, 1 melody) and octave spread. */
  blend: number;
  spread: number;
  /** Radius at the head: base plus gain times loudness. */
  base: number;
  gain: number;
};

export class CometPath {
  /**
   * Rings in use, oldest first, each on a stretch of the line that sounds
   * (rests aren't drawn). The last ring is the head's when the line sounds now.
   */
  count = 0;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly age: Float32Array;
  readonly loudness: Float32Array;
  /** Which phrase each ring belongs to: rings of different phrases aren't joined. */
  readonly phrase: Uint16Array;
  /** Tube radius per ring: tapering with age, round where a phrase starts or stops. */
  readonly radius: Float32Array;
  /** Distance along the path from the first ring. */
  readonly distance: Float32Array;
  /** Whether the line sounds now (the last ring is the head). */
  sounding = false;
  /** Where the head is, and its radius before tapering (the tail meets the head at this width). */
  readonly head = new THREE.Vector3();
  headRadius = 0;

  // Fine samples of the spring's path, oldest first.
  private samples = 0;
  private sx: Float32Array;
  private sy: Float32Array;
  private sz: Float32Array;
  private sAge: Float32Array;
  private sLoud: Float32Array;
  private sVoiced: Uint8Array;
  private sAt: Float32Array;
  // Scratch for smoothing: distance from the head, window per ring, running sums.
  private fromHead: Float32Array;
  private reach: Float32Array;
  private px: Float64Array;
  private py: Float64Array;
  private pz: Float64Array;

  private theta: Spring = { x: 0, v: 0 };
  private r: Spring = { x: 0, v: 0 };
  private h: Spring = { x: 0, v: 0 };
  private loud: Spring = { x: 0, v: 0 };
  private cylinder: Cylinder = { theta: 0, r: 0, y: 0 };
  private point = new THREE.Vector3();

  /** Room for `maxFrames` analysis frames and `rings` rings. */
  constructor(readonly maxFrames: number, readonly rings: number) {
    const samples = maxFrames * STEPS_PER_FRAME + 2;
    this.sx = new Float32Array(samples);
    this.sy = new Float32Array(samples);
    this.sz = new Float32Array(samples);
    this.sAge = new Float32Array(samples);
    this.sLoud = new Float32Array(samples);
    this.sVoiced = new Uint8Array(samples);
    this.sAt = new Float32Array(samples);
    this.x = new Float32Array(rings);
    this.y = new Float32Array(rings);
    this.z = new Float32Array(rings);
    this.age = new Float32Array(rings);
    this.loudness = new Float32Array(rings);
    this.phrase = new Uint16Array(rings);
    this.radius = new Float32Array(rings);
    this.distance = new Float32Array(rings);
    this.fromHead = new Float32Array(rings);
    this.reach = new Float32Array(rings);
    this.px = new Float64Array(rings + 1);
    this.py = new Float64Array(rings + 1);
    this.pz = new Float64Array(rings + 1);
  }

  build(frames: CometFrames, shape: CometShape) {
    this.count = 0;
    this.samples = 0;
    this.sounding = false;
    this.headRadius = 0;
    this.step(frames, shape);
    if (this.samples === 0) return;
    const last = this.samples - 1;
    this.head.set(this.sx[last], this.sy[last], this.sz[last]);
    this.sounding = this.sVoiced[last] === 1;
    this.headRadius = this.sounding ? shape.base + shape.gain * Math.min(1, this.sLoud[last]) : 0;
    this.resample();
    this.smooth();
    this.shape(shape);
  }

  /** 1-2: run the spring through the frames, sampling it finely. */
  private step(frames: CometFrames, shape: CometShape) {
    const { n, midi, voiced, energy, firstTime, hop } = frames;
    let start = -1;
    for (let i = 0; i < n && start < 0; i++) if (!Number.isNaN(midi[i])) start = i;
    if (start < 0 || hop <= 0) return;

    const omega = 2 / SMOOTH_TIME;
    const step = hop / STEPS_PER_FRAME;
    const settle = (i: number) => {
      voiceCylinder(midi[i], shape.blend, shape.spread, this.cylinder);
      this.theta.x = this.cylinder.theta;
      this.r.x = this.cylinder.r;
      this.h.x = this.cylinder.y;
      this.loud.x = energy[i];
      this.theta.v = this.r.v = this.h.v = this.loud.v = 0;
    };
    settle(start);

    for (let i = start; i < n; i++) {
      // A phrase starts on its note: no swoop over from where the last one ended.
      if (i > start && voiced[i] && !voiced[i - 1]) settle(i);
      const time = firstTime + i * hop;
      const end = i === n - 1 ? Math.min(shape.t, time + MAX_OVERRUN) : time + hop;
      this.sample(time, shape.t - time, shape.tailSeconds, voiced[i]);
      if (end <= time) continue;

      voiceCylinder(midi[i], shape.blend, shape.spread, this.cylinder);
      const theta = this.theta.x + turnBetween(this.theta.x, this.cylinder.theta);
      const r = this.cylinder.r;
      const y = this.cylinder.y;
      const loud = Math.min(1, Math.max(0, energy[i]));
      let at = time;
      while (at < end - 1e-9) {
        const dt = Math.min(step, end - at);
        springStep(this.theta, theta, dt, omega);
        springStep(this.r, r, dt, omega);
        springStep(this.h, y, dt, omega);
        springStep(this.loud, loud, dt, omega);
        at += dt;
        // The step onto the next frame's time is that frame's own sample.
        if (at < end - 1e-9 || i === n - 1) this.sample(at, shape.t - at, shape.tailSeconds, voiced[i]);
      }
    }
  }

  private sample(time: number, age: number, tailSeconds: number, voiced: number) {
    if (age > tailSeconds || this.samples >= this.sx.length) return;
    this.cylinder.theta = this.theta.x;
    this.cylinder.r = this.r.x;
    this.cylinder.y = this.h.x;
    const p = cylinderPoint(this.cylinder, this.point);
    const j = this.samples++;
    this.sx[j] = p.x;
    this.sy[j] = p.y;
    this.sz[j] = p.z;
    this.sAge[j] = Math.max(0, age);
    this.sLoud[j] = Math.max(0, this.loud.x);
    this.sVoiced[j] = voiced;
    this.sAt[j] = time;
  }

  /** 3a: rings evenly along each phrase (the stretches where the line sounds). */
  private resample() {
    const { sx, sy, sz, sAge, sLoud, sVoiced } = this;
    const samples = this.samples;
    // Spacing: fine, unless the path is too long for the rings there are.
    let length = 0;
    let pieces = 0;
    for (let i = 0; i < samples; i++) {
      if (!sVoiced[i]) continue;
      if (i === 0 || !sVoiced[i - 1]) pieces++;
      else length += Math.hypot(sx[i] - sx[i - 1], sy[i] - sy[i - 1], sz[i] - sz[i - 1]);
    }
    const spacing = Math.max(RING_SPACING, length / Math.max(1, this.rings - 2 * pieces - 2));

    let count = 0;
    let phrase = 0;
    const put = (i: number, f: number) => {
      // A ring between samples i and i+1 (f of the way).
      if (count >= this.rings) return;
      const k = Math.min(samples - 1, i + 1);
      this.x[count] = sx[i] + (sx[k] - sx[i]) * f;
      this.y[count] = sy[i] + (sy[k] - sy[i]) * f;
      this.z[count] = sz[i] + (sz[k] - sz[i]) * f;
      this.age[count] = sAge[i] + (sAge[k] - sAge[i]) * f;
      this.loudness[count] = sLoud[i] + (sLoud[k] - sLoud[i]) * f;
      this.phrase[count] = phrase;
      count++;
    };
    for (let i = 0; i < samples; ) {
      if (!sVoiced[i]) {
        i++;
        continue;
      }
      let last = i;
      while (last + 1 < samples && sVoiced[last + 1]) last++;
      // Rings every `spacing` along samples i..last, and one on each end.
      put(i, 0);
      let carried = 0; // distance since the last ring
      for (let k = i; k < last; k++) {
        const segment = Math.hypot(sx[k + 1] - sx[k], sy[k + 1] - sy[k], sz[k + 1] - sz[k]);
        let along = spacing - carried;
        while (along < segment) {
          put(k, along / segment);
          along += spacing;
        }
        carried = segment - (along - spacing);
      }
      if (last > i) {
        // The end ring: replaces the last one if they'd nearly coincide.
        if (carried < spacing * 0.35 && count > 0 && this.phrase[count - 1] === phrase && count > 1 && this.phrase[count - 2] === phrase) count--;
        put(last, 0);
      }
      phrase++;
      i = last + 1;
    }
    this.count = count;
  }

  /**
   * 3b: a smoothing along each phrase that widens along the tail: right
   * behind the head the tail follows the comet exactly, and further back it
   * relaxes, rounding the elbows where the comet sat on a note and set off
   * somewhere new. Three box blurs (close to a Gaussian); each window is
   * symmetric and narrowed near a phrase's ends, so the ends stay exactly
   * where they are and a straight stretch stays straight. Window widths vary
   * continuously (a blend of the two nearest whole widths), so the tail
   * bends smoothly where the smoothing changes.
   */
  private smooth() {
    const { x, y, z, phrase, reach, fromHead, px, py, pz } = this;
    const count = this.count;
    if (count < 3) return;
    let spacing = RING_SPACING;
    for (let i = 1; i < count; i++) {
      if (phrase[i] === phrase[i - 1]) {
        spacing = Math.max(spacing, Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1]));
        break;
      }
    }
    fromHead[count - 1] = 0;
    for (let i = count - 2; i >= 0; i--) {
      fromHead[i] = fromHead[i + 1] + (phrase[i] === phrase[i + 1] ? Math.hypot(x[i + 1] - x[i], y[i + 1] - y[i], z[i + 1] - z[i]) : 0);
    }
    let startOfPhrase = 0;
    let endOfPhrase = -1;
    for (let i = 0; i < count; i++) {
      if (i > 0 && phrase[i] !== phrase[i - 1]) startOfPhrase = i;
      if (i > endOfPhrase) {
        endOfPhrase = i;
        while (endOfPhrase + 1 < count && phrase[endOfPhrase + 1] === phrase[i]) endOfPhrase++;
      }
      const along = Math.min(1, fromHead[i] / RELAX_DISTANCE);
      const sigma = (ROUNDING_NEW + (ROUNDING_OLD - ROUNDING_NEW) * along * along * (3 - 2 * along)) / spacing; // in rings
      // Three passes of a box of half-width h have a variance of h(h + 1).
      const h = (Math.sqrt(1 + 4 * sigma * sigma) - 1) / 2;
      reach[i] = Math.min(h, MAX_REACH, i - startOfPhrase, endOfPhrase - i);
    }
    for (let pass = 0; pass < 3; pass++) {
      px[0] = py[0] = pz[0] = 0;
      for (let i = 0; i < count; i++) {
        px[i + 1] = px[i] + x[i];
        py[i + 1] = py[i] + y[i];
        pz[i + 1] = pz[i] + z[i];
      }
      for (let i = 0; i < count; i++) {
        const h = reach[i];
        if (h <= 0) continue;
        const h0 = Math.floor(h);
        const f = h - h0;
        const w0 = 2 * h0 + 1;
        let ax = (px[i + h0 + 1] - px[i - h0]) / w0;
        let ay = (py[i + h0 + 1] - py[i - h0]) / w0;
        let az = (pz[i + h0 + 1] - pz[i - h0]) / w0;
        if (f > 0) {
          const h1 = h0 + 1;
          const w1 = 2 * h1 + 1;
          ax += ((px[i + h1 + 1] - px[i - h1]) / w1 - ax) * f;
          ay += ((py[i + h1 + 1] - py[i - h1]) / w1 - ay) * f;
          az += ((pz[i + h1 + 1] - pz[i - h1]) / w1 - az) * f;
        }
        x[i] = ax;
        y[i] = ay;
        z[i] = az;
      }
    }
  }

  /** 4: radii from loudness, tapering with age, round at each end of a phrase, never changing abruptly. */
  private shape(shape: CometShape) {
    const { x, y, z, radius, distance, phrase } = this;
    const count = this.count;
    distance[0] = 0;
    for (let i = 1; i < count; i++) {
      distance[i] = distance[i - 1] + (phrase[i] === phrase[i - 1] ? Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1], z[i] - z[i - 1]) : 0);
    }
    for (let i = 0; i < count; i++) {
      const u = Math.min(1, this.age[i] / shape.tailSeconds);
      radius[i] = (shape.base + shape.gain * Math.min(1, this.loudness[i])) * Math.pow(1 - u, 0.9);
    }
    // Round each phrase's ends; the head's end is under the head's bead.
    for (let i = 0; i < count; ) {
      let last = i;
      while (last + 1 < count && phrase[last + 1] === phrase[i]) last++;
      const headEnd = last === count - 1 && this.sounding;
      for (let k = i; k <= last; k++) {
        const fromStart = distance[k] - distance[i];
        const fromEnd = headEnd ? Infinity : distance[last] - distance[k];
        radius[k] = Math.min(radius[k], cap(fromStart, radius[k]), cap(fromEnd, radius[k]));
      }
      i = last + 1;
    }
    // Width changes at most MAX_SLOPE per unit length (where the comet sat
    // still, the rings either side are seconds apart in age).
    for (let i = 1; i < count; i++) {
      if (phrase[i] === phrase[i - 1]) {
        radius[i] = Math.min(radius[i], radius[i - 1] + MAX_SLOPE * (distance[i] - distance[i - 1]));
      }
    }
    for (let i = count - 2; i >= 0; i--) {
      if (phrase[i] === phrase[i + 1]) {
        radius[i] = Math.min(radius[i], radius[i + 1] + MAX_SLOPE * (distance[i + 1] - distance[i]));
      }
    }
  }
}

/** A hemispherical end: the radius `d` along from the tip of a tube of radius `r`. */
const cap = (d: number, r: number) => (d >= r ? r : Math.sqrt(Math.max(0, d * (2 * r - d))));

const UP = new THREE.Vector3(0, 1, 0);
const tangent = new THREE.Vector3();
const chord = new THREE.Vector3();
const n = new THREE.Vector3();
const b = new THREE.Vector3();
const previousN = new THREE.Vector3();
const dir = new THREE.Vector3();
const nrm = new THREE.Vector3();

/**
 * Write a tube around a path: `segments` vertices per ring, positions and
 * normals (normals lean along the path where the radius changes, so the ends
 * shade round). Rings of different phrases aren't joined: both are points.
 * Returns the number of rings written.
 */
export const writeTube = (
  path: CometPath,
  radiusScale: number,
  segments: number,
  position: Float32Array,
  normal: Float32Array
) => {
  const { count, x, y, z, radius, distance, phrase } = path;
  tangent.set(1, 0, 0);
  for (let i = 0; i < count; i++) {
    const a = i > 0 && phrase[i - 1] === phrase[i] ? i - 1 : i;
    const c = i + 1 < count && phrase[i + 1] === phrase[i] ? i + 1 : i;
    chord.set(x[c] - x[a], y[c] - y[a], z[c] - z[a]);
    // Where two rings coincide, the tangent carries on from the last one.
    if (chord.lengthSq() > 1e-14) tangent.copy(chord).normalize();
    // Across the path, level with the horizon where possible (so it doesn't
    // depend on where the tail starts), otherwise carried along.
    n.crossVectors(tangent, UP);
    if (n.lengthSq() > 0.06) {
      n.normalize();
    } else if (i > 0) {
      n.copy(previousN).addScaledVector(tangent, -tangent.dot(previousN));
      if (n.lengthSq() < 1e-10) n.set(1, 0, 0);
      n.normalize();
    } else {
      n.set(1, 0, 0).addScaledVector(tangent, -tangent.x).normalize();
    }
    // Keep the rings from turning over between neighbours.
    if (i > 0 && n.dot(previousN) < 0) n.negate();
    previousN.copy(n);
    b.crossVectors(tangent, n);

    const span = distance[c] - distance[a];
    const slope = span > 1e-9 ? Math.max(-6, Math.min(6, ((radius[c] - radius[a]) * radiusScale) / span)) : 0;
    const r = radius[i] * radiusScale;
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      dir.copy(n).multiplyScalar(Math.cos(angle)).addScaledVector(b, Math.sin(angle));
      const v = (i * segments + j) * 3;
      position[v] = x[i] + dir.x * r;
      position[v + 1] = y[i] + dir.y * r;
      position[v + 2] = z[i] + dir.z * r;
      nrm.copy(dir).addScaledVector(tangent, -slope).normalize();
      normal[v] = nrm.x;
      normal[v + 1] = nrm.y;
      normal[v + 2] = nrm.z;
    }
  }
  return count;
};

/** Triangles joining each ring to the next, for up to `rings` rings. */
export const tubeIndex = (rings: number, segments: number) => {
  const index: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      index.push(a, b, c, b, d, c);
    }
  }
  return index;
};
