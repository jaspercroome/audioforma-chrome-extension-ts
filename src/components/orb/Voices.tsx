import React, { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

import { StemRole } from "../../stems/stemAnalysis";
import { StemStyle } from "../../stems/styles";
import { StemTimeline } from "../../stems/timeline";
import { VEIN_COUNT } from "../../utils/orbAnalysis";
import { hzToMidi } from "../../utils/pitch";
import { cylinderPoint, turnBetween, veinMidi, voiceCylinder, voicePoint } from "./voiceLayout";
import { ribbonFragment, ribbonVertex, sparkFragment, sparkVertex } from "./voiceShaders";

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

/** Seconds of history drawn: melodic trails and chord sparks. */
const TRAIL_SECONDS = 4;
const SPARK_SECONDS = 2.5;
const MAX_TRAIL = 128;
const MAX_SPARKS = 900;
const MAX_CHORD_SEGMENTS = 16;
const PITCH_CONFIDENCE = 0.55;
const SILENT_ENERGY = 0.04;
const SPARK_LEVEL = 0.3;

const approach = (current: number, target: number, dt: number, tau: number) =>
  current + (target - current) * (1 - Math.exp(-dt / tau));
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const TRAIL_STYLE: Record<StemRole, { base: number; gain: number }> = {
  melody: { base: 0.02, gain: 0.06 },
  bass: { base: 0.028, gain: 0.06 },
  chords: { base: 0.012, gain: 0.04 },
  drums: { base: 0, gain: 0 },
  mix: { base: 0, gain: 0 },
};
/**
 * Unpitched frames shorter than this (the moment between two notes) are
 * bridged, so a phrase reads as one line; longer silences are rests and
 * break it.
 */
const BRIDGE_FRAMES = 3;
/** How quickly a trail glides to a new note (seconds): leaps become arcs around the orb. */
const GLIDE_SECONDS = 0.07;

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

/** Camera-facing strip: two vertices per point, rebuilt every frame. */
const makeRibbon = (color: string) => {
  const geometry = new THREE.BufferGeometry();
  const vertices = MAX_TRAIL * 2;
  const attribute = (size: number) => new THREE.BufferAttribute(new Float32Array(vertices * size), size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute(3));
  geometry.setAttribute("aPrev", attribute(3));
  geometry.setAttribute("aNext", attribute(3));
  geometry.setAttribute("aWidth", attribute(1));
  geometry.setAttribute("aAlpha", attribute(1));
  const side = new Float32Array(vertices);
  for (let i = 0; i < vertices; i++) side[i] = i % 2 === 0 ? -1 : 1;
  geometry.setAttribute("aSide", new THREE.BufferAttribute(side, 1));
  const index: number[] = [];
  for (let i = 0; i < MAX_TRAIL - 1; i++) {
    const a = i * 2;
    index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  geometry.setIndex(index);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const material = new THREE.ShaderMaterial({
    vertexShader: ribbonVertex,
    fragmentShader: ribbonFragment,
    uniforms: { uColor: { value: new THREE.Color(color) } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  return { geometry, material };
};

const makeSparks = (color: string) => {
  const geometry = new THREE.BufferGeometry();
  const attribute = (size: number) =>
    new THREE.BufferAttribute(new Float32Array(MAX_SPARKS * size), size).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", attribute(3));
  geometry.setAttribute("aSize", attribute(1));
  geometry.setAttribute("aAlpha", attribute(1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
  const material = new THREE.ShaderMaterial({
    vertexShader: sparkVertex,
    fragmentShader: sparkFragment,
    uniforms: { uColor: { value: new THREE.Color(color) }, uScale: { value: 800 } },
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  return { geometry, material };
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
  spread: number;
};

/**
 * One stem as a body in the orb. A melodic line is a comet whose trail draws
 * its phrase (width = loudness, gaps = rests); notes sounding together are
 * sparks, and the current chord is joined into its shape. How much of each a
 * stem shows depends on its role and on how single-line it actually is.
 */
const StemVoice = ({ stem, sourceRef, blendRef, spread }: StemVoiceProps) => {
  const role = stem.style.role;
  const ribbon = useMemo(() => makeRibbon(stem.style.color), [stem.style.color]);
  const sparks = useMemo(() => makeSparks(stem.style.color), [stem.style.color]);
  const chord = useMemo(() => makeChord(stem.style.color), [stem.style.color]);
  const headMaterial = useMemo(
    () => new THREE.MeshBasicMaterial({ color: stem.style.color, transparent: true, depthWrite: false, toneMapped: false }),
    [stem.style.color]
  );
  const head = useRef<THREE.Mesh>(null);
  const visibility = useRef(0);
  const monophony = useRef(role === "chords" ? 0 : 1);
  const { size, camera } = useThree();

  useEffect(
    () => () => {
      [ribbon, sparks, chord].forEach(({ geometry, material }) => {
        geometry.dispose();
        material.dispose();
      });
      headMaterial.dispose();
    },
    [ribbon, sparks, chord, headMaterial]
  );

  // Scratch space reused every frame.
  const scratch = useMemo(
    () => ({
      points: new Float32Array(MAX_TRAIL * 3),
      widths: new Float32Array(MAX_TRAIL),
      alphas: new Float32Array(MAX_TRAIL),
      midis: new Float32Array(MAX_TRAIL),
      ages: new Float32Array(MAX_TRAIL),
      cylinder: { theta: 0, r: 0, y: 0 },
      p: new THREE.Vector3(),
      notes: [] as number[],
    }),
    []
  );

  useFrame((_, delta) => {
    const source = sourceRef.current;
    const timeline = source?.timelines[stem.name];
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const target = source && source.active() ? (source.audible(stem.name) ? 1 : 0.12) : 0;
    visibility.current = approach(visibility.current, target, dt, 0.25);
    const vis = visibility.current;
    const hidden = !timeline || vis < 0.005 || role === "drums";
    ribbon.material.visible = sparks.material.visible = chord.material.visible = !hidden;
    if (head.current) head.current.visible = !hidden;
    if (hidden || !source || !timeline) return;

    const t = source.songTime();
    const now = timeline.indexAt(t);
    const blend = blendRef.current;
    const { points, widths, alphas, ages, p, notes } = scratch;

    // --- The line: a trail of recent pitches, newest first. ---
    const { midis } = scratch;
    let count = 0;
    let voiced = 0;
    let pitched = 0;
    const style = TRAIL_STYLE[role];
    for (let j = 0; j < MAX_TRAIL && now - j >= 0; j++) {
      const k = now - j;
      const age = Math.max(0, t - timeline.timeOf(k));
      if (age > TRAIL_SECONDS) break;
      const energy = timeline.energy(k);
      const midi = lineMidi(timeline, k, role);
      if (energy >= SILENT_ENERGY) voiced++;
      if (!Number.isNaN(midi)) pitched++;
      midis[count] = midi;
      const fade = 1 - age / TRAIL_SECONDS;
      widths[count] = Number.isNaN(midi) ? 0 : (style.base + style.gain * Math.min(1, energy)) * (0.45 + 0.55 * fade);
      alphas[count] = Math.pow(fade, 1.2);
      ages[count] = age;
      count++;
    }
    // Bridge the short unpitched moments between notes: the jump happens mid-gap.
    for (let i = 0; i < count; ) {
      if (!Number.isNaN(midis[i])) {
        i++;
        continue;
      }
      let end = i;
      while (end < count && Number.isNaN(midis[end])) end++;
      const run = end - i;
      if (i > 0 && end < count && run <= BRIDGE_FRAMES) {
        const width = 0.7 * Math.min(widths[i - 1], widths[end]);
        for (let g = i; g < end; g++) {
          midis[g] = g - i < run / 2 ? midis[i - 1] : midis[end];
          widths[g] = width;
        }
      }
      i = end;
    }
    // Real rests: park them on a neighbouring pitch (they have no width), and
    // close each phrase where it ends so the strip never stretches across a
    // rest. The newest point keeps its width: that's the comet's head.
    let lastMidi = 60;
    for (let i = 0; i < count; i++) {
      if (!Number.isNaN(midis[i])) {
        lastMidi = midis[i];
        break;
      }
    }
    for (let i = 0; i < count; i++) {
      if (Number.isNaN(midis[i])) midis[i] = lastMidi;
      else lastMidi = midis[i];
    }
    for (let i = 1; i < count; i++) {
      if (widths[i] > 0 && (widths[i - 1] === 0 || (i + 1 < count && widths[i + 1] === 0))) alphas[i] = -alphas[i];
    }
    // Glide from each note to the next in cylindrical coordinates, oldest first,
    // so the line swings around the orb between notes rather than jumping.
    const glide = 1 - Math.exp(-timeline.hopSeconds / GLIDE_SECONDS);
    const c = scratch.cylinder;
    let theta = 0;
    let radius = 0;
    let height = 0;
    for (let i = count - 1; i >= 0; i--) {
      if (alphas[i] < 0) {
        alphas[i] = -alphas[i];
        widths[i] = 0;
      }
      voiceCylinder(midis[i], ages[i], blend, spread, c);
      if (i === count - 1) {
        theta = c.theta;
        radius = c.r;
        height = c.y;
      } else {
        theta += turnBetween(theta, c.theta) * glide;
        radius += (c.r - radius) * glide;
        height += (c.y - height) * glide;
      }
      c.theta = theta;
      c.r = radius;
      c.y = height;
      cylinderPoint(c, p);
      points[i * 3] = p.x;
      points[i * 3 + 1] = p.y;
      points[i * 3 + 2] = p.z;
    }

    // How single-line this stem is right now decides comet vs constellation.
    const single = voiced > 4 ? pitched / voiced : monophony.current;
    monophony.current = approach(monophony.current, single, dt, 0.8);
    // A melodic stem playing chords (4-stem "other") shows sparks; a chordal
    // stem playing a single line (a piano solo) grows a comet.
    const m = monophony.current;
    const cometWeight = role === "chords" ? smoothstep(0.6, 0.9, m) : role === "melody" ? Math.max(0.35, smoothstep(0.2, 0.6, m)) : 1;
    const sparkWeight = role === "bass" ? 0 : role === "melody" ? 1 - smoothstep(0.3, 0.7, m) : 1 - 0.6 * cometWeight;

    const position = ribbon.geometry.getAttribute("position") as THREE.BufferAttribute;
    const prev = ribbon.geometry.getAttribute("aPrev") as THREE.BufferAttribute;
    const next = ribbon.geometry.getAttribute("aNext") as THREE.BufferAttribute;
    const width = ribbon.geometry.getAttribute("aWidth") as THREE.BufferAttribute;
    const alpha = ribbon.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      for (let v = 0; v < 2; v++) {
        const at = i * 2 + v;
        position.setXYZ(at, points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
        prev.setXYZ(at, points[a * 3], points[a * 3 + 1], points[a * 3 + 2]);
        next.setXYZ(at, points[b * 3], points[b * 3 + 1], points[b * 3 + 2]);
        width.setX(at, widths[i]);
        alpha.setX(at, alphas[i] * vis * cometWeight);
      }
    }
    ribbon.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    [position, prev, next, width, alpha].forEach((attr) => (attr.needsUpdate = true));

    // Comet head at the newest point, while the line is sounding.
    if (head.current) {
      const on = count > 0 && widths[0] > 0;
      head.current.visible = on && cometWeight > 0.05;
      if (on) {
        head.current.position.set(points[0], points[1], points[2]);
        head.current.scale.setScalar(0.8 + 1.6 * Math.min(1, timeline.energy(now)));
        headMaterial.opacity = vis * cometWeight;
      }
    }

    // --- Constellations: every clearly sounding note, rising as it ages. ---
    const sparkPosition = sparks.geometry.getAttribute("position") as THREE.BufferAttribute;
    const sparkSize = sparks.geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const sparkAlpha = sparks.geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    let sparkCount = 0;
    if (sparkWeight > 0.01) {
      for (let j = 0; now - j >= 0 && sparkCount < MAX_SPARKS; j++) {
        const k = now - j;
        const age = Math.max(0, t - timeline.timeOf(k));
        if (age > SPARK_SECONDS) break;
        const fade = 1 - age / SPARK_SECONDS;
        for (let vein = 0; vein < VEIN_COUNT && sparkCount < MAX_SPARKS; vein++) {
          const level = timeline.global(k, vein);
          if (level < SPARK_LEVEL) continue;
          voicePoint(veinMidi(vein), age, blend, spread, p);
          sparkPosition.setXYZ(sparkCount, p.x, p.y, p.z);
          sparkSize.setX(sparkCount, (0.03 + 0.07 * level) * (0.5 + 0.5 * fade));
          sparkAlpha.setX(sparkCount, Math.pow(fade, 1.3) * (0.45 + 0.55 * level) * vis * sparkWeight);
          sparkCount++;
        }
      }
    }
    sparks.geometry.setDrawRange(0, sparkCount);
    [sparkPosition, sparkSize, sparkAlpha].forEach((attr) => (attr.needsUpdate = true));
    const perspective = camera as THREE.PerspectiveCamera;
    sparks.material.uniforms.uScale.value =
      size.height / (2 * Math.tan(THREE.MathUtils.degToRad((perspective.fov ?? 30) / 2)));

    // --- The chord sounding now, joined low to high into its shape. ---
    notes.length = 0;
    if (now >= 0 && role === "chords" && sparkWeight > 0.01) {
      for (let vein = 0; vein < VEIN_COUNT; vein++) if (timeline.global(now, vein) >= SPARK_LEVEL + 0.05) notes.push(vein);
    }
    const chordPosition = chord.geometry.getAttribute("position") as THREE.BufferAttribute;
    let segments = 0;
    for (let i = 0; i + 1 < notes.length && segments < MAX_CHORD_SEGMENTS; i++, segments++) {
      voicePoint(veinMidi(notes[i]), 0, blend, spread, p);
      chordPosition.setXYZ(segments * 2, p.x, p.y, p.z);
      voicePoint(veinMidi(notes[i + 1]), 0, blend, spread, p);
      chordPosition.setXYZ(segments * 2 + 1, p.x, p.y, p.z);
    }
    chord.geometry.setDrawRange(0, segments * 2);
    chordPosition.needsUpdate = true;
    // Chord shapes read on the circle of fifths; on the helix they'd only cut across it.
    chord.material.opacity = 0.55 * vis * sparkWeight * (1 - blend);
  });

  return (
    <group>
      <mesh geometry={ribbon.geometry} material={ribbon.material} frustumCulled={false} renderOrder={2} />
      <points geometry={sparks.geometry} material={sparks.material} frustumCulled={false} renderOrder={2} />
      <lineSegments geometry={chord.geometry} material={chord.material} frustumCulled={false} renderOrder={2} />
      <mesh ref={head} material={headMaterial} renderOrder={2} visible={false}>
        <sphereGeometry args={[0.05, 20, 20]} />
      </mesh>
    </group>
  );
};

type VoicesProps = {
  stems: VoiceStem[];
  sourceRef: React.MutableRefObject<VoiceSource | null>;
  blendRef: React.MutableRefObject<number>;
  spread: number;
};

/** Every stem as its own body, meandering around the others. */
export const Voices = ({ stems, sourceRef, blendRef, spread }: VoicesProps) => (
  <group>
    {stems.map((stem) => (
      <StemVoice key={stem.name} stem={stem} sourceRef={sourceRef} blendRef={blendRef} spread={spread} />
    ))}
  </group>
);
