import React, { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_HEIGHT, reachAt, voiceAngle, voicePoint } from "./voiceLayout";

const LOWEST = 24; // C1
const HIGHEST = 108; // C8
const STEPS_PER_SEMITONE = 6;
const MERIDIAN_STEPS = 96;
const MERIDIAN_OPACITY = 0.11;
/** C's meridian is a little stronger, so there's a way to tell which is which. */
const C_OPACITY = 0.22;
const HELIX_OPACITY = 0.2;

/**
 * The Voices view's axes, as faint hairlines at full loudness (the furthest
 * out a voice can go):
 * - a meridian per note, from the bottom of the orb to the top: every C is
 *   on C's meridian, whatever its octave. In the harmony view they sit in
 *   circle-of-fifths order; in the melody view in semitone order.
 * - in the melody view, the pitch helix itself: one turn per octave from C1
 *   to C8, so a line that follows it is a scale.
 */
export const PitchGuide = ({ blendRef }: { blendRef: React.MutableRefObject<number> }) => {
  const { meridian, helix, meridianMaterial, cMaterial, helixMaterial } = useMemo(() => {
    // One meridian, at angle 0; each note's copy is turned to its angle.
    const points: number[] = [];
    for (let i = 0; i <= MERIDIAN_STEPS; i++) {
      const y = -MAX_HEIGHT + (2 * MAX_HEIGHT * i) / MERIDIAN_STEPS;
      points.push(reachAt(y), y, 0);
    }
    const meridian = new THREE.BufferGeometry();
    meridian.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));

    const p = new THREE.Vector3();
    const spiral: number[] = [];
    for (let i = 0; i <= (HIGHEST - LOWEST) * STEPS_PER_SEMITONE; i++) {
      voicePoint(LOWEST + i / STEPS_PER_SEMITONE, 1, 1, p);
      spiral.push(p.x, p.y, p.z);
    }
    const helix = new THREE.BufferGeometry();
    helix.setAttribute("position", new THREE.Float32BufferAttribute(spiral, 3));

    const line = (opacity: number) =>
      new THREE.LineBasicMaterial({ color: "#8d949e", transparent: true, opacity, depthWrite: false });
    return {
      meridian,
      helix,
      meridianMaterial: line(MERIDIAN_OPACITY),
      cMaterial: line(C_OPACITY),
      helixMaterial: line(HELIX_OPACITY),
    };
  }, []);

  const meridians = useMemo(
    () =>
      Array.from({ length: 12 }, (_, pitchClass) => {
        const object = new THREE.Line(meridian, pitchClass === 0 ? cMaterial : meridianMaterial);
        object.renderOrder = 4;
        return object;
      }),
    [meridian, cMaterial, meridianMaterial]
  );
  const helixLine = useMemo(() => {
    const object = new THREE.Line(helix, helixMaterial);
    object.renderOrder = 4;
    return object;
  }, [helix, helixMaterial]);

  useEffect(
    () => () => {
      meridian.dispose();
      helix.dispose();
      meridianMaterial.dispose();
      cMaterial.dispose();
      helixMaterial.dispose();
    },
    [meridian, helix, meridianMaterial, cMaterial, helixMaterial]
  );

  useFrame(() => {
    const blend = blendRef.current;
    meridians.forEach((object, pitchClass) => {
      // Turn the meridian to its note's angle (in C4's octave; any octave lands on the same angle).
      object.rotation.y = -voiceAngle(60 + pitchClass, blend);
    });
    helixMaterial.opacity = HELIX_OPACITY * blend;
    helixLine.visible = blend > 0.01;
  });

  return (
    <group>
      {meridians.map((object, i) => (
        <primitive key={i} object={object} />
      ))}
      <primitive object={helixLine} />
    </group>
  );
};
