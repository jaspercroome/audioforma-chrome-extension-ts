import React, { useEffect, useMemo } from "react";
import * as THREE from "three";
import { noteNames } from "../../utils/consts";
import { fifthsIndex } from "../../utils/notes";
import { FIRST_OCTAVE, OCTAVES } from "../../utils/orbAnalysis";
import { octaveRadius } from "./layout";

const SEGMENTS = 128;

/**
 * Hairline reference in the equatorial plane, where "now" lives: one faint
 * circle per octave shell and one spoke per note on the circle of fifths.
 * It is the orb's chart axes, kept quiet enough to disappear in a glance.
 */
export const EquatorGuide = ({ spread }: { spread: number }) => {
  const circle = useMemo(() => {
    const points: number[] = [];
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      points.push(Math.cos(a), 0, Math.sin(a));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return g;
  }, []);

  const spokes = useMemo(() => {
    const inner = octaveRadius(FIRST_OCTAVE, spread);
    const outer = octaveRadius(FIRST_OCTAVE + OCTAVES - 1, spread);
    const points: number[] = [];
    for (const note of Object.values(noteNames)) {
      const a = THREE.MathUtils.degToRad(fifthsIndex(note) * 30);
      points.push(Math.cos(a) * inner, 0, Math.sin(a) * inner, Math.cos(a) * outer, 0, Math.sin(a) * outer);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    return g;
  }, [spread]);

  useEffect(() => () => circle.dispose(), [circle]);
  useEffect(() => () => spokes.dispose(), [spokes]);

  return (
    <group renderOrder={1}>
      {Array.from({ length: OCTAVES }, (_, o) => (
        <lineLoop key={o} geometry={circle} scale={octaveRadius(FIRST_OCTAVE + o, spread)}>
          <lineBasicMaterial color="#8d949e" transparent opacity={0.24} depthWrite={false} />
        </lineLoop>
      ))}
      <lineSegments geometry={spokes}>
        <lineBasicMaterial color="#8d949e" transparent opacity={0.14} depthWrite={false} />
      </lineSegments>
    </group>
  );
};
