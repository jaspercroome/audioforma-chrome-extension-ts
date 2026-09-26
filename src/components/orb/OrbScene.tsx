import React, { useEffect, useMemo, useRef } from "react";
import { Canvas, RootState, useFrame, useThree } from "@react-three/fiber";
import {
  ContactShadows,
  Environment,
  Float,
  Lightformer,
  MeshTransmissionMaterial,
  OrbitControls,
} from "@react-three/drei";
import { Bloom, EffectComposer, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";

import { noteNames } from "../../utils/consts";
import { fifthsIndex } from "../../utils/notes";
import { fifthsAngleToHue, NOTE_COLORS_LINEAR, oklchToLinear } from "../../utils/noteColors";
import { BANDS, OrbFrame, PITCH_CLASSES, VEIN_COUNT } from "../../utils/orbAnalysis";
import { coreFragment, coreVertex } from "./shaders";
import { Veins } from "./Veins";

export type OrbSettings = {
  /** Tint the room by the harmonic lean (experimental "feeling" layer). */
  mood: boolean;
  autoRotate: boolean;
};

const FLOOR_Y = -1.62;
const ROOM = {
  neutral: new THREE.Color("#f1f0ec"),
  warm: new THREE.Color("#f7eee1"),
  cool: new THREE.Color("#e1e7f0"),
};
const KEY = {
  neutral: new THREE.Color("#ffffff"),
  warm: new THREE.Color("#ffe6c7"),
  cool: new THREE.Color("#d4e2ff"),
};
const SPILL_LIGHTS = 3;
const NOTE_ANGLES = Array.from({ length: PITCH_CLASSES }, (_, pc) =>
  THREE.MathUtils.degToRad(fifthsIndex(noteNames[pc]) * 30)
);
const NOTE_COLORS = NOTE_COLORS_LINEAR.map((rgb) => new THREE.Color().setRGB(...rgb, THREE.LinearSRGBColorSpace));

const approach = (current: number, target: number, dt: number, tau: number) =>
  current + (target - current) * (1 - Math.exp(-dt / tau));

type Shared = {
  smoothedLevels: React.MutableRefObject<Float32Array>;
  energy: React.MutableRefObject<number>;
};

/** Colour of the orb's inner light: hue from where the harmony sits, saturation from how focused it is. */
const feelingColor = (hereX: number, hereY: number, focus: number, out: THREE.Color) => {
  const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(hereY, hereX));
  const [r, g, b] = oklchToLinear(fifthsAngleToHue(angleDeg), 0.74);
  const saturation = THREE.MathUtils.smoothstep(focus, 0.04, 0.4);
  return out.setRGB(1 + (r - 1) * saturation, 1 + (g - 1) * saturation, 1 + (b - 1) * saturation, THREE.LinearSRGBColorSpace);
};

const Core = ({ frameRef, energy }: { frameRef: React.MutableRefObject<OrbFrame>; energy: React.MutableRefObject<number> }) => {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: coreVertex,
        fragmentShader: coreFragment,
        uniforms: {
          uColor: { value: new THREE.Color(1, 1, 1) },
          uEnergy: { value: 0 },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    []
  );
  useEffect(() => () => material.dispose(), [material]);
  const here = useRef({ x: 0, y: 0 });
  const target = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const frame = frameRef.current;
    here.current.x = approach(here.current.x, frame.here.x, dt, 0.6);
    here.current.y = approach(here.current.y, frame.here.y, dt, 0.6);
    const focus = Math.hypot(here.current.x, here.current.y);
    feelingColor(here.current.x, here.current.y, focus, target);
    (material.uniforms.uColor.value as THREE.Color).lerp(target, 1 - Math.exp(-dt / 0.4));
    material.uniforms.uEnergy.value = energy.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh material={material} renderOrder={1}>
      <sphereGeometry args={[0.5, 64, 64]} />
    </mesh>
  );
};

