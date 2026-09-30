import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { easing } from "maath";
import * as THREE from "three";

import { StemRole } from "../../stems/stemAnalysis";
import { StemStyle } from "../../stems/styles";
import { StemTimeline } from "../../stems/timeline";
import { VEIN_COUNT } from "../../utils/orbAnalysis";
import { hzToMidi } from "../../utils/pitch";
import { CometPath, confirmPitches, tubeIndex, writeTube } from "./cometPath";
import { loudnessOut, veinMidi, voicePoint } from "./voiceLayout";
import { bodyFragment, bodyVertex } from "./voiceShaders";

/** What the Voices view reads each frame. */
export type VoiceSource = {
  songTime: () => number;
  /** False when nothing is playing: the voices fade away. */
  active: () => boolean;
  timelines: Record<string, StemTimeline>;
  /** Muted stems fade to a ghost, so you see what you hear. */
  audible: (stem: string) => boolean;
};

export type VoiceStem = { name: string; style: StemStyle };

/** A comet's tail: the last few seconds of where its line has been. */
const TAIL_SECONDS = 2.5;
/** History stepped through before the tail starts, so the tail's end has settled too. */
const WARMUP_SECONDS = 0.4;
/**
 * The comet runs this far ahead of the playhead: a frame's pitch is ready
 * only once its window has played, a new note waits a frame to be
 * confirmed, and the spring takes a moment to arrive. This way it moves with
 * the note rather than after it.
 */
const COMET_LEAD = 0.09;
/** Chord notes light when a frame's window is centred on the playhead. */
const SPARK_LEAD = 0.045;
const MAX_FRAMES = 96;
/** Rings along a comet's tube, at most, and vertices around each. */
const RINGS = 768;
const SEGMENTS = 10;
/** Chord notes stay lit a little after they sound, shrinking away. */
const SPARK_SECONDS = 1.6;
const SPARK_DECAY = 0.45;
const MAX_CHORD_SEGMENTS = 16;
const PITCH_CONFIDENCE = 0.55;
const SILENT_ENERGY = 0.04;
const SPARK_LEVEL = 0.3;
/** How present a muted stem stays. */
const GHOST = 0.12;
/**
 * Unpitched frames shorter than this (the moment between two notes) are
 * bridged, so a phrase reads as one line; longer silences are rests and
 * break it.
 */
const BRIDGE_FRAMES = 3;
/** The head's dot is this much wider than the tail where they meet. */
const HEAD_SCALE = 1.7;
/** Chord-note dots: radius when faint, plus more when loud. */
const BEAD_RADIUS = { base: 0.011, gain: 0.011 };
/** The tail pales toward its end, so it fades into the room while staying solid. */
const TAIL_WHITEN = 0.65;
/** Voices draw after the glass (render order 3), crisp, rather than through it. */
const RENDER_ORDER = 4;

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Tube radius at a comet's head: base, plus a little more when loud (how
 * far out it sits already says how loud it is).
 */
const COMET: Record<StemRole, { base: number; gain: number }> = {
  melody: { base: 0.0105, gain: 0.0035 },
  bass: { base: 0.012, gain: 0.004 },
  chords: { base: 0.008, gain: 0.003 },
  drums: { base: 0, gain: 0 },
  mix: { base: 0, gain: 0 },
};

/**
 * The pitch a stem's line is on in frame k, or NaN in rests and unpitched
 * frames. Chordal stems need a clearer single pitch before they draw a line.
 */
const lineMidi = (timeline: StemTimeline, k: number, role: StemRole) => {
  if (timeline.energy(k) < SILENT_ENERGY) return NaN;
  const hz = timeline.pitchHz(k);
  const needed = role === "chords" ? 0.8 : PITCH_CONFIDENCE;
  return hz > 0 && timeline.pitchConfidence(k) >= needed ? hzToMidi(hz) : NaN;
};

const bodyMaterial = (color: string, tube: boolean) =>
  new THREE.ShaderMaterial({
    vertexShader: bodyVertex,
    fragmentShader: bodyFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uWhiten: { value: 0 }, uTailWhiten: { value: TAIL_WHITEN } },
    defines: tube ? { TUBE: "" } : {},
    toneMapped: false,
  });

