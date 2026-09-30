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
import { easing } from "maath";
import { ToneMappingMode } from "postprocessing";
import * as THREE from "three";

import { noteNames } from "../../utils/consts";
import { fifthsIndex } from "../../utils/notes";
import { fifthsAngleToHue, NOTE_COLORS_LINEAR, oklchToLinear } from "../../utils/noteColors";
import { OCTAVES, OrbFrame, PITCH_CLASSES, VEIN_COUNT } from "../../utils/orbAnalysis";
import { BeatLines } from "./BeatLines";
import { EquatorGuide } from "./EquatorGuide";
import { GLASS_RADIUS, outerRadius } from "./layout";
import { PitchGuide } from "./PitchGuide";
import { coreFragment, coreVertex } from "./shaders";
import { Veins } from "./Veins";
import { Voices, VoiceSource, VoiceStem } from "./Voices";
import { HARMONY_ELEVATION, MELODY_ELEVATION } from "./voiceLayout";

export type OrbSettings = {
  /** Tint the room by the harmonic lean (experimental "feeling" layer). */
  mood: boolean;
  autoRotate: boolean;
  /** Distance between octave shells: 1 is the default, lower pulls everything inside the glass. */
  spread: number;
  /**
   * How voices are laid out (Voices mode): "harmony" is the orb's own layout
   * (circle of fifths around, octave out, time up); "melody" is a pitch helix
   * (semitones around, pitch up, time out).
   */
  view?: "harmony" | "melody";
};

/** Stems to draw as separate voices instead of the note veins. */
export type OrbVoices = {
  stems: VoiceStem[];
  sourceRef: React.MutableRefObject<VoiceSource | null>;
  /** Drum hits for the rings (the drum stem's frames, when there is one). */
  beatFrameRef?: React.MutableRefObject<OrbFrame>;
};

const FLOOR_Y = -1.75;
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

/** Colour of the orb's inner light: hue from where the harmony sits, saturation from how focused it is. */
const feelingColor = (hereX: number, hereY: number, focus: number, out: THREE.Color) => {
  const angleDeg = THREE.MathUtils.radToDeg(Math.atan2(hereY, hereX));
  const [r, g, b] = oklchToLinear(fifthsAngleToHue(angleDeg), 0.74);
  const saturation = THREE.MathUtils.smoothstep(focus, 0.04, 0.4);
  return out.setRGB(1 + (r - 1) * saturation, 1 + (g - 1) * saturation, 1 + (b - 1) * saturation, THREE.LinearSRGBColorSpace);
};

/** A small seed of light at the centre, coloured by the harmonic centre of gravity. */
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
    feelingColor(here.current.x, here.current.y, Math.hypot(here.current.x, here.current.y), target);
    (material.uniforms.uColor.value as THREE.Color).lerp(target, 1 - Math.exp(-dt / 0.4));
    material.uniforms.uEnergy.value = energy.current;
    material.uniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <mesh material={material} renderOrder={1}>
      <sphereGeometry args={[0.13, 48, 48]} />
    </mesh>
  );
};

