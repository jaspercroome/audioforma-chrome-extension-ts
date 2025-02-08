import React, { useEffect, useRef, useState } from "react";
import Meyda from "meyda";
import { MeydaAnalyzer } from "meyda/dist/esm/meyda-wa";
import { CameraControls, OrbitControls, PerspectiveCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";

import { AudioFeatures, AmpArray, BUFFER_SIZE, defaultVisualSettings } from "../utils/consts";
import { processPowerSpectrum } from "../utils/processPowerSpectrum";
import { ColorScale } from "../utils/colors";

import { KeySegments } from "./KeySegments";
import { ControlPanel } from "./ControlPanel";
import { PointCloud } from "./PointCloud";
import { CircleOfFifths } from "./CircleOfFifths";
import { Classic } from "./Classic";

export const Visual = () => {
  const [tabId, setTabId] = useState<number>();
  const [audioContext, setAudioContext] = useState<AudioContext>();
  const [analyzer, setAnalyzer] = useState<MeydaAnalyzer>();
  const [settings, setSettings] = useState(defaultVisualSettings);
  const [melodicAmps, setMelodicAmps] = useState<AmpArray>([])
  const [percussiveAmps, setPercussiveAmps] = useState<AmpArray>([])
  const [keyOctaveAmplitudes, setKeyOctaveAmplitudes] = useState<
    Record<string, number>
  >({});
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(600 / (16 / 9));
  const [colorScale, setColorScale] = useState<ColorScale>("Rainbow - Warm");
  const [visualStyle, setVisualStyle] = useState<'classic' | '3d'>('3d');
  const [chroma, setChroma] = useState<number[]>([]);

  // Add refs for animation handling
  const videoRef = useRef<HTMLVideoElement>(null);

  // Add resize observer ref
  const resizeObserver = useRef<ResizeObserver>();

  // Update dimensions based on window size
  const updateDimensions = () => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    setWidth(windowWidth);
    setHeight(windowHeight);
  };

  // Add effect for dimension handling
  useEffect(() => {
    // Initial dimension setup
    updateDimensions();

    // Setup resize observer
    resizeObserver.current = new ResizeObserver(updateDimensions);
    resizeObserver.current.observe(document.body);

    // Cleanup
    return () => {
      resizeObserver.current?.disconnect();
    };
  }, []);

  useEffect(() => {
    console.log("Setting up message listener");
    const messageHandler = (message: any) => {
      console.log("Received message:", message);
      if (message.type === "SOURCE_TAB_ID") {
        console.log("Setting tab ID:", message.tabId);
        setTabId(message.tabId);
      }
      if (message.type === "COLOR_SCALE") {
        setColorScale(message.scale);
      }
    };

    chrome.runtime.onMessage.addListener(messageHandler);
    return () => {
      console.log("Cleaning up message listener");
      chrome.runtime.onMessage.removeListener(messageHandler);
    };
  }, []);

  useEffect(() => {
    const setupAudioCapture = async () => {
      let cleanup: (() => void) | undefined;
      console.log("Setting up audio capture with tabId:", tabId);
      try {
        // First get the media stream ID
        const streamId = await new Promise<string>((resolve) => {
          chrome.tabCapture.getMediaStreamId(
            { targetTabId: tabId },
            (streamId) => resolve(streamId)
          );
        });

        // Add error handling for stream
        if (!streamId) {
          throw new Error("Failed to get media stream ID");
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
            },
          } as MediaTrackConstraints,
          video: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
            },
          } as MediaTrackConstraints,
        });

        console.log("Got media stream:", stream);
        if (!stream) return;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        
        // Create a proper audio graph for both playback and analysis
        const gainNode = ctx.createGain();
        gainNode.gain.value = 1; // Full volume for normal playback
        source.connect(gainNode);
        gainNode.connect(ctx.destination);
        
        const meydaAnalyzer = Meyda.createMeydaAnalyzer({
          audioContext: ctx,
          source: source,
          bufferSize: BUFFER_SIZE,
          featureExtractors: [
            'powerSpectrum',
            'spectralCentroid',
            'spectralFlatness',
            'spectralKurtosis',
            'spectralRolloff',
            'perceptualSpread',
            'chroma'
          ],
          callback: (features: AudioFeatures) => {
            try {
              if (features && features.powerSpectrum) {
                const {
                  keyOctaveAmps: newKeyOctaveAmplitudes,
                  melodic: { fullSpectrumAmps: newMelodicAmps },
                  percussive: { fullSpectrumAmps: newPercussiveAmps }
                } = processPowerSpectrum(features, ctx);

                setKeyOctaveAmplitudes(newKeyOctaveAmplitudes);
                setMelodicAmps(newMelodicAmps);
                setPercussiveAmps(newPercussiveAmps);
                if (features.chroma) {
                  setChroma(features.chroma);
                }
              }
            } catch (error) {
              console.error("Error processing audio features:", error);
            }
          },
        });

        meydaAnalyzer.start();
        setAudioContext(ctx);
        setAnalyzer(meydaAnalyzer);

        // Setup cleanup function
        cleanup = () => {
          try {
            meydaAnalyzer.stop();
            gainNode.disconnect();
            source.disconnect();
            stream.getTracks().forEach(track => track.stop());
            ctx.close();
          } catch (error) {
            console.error("Error during cleanup:", error);
          }
        };

      } catch (error) {
        console.error("Error in setupAudioCapture:", error);
        if (cleanup) {
          cleanup();
        }
      }

      return () => {
        if (cleanup) {
          cleanup();
        }
      };
    };

    if (tabId) {
      setupAudioCapture();
    }

    return () => {
      if (analyzer) {
        try {
          analyzer.stop();
        } catch (error) {
          console.error("Error stopping analyzer:", error);
        }
      }
      if (audioContext) {
        try {
          audioContext.close();
        } catch (error) {
          console.error("Error closing audio context:", error);
        }
      }
    };
  }, [tabId]);

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
        }}
        muted
      />
      {visualStyle === '3d' ? (
        <Canvas>
          <ambientLight intensity={Math.PI / 2} />
          <spotLight
            position={[10, 10, 10]}
            angle={0.15}
            penumbra={1}
            decay={0}
            intensity={Math.PI}
          />
          <pointLight position={[-10, -10, -10]} decay={0} intensity={Math.PI} />
          <PerspectiveCamera makeDefault position={[0, 4, 15]} fov={60} />
          <CameraControls minDistance={1} maxDistance={50}/>
          <OrbitControls />
          {settings.showKeySegments && <KeySegments keyOctaveAmplitudes={keyOctaveAmplitudes} highlightColor={settings.keySegmentColor} />}
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
          radius={Math.min(width, height) * 0.4}
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
