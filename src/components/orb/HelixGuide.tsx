import React, { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { melodyPoint } from "./voiceLayout";

const LOWEST = 24; // C1
const HIGHEST = 108; // C8
const STEPS_PER_SEMITONE = 4;
const OPACITY = 0.28;

/**
 * The melody view's axes: a faint pitch helix from C1 to C8, one turn per
 * octave, with a small ring marking each C.
 */
export const HelixGuide = ({ visibilityRef }: { visibilityRef: React.MutableRefObject<number> }) => {
  const { helix, rings, material, ringMaterial, line } = useMemo(() => {
    const p = new THREE.Vector3();
    const points: number[] = [];
    for (let i = 0; i <= (HIGHEST - LOWEST) * STEPS_PER_SEMITONE; i++) {
      melodyPoint(LOWEST + i / STEPS_PER_SEMITONE, 0, p);
      points.push(p.x, p.y, p.z);
    }
    const helix = new THREE.BufferGeometry();
    helix.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    // Tick marks at each C: short radial dashes.
    const ticks: number[] = [];
    for (let midi = LOWEST; midi <= HIGHEST; midi += 12) {
      melodyPoint(midi, 0, p);
      ticks.push(p.x * 0.9, p.y, p.z * 0.9, p.x * 1.1, p.y, p.z * 1.1);
    }
    const rings = new THREE.BufferGeometry();
    rings.setAttribute("position", new THREE.Float32BufferAttribute(ticks, 3));
    const material = new THREE.LineBasicMaterial({ color: "#8d949e", transparent: true, opacity: 0, depthWrite: false });
    const ringMaterial = new THREE.LineBasicMaterial({ color: "#6b717b", transparent: true, opacity: 0, depthWrite: false });
    return { helix, rings, material, ringMaterial, line: new THREE.Line(helix, material) };
  }, []);

  useEffect(
    () => () => {
      helix.dispose();
      rings.dispose();
      material.dispose();
      ringMaterial.dispose();
    },
    [helix, rings, material, ringMaterial]
  );

  useFrame(() => {
    const v = visibilityRef.current;
    material.opacity = OPACITY * v;
    ringMaterial.opacity = 0.6 * v;
    material.visible = ringMaterial.visible = v > 0.01;
  });

  return (
    <group renderOrder={1}>
      <primitive object={line} />
      <lineSegments geometry={rings} material={ringMaterial} />
    </group>
  );
};
