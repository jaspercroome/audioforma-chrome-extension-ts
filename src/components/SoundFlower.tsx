import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { ColorScale, getColor } from "../utils/colors";

const NUM_OCTAVES = 10;
const LERP_FACTOR = 0.08;
const MAX_RIM_POINTS = 32;
const MAX_VERTICES = MAX_RIM_POINTS + 2; // centre + rim + closing vertex

interface SoundFlowerProps {
  points: Array<{
    position: THREE.Vector3;
    octave: number;
  }>;
  colorScale: ColorScale;
}

interface OctaveShape {
  geometry: THREE.BufferGeometry;
  positions: THREE.BufferAttribute;
  mesh: THREE.Mesh;
  material: THREE.MeshPhysicalMaterial;
  currentPoints: THREE.Vector3[];
  targetPoints: THREE.Vector3[];
}

const octaveColor = (octave: number, colorScale: ColorScale) =>
  getColor({
    power: octave / NUM_OCTAVES,
    colorScale,
    colorNumberScale: () => octave / NUM_OCTAVES,
    degrees: 0,
  });

// Fan triangulation from the centre vertex; fixed, so it is built once.
const FAN_INDICES = (() => {
  const indices: number[] = [];
  for (let i = 1; i < MAX_VERTICES - 1; i++) indices.push(0, i, i + 1);
  return indices;
})();

export const SoundFlower = ({ points, colorScale }: SoundFlowerProps) => {
  const groupRef = useRef<THREE.Group>(null);

  const shapes = useMemo<OctaveShape[]>(
    () =>
      Array.from({ length: NUM_OCTAVES }, () => {
        const geometry = new THREE.BufferGeometry();
        const positions = new THREE.BufferAttribute(new Float32Array(MAX_VERTICES * 3), 3);
        positions.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute("position", positions);
        geometry.setIndex(FAN_INDICES);
        geometry.setDrawRange(0, 0);
        const material = new THREE.MeshPhysicalMaterial({
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: true,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.visible = false;
        mesh.frustumCulled = false;
        return { geometry, positions, mesh, material, currentPoints: [], targetPoints: [] };
      }),
    []
  );

  useEffect(() => {
    const group = groupRef.current;
    shapes.forEach((shape) => group?.add(shape.mesh));
    return () => {
      shapes.forEach((shape) => {
        group?.remove(shape.mesh);
        shape.geometry.dispose();
        shape.material.dispose();
      });
    };
  }, [shapes]);

  // Colours follow the selected colour scale (they used to be fixed at mount).
  useEffect(() => {
    shapes.forEach((shape, octave) => shape.material.color.set(octaveColor(octave, colorScale)));
  }, [shapes, colorScale]);

  useEffect(() => {
    shapes.forEach((shape) => {
      shape.targetPoints = [];
    });

    const pointsByOctave = new Map<number, THREE.Vector3[]>();
    points.forEach(({ position, octave }) => {
      if (!pointsByOctave.has(octave)) pointsByOctave.set(octave, []);
      pointsByOctave.get(octave)!.push(position.clone());
    });

    pointsByOctave.forEach((octavePoints, octave) => {
      const shape = shapes[octave];
      if (!shape || octavePoints.length === 0) return;

      const center = new THREE.Vector3();
      octavePoints.forEach((p) => center.add(p));
      center.divideScalar(octavePoints.length);

      const normalizedPoints = octavePoints
        .map((p) => {
          const dir = p.clone().sub(center);
          const smoothDist = Math.pow(dir.length(), 0.7);
          return center.clone().add(dir.normalize().multiplyScalar(smoothDist));
        })
        .sort(
          (a, b) =>
            Math.atan2(a.z - center.z, a.x - center.x) - Math.atan2(b.z - center.z, b.x - center.x)
        );

      const smoothedPoints: THREE.Vector3[] = [];
      const numInterpolatedPoints = Math.min(MAX_RIM_POINTS, Math.max(16, normalizedPoints.length * 2));
      for (let i = 0; i < numInterpolatedPoints; i++) {
        const t = (i / numInterpolatedPoints) * normalizedPoints.length;
        const index = Math.floor(t);
        const nextIndex = (index + 1) % normalizedPoints.length;
        const point = normalizedPoints[index].clone().lerp(normalizedPoints[nextIndex], t - index);
        point.x += (Math.random() - 0.5) * 0.02;
        point.z += (Math.random() - 0.5) * 0.02;
        smoothedPoints.push(point);
      }

      shape.targetPoints = [center.clone(), ...smoothedPoints, smoothedPoints[0].clone()];
    });

    shapes.forEach((shape) => {
      if (shape.currentPoints.length === 0 && shape.targetPoints.length > 0) {
        shape.currentPoints = shape.targetPoints.map((p) => p.clone());
      }
    });
  }, [points, shapes]);

  useFrame(() => {
    shapes.forEach((shape) => {
      if (shape.targetPoints.length < 3) {
        shape.mesh.visible = false;
        return;
      }
      shape.mesh.visible = true;

      while (shape.currentPoints.length < shape.targetPoints.length) {
        shape.currentPoints.push(shape.targetPoints[0].clone());
      }
      shape.currentPoints.length = shape.targetPoints.length;

      shape.currentPoints.forEach((point, i) => point.lerp(shape.targetPoints[i], LERP_FACTOR));

      // Write into the preallocated buffer instead of allocating a new one per frame.
      const array = shape.positions.array as Float32Array;
      shape.currentPoints.forEach((point, i) => {
        array[i * 3] = point.x;
        array[i * 3 + 1] = point.y;
        array[i * 3 + 2] = point.z;
      });
      // Collapse unused vertices onto the centre so they add nothing to the normals.
      const centre = shape.currentPoints[0];
      for (let i = shape.currentPoints.length; i < MAX_VERTICES; i++) {
        array[i * 3] = centre.x;
        array[i * 3 + 1] = centre.y;
        array[i * 3 + 2] = centre.z;
      }
      shape.positions.needsUpdate = true;
      shape.geometry.setDrawRange(0, Math.max(0, (shape.currentPoints.length - 2) * 3));
      shape.geometry.computeVertexNormals();
      shape.geometry.computeBoundingSphere();
    });
  });

  return <group ref={groupRef} />;
};
