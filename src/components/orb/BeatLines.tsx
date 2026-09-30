import React, { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { DRUM_BANDS, DrumBand, OrbFrame } from "../../utils/orbAnalysis";
import { GLASS_RADIUS, HISTORY_SECONDS, LATITUDE_MAX } from "./layout";
import { beatFragment, beatVertex, MAX_BEAT_LINES } from "./shaders";

/** Ring width (radians of latitude) and strength per drum band. */
const LINE_STYLE: Record<DrumBand, { width: number; strength: number }> = {
  low: { width: 0.055, strength: 1 },
  mid: { width: 0.03, strength: 0.6 },
  high: { width: 0.014, strength: 0.18 },
};

type BeatLinesProps = {
  frameRef: React.MutableRefObject<OrbFrame>;
  /** Decaying 0-1 pulse from the latest kick, for the orb's heartbeat. */
  kickRef: React.MutableRefObject<number>;
  /**
   * Rings travel poleward with the veins' history (Orb mode). Without it
   * (Voices mode, which has no time axis) each hit is a ring that flashes
   * at the equator and fades where it is.
   */
  travel?: boolean;
};

/**
 * Drum hits as rings on the glass. A ring starts at the equator when a hit
 * lands and travels poleward in step with the veins' history, so the rings
 * form a moving beat grid alongside the notes; or, without `travel`, it
 * flashes at the equator and fades in place.
 */
export const BeatLines = ({ frameRef, kickRef, travel = true }: BeatLinesProps) => {
  const lines = useMemo(() => Array.from({ length: MAX_BEAT_LINES }, () => new THREE.Vector4(0, 0, 1, 0)), []);
  const next = useRef(0);
  const lastFrameTime = useRef(-1);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: beatVertex,
        fragmentShader: beatFragment,
        uniforms: {
          uLines: { value: lines },
          uTime: { value: 0 },
          uLatMax: { value: LATITUDE_MAX },
          uHistorySeconds: { value: HISTORY_SECONDS },
          uTravel: { value: 1 },
          uFade: { value: 1.5 },
          uLife: { value: HISTORY_SECONDS },
        },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    [lines]
  );
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    material.uniforms.uTravel.value = travel ? 1 : 0;
    material.uniforms.uFade.value = travel ? 1.5 : 0.3;
    material.uniforms.uLife.value = travel ? HISTORY_SECONDS : 1;
  }, [material, travel]);

  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime;
    const frame = frameRef.current;
    kickRef.current *= Math.exp(-Math.max(delta, 0) / 0.16);
    if (frame.time !== lastFrameTime.current) {
      lastFrameTime.current = frame.time;
      for (const band of DRUM_BANDS) {
        const hit = frame.hits[band];
        if (!(hit > 0)) continue;
        const style = LINE_STYLE[band];
        lines[next.current].set(now, hit * style.strength, style.width, 1);
        next.current = (next.current + 1) % MAX_BEAT_LINES;
        // Only clear kicks drive the heartbeat, so it pulses with the beat, not every bass note.
        if (band === "low" && hit >= 0.5) kickRef.current = Math.max(kickRef.current, hit);
      }
    }
    material.uniforms.uTime.value = now;
  });

  return (
    <mesh material={material} renderOrder={5} scale={GLASS_RADIUS * 1.004}>
      <sphereGeometry args={[1, 96, 64]} />
    </mesh>
  );
};