/** Coloured light from the loudest notes, cast from their side of the orb onto the floor. */
const SpillLights = ({ smoothedLevels }: Pick<Shared, "smoothedLevels">) => {
  const lights = useRef<Array<THREE.PointLight | null>>([]);
  const totals = useMemo(() => new Float32Array(PITCH_CLASSES), []);
  const order = useMemo(() => Array.from({ length: PITCH_CLASSES }, (_, i) => i), []);
  const state = useMemo(
    () => Array.from({ length: SPILL_LIGHTS }, () => ({ angle: 0, color: new THREE.Color(1, 1, 1), intensity: 0 })),
    []
  );

  useFrame((_, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const levels = smoothedLevels.current;
    for (let pc = 0; pc < PITCH_CLASSES; pc++) {
      let sum = 0;
      for (let b = 0; b < BANDS; b++) sum += levels[b * PITCH_CLASSES + pc] * (b === 0 ? 1.2 : 1);
      totals[pc] = sum;
    }
    order.sort((a, b) => totals[b] - totals[a]);
    for (let i = 0; i < SPILL_LIGHTS; i++) {
      const pc = order[i];
      const s = state[i];
      // Turn toward the note's side of the orb along the shorter way round.
      const targetAngle = NOTE_ANGLES[pc];
      const diff = Math.atan2(Math.sin(targetAngle - s.angle), Math.cos(targetAngle - s.angle));
      s.angle += diff * (1 - Math.exp(-dt / 0.35));
      s.color.lerp(NOTE_COLORS[pc], 1 - Math.exp(-dt / 0.25));
      s.intensity = approach(s.intensity, Math.min(1.2, totals[pc] / 1.6), dt, 0.2);
      const light = lights.current[i];
      if (light) {
        light.position.set(Math.cos(s.angle) * 1.55, -0.95, Math.sin(s.angle) * 1.55);
        light.color.copy(s.color);
        light.intensity = s.intensity * 7;
      }
    }
  });

  return (
    <>
      {state.map((_, i) => (
        <pointLight key={i} ref={(l) => (lights.current[i] = l)} distance={6} decay={2} intensity={0} />
      ))}
    </>
  );
};

/** Background, fog and key light follow the harmonic lean when mood lighting is on. */
const MoodRig = ({
  frameRef,
  energy,
  mood,
  keyLight,
}: {
  frameRef: React.MutableRefObject<OrbFrame>;
  energy: React.MutableRefObject<number>;
  mood: boolean;
  keyLight: React.RefObject<THREE.DirectionalLight>;
}) => {
  const { scene } = useThree();
  const lean = useRef(0);
  const room = useMemo(() => ROOM.neutral.clone(), []);
  const key = useMemo(() => KEY.neutral.clone(), []);

  useEffect(() => {
    scene.background = room;
    scene.fog = new THREE.Fog(room, 10, 26);
    return () => {
      scene.background = null;
      scene.fog = null;
    };
  }, [scene, room]);

  useFrame((_, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const frame = frameRef.current;
    energy.current = approach(energy.current, frame.energy, dt, 0.25);
    lean.current = approach(lean.current, mood ? frame.lean : 0, dt, 2.5);
    const amount = Math.min(1, Math.abs(lean.current) * 0.85);
    const toward = lean.current >= 0 ? "warm" : "cool";
    room.copy(ROOM.neutral).lerp(ROOM[toward], amount);
    key.copy(KEY.neutral).lerp(KEY[toward], amount);
    if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(room);
    if (keyLight.current) {
      keyLight.current.color.copy(key);
      const dim = lean.current < 0 ? 1 - 0.18 * amount : 1;
      keyLight.current.intensity = 1.6 * dim * (0.9 + 0.2 * energy.current);
    }
  });
  return null;
};

/**
 * Keep the whole orb in frame on any window shape. The field of view is
 * vertical, so on a tall, narrow window (a phone, a slim popup) the camera
 * backs off until the orb and its veins fit the width. Runs on resize only,
 * so it never fights the viewer's own zooming.
 */
const FitCamera = () => {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const aspect = size.width / Math.max(1, size.height);
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const neededForWidth = 3.4 / (2 * halfHeight * aspect);
    const distance = Math.max(6.4, neededForWidth);
    const target = new THREE.Vector3(0, -0.05, 0);
    const offset = camera.position.clone().sub(target);
    camera.position.copy(target.add(offset.setLength(distance)));
    (controls as unknown as { update?: () => void } | null)?.update?.();
  }, [camera, size.width, size.height, controls]);
  return null;
};

/** Deterministic slow orbit for rendered clips; OrbitControls handles live use. */
const RenderCamera = () => {
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    const angle = -0.35 + t * 0.045;
    camera.position.set(Math.sin(angle) * 6.4, 0.3 + 0.12 * Math.sin(t * 0.13), Math.cos(angle) * 6.4);
    camera.lookAt(0, -0.05, 0);
  });
  return null;
};

const Breath = ({ energy, children }: { energy: React.MutableRefObject<number>; children: React.ReactNode }) => {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const s = 1 + 0.035 * energy.current + 0.008 * Math.sin(clock.elapsedTime * 0.9);
    group.current?.scale.setScalar(s);
  });
  return <group ref={group}>{children}</group>;
};

