import React,{ useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { ColorScale, getColor } from '../utils/colors';

const NUM_OCTAVES = 10;
const LERP_FACTOR = 0.08;

interface SoundFlowerProps {
  points: Array<{
    position: THREE.Vector3;
    octave: number;
  }>;
  colorScale: ColorScale;
}

interface OctaveShape {
  geometry: THREE.BufferGeometry;
  mesh: THREE.Mesh;
  currentPoints: THREE.Vector3[];
  targetPoints: THREE.Vector3[];
}

export const SoundFlower = ({ points, colorScale }: SoundFlowerProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const shapesRef = useRef<OctaveShape[]>([]);

  // Initialize shapes
  useEffect(() => {
    if (shapesRef.current.length === 0) {
      shapesRef.current = Array(NUM_OCTAVES).fill(null).map((_, octave) => {
        const geometry = new THREE.BufferGeometry();
        const material = new THREE.MeshPhysicalMaterial({
          // color: new THREE.Color().setHSL(0.6 + (octave / NUM_OCTAVES) * 0.4, 0.6, 0.5),
          color: getColor({
            power:(octave / NUM_OCTAVES), 
            colorScale, 
            colorNumberScale:() => octave / NUM_OCTAVES, 
            degrees:0
          }),
          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: true,
        });

        return {
          geometry,
          mesh: new THREE.Mesh(geometry, material),
          currentPoints: [],
          targetPoints: []
        };
      });

      // Add meshes to group
      if (groupRef.current) {
        shapesRef.current.forEach(shape => {
          groupRef.current!.add(shape.mesh);
        });
      }
    }

    return () => {
      shapesRef.current.forEach(shape => {
        shape.geometry.dispose();
        (shape.mesh.material as THREE.MeshPhysicalMaterial).dispose();
      });
    };
  }, []);

  // Update target positions when data changes
  useEffect(() => {
    if (!groupRef.current) return;

    // Reset all shape points
    shapesRef.current.forEach(shape => {
      shape.targetPoints = [];
    });

    // Group points by octave
    const pointsByOctave = new Map<number, THREE.Vector3[]>();
    
    points.forEach(({ position, octave }) => {
      if (!pointsByOctave.has(octave)) {
        pointsByOctave.set(octave, []);
      }
      pointsByOctave.get(octave)!.push(position.clone());
    });

    // Update shape target points
    pointsByOctave.forEach((octavePoints, octave) => {
      const shape = shapesRef.current[octave];
      if (shape && octavePoints.length > 0) {
        // Calculate center
        const center = new THREE.Vector3();
        octavePoints.forEach(p => center.add(p));
        center.divideScalar(octavePoints.length);
        
        // Normalize distances from center and sort by angle
        const normalizedPoints = octavePoints.map(p => {
          const dir = p.clone().sub(center);
          const dist = dir.length();
          // Smooth out extreme distances while maintaining relative relationships
          const smoothDist = Math.pow(dist, 0.7); // Less extreme variations
          return center.clone().add(dir.normalize().multiplyScalar(smoothDist));
        }).sort((a, b) => {
          const angleA = Math.atan2(a.z - center.z, a.x - center.x);
          const angleB = Math.atan2(b.z - center.z, b.x - center.x);
          return angleA - angleB;
        });

        // Add interpolated points for smoother shape
        const smoothedPoints: THREE.Vector3[] = [];
        const numInterpolatedPoints = Math.min(32, Math.max(16, normalizedPoints.length * 2));
        
        for (let i = 0; i < numInterpolatedPoints; i++) {
          const t = (i / numInterpolatedPoints) * normalizedPoints.length;
          const index = Math.floor(t);
          const nextIndex = (index + 1) % normalizedPoints.length;
          const alpha = t - index;
          
          const point = normalizedPoints[index].clone().lerp(
            normalizedPoints[nextIndex], 
            alpha
          );
          
          // Add slight variation to prevent perfectly straight lines
          const noise = new THREE.Vector3(
            (Math.random() - 0.5) * 0.02,
            0,
            (Math.random() - 0.5) * 0.02
          );
          point.add(noise);
          
          smoothedPoints.push(point);
        }

        // Put center point first, then smoothed points, then close the loop
        shape.targetPoints = [
          center.clone(),
          ...smoothedPoints,
          smoothedPoints[0].clone()
        ];
      }
    });

    // Initialize current points if needed
    shapesRef.current.forEach(shape => {
      if (shape.currentPoints.length === 0 && shape.targetPoints.length > 0) {
        shape.currentPoints = shape.targetPoints.map(p => p.clone());
      }
    });
  }, [points]);

  // Animate shapes each frame
  useFrame((state) => {
    if (!groupRef.current) return;

    shapesRef.current.forEach((shape) => {
      // Only hide if we definitely don't have enough points for a triangle
      if (shape.targetPoints.length < 3) {
        shape.mesh.visible = false;
        return;
      }

      // Make sure shape is visible
      shape.mesh.visible = true;

      // Ensure current points array matches target points array length
      while (shape.currentPoints.length < shape.targetPoints.length) {
        // Initialize new points at the center position instead of target position
        const centerPoint = shape.targetPoints[0].clone();
        shape.currentPoints.push(centerPoint);
      }
      shape.currentPoints = shape.currentPoints.slice(0, shape.targetPoints.length);

      // Lerp points
      let needsUpdate = false;
      shape.currentPoints.forEach((point, i) => {
        const target = shape.targetPoints[i];
        if (target && !point.equals(target)) {
          point.lerp(target, LERP_FACTOR);
          needsUpdate = true;
        }
      });

      // Update geometry even if points haven't changed
      // Create positions array
      const positions = new Float32Array(shape.currentPoints.length * 3);
      shape.currentPoints.forEach((point, i) => {
        positions[i * 3] = point.x;
        positions[i * 3 + 1] = point.y;
        positions[i * 3 + 2] = point.z;
      });

      shape.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      
      // Create indices for triangulation from center
      const indices = [];
      for (let i = 1; i < shape.currentPoints.length - 1; i++) {
        indices.push(0, i, i + 1);
      }
      
      shape.geometry.setIndex(indices);
      shape.geometry.computeVertexNormals();

      // Update shader time
      (shape.mesh.material as any).time = state.clock.elapsedTime;
    });
  });

  return <group ref={groupRef} />;
}; 