import React from 'react';
import { noteAngles } from '../utils/consts';

const CIRCLE_RADIUS = 5;
const NOTES = Object.keys(noteAngles);

export const CircleOfFifths = () => {
  return (
    <group position={[0, 0, 0]}>
      {/* Circle outline */}
      <line>
        <bufferGeometry>
          <float32BufferAttribute
            attach="attributes-position"
            count={65}
            array={(() => {
              const points = [];
              for (let i = 0; i <= 64; i++) {
                const angle = (i / 64) * Math.PI * 2;
                points.push(
                  Math.cos(angle) * CIRCLE_RADIUS,
                  0,
                  Math.sin(angle) * CIRCLE_RADIUS
                );
              }
              return new Float32Array(points);
            })()}
            itemSize={CIRCLE_RADIUS}
          />
        </bufferGeometry>
        <lineBasicMaterial color="black" />
      </line>
    </group>
  );
}; 