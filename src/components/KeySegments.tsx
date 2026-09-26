import React, { useEffect, useMemo, useRef } from "react";
import {
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
} from "three";
import { useFrame } from "@react-three/fiber";
import { BUFFER_SIZE, NOTES, NoteName, OCTAVE_SPACING_3D, segmentArc } from "../utils/consts";
import { noteAngleRad } from "../utils/notes";

interface KeySegmentsProps {
  keyOctaveAmplitudes: Record<string, number>;
  highlightColor?: string;
}

const NUM_OCTAVES = 11; // 0-10: the analysis goes up to 20 kHz, which is octave 10
const SEGMENT_RADIUS = 8;
const AMPLITUDE_THRESHOLD = BUFFER_SIZE / 100;
const HIDDEN = new Vector3(0.0001, 0.0001, 0.0001);
const SHOWN = new Vector3(1, 1, 1);

/** One fixed instance per note and octave, so the mesh never has to be rebuilt. */
const SEGMENTS = Array.from({ length: NUM_OCTAVES }, (_, octave) =>
  NOTES.map((note) => ({ key: `${note}${octave}`, note: note as NoteName, octave }))
).flat();

export const KeySegments = ({ keyOctaveAmplitudes, highlightColor = "#32ddef" }: KeySegmentsProps) => {
  const meshRef = useRef<InstancedMesh>(null);
  const amplitudesRef = useRef(keyOctaveAmplitudes);
  amplitudesRef.current = keyOctaveAmplitudes;

  // Geometry and material are created once. Creating them inline (as before)
  // made React Three Fiber rebuild the instanced mesh on every render.
  const geometry = useMemo(() => new TorusGeometry(SEGMENT_RADIUS, 0.1, 10, 100, segmentArc), []);
  const material = useMemo(
    // White base so the per-instance colour is the colour you see. The old
    // code multiplied the picked colour by a hard-coded cyan.
    () => new MeshStandardMaterial({ color: 0xffffff, side: DoubleSide }),
    []
  );
  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  const baseMatrices = useMemo(
    () =>
      SEGMENTS.map(({ note, octave }) => {
        // Centre each arc on the same angle the point cloud uses for the note.
        const angle = noteAngleRad(note) - segmentArc / 2;
        const rotation = new Euler(Math.PI / 2, 0, angle);
        return new Matrix4().compose(
          new Vector3(0, octave * OCTAVE_SPACING_3D, 0),
          new Quaternion().setFromEuler(rotation),
          SHOWN
        );
      }),
    []
  );

  const baseColor = useMemo(() => new Color(0x000000), []);
  const highColor = useMemo(() => new Color(highlightColor), [highlightColor]);
  const scratch = useMemo(() => ({ matrix: new Matrix4(), color: new Color() }), []);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const amplitudes = amplitudesRef.current;
    SEGMENTS.forEach(({ key }, i) => {
      const power = Math.max(0, amplitudes[key] ?? 0);
      scratch.matrix.copy(baseMatrices[i]).scale(power > AMPLITUDE_THRESHOLD ? SHOWN : HIDDEN);
      mesh.setMatrixAt(i, scratch.matrix);
      scratch.color.copy(baseColor).lerp(highColor, Math.min(1, power / (BUFFER_SIZE / 2)));
      mesh.setColorAt(i, scratch.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    // Without this, colour changes after the first frame never reach the GPU.
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, SEGMENTS.length]} />;
};

export default KeySegments;
