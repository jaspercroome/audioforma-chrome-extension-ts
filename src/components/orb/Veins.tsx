import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { noteNames } from "../../utils/consts";
import { fifthsIndex } from "../../utils/notes";
import { NOTE_COLORS_LINEAR } from "../../utils/noteColors";
import { FIRST_OCTAVE, OCTAVES, OrbFrame, PITCH_CLASSES, VEIN_COUNT, veinIndex } from "../../utils/orbAnalysis";
import {
  CURVE,
  HISTORY_COLUMNS,
  HISTORY_RATE,
  HISTORY_SECONDS,
  INNER_RADIUS,
  LATITUDE_MAX,
  octaveFraction,
  OUTER_REACH,
} from "./layout";
import { veinFragment, veinHaloFragment, veinVertex } from "./shaders";

const U_SEGMENTS = 128;
const THETA_SEGMENTS = 8;
// Envelopes: quick enough that rhythm reads, slow enough to glide over the
// ~23 Hz steps between analysis frames instead of jumping at each one.
const ATTACK_SECONDS = 0.05;
const RELEASE_SECONDS = 0.2;
const FLASH_SECONDS = 0.18;
/** Analysis runs ~23 times a second; this long without a frame means no audio. */
const STALE_SECONDS = 0.5;

const seedFor = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Tube strip shared by every vein: u along the vein, theta around it. */
const buildGeometry = () => {
  const geometry = new THREE.InstancedBufferGeometry();
  const rows = U_SEGMENTS + 1;
  const cols = THETA_SEGMENTS + 1;
  const aU = new Float32Array(rows * cols);
  const aTheta = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      aU[r * cols + c] = r / U_SEGMENTS;
      aTheta[r * cols + c] = (c / THETA_SEGMENTS) * Math.PI * 2;
    }
  }
  const indices: number[] = [];
  for (let r = 0; r < U_SEGMENTS; r++) {
    for (let c = 0; c < THETA_SEGMENTS; c++) {
      const a = r * cols + c;
      const b = (r + 1) * cols + c;
      indices.push(a, a + 1, b, b, a + 1, b + 1); // front faces point out of the tube
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * cols * 3), 3));
  geometry.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
  geometry.setAttribute("aTheta", new THREE.BufferAttribute(aTheta, 1));

  const phi = new Float32Array(VEIN_COUNT);
  const octaveT = new Float32Array(VEIN_COUNT);
  const tube = new Float32Array(VEIN_COUNT);
  const color = new Float32Array(VEIN_COUNT * 3);
  const seed = new Float32Array(VEIN_COUNT);
  const row = new Float32Array(VEIN_COUNT);
  for (let o = 0; o < OCTAVES; o++) {
    const octave = FIRST_OCTAVE + o;
    for (let pc = 0; pc < PITCH_CLASSES; pc++) {
      const i = veinIndex(octave, pc);
      phi[i] = THREE.MathUtils.degToRad(fifthsIndex(noteNames[pc]) * 30);
      octaveT[i] = octaveFraction(octave);
      // Bass veins are thicker, treble veins finer.
      tube[i] = THREE.MathUtils.lerp(0.036, 0.018, octaveFraction(octave));
      color.set(NOTE_COLORS_LINEAR[pc], i * 3);
      seed[i] = seedFor(i);
      row[i] = i;
    }
  }
  geometry.setAttribute("iPhi", new THREE.InstancedBufferAttribute(phi, 1));
  geometry.setAttribute("iOctaveT", new THREE.InstancedBufferAttribute(octaveT, 1));
  geometry.setAttribute("iTube", new THREE.InstancedBufferAttribute(tube, 1));
  geometry.setAttribute("iColor", new THREE.InstancedBufferAttribute(color, 3));
  geometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seed, 1));
  geometry.setAttribute("iRow", new THREE.InstancedBufferAttribute(row, 1));
  const flash = new THREE.InstancedBufferAttribute(new Float32Array(VEIN_COUNT), 1);
  flash.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iFlash", flash);
  geometry.instanceCount = VEIN_COUNT;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3);
  return { geometry, flash };
};

/**
 * Rolling history of every vein's level: one row per vein, one column per
 * 1/HISTORY_RATE s. The "head" column always holds the live level and moves
 * on at HISTORY_RATE, leaving the past behind it.
 */