/** A tube around the comet's path, rebuilt every frame. */
const makeTube = (color: string) => {
  const geometry = new THREE.BufferGeometry();
  const vertices = RINGS * SEGMENTS;
  const attribute = (size: number) =>
    new THREE.BufferAttribute(new Float32Array(vertices * size), size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute(3));
  geometry.setAttribute("normal", attribute(3));
  geometry.setAttribute("aFade", attribute(1));
  geometry.setIndex(tubeIndex(RINGS, SEGMENTS));
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  return { geometry, material: bodyMaterial(color, true) };
};

/** Dots for chord notes: one instance per sounding note. */
const makeBeads = (color: string) => {
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), bodyMaterial(color, false), VEIN_COUNT);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color(color)); // creates instanceColor
  mesh.instanceColor?.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = RENDER_ORDER;
  return mesh;
};

const makeChord = (color: string) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(MAX_CHORD_SEGMENTS * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage)
  );
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
  return { geometry, material };
};

type StemVoiceProps = {
  stem: VoiceStem;
  sourceRef: React.MutableRefObject<VoiceSource | null>;
  blendRef: React.MutableRefObject<number>;
};

/**
 * One stem as a body in the orb. A melodic line is a comet at its current
 * pitch: a dot that glides from note to note, trailing a stroke of where it
 * has just been (width = loudness, gaps = rests). Notes sounding together
 * are dots where they are, and the chord sounding now is joined into its
 * shape. How much of each a stem shows depends on its role and on how
 * single-line it actually is.
 */
