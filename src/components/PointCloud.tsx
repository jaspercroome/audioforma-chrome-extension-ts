import React, { useRef, useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { scalePow } from "d3-scale";
import { AmpArray, BUFFER_SIZE, OCTAVE_SPACING_3D } from "../utils/consts";
import { noteAngleRad } from "../utils/notes";
import { SoundFlower } from "./SoundFlower";
import { ColorScale } from "../utils/colors";

const CIRCLE_RADIUS = 3;
const NUM_OCTAVES = 10;
// The analysis produces ~480 log-spaced bins at most, so 512 instances per
// group is plenty. (It used to allocate BUFFER_SIZE * 2 = 8192.)
const INSTANCES_PER_GROUP = 512;
const TOTAL_INSTANCES = INSTANCES_PER_GROUP * 2;
const LERP_FACTOR = 0.08;
const PARKED = new THREE.Vector3(0, -1000, 0);

const radiusScale = scalePow().exponent(0.6).domain([0, BUFFER_SIZE]).range([0.15, 2]).clamp(true);
const sizeScale = scalePow().exponent(1.1).domain([0, BUFFER_SIZE]).range([0.3, 2.0]).clamp(true);
const stickRadiusScale = scalePow().exponent(0.8).domain([0, BUFFER_SIZE]).range([0.1, 1]);

interface PointCloudProps {
  fullSpectrumAmps: AmpArray;
  percussiveAmps?: AmpArray;
  pointSize: number;
  stickRadius: number;
  showSoundFlower: boolean;
  colorScale: ColorScale;
}

interface PointData {
  targetPosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  targetScale: THREE.Vector3;
  currentScale: THREE.Vector3;
  targetColor: THREE.Color;
  currentColor: THREE.Color;
  isActive: boolean;
}

type LaidOutPoint = {
  position: THREE.Vector3;
  octave: number;
  size: number;
  color: THREE.Color;
};

/** Position, size and colour for each loud-enough point, loudest first. */
const layoutPoints = (points: AmpArray | undefined): LaidOutPoint[] => {
  if (!points) return [];
  return points
    .filter(
      (point) =>
        point &&
        point.note &&
        point.amplitude > BUFFER_SIZE / 1000 &&
        point.octave >= 0 &&
        point.octave < NUM_OCTAVES
    )
    .sort((a, b) => b.amplitude - a.amplitude)
    .slice(0, INSTANCES_PER_GROUP)
    .map(({ note, octave, amplitude, cents }) => {
      const angle = noteAngleRad(note, cents);
      const scaledRadius = CIRCLE_RADIUS * radiusScale(amplitude);
      return {
        position: new THREE.Vector3(
          Math.cos(angle) * scaledRadius,
          octave * OCTAVE_SPACING_3D,
          Math.sin(angle) * scaledRadius
        ),
        octave,
        size: sizeScale(amplitude),
        color: new THREE.Color().setHSL(
          0.6 + (octave / NUM_OCTAVES) * 0.4,
          Math.min(1, amplitude / BUFFER_SIZE),
          0.5
        ),
      };
    });
};

export const PointCloud = ({
  fullSpectrumAmps,
  percussiveAmps,
  pointSize,
  stickRadius,
  showSoundFlower,
  colorScale,
}: PointCloudProps) => {
  const pointsRef = useRef<THREE.InstancedMesh>(null);
  const sticksRef = useRef<THREE.InstancedMesh>(null);

  // Geometries and materials are memoised: creating them inline made React
  // Three Fiber rebuild both instanced meshes on every audio frame.
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(pointSize, 8, 8), [pointSize]);
  const stickGeometry = useMemo(() => {
    const geometry = new THREE.CylinderGeometry(stickRadius, stickRadius, 1, 4);
    geometry.translate(0, 0.5, 0); // pivot at the base
    return geometry;
  }, [stickRadius]);
  const sphereMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.8 }),
    []
  );
  const stickMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ metalness: 0.3, roughness: 0.8 }),
    []
  );
  useEffect(() => () => sphereGeometry.dispose(), [sphereGeometry]);
  useEffect(() => () => stickGeometry.dispose(), [stickGeometry]);
  useEffect(
    () => () => {
      sphereMaterial.dispose();
      stickMaterial.dispose();
    },
    [sphereMaterial, stickMaterial]
  );

  const pointsData = useMemo<PointData[]>(
    () =>
      Array.from({ length: TOTAL_INSTANCES }, () => ({
        targetPosition: PARKED.clone(),
        currentPosition: PARKED.clone(),
        targetScale: new THREE.Vector3(1, 1, 1),
        currentScale: new THREE.Vector3(1, 1, 1),
        targetColor: new THREE.Color(0, 0, 0),
        currentColor: new THREE.Color(0, 0, 0),
        isActive: false,
      })),
    []
  );

  const melodicLayout = useMemo(() => layoutPoints(fullSpectrumAmps), [fullSpectrumAmps]);
  const percussiveLayout = useMemo(() => layoutPoints(percussiveAmps), [percussiveAmps]);
  // Passed straight to SoundFlower; no extra state update and re-render.
  const flowerPoints = useMemo(
    () => [...melodicLayout, ...percussiveLayout].map(({ position, octave }) => ({ position, octave })),
    [melodicLayout, percussiveLayout]
  );

  useEffect(() => {
    pointsData.forEach((point) => {
      point.isActive = false;
      point.targetPosition.copy(PARKED);
      point.targetScale.set(1, 1, 1);
      point.targetColor.set(0, 0, 0);
    });
    const assign = (layout: LaidOutPoint[], startIndex: number) => {
      layout.forEach(({ position, size, color }, index) => {
        const point = pointsData[startIndex + index];
        point.isActive = true;
        point.targetPosition.copy(position);
        point.targetScale.setScalar(size);
        point.targetColor.copy(color);
      });
    };
    assign(melodicLayout, 0);
    assign(percussiveLayout, INSTANCES_PER_GROUP);
  }, [melodicLayout, percussiveLayout, pointsData]);

  const scratch = useMemo(
    () => ({
      object: new THREE.Object3D(),
      stickStart: new THREE.Vector3(),
      stickVector: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      stickColor: new THREE.Color(),
    }),
    []
  );

  useFrame(() => {
    const points = pointsRef.current;
    const sticks = sticksRef.current;
    if (!points || !sticks) return;
    const { object, stickStart, stickVector, up, stickColor } = scratch;

    pointsData.forEach((point, index) => {
      point.currentPosition.lerp(point.targetPosition, LERP_FACTOR);
      point.currentScale.lerp(point.targetScale, LERP_FACTOR);
      point.currentColor.lerp(point.targetColor, LERP_FACTOR);

      object.position.copy(point.currentPosition);
      object.scale.copy(point.currentScale);
      object.quaternion.identity();
      object.updateMatrix();
      points.setMatrixAt(index, object.matrix);
      points.setColorAt(index, point.isActive ? point.currentColor : stickColor.setRGB(0, 0, 0));

      if (point.isActive) {
        stickStart.set(0, point.currentPosition.y, 0);
        stickVector.subVectors(point.currentPosition, stickStart);
        const stickLength = stickVector.length();
        const stickScale = point.currentScale.x * stickRadiusScale(point.currentScale.x * 100);
        object.position.copy(stickStart);
        object.scale.set(stickScale, Math.max(stickLength, 1e-4), stickScale);
        if (stickLength > 1e-6) object.quaternion.setFromUnitVectors(up, stickVector.normalize());
        sticks.setColorAt(index, stickColor.copy(point.currentColor).multiplyScalar(0.7));
      } else {
        object.position.copy(PARKED);
        object.scale.set(1, 1, 1);
        object.quaternion.identity();
        sticks.setColorAt(index, stickColor.setRGB(0, 0, 0));
      }
      object.updateMatrix();
      sticks.setMatrixAt(index, object.matrix);
    });

    points.instanceMatrix.needsUpdate = true;
    sticks.instanceMatrix.needsUpdate = true;
    if (points.instanceColor) points.instanceColor.needsUpdate = true;
    if (sticks.instanceColor) sticks.instanceColor.needsUpdate = true;
  });

  return (
    <group>
      {showSoundFlower && <SoundFlower points={flowerPoints} colorScale={colorScale} />}
      <instancedMesh ref={pointsRef} args={[sphereGeometry, sphereMaterial, TOTAL_INSTANCES]} />
      <instancedMesh ref={sticksRef} args={[stickGeometry, stickMaterial, TOTAL_INSTANCES]} />
    </group>
  );
};