const buildHistory = () => {
  const data = new Uint8Array(HISTORY_COLUMNS * VEIN_COUNT);
  const texture = new THREE.DataTexture(data, HISTORY_COLUMNS, VEIN_COUNT, THREE.RedFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { data, texture };
};

type VeinsProps = {
  frameRef: React.MutableRefObject<OrbFrame>;
  /** Smoothed levels, shared with the lights so they follow the same envelope. */
  smoothedRef: React.MutableRefObject<Float32Array>;
  spread: number;
};

export const Veins = ({ frameRef, smoothedRef, spread }: VeinsProps) => {
  const { geometry, flash } = useMemo(buildGeometry, []);
  const history = useMemo(buildHistory, []);
  const state = useRef({
    head: 0,
    carry: 0,
    lastFrameTime: -1,
    lastNewFrameAt: 0,
    flashes: new Float32Array(VEIN_COUNT),
  });

  const makeMaterial = (fragmentShader: string, radiusScale: number, depthWrite: boolean) =>
    new THREE.ShaderMaterial({
      vertexShader: veinVertex,
      fragmentShader,
      uniforms: {
        uHistory: { value: history.texture },
        uRows: { value: VEIN_COUNT },
        uColumns: { value: HISTORY_COLUMNS },
        uHead: { value: 0 },
        uCarry: { value: 0 },
        uSpan: { value: (HISTORY_COLUMNS - 2) / HISTORY_COLUMNS },
        uLatMax: { value: LATITUDE_MAX },
        uInner: { value: INNER_RADIUS },
        uReach: { value: OUTER_REACH },
        uCurve: { value: CURVE },
        uSpread: { value: spread },
        uTime: { value: 0 },
        uRadiusScale: { value: radiusScale },
      },
      transparent: true,
      depthWrite,
      toneMapped: false,
    });
  // Created once; spread changes go through the uniform below.
  const material = useMemo(() => makeMaterial(veinFragment, 1, true), []);
  const haloMaterial = useMemo(() => makeMaterial(veinHaloFragment, 2.6, false), []);

  useEffect(() => {
    material.uniforms.uSpread.value = spread;
    haloMaterial.uniforms.uSpread.value = spread;
  }, [spread, material, haloMaterial]);

  useEffect(
    () => () => {
      geometry.dispose();
      history.texture.dispose();
      material.dispose();
      haloMaterial.dispose();
    },
    [geometry, history, material, haloMaterial]
  );

  useFrame((clock, delta) => {
    const elapsed = Math.max(delta, 0);
    const dt = Math.min(elapsed, 0.1);
    const frame = frameRef.current;
    const s = state.current;
    const smoothed = smoothedRef.current;
    const flashes = s.flashes;
    const now = clock.clock.elapsedTime;
    const isNewFrame = frame.time !== s.lastFrameTime;
    s.lastFrameTime = frame.time;
    if (isNewFrame) s.lastNewFrameAt = now;
    // If analysis frames stop arriving (capture ended, audio stopped), fade to
    // silence rather than holding the last frame lit.
    const live = now - s.lastNewFrameAt < STALE_SECONDS;

    for (let i = 0; i < VEIN_COUNT; i++) {
      const goal = live ? frame.levels[i] ?? 0 : 0;
      const tau = goal > smoothed[i] ? ATTACK_SECONDS : RELEASE_SECONDS;
      smoothed[i] += (goal - smoothed[i]) * (1 - Math.exp(-dt / tau));
      flashes[i] *= Math.exp(-dt / FLASH_SECONDS);
      if (isNewFrame) flashes[i] = Math.max(flashes[i], frame.attacks[i] ?? 0);
    }
    (flash.array as Float32Array).set(flashes);
    flash.needsUpdate = true;

    // Write the live level into the head column; advance the head at HISTORY_RATE.
    const writeColumn = (column: number) => {
      for (let i = 0; i < VEIN_COUNT; i++) {
        history.data[i * HISTORY_COLUMNS + column] = Math.round(Math.min(1, Math.max(0, smoothed[i])) * 255);
      }
    };
    // Real elapsed time, not the capped dt: at low frame rates the history
    // must still keep pace with the clock, or the veins drift out of step
    // with the beat rings.
    s.carry += Math.min(elapsed, HISTORY_SECONDS) * HISTORY_RATE;
    while (s.carry >= 1) {
      writeColumn(s.head);
      s.head = (s.head + 1) % HISTORY_COLUMNS;
      s.carry -= 1;
    }
    writeColumn(s.head);
    history.texture.needsUpdate = true;

    // The head column is "now"; the carry (how far into the next column time
    // has run) lets the past slide smoothly instead of stepping 48 times a second.
    for (const m of [material, haloMaterial]) {
      m.uniforms.uHead.value = s.head;
      m.uniforms.uCarry.value = s.carry;
      m.uniforms.uTime.value = clock.clock.elapsedTime;
    }
  });

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
      <mesh geometry={geometry} material={haloMaterial} frustumCulled={false} renderOrder={4} />
    </>
  );
};
