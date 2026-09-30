import React, { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
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
const CIRCLE_OPACITY = 0.24;
const SPOKE_OPACITY = 0.14;

export const EquatorGuide = ({
  spread,
  visibilityRef,
  y = 0,
}: {
  spread: number;
  /** Height of the guide: the equator for the veins, "now" for voices. */
  y?: number;
  /** 0-1, read every frame: lets the guide fade out when another view takes over. */
  visibilityRef?: React.MutableRefObject<number>;
}) => {
  const circleMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#8d949e", transparent: true, opacity: CIRCLE_OPACITY, depthWrite: false }),
    []
  );
  const spokeMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ color: "#8d949e", transparent: true, opacity: SPOKE_OPACITY, depthWrite: false }),
    []
  );
  useEffect(
    () => () => {
      circleMaterial.dispose();
      spokeMaterial.dispose();
    },
    [circleMaterial, spokeMaterial]
  );
  useFrame(() => {
    const v = visibilityRef ? visibilityRef.current : 1;
    circleMaterial.opacity = CIRCLE_OPACITY * v;
    spokeMaterial.opacity = SPOKE_OPACITY * v;
    circleMaterial.visible = spokeMaterial.visible = v > 0.01;
  });

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
    <group renderOrder={1} position-y={y}>
      {Array.from({ length: OCTAVES }, (_, o) => (
        <lineLoop key={o} geometry={circle} material={circleMaterial} scale={octaveRadius(FIRST_OCTAVE + o, spread)} />
      ))}
      <lineSegments geometry={spokes} material={spokeMaterial} />
    </group>
  );
};
