import React, { useEffect, useMemo, useRef, useState } from "react";
import Meyda from "meyda";
import { OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import { AudioFeatures, AmpArray, BUFFER_SIZE, defaultVisualSettings, FEATURE_EXTRACTORS } from "../utils/consts";
import { HarmonicMask, processPowerSpectrum } from "../utils/processPowerSpectrum";
import { ColorScale } from "../utils/colors";
import { classicRadius } from "../utils/drawVisual";

import { emptyOrbFrame, OrbAnalyzer, OrbFrame } from "../utils/orbAnalysis";
import { LowBandAnalyzer, LOW_FFT_SIZE } from "../utils/lowBand";
import { OrbScene } from "./orb/OrbScene";
import { KeySegments } from "./KeySegments";
import { ControlPanel } from "./ControlPanel";
import { PointCloud } from "./PointCloud";
import { CircleOfFifths } from "./CircleOfFifths";
import { Classic } from "./Classic";

export type VisualStyle = "orb" | "3d" | "classic";


export type StageAudio = { context: BaseAudioContext; source: AudioNode };

type VisualStageProps = {
  audio: StageAudio | null;
  /** Captured tab video, drawn behind the classic and 3D views. */
  backgroundStream?: MediaStream | null;
  initialStyle?: VisualStyle;
};

const useWindowSize = () => {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => {
    const update = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    const observer = new ResizeObserver(update);
    observer.observe(document.body);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return size;
};

export const VisualStage = ({ audio, backgroundStream, initialStyle = "orb" }: VisualStageProps) => {
  const { width, height } = useWindowSize();
  const [settings, setSettings] = useState(defaultVisualSettings);
  const [melodicAmps, setMelodicAmps] = useState<AmpArray>([]);
  const [keyOctaveAmplitudes, setKeyOctaveAmplitudes] = useState<Record<string, number>>({});
  const [colorScale, setColorScale] = useState<ColorScale>("Rainbow - Warm");
  const [visualStyle, setVisualStyle] = useState<VisualStyle>(initialStyle);
  const [chroma, setChroma] = useState<number[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const harmonicMask = useMemo(() => new HarmonicMask(), []);
  // The orb reads analysis from a ref inside its render loop, so audio frames
  // don't re-render the React tree while it's showing.
  const orbFrameRef = useRef<OrbFrame>(emptyOrbFrame());
  const styleRef = useRef(visualStyle);
  styleRef.current = visualStyle;

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = backgroundStream ?? null;
  }, [backgroundStream]);

  useEffect(() => {
    if (!audio) return;
    harmonicMask.reset();
    const orbAnalyzer = new OrbAnalyzer({
      hopSeconds: BUFFER_SIZE / audio.context.sampleRate,
      sampleRate: audio.context.sampleRate,
      fftSize: BUFFER_SIZE,
    });
    // Raw recent samples for the long-FFT bass analysis (Meyda only exposes windowed frames).
    const tap = audio.context.createAnalyser();
    tap.fftSize = LOW_FFT_SIZE;
    audio.source.connect(tap);
    const recent = new Float32Array(LOW_FFT_SIZE);
    const lowBand = new LowBandAnalyzer(audio.context.sampleRate);
    const analyzer = Meyda.createMeydaAnalyzer({
      audioContext: audio.context as AudioContext,
      source: audio.source,
      bufferSize: BUFFER_SIZE,
      featureExtractors: [...FEATURE_EXTRACTORS],
      callback: (features: AudioFeatures) => {
        try {
          if (!features?.powerSpectrum) return;
          const { keyOctaveAmps, melodic, fullSpectrumAmps } = processPowerSpectrum(
            features,
            audio.context,
            harmonicMask
          );
          if (styleRef.current === "orb") {
            tap.getFloatTimeDomainData(recent);
            orbFrameRef.current = orbAnalyzer.update(fullSpectrumAmps, features, lowBand.analyze(recent));
            return;
          }
          setKeyOctaveAmplitudes(keyOctaveAmps);
          setMelodicAmps(melodic.fullSpectrumAmps);
          if (features.chroma) setChroma(features.chroma);
        } catch (error) {
          console.error("Error processing audio features:", error);
        }
      },
    });
    analyzer.start();
    return () => {
      analyzer.stop();
      audio.source.disconnect(tap);
    };
  }, [audio, harmonicMask]);

  const scale = `${(1 / devicePixelRatio) * 100}%`;

  return (
    <div style={{ height, width, overflow: "hidden" }}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        style={{
          position: "absolute",
          zIndex: 0,
          scale,
          transformOrigin: "left top",
          left: -window.screenLeft,
          top: -window.screenTop,
          // The orb has its own opaque room, so skip compositing the tab video.
          display: visualStyle === "orb" ? "none" : undefined,
        }}
        muted
      />
      {visualStyle === "orb" ? (
        <OrbScene
          frameRef={orbFrameRef}
          settings={{ mood: settings.orbMood, autoRotate: settings.orbAutoRotate }}
        />
      ) : visualStyle === "3d" ? (
        <Canvas>
          <ambientLight intensity={Math.PI / 2} />
          <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} decay={0} intensity={Math.PI} />
          <pointLight position={[-10, -10, -10]} decay={0} intensity={Math.PI} />
          <PerspectiveCamera makeDefault position={[0, 4, 15]} fov={60} />
          {/* One camera controller. CameraControls and OrbitControls were both
              mounted and fought over the camera on every drag. */}
          <OrbitControls makeDefault enableDamping minDistance={1} maxDistance={50} />
          {settings.showKeySegments && (
            <KeySegments keyOctaveAmplitudes={keyOctaveAmplitudes} highlightColor={settings.keySegmentColor} />
          )}
          {settings.showCircleOfFifths && <CircleOfFifths />}
          <PointCloud
            fullSpectrumAmps={melodicAmps}
            pointSize={settings.pointSize}
            stickRadius={settings.stickRadius}
            showSoundFlower={settings.showSoundFlower}
            colorScale={colorScale}
          />
        </Canvas>
      ) : (
        <Classic
          chroma={chroma}
          keyOctaveAmplitudes={keyOctaveAmplitudes}
          width={width}
          height={height}
          radius={classicRadius(width, height)}
          colorScale={colorScale}
        />
      )}
      <ControlPanel
        settings={settings}
        onChange={setSettings}
        visualStyle={visualStyle}
        onVisualStyleChange={setVisualStyle}
        colorScale={colorScale}
        onColorScaleChange={setColorScale}
      />
    </div>
  );
};
