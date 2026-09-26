import React, { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { noteNames } from "../../utils/consts";
import { fifthsIndex } from "../../utils/notes";
import { NOTE_COLORS_LINEAR } from "../../utils/noteColors";
import { BANDS, OrbFrame, PITCH_CLASSES, VEIN_COUNT } from "../../utils/orbAnalysis";
import { veinFragment, veinHaloFragment, veinVertex } from "./shaders";

// Per register: low notes hug the glass as thick arteries, high notes float
// further out as fine capillaries.
const BAND_RADIUS = [1.035, 1.115, 1.2];
const BAND_TUBE = [0.021, 0.013, 0.0085];
const BAND_TILT_DEG = [56, 67, 78];
const BAND_AZIMUTH_OFFSET_DEG = [0, 9, -9];

const U_SEGMENTS = 240;
const THETA_SEGMENTS = 8;

const ATTACK_SECONDS = 0.05;
const RELEASE_SECONDS = 0.45;

const seedFor = (i: number) => {
  const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

/** Shared tube strip: (u along the vein, theta around it). Positions are built in the shader. */
const buildVeinGeometry = () => {
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
      // Counter-clockwise seen from outside the tube, so front faces face out.
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(rows * cols * 3), 3));
  geometry.setAttribute("aU", new THREE.BufferAttribute(aU, 1));
  geometry.setAttribute("aTheta", new THREE.BufferAttribute(aTheta, 1));

  const axisA = new Float32Array(VEIN_COUNT * 3);
  const axisB = new Float32Array(VEIN_COUNT * 3);
  const radius = new Float32Array(VEIN_COUNT);
  const tube = new Float32Array(VEIN_COUNT);
  const color = new Float32Array(VEIN_COUNT * 3);
  const seed = new Float32Array(VEIN_COUNT);
  const level = new Float32Array(VEIN_COUNT);

  for (let band = 0; band < BANDS; band++) {
    const tilt = THREE.MathUtils.degToRad(BAND_TILT_DEG[band]);
    for (let pc = 0; pc < PITCH_CLASSES; pc++) {
      const i = band * PITCH_CLASSES + pc;
      const phi = THREE.MathUtils.degToRad(fifthsIndex(noteNames[pc]) * 30 + BAND_AZIMUTH_OFFSET_DEG[band]);
      // Ring plane tilted toward the note's direction on the circle of fifths.
      const normal = new THREE.Vector3(Math.sin(tilt) * Math.cos(phi), Math.cos(tilt), Math.sin(tilt) * Math.sin(phi));
      const a = new THREE.Vector3(-Math.sin(phi), 0, Math.cos(phi));
      const b = new THREE.Vector3().crossVectors(normal, a).normalize();
      a.toArray(axisA, i * 3);
      b.toArray(axisB, i * 3);
      radius[i] = BAND_RADIUS[band];
      tube[i] = BAND_TUBE[band];
      color.set(NOTE_COLORS_LINEAR[pc], i * 3);
      seed[i] = seedFor(i);
    }
  }

  geometry.setAttribute("iAxisA", new THREE.InstancedBufferAttribute(axisA, 3));
  geometry.setAttribute("iAxisB", new THREE.InstancedBufferAttribute(axisB, 3));
  geometry.setAttribute("iRadius", new THREE.InstancedBufferAttribute(radius, 1));
  geometry.setAttribute("iTube", new THREE.InstancedBufferAttribute(tube, 1));
  geometry.setAttribute("iColor", new THREE.InstancedBufferAttribute(color, 3));
  geometry.setAttribute("iSeed", new THREE.InstancedBufferAttribute(seed, 1));
  const levelAttribute = new THREE.InstancedBufferAttribute(level, 1);
  levelAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iLevel", levelAttribute);
  geometry.instanceCount = VEIN_COUNT;
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
  return { geometry, levelAttribute };
};

type VeinsProps = {
  frameRef: React.MutableRefObject<OrbFrame>;
  /** Smoothed levels, shared with the lights so they follow the same envelope. */
  smoothedRef: React.MutableRefObject<Float32Array>;
  energyRef: React.MutableRefObject<number>;
};

export const Veins = ({ frameRef, smoothedRef, energyRef }: VeinsProps) => {
  const { geometry, levelAttribute } = useMemo(buildVeinGeometry, []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: veinVertex,
        fragmentShader: veinFragment,
        uniforms: {
          uTime: { value: 0 },
          uWobble: { value: 1 },
          uFlow: { value: 0.15 },
          uRadiusScale: { value: 1 },
        },
        transparent: true,
        depthWrite: true,
        toneMapped: false,
      }),
    []
  );
  const haloMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: veinVertex,
        fragmentShader: veinHaloFragment,
        uniforms: {
          uTime: { value: 0 },
          uWobble: { value: 1 },
          uFlow: { value: 0.15 },
          uRadiusScale: { value: 4.2 },
        },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
      haloMaterial.dispose();
    },
    [geometry, material, haloMaterial]
  );

  useFrame((state, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const target = frameRef.current.levels;
    const smoothed = smoothedRef.current;
    const levels = levelAttribute.array as Float32Array;
    for (let i = 0; i < VEIN_COUNT; i++) {
      const goal = target[i] ?? 0;
      const tau = goal > smoothed[i] ? ATTACK_SECONDS : RELEASE_SECONDS;
      smoothed[i] += (goal - smoothed[i]) * (1 - Math.exp(-dt / tau));
      levels[i] = smoothed[i];
    }
    levelAttribute.needsUpdate = true;
    for (const m of [material, haloMaterial]) {
      m.uniforms.uTime.value = state.clock.elapsedTime;
      m.uniforms.uFlow.value = 0.1 + 0.45 * energyRef.current;
    }
  });

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />
      <mesh geometry={geometry} material={haloMaterial} frustumCulled={false} renderOrder={4} />
    </>
  );
};