const StemVoice = ({ stem, sourceRef, blendRef }: StemVoiceProps) => {
  const role = stem.style.role;
  const color = stem.style.color;
  const tube = useMemo(() => makeTube(color), [color]);
  const beads = useMemo(() => makeBeads(color), [color]);
  const chord = useMemo(() => makeChord(color), [color]);
  const headMaterial = useMemo(() => bodyMaterial(color, false), [color]);
  const tubeMesh = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);
  const chordLines = useRef<THREE.LineSegments>(null);
  // Smoothed with maath's damp: how present the stem is, and how single-line.
  const smooth = useRef({ visibility: 0, monophony: role === "chords" ? 0 : 1 }).current;

  useEffect(
    () => () => {
      tube.geometry.dispose();
      tube.material.dispose();
      beads.geometry.dispose();
      (beads.material as THREE.Material).dispose();
      beads.dispose();
      chord.geometry.dispose();
      chord.material.dispose();
      headMaterial.dispose();
    },
    [tube, beads, chord, headMaterial]
  );

  // Scratch space reused every frame.
  const scratch = useMemo(
    () => ({
      midi: new Float32Array(MAX_FRAMES),
      voiced: new Uint8Array(MAX_FRAMES),
      energy: new Float32Array(MAX_FRAMES),
      path: new CometPath(MAX_FRAMES, RINGS),
      glow: new Float32Array(VEIN_COUNT),
      p: new THREE.Vector3(),
      matrix: new THREE.Matrix4(),
      tint: new THREE.Color(),
      base: new THREE.Color(color),
      white: new THREE.Color(1, 1, 1),
      notes: [] as number[],
    }),
    [color]
  );

  useFrame((_, delta) => {
    const source = sourceRef.current;
    const timeline = source?.timelines[stem.name];
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const target = source && source.active() ? (source.audible(stem.name) ? 1 : GHOST) : 0;
    easing.damp(smooth, "visibility", target, 0.18, dt);
    const vis = smooth.visibility;
    const hidden = !timeline || vis < 0.005 || role === "drums";
    const tubeObject = tubeMesh.current;
    const headObject = head.current;
    const lines = chordLines.current;
    if (tubeObject) tubeObject.visible = false;
    if (headObject) headObject.visible = false;
    if (lines) lines.visible = false;
    beads.visible = false;
    if (hidden || !source || !timeline) return;

    // A fading or muted stem shrinks and pales rather than turning see-through.
    const presence = Math.sqrt(Math.min(1, vis));
    const whiten = (1 - Math.min(1, vis)) * 0.7;
    tube.material.uniforms.uWhiten.value = whiten;
    headMaterial.uniforms.uWhiten.value = whiten;
    (beads.material as THREE.ShaderMaterial).uniforms.uWhiten.value = whiten;

    const song = source.songTime();
    const t = song + COMET_LEAD;
    const now = timeline.indexAt(t);
    const blend = blendRef.current;
    const s = scratch;

    // --- The line's recent frames, oldest first. ---
    let first = now;
    while (first > 0 && now - first < MAX_FRAMES - 1 && t - timeline.timeOf(first - 1) <= TAIL_SECONDS + WARMUP_SECONDS) {
      first--;
    }
    const n = now < 0 ? 0 : now - first + 1;
    let voicedFrames = 0;
    let pitchedFrames = 0;
    for (let i = 0; i < n; i++) {
      const k = first + i;
      s.energy[i] = timeline.energy(k);
      s.midi[i] = lineMidi(timeline, k, role);
      s.voiced[i] = Number.isNaN(s.midi[i]) ? 0 : 1;
      if (s.energy[i] >= SILENT_ENERGY) voicedFrames++;
      if (s.voiced[i]) pitchedFrames++;
    }
    // Bridge the short unpitched moments between notes (the jump lands mid-gap).
    for (let i = 0; i < n; ) {
      if (s.voiced[i]) {
        i++;
        continue;
      }
      let end = i;
      while (end < n && !s.voiced[end]) end++;
      const run = end - i;
      if (i > 0 && end < n && run <= BRIDGE_FRAMES) {
        for (let g = i; g < end; g++) {
          s.midi[g] = g - i < run / 2 ? s.midi[i - 1] : s.midi[end];
          s.voiced[g] = 1;
        }
      }
      i = end;
    }
    confirmPitches(s.midi, n);
    // Rests keep the last pitch (they're drawn with no width), so the comet rests in place.
    let firstPitched = -1;
    for (let i = 0; i < n && firstPitched < 0; i++) if (!Number.isNaN(s.midi[i])) firstPitched = i;
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(s.midi[i])) s.midi[i] = firstPitched < 0 ? NaN : i < firstPitched ? s.midi[firstPitched] : s.midi[i - 1];
    }

    // How single-line this stem is right now decides comet vs constellation.
    const single = voicedFrames > 4 ? pitchedFrames / voicedFrames : smooth.monophony;
    easing.damp(smooth, "monophony", single, 0.6, dt);
    const m = smooth.monophony;
    const cometWeight = role === "chords" ? smoothstep(0.6, 0.9, m) : role === "melody" ? Math.max(0.35, smoothstep(0.2, 0.6, m)) : 1;
    const sparkWeight = role === "bass" ? 0 : role === "melody" ? 1 - smoothstep(0.3, 0.7, m) : 1 - 0.6 * cometWeight;

    // --- The comet: its path as it moved, as a tube, with a dot at the head. ---
    const style = COMET[role];
    const path = s.path;
    if (n > 0 && cometWeight > 0.02) {
      path.build(
        { n, midi: s.midi, voiced: s.voiced, energy: s.energy, firstTime: timeline.timeOf(first), hop: timeline.hopSeconds },
        { t, tailSeconds: TAIL_SECONDS, blend, base: style.base, gain: style.gain }
      );
    } else {
      path.count = 0;
      path.sounding = false;
    }
    const scale = presence * cometWeight;
    const position = tube.geometry.getAttribute("position") as THREE.BufferAttribute;
    const normal = tube.geometry.getAttribute("normal") as THREE.BufferAttribute;
    const fadeAttr = tube.geometry.getAttribute("aFade") as THREE.BufferAttribute;
    const rings = path.count > 1 ? writeTube(path, scale, SEGMENTS, position.array as Float32Array, normal.array as Float32Array) : 0;
    const fadeArray = fadeAttr.array as Float32Array;
    for (let i = 0; i < rings; i++) fadeArray.fill(path.fade[i], i * SEGMENTS, (i + 1) * SEGMENTS);
    tube.geometry.setDrawRange(0, Math.max(0, rings - 1) * SEGMENTS * 6);
    // Upload only the rings in use.
    for (const attribute of [position, normal, fadeAttr]) {
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(0, Math.max(1, rings * SEGMENTS) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    if (tubeObject) tubeObject.visible = rings > 1;

    if (headObject && path.sounding && cometWeight > 0.05) {
      headObject.visible = true;
      headObject.position.copy(path.head);
      headObject.scale.setScalar(path.headRadius * HEAD_SCALE * scale);
    }

    // --- Chord notes are dots where they sound, shrinking as they fade. ---
    const ts = song + SPARK_LEAD;
    const sparkNow = timeline.indexAt(ts);
    let beadCount = 0;
    if (sparkWeight > 0.01 && sparkNow >= 0) {
      s.glow.fill(0);
      for (let k = sparkNow; k >= 0; k--) {
        const age = Math.max(0, ts - timeline.timeOf(k));
        if (age > SPARK_SECONDS) break;
        const decay = Math.exp(-age / SPARK_DECAY);
        for (let vein = 0; vein < VEIN_COUNT; vein++) {
          const level = timeline.global(k, vein);
          if (level >= SPARK_LEVEL && level * decay > s.glow[vein]) s.glow[vein] = level * decay;
        }
      }
      const beadScale = presence * Math.sqrt(sparkWeight);
      for (let vein = 0; vein < VEIN_COUNT; vein++) {
        const glow = Math.min(1, s.glow[vein]);
        if (glow < 0.05) continue;
        // Out = loudness: as a note fades its dot shrinks and falls back toward the axis.
        const out = loudnessOut(glow);
        voicePoint(veinMidi(vein), blend, out, s.p);
        const radius = (BEAD_RADIUS.base + BEAD_RADIUS.gain * out) * beadScale;
        s.matrix.makeScale(radius, radius, radius).setPosition(s.p);
        beads.setMatrixAt(beadCount, s.matrix);
        beads.setColorAt(beadCount, s.tint.copy(s.base).lerp(s.white, 0.55 * (1 - glow)));
        beadCount++;
      }
    }
    beads.count = beadCount;
    beads.visible = beadCount > 0;
    beads.instanceMatrix.needsUpdate = true;
    if (beads.instanceColor) beads.instanceColor.needsUpdate = true;

    // --- The chord sounding now, joined low to high into its shape. ---
    s.notes.length = 0;
    if (sparkNow >= 0 && role === "chords" && sparkWeight > 0.01) {
      for (let vein = 0; vein < VEIN_COUNT; vein++) if (timeline.global(sparkNow, vein) >= SPARK_LEVEL + 0.05) s.notes.push(vein);
    }
    const chordPosition = chord.geometry.getAttribute("position") as THREE.BufferAttribute;
    let segments = 0;
    for (let i = 0; i + 1 < s.notes.length && segments < MAX_CHORD_SEGMENTS; i++, segments++) {
      voicePoint(veinMidi(s.notes[i]), blend, loudnessOut(timeline.global(sparkNow, s.notes[i])), s.p);
      chordPosition.setXYZ(segments * 2, s.p.x, s.p.y, s.p.z);
      voicePoint(veinMidi(s.notes[i + 1]), blend, loudnessOut(timeline.global(sparkNow, s.notes[i + 1])), s.p);
      chordPosition.setXYZ(segments * 2 + 1, s.p.x, s.p.y, s.p.z);
    }
    chord.geometry.setDrawRange(0, segments * 2);
    chordPosition.needsUpdate = true;
    // Chord shapes read on the circle of fifths; on the helix they'd only cut across it.
    chord.material.opacity = 0.5 * vis * sparkWeight * (1 - blend);
    if (lines) lines.visible = segments > 0 && chord.material.opacity > 0.01;
  });

  return (
    <group>
      <mesh ref={tubeMesh} geometry={tube.geometry} material={tube.material} frustumCulled={false} renderOrder={RENDER_ORDER} visible={false} />
      <mesh ref={head} material={headMaterial} renderOrder={RENDER_ORDER} visible={false}>
        <sphereGeometry args={[1, 28, 20]} />
      </mesh>
      <primitive object={beads} />
      <lineSegments ref={chordLines} geometry={chord.geometry} material={chord.material} frustumCulled={false} renderOrder={RENDER_ORDER} visible={false} />
    </group>
  );
};

type VoicesProps = {
  stems: VoiceStem[];
  sourceRef: React.MutableRefObject<VoiceSource | null>;
  blendRef: React.MutableRefObject<number>;
};

/** Every stem as its own body, meandering around the others. */
export const Voices = ({ stems, sourceRef, blendRef }: VoicesProps) => (
  <group>
    {stems.map((stem) => (
      <StemVoice key={stem.name} stem={stem} sourceRef={sourceRef} blendRef={blendRef} />
    ))}
  </group>
);