const OrbWorld = ({
  frameRef,
  settings,
  renderMode,
}: {
  frameRef: React.MutableRefObject<OrbFrame>;
  settings: OrbSettings;
  renderMode: boolean;
}) => {
  const smoothedLevels = useRef(new Float32Array(VEIN_COUNT));
  const energy = useRef(0);
  const keyLight = useRef<THREE.DirectionalLight>(null);

  return (
    <>
      <MoodRig frameRef={frameRef} energy={energy} mood={settings.mood} keyLight={keyLight} />

      <hemisphereLight args={["#ffffff", "#d9d5cc", 0.9]} />
      <directionalLight ref={keyLight} position={[3.5, 6, 4]} intensity={1.6} />
      <SpillLights smoothedLevels={smoothedLevels} />

      <Environment resolution={256} frames={1}>
        {/* What the glass reflects: mid-grey walls with bright softboxes, so the
            orb gets defined edges instead of the default black void or a white-out. */}
        <color attach="background" args={["#a9a8a3"]} />
        <Lightformer form="rect" intensity={2.2} position={[0, 5, 1]} rotation-x={Math.PI / 2} scale={[10, 6, 1]} />
        <Lightformer form="rect" intensity={3} position={[-5, 1, 1]} rotation-y={Math.PI / 2} scale={[3, 8, 1]} />
        <Lightformer form="rect" intensity={1.6} position={[5, 1.5, -1]} rotation-y={-Math.PI / 2} scale={[3, 8, 1]} />
        <Lightformer form="ring" intensity={1.2} position={[0, 1, -6]} scale={3} />
        <Lightformer form="rect" intensity={0.8} color="#f2efe8" position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>

      <mesh rotation-x={-Math.PI / 2} position={[0, FLOOR_Y, 0]}>
        <circleGeometry args={[40, 96]} />
        <meshStandardMaterial color="#f4f3ef" roughness={0.94} metalness={0} />
      </mesh>
      <ContactShadows
        position={[0, FLOOR_Y + 0.003, 0]}
        opacity={0.6}
        scale={7}
        blur={2.2}
        far={3}
        resolution={512}
        color="#6f6d78"
      />

      <Float speed={1.1} rotationIntensity={0.2} floatIntensity={0.55} floatingRange={[-0.07, 0.07]}>
        <Breath energy={energy}>
          <Core frameRef={frameRef} energy={energy} />
          <Veins frameRef={frameRef} smoothedRef={smoothedLevels} energyRef={energy} />
          <mesh renderOrder={3}>
            <sphereGeometry args={[1, 128, 128]} />
            <MeshTransmissionMaterial
              samples={renderMode ? 10 : 6}
              resolution={768}
              transmission={1}
              roughness={0.05}
              thickness={0.5}
              ior={1.25}
              chromaticAberration={0.05}
              anisotropicBlur={0.1}
              distortion={0.2}
              distortionScale={0.35}
              temporalDistortion={0.1}
              clearcoat={0.35}
              clearcoatRoughness={0.1}
              envMapIntensity={0.8}
              attenuationDistance={3}
              attenuationColor="#f3f6ff"
              color="#ffffff"
            />
          </mesh>
        </Breath>
      </Float>

      {renderMode ? (
        <RenderCamera />
      ) : (
        <>
          <OrbitControls
            makeDefault
            enablePan={false}
            enableDamping
            autoRotate={settings.autoRotate}
            autoRotateSpeed={0.35}
            minDistance={3.4}
            maxDistance={18}
            maxPolarAngle={Math.PI * 0.52}
            target={[0, -0.05, 0]}
          />
          <FitCamera />
        </>
      )}

      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur intensity={1.25} luminanceThreshold={1} luminanceSmoothing={0.3} radius={0.8} />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
        <Vignette offset={0.32} darkness={0.28} />
      </EffectComposer>
    </>
  );
};

type OrbSceneProps = {
  frameRef: React.MutableRefObject<OrbFrame>;
  settings: OrbSettings;
  /** Deterministic rendering for captured clips: no render loop, fixed camera path. */
  renderMode?: boolean;
  onCreated?: (state: RootState) => void;
};

export const OrbScene = ({ frameRef, settings, renderMode = false, onCreated }: OrbSceneProps) => (
  <Canvas
    frameloop={renderMode ? "never" : "always"}
    dpr={renderMode ? 1 : [1, 1.75]}
    gl={{ antialias: false, preserveDrawingBuffer: renderMode, powerPreference: "high-performance" }}
    camera={{ position: [0, 0.3, 6.4], fov: 30, near: 0.1, far: 80 }}
    onCreated={onCreated}
  >
    <OrbWorld frameRef={frameRef} settings={settings} renderMode={renderMode} />
  </Canvas>
);