/** Coloured light from the loudest notes, cast from their side of the orb onto the floor. */
const SpillLights = ({ smoothedLevels }: { smoothedLevels: React.MutableRefObject<Float32Array> }) => {
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
    totals.fill(0);
    for (let o = 0; o < OCTAVES; o++) {
      const weight = o < 3 ? 1.2 : 1;
      for (let pc = 0; pc < PITCH_CLASSES; pc++) totals[pc] += levels[o * PITCH_CLASSES + pc] * weight;
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
      s.intensity = approach(s.intensity, Math.min(1.2, totals[pc] / 2.5), dt, 0.15);
      const light = lights.current[i];
      if (light) {
        light.position.set(Math.cos(s.angle) * 1.6, -1.05, Math.sin(s.angle) * 1.6);
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
    scene.fog = new THREE.Fog(room, 11, 30);
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
 * Camera distance that keeps every octave shell in frame for this window
 * shape; in Voices mode, where everything is inside the glass, just the orb
 * (with a margin, `voicesMargin`, for the page's panels in live use).
 */
const fitDistance = (
  camera: THREE.PerspectiveCamera,
  width: number,
  height: number,
  spread: number,
  voices = false,
  voicesMargin = 1.12
) => {
  const aspect = width / Math.max(1, height);
  const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // Outermost shell (its veins taper toward the poles, so a little inside it)
  // plus the vein haze.
  const extent = voices ? GLASS_RADIUS * voicesMargin : outerRadius(spread) * 0.92 + 0.2;
  const forHeight = (extent * 1.05) / halfHeight;
  const forWidth = extent / (halfHeight * aspect);
  return Math.max(forHeight, forWidth);
};

/**
 * Keep the whole orb in frame on any window shape and octave spread. Runs on
 * resize and spread changes only, so it never fights the viewer's own zooming.
 */
const FitCamera = ({ spread, voices }: { spread: number; voices: boolean }) => {
  const { camera, size, controls } = useThree();
  useEffect(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    const distance = fitDistance(camera, size.width, size.height, spread, voices, 1.28);
    const target = new THREE.Vector3(0, 0, 0);
    const offset = camera.position.clone().sub(target);
    camera.position.copy(target.add(offset.setLength(distance)));
    (controls as unknown as { update?: () => void } | null)?.update?.();
  }, [camera, size.width, size.height, controls, spread, voices]);
  return null;
};

/** Deterministic slow orbit for rendered clips; OrbitControls handles live use. */
const RenderCamera = ({
  spread,
  voiceBlendRef,
}: {
  spread: number;
  /** In Voices mode: 0 harmony (seen from above), 1 melody (seen from the side). */
  voiceBlendRef?: React.MutableRefObject<number>;
}) => {
  const { size } = useThree();
  useFrame(({ camera, clock }) => {
    const t = clock.elapsedTime;
    const distance = fitDistance(camera as THREE.PerspectiveCamera, size.width, size.height, spread, !!voiceBlendRef);
    const angle = -0.35 + t * 0.045;
    const sway = 0.03 * Math.sin(t * 0.13);
    const elevation = voiceBlendRef
      ? HARMONY_ELEVATION + (MELODY_ELEVATION - HARMONY_ELEVATION) * voiceBlendRef.current + sway
      : 0.2 + sway; // a little above the equator
    camera.position.set(
      Math.sin(angle) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(angle) * Math.cos(elevation) * distance
    );
    camera.lookAt(0, 0, 0);
  });
  return null;
};

/**
 * Live mode: when the Voices layout changes, swing the camera to the angle
 * that suits it (above the harmony disc, beside the helix), then leave it
 * to the viewer; any drag stops the swing. The swing eases in and out
 * (maath's damp).
 */
const ViewAim = ({ elevation }: { elevation: number | null }) => {
  const { camera, controls } = useThree();
  const aiming = useRef(false);
  const aim = useMemo(() => ({ phi: 0 } as { phi: number; __damp?: unknown }), []);
  useEffect(() => {
    aiming.current = elevation !== null;
    aim.__damp = undefined; // start from rest
  }, [elevation, aim]);
  useEffect(() => {
    const orbit = controls as unknown as { addEventListener?: Function; removeEventListener?: Function } | null;
    const stop = () => (aiming.current = false);
    orbit?.addEventListener?.("start", stop);
    return () => orbit?.removeEventListener?.("start", stop);
  }, [controls]);
  const spherical = useMemo(() => new THREE.Spherical(), []);
  useFrame((_, delta) => {
    if (!aiming.current || elevation === null) return;
    const dt = Math.min(Math.max(delta, 0), 0.1);
    spherical.setFromVector3(camera.position);
    aim.phi = spherical.phi;
    if (!easing.damp(aim, "phi", Math.PI / 2 - elevation, 0.3, dt)) aiming.current = false;
    spherical.phi = aim.phi;
    camera.position.setFromSpherical(spherical);
    camera.lookAt(0, 0, 0);
  });
  return null;
};

/** Animates the blend between the harmony (0) and melody (1) layouts, easing in and out. */
const ViewBlend = ({ target, blendRef }: { target: number; blendRef: React.MutableRefObject<number> }) => {
  const morph = useMemo(() => ({ blend: blendRef.current }), [blendRef]);
  useFrame((_, delta) => {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    easing.damp(morph, "blend", target, 0.3, dt);
    blendRef.current = morph.blend;
  });
  return null;
};

/**
 * The glass renders what's behind it into a buffer each frame, without
 * antialiasing, and shows it through the glass. Voices are thin lines: seen
 * that way they turn jagged and soft. So they stay out of that buffer and
 * draw after the glass instead (render order above it, and the glass doesn't
 * write depth): one of these hides them just before the glass's pass, the
 * other shows them again just after. Mounted either side of the glass, so
 * their frame callbacks run in that order.
 */
const GlassPass = ({ layer, show }: { layer: React.RefObject<THREE.Group>; show: boolean }) => {
  useFrame(() => {
    if (layer.current) layer.current.visible = show;
  });
  return null;
};

/** Slow breathing with the energy, plus a heartbeat on every kick. */
const Breath = ({
  energy,
  kick,
  children,
}: {
  energy: React.MutableRefObject<number>;
  kick: React.MutableRefObject<number>;
  children: React.ReactNode;
}) => {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const s = 1 + 0.02 * energy.current + 0.012 * kick.current + 0.006 * Math.sin(clock.elapsedTime * 0.9);
    group.current?.scale.setScalar(s);
  });
  return <group ref={group}>{children}</group>;
};

const OrbWorld = ({
  frameRef,
  settings,
  renderMode,
  voices,
}: {
  frameRef: React.MutableRefObject<OrbFrame>;
  settings: OrbSettings;
  renderMode: boolean;
  voices?: OrbVoices;
}) => {
  const smoothedLevels = useRef(new Float32Array(VEIN_COUNT));
  const energy = useRef(0);
  const kick = useRef(0);
  const keyLight = useRef<THREE.DirectionalLight>(null);
  const spread = settings.spread;
  const melody = !!voices && settings.view === "melody";
  const blend = useRef(melody ? 1 : 0);
  const voicesLayer = useRef<THREE.Group>(null);

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
        opacity={0.55}
        scale={8}
        blur={2.4}
        far={3.5}
        resolution={512}
        color="#6f6d78"
      />

      <Float speed={1} rotationIntensity={0.12} floatIntensity={0.45} floatingRange={[-0.06, 0.06]}>
        <Breath energy={energy} kick={kick}>
          <ViewBlend target={melody ? 1 : 0} blendRef={blend} />
          <Core frameRef={frameRef} energy={energy} />
          {!voices && <EquatorGuide spread={spread} />}
          {/* In Voices mode the veins stay mounted (their levels still colour the
              floor light) but aren't drawn: each stem draws itself instead. */}
          <group visible={!voices}>
            <Veins frameRef={frameRef} smoothedRef={smoothedLevels} spread={spread} />
          </group>
          <group ref={voicesLayer}>
            {voices && (
              <>
                <PitchGuide blendRef={blend} />
                <Voices stems={voices.stems} sourceRef={voices.sourceRef} blendRef={blend} />
              </>
            )}
          </group>
          <GlassPass layer={voicesLayer} show={false} />
          <mesh renderOrder={3} scale={GLASS_RADIUS}>
            <sphereGeometry args={[1, 128, 128]} />
            {/* A thin, clear shell: enough glass to catch the studio light,
                not so much that it warps the octave shells inside. */}
            <MeshTransmissionMaterial
              samples={renderMode ? 8 : 6}
              transmission={1}
              roughness={0}
              thickness={0.12}
              ior={1.12}
              // Voices are thin lines seen through the glass: colour fringing and
              // wobble wash them out, so the glass is clearer in Voices mode.
              chromaticAberration={voices ? 0.004 : 0.015}
              anisotropicBlur={0}
              distortion={voices ? 0.012 : 0.04}
              distortionScale={0.3}
              temporalDistortion={0}
              clearcoat={0.08}
              clearcoatRoughness={0.1}
              envMapIntensity={voices ? 0.35 : 0.45}
              attenuationDistance={4}
              attenuationColor="#f3f6ff"
              color="#ffffff"
              // Voices draw after the glass, so it mustn't hide them (see GlassPass).
              depthWrite={!voices}
            />
          </mesh>
          <GlassPass layer={voicesLayer} show />
          <BeatLines frameRef={voices?.beatFrameRef ?? frameRef} kickRef={kick} travel={!voices} />
        </Breath>
      </Float>

      {renderMode ? (
        <RenderCamera spread={spread} voiceBlendRef={voices ? blend : undefined} />
      ) : (
        <>
          <OrbitControls
            makeDefault
            enablePan={false}
            enableDamping
            autoRotate={settings.autoRotate}
            autoRotateSpeed={0.35}
            minDistance={2.5}
            maxDistance={24}
            maxPolarAngle={Math.PI * 0.62}
            target={[0, 0, 0]}
          />
          <FitCamera spread={spread} voices={!!voices} />
          <ViewAim elevation={voices ? (melody ? MELODY_ELEVATION : HARMONY_ELEVATION) : null} />
        </>
      )}

      {voices ? (
        // No bloom for Voices: the lit room blooms into a haze over everything,
        // and thin solid voices wash out in it.
        <EffectComposer multisampling={4}>
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <Vignette offset={0.32} darkness={0.28} />
        </EffectComposer>
      ) : (
        <EffectComposer multisampling={4}>
          {/* Kept modest: bloom adds light, and on a white room that reads as haze. */}
          <Bloom mipmapBlur intensity={0.8} luminanceThreshold={1} luminanceSmoothing={0.3} radius={0.7} />
          <ToneMapping mode={ToneMappingMode.NEUTRAL} />
          <Vignette offset={0.32} darkness={0.28} />
        </EffectComposer>
      )}
    </>
  );
};

type OrbSceneProps = {
  /** Draw these stems as separate voices (Voices mode) instead of the note veins. */
  voices?: OrbVoices;
  frameRef: React.MutableRefObject<OrbFrame>;
  settings: OrbSettings;
  /** Deterministic rendering for captured clips: no render loop, fixed camera path. */
  renderMode?: boolean;
  onCreated?: (state: RootState) => void;
};

export const OrbScene = ({ frameRef, settings, renderMode = false, onCreated, voices }: OrbSceneProps) => (
  <Canvas
    frameloop={renderMode ? "never" : "always"}
    dpr={renderMode ? 1 : [1, 1.75]}
    gl={{ antialias: false, preserveDrawingBuffer: renderMode, powerPreference: "high-performance" }}
    camera={{ position: [0, 1.4, 7.5], fov: 30, near: 0.1, far: 80 }}
    onCreated={onCreated}
  >
    <OrbWorld frameRef={frameRef} settings={settings} renderMode={renderMode} voices={voices} />
  </Canvas>
);
