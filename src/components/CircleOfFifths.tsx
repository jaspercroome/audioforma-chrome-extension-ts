import React, { useEffect, useMemo } from "react";
import * as THREE from "three";

const CIRCLE_RADIUS = 5;
const SEGMENTS = 64;

export const CircleOfFifths = () => {
  // The old outline passed itemSize={5} (the radius) instead of 3, so WebGL
  // rejected the attribute and nothing was drawn; it was also black on black.
  const geometry = useMemo(() => {
    const points: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const angle = (i / SEGMENTS) * Math.PI * 2;
      points.push(Math.cos(angle) * CIRCLE_RADIUS, 0, Math.sin(angle) * CIRCLE_RADIUS);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineLoop geometry={geometry}>
      <lineBasicMaterial color="#9aa3ad" transparent opacity={0.6} />
    </lineLoop>
  );
};
