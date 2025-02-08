import React,{ useEffect, useRef } from 'react';
import {
  BufferGeometry,
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  InstancedMeshEventMap,
  Material,
  Matrix4,
  MeshStandardMaterial,
  NormalBufferAttributes,
  Quaternion,
  TorusGeometry,
  Vector3,
} from 'three';
import { getPathCoords } from '../utils/drawVisual';
import { BUFFER_SIZE, segmentArc } from '../utils/consts';
import { useFrame } from '@react-three/fiber';
import { scaleLinear } from 'd3-scale';

interface KeySegmentsProps {
  keyOctaveAmplitudes: Record<string, number>;
  highlightColor?: string;
}

export const KeySegments = ({ keyOctaveAmplitudes, highlightColor = '#32ddef' }: KeySegmentsProps) => {
  const meshRef =
    useRef<
      InstancedMesh<
        BufferGeometry<NormalBufferAttributes>,
        Material | Material[],
        InstancedMeshEventMap
      >
    >(null);
  const baseMatricesRef = useRef<Matrix4[]>([]);
  const workingMatricesRef = useRef<Matrix4[]>([]);

  const amplitudeScale = scaleLinear()
    .domain([0, BUFFER_SIZE/2])
    .range([0, 1]);

  const baseColor = new Color(0x000000);
  const highColor = new Color(0x32ddef);

  const AMPLITUDE_THRESHOLD = BUFFER_SIZE/100;

  useEffect(() => {
    const instanceCount = Object.keys(keyOctaveAmplitudes).length;
    if (!meshRef.current || instanceCount === 0) {
      return;
    } else {
      baseMatricesRef.current = Object.keys(keyOctaveAmplitudes).map(
        (noteOctave) => {
          const {
            x,
            y: twoDZ,
            threeCoords,
            degrees,
          } = getPathCoords({noteOctave, power: 10, width: 5, radius: 5});
          const position = new Vector3(x, threeCoords.y, twoDZ);
          const rotation = new Euler(
            Math.PI / 2, // Tilt the torus to be horizontal
            0,
            (degrees / 360) * (Math.PI * 2), // Rotate around the circle
          );
          const quaternion = new Quaternion();
          quaternion.setFromEuler(rotation);

          const scale = new Vector3(1, 1, 1);
          const matrix = new Matrix4();

          matrix.compose(position, quaternion, scale);

          return matrix;
        },
      );

      workingMatricesRef.current = baseMatricesRef.current.map((m) =>
        m.clone(),
      );

      baseMatricesRef.current.forEach((matrix, i) => {
        meshRef.current?.setMatrixAt(i, matrix);
      });

      meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [keyOctaveAmplitudes]);

  useFrame(() => {
    if (!meshRef.current || baseMatricesRef.current.length === 0) {
      return;
    }
    Object.entries(keyOctaveAmplitudes).forEach(([, power], i) => {
      const scale = amplitudeScale(power);
      
      // Start with the base matrix
      workingMatricesRef.current[i].copy(baseMatricesRef.current[i]);

      // If power is below threshold, scale the instance down to nearly invisible
      const scaleVector = new Vector3(
        power > AMPLITUDE_THRESHOLD ? 1 : 0.0001,
        power > AMPLITUDE_THRESHOLD ? 1 : 0.0001,
        power > AMPLITUDE_THRESHOLD ? 1 : 0.0001
      );
      workingMatricesRef.current[i].scale(scaleVector);

      const material = meshRef.current?.material as MeshStandardMaterial;
      if (material) {
        const color = baseColor.clone().lerp(highColor, scale)
        meshRef.current?.setColorAt(i, color)
      }

      meshRef.current?.setMatrixAt(i, workingMatricesRef.current[i]);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  const geometry = new TorusGeometry(8, 0.1, 10, 100, segmentArc);
  const material = new MeshStandardMaterial({
    color: new Color(highlightColor),
    side: DoubleSide,
  });

  return (
      <instancedMesh
        ref={meshRef}
        args={[
          geometry,
          material,
          Math.max(Object.keys(keyOctaveAmplitudes).length, 1),
        ]}
      />
  );
};

export default KeySegments;
