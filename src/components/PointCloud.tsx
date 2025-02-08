import React,{ useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { scalePow } from 'd3-scale';
import { BUFFER_SIZE, noteAngles, NoteName } from '../utils/consts';
import {centsToAngleOffset } from '../utils/drawVisual';
import { SoundFlower } from './SoundFlower';
import { ColorScale } from '../utils/colors';

const CIRCLE_RADIUS = 3;
const OCTAVE_SPACING = 1.5;
const NUM_OCTAVES = 10;
const TOTAL_INSTANCES = BUFFER_SIZE;
const LERP_FACTOR = 0.08; 

// Create scales for mapping
const radiusScale = scalePow()
  .exponent(.6)
  .domain([0, BUFFER_SIZE])
  .range([0.15, 2]).clamp(true);
// Scale for point size
const sizeScale = scalePow()
  .exponent(1.1)
  .domain([0, BUFFER_SIZE])
  .range([0.3, 2.0]).clamp(true);

// Scale for stick radius
const stickRadiusScale = scalePow()
  .exponent(0.8)
  .domain([0, BUFFER_SIZE])
  .range([0.1, 1]);


interface PointCloudProps {
  fullSpectrumAmps: Array<{
    note: string;
    octave: number;
    cents: number;
    amplitude: number;
  }>;
  percussiveAmps?: Array<{
    note: string;
    octave: number;
    cents: number;
    amplitude: number;
  }>;
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

export const PointCloud = ({ fullSpectrumAmps, percussiveAmps, pointSize, stickRadius, showSoundFlower, colorScale }: PointCloudProps) => {
  const pointsRef = useRef<THREE.InstancedMesh>(null);
  const sticksRef = useRef<THREE.InstancedMesh>(null);
  const pointsDataRef = useRef<PointData[]>([]);
  const tempObject = new THREE.Object3D();
  const [activePoints, setActivePoints] = useState<Array<{position: THREE.Vector3, octave: number}>>([]);
  
  // Create geometries
  const sphereGeometry = new THREE.SphereGeometry(pointSize, 8, 8);
  const stickGeometry = new THREE.CylinderGeometry(stickRadius, stickRadius, 1, 4);
  stickGeometry.translate(0, 0.5, 0); // Move pivot to end
  
  // Create materials
  const sphereMaterial = new THREE.MeshStandardMaterial({ 
    vertexColors: true,
    metalness: 0.3,
    roughness: 0.8,
    opacity: 1,
  });
  
  const stickMaterial = new THREE.MeshStandardMaterial({ 
    vertexColors: true,
    metalness: 0.3,
    roughness: 0.8,
    opacity: 1,
  });


  // Initialize points data
  useEffect(() => {
    if (pointsDataRef.current.length === 0) {
      // Double the instances to handle both melodic and percussive points
      pointsDataRef.current = Array(TOTAL_INSTANCES * 2).fill(null).map(() => ({
        targetPosition: new THREE.Vector3(0, -1000, 0),
        currentPosition: new THREE.Vector3(0, -1000, 0),
        targetScale: new THREE.Vector3(1, 1, 1),
        currentScale: new THREE.Vector3(1, 1, 1),
        targetColor: new THREE.Color(0, 0, 0),
        currentColor: new THREE.Color(0, 0, 0),
        isActive: false
      }));
    }
  }, []);

  // Update target positions when data changes
  useEffect(() => {
    if (!pointsRef.current || !sticksRef.current) return;

    // Reset all points
    pointsDataRef.current.forEach(point => {
      point.isActive = false;
      point.targetPosition.set(0, -1000, 0);
      point.targetScale.set(1, 1, 1);
      point.targetColor.set(0, 0, 0);
    });

    // Collect points for hull
    const activePoints: Array<{position: THREE.Vector3, octave: number}> = [];

    // Process melodic points
    const processPoints = (points: typeof fullSpectrumAmps, startIndex: number) => {
      if (!points) return;

      const yOffset = -0;

      // Filter points more aggressively
      const validPoints = points.filter(point => 
        point && 
        point.note && 
        point.amplitude > BUFFER_SIZE / 1000 &&
        point.octave >= 0 && 
        point.octave < NUM_OCTAVES
      ).sort((a, b) => b.amplitude - a.amplitude); 
      
      validPoints.forEach((point, index) => {
        if (index >= TOTAL_INSTANCES) return;

        const { note, octave, amplitude, cents } = point;
        const noteIndex = Object.values(NoteName).indexOf(note as NoteName);
        if (noteIndex === -1) return;

        const noteValue = point.note.includes("#") 
          ? point.note.slice(0, 2)
          : point.note.slice(0, 1);
        
        const degrees = noteAngles[noteValue as keyof typeof noteAngles] - 60;
        const finalAngle = (degrees / 360) * Math.PI * 2 + centsToAngleOffset(cents);

        const scaledRadius = CIRCLE_RADIUS * radiusScale(amplitude);
        const pointSize = sizeScale(amplitude);
        
        const x = Math.cos(finalAngle) * scaledRadius;
        const z = Math.sin(finalAngle) * scaledRadius;
        const y = octave * OCTAVE_SPACING + yOffset;

        const color = new THREE.Color().setHSL(0.6 + (octave / NUM_OCTAVES) * 0.4, amplitude/BUFFER_SIZE, 0.5);
        
        const newPoint = pointsDataRef.current[startIndex + index];
        newPoint.isActive = true;
        newPoint.targetPosition.set(x, y, z);
        newPoint.targetScale.set(pointSize, pointSize, pointSize);
        newPoint.targetColor.copy(color);

        // Add to active points for hull
        activePoints.push({
          position: new THREE.Vector3(x, y, z),
          octave
        });
      });
    };

    processPoints(fullSpectrumAmps, 0);
    processPoints(percussiveAmps || [], TOTAL_INSTANCES);
    
    // Update active points state
    setActivePoints(activePoints);

  }, [fullSpectrumAmps, percussiveAmps]);

  // Animate points and sticks each frame
  useFrame(() => {
    if (!pointsRef.current || !sticksRef.current) return;

    let needsUpdate = false;
    const colors: number[] = [];
    const stickColors: number[] = [];
    
    pointsDataRef.current.forEach((point, index) => {
      const positionChanged = !point.currentPosition.equals(point.targetPosition);
      const scaleChanged = !point.currentScale.equals(point.targetScale);
      const colorChanged = !point.currentColor.equals(point.targetColor);
      
      if (positionChanged || scaleChanged || colorChanged) {
        point.currentPosition.lerp(point.targetPosition, LERP_FACTOR);
        point.currentScale.lerp(point.targetScale, LERP_FACTOR);
        point.currentColor.lerp(point.targetColor, LERP_FACTOR);
        needsUpdate = true;
      }

      // Set colors based on whether point is active
      if (point.isActive) {
        colors[index * 4] = point.currentColor.r;
        colors[index * 4 + 1] = point.currentColor.g;
        colors[index * 4 + 2] = point.currentColor.b;
        colors[index * 4 + 3] = 1.0; // Full opacity for active points
        
        // Make sticks slightly darker version of the same color
        stickColors[index * 4] = point.currentColor.r * 0.7;
        stickColors[index * 4 + 1] = point.currentColor.g * 0.7;
        stickColors[index * 4 + 2] = point.currentColor.b * 0.7;
        stickColors[index * 4 + 3] = 0.4; // Maintain stick transparency
      } else {
        // Make inactive points fully transparent
        colors[index * 4] = 0;
        colors[index * 4 + 1] = 0;
        colors[index * 4 + 2] = 0;
        colors[index * 4 + 3] = 0;
        
        stickColors[index * 4] = 0;
        stickColors[index * 4 + 1] = 0;
        stickColors[index * 4 + 2] = 0;
        stickColors[index * 4 + 3] = 0;
      }

      // Update matrices
      if (needsUpdate) {
        // Update point
        tempObject.position.copy(point.currentPosition);
        tempObject.scale.copy(point.currentScale);
        tempObject.updateMatrix();
        pointsRef.current!.setMatrixAt(index, tempObject.matrix);

        // Update stick
        if (point.isActive) {
          const stickStart = new THREE.Vector3(0, point.currentPosition.y, 0);
          const stickEnd = point.currentPosition;
          
          const stickVector = new THREE.Vector3().subVectors(stickEnd, stickStart);
          const stickLength = stickVector.length();
          const targetDirection = stickVector.normalize();
          
          const stickRadius = point.currentScale.x * stickRadiusScale(point.currentScale.x * 100);
          
          tempObject.position.copy(stickStart);
          tempObject.scale.set(stickRadius, stickLength, stickRadius);
          tempObject.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), targetDirection);
        } else {
          tempObject.position.set(0, -1000, 0);
        }
        tempObject.updateMatrix();
        sticksRef.current!.setMatrixAt(index, tempObject.matrix);
      }
    });

    if (needsUpdate) {
      pointsRef.current.instanceMatrix.needsUpdate = true;
      sticksRef.current.instanceMatrix.needsUpdate = true;
      
      // Update colors with alpha channel (4 components instead of 3)
      const pointColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(colors), 4);
      const stickColorAttribute = new THREE.InstancedBufferAttribute(new Float32Array(stickColors), 4);
      
      pointsRef.current.geometry.setAttribute('color', pointColorAttribute);
      sticksRef.current.geometry.setAttribute('color', stickColorAttribute);
    }
  });

  return (
    <group>
      {showSoundFlower && <SoundFlower points={activePoints}colorScale={colorScale} />}
      <instancedMesh
        ref={pointsRef}
        args={[sphereGeometry, sphereMaterial, TOTAL_INSTANCES * 2]}
      />
      <instancedMesh
        ref={sticksRef}
        args={[stickGeometry, stickMaterial, TOTAL_INSTANCES * 2]}
      />
    </group>
  );
}; 