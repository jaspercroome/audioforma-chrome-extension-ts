import { scaleLinear } from "d3-scale";
import "d3-transition";
import Meyda from "meyda";
import React, { useEffect, useRef, useState } from "react";

import { octaves, noteAngles, noteNames, BUFFER_SIZE } from "../utils/consts";
import { processPowerSpectrum } from "../utils/processPowerSpectrum";
import { MeydaAnalyzer } from "meyda/dist/esm/meyda-wa";
import { BASE_COLOR, ColorScale, getColor } from "../utils/colors";
import { drawVisual, getYMove } from "../utils/drawVisual";

interface VisualProps {}

const Visual = (props: VisualProps) => {
  const [tabId, setTabId] = useState<number>();
  const [audioContext, setAudioContext] = useState<AudioContext>();
  const [analyzer, setAnalyzer] = useState<MeydaAnalyzer>();
  const [keyOctaveAmplitudes, setKeyOctaveAmplitudes] = useState<
    Record<string, number>
  >({});
  const [chroma, setChroma] = useState<number[]>([]);
  const [turbulence, setTurbulence] = useState<number>(0);
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(600 / (16 / 9));
  const [radius, setRadius] = useState(600 / (16 / 9) / 3);
  const [colorScale, setColorScale] = useState<ColorScale>("Cubehelix");

  // Add refs for animation handling
  const latestData = useRef({
    pathData: [] as Array<[number, number]>,
    color: "#ff5200",
    path: "",
  });
  const animationFrame = useRef<number>();
  const strongestNoteCoords = useRef<Array<[number, number]>>([[0, 0]]);
  const pathRef = useRef<SVGPathElement>(null);
  const backgroundPathRef = useRef<SVGPathElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Add resize observer ref
  const resizeObserver = useRef<ResizeObserver>();

  // Update dimensions based on window size
  const updateDimensions = () => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    setWidth(windowWidth);
    setHeight(windowHeight);
    setRadius(Math.min(windowWidth, windowHeight) / 3);
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
      const ctx = new AudioContext();
      console.log("Setting up audio capture with tabId:", tabId);
      try {
        // First get the media stream ID
        const streamId = await new Promise<string>((resolve) => {
          chrome.tabCapture.getMediaStreamId(
            { targetTabId: tabId },
            (streamId) => resolve(streamId)
          );
        });
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
        source.connect(ctx.destination);

        const meydaAnalyzer = Meyda.createMeydaAnalyzer({
          audioContext: ctx,
          source: source,
          bufferSize: BUFFER_SIZE,
          featureExtractors: ["powerSpectrum", "chroma", "spectralSpread"],
          callback: ({
            powerSpectrum,
            chroma,
            spectralSpread,
          }: {
            powerSpectrum: number[];
            chroma: number[];
            spectralSpread: number;
          }) => {
            if (powerSpectrum) {
              const newKeyOctaveAmplitudes = processPowerSpectrum(
                powerSpectrum,
                ctx
              );
              setKeyOctaveAmplitudes(newKeyOctaveAmplitudes);
            }
            if (chroma) {
              setChroma(chroma);
            }
            if (spectralSpread) {
              setTurbulence(spectralSpread / (BUFFER_SIZE / 2));
            }
          },
        });

        meydaAnalyzer.start();
        setAudioContext(ctx);
        setAnalyzer(meydaAnalyzer);
      } catch (error) {
        console.error("Error in setupAudioCapture:", error);
      }
    };

    if (tabId) {
      setupAudioCapture();
    }

    return () => {
      analyzer?.stop();
      audioContext?.close();
    };
  }, [tabId]);

  useEffect(() => {
    drawVisual({
      keyOctaveAmplitudes,
      width,
      radius,
      pathRef,
      backgroundPathRef,
      strongestNoteCoords,
      colorScale,
      latestData,
    });
  }, [keyOctaveAmplitudes, width, height, radius]);

  // Remove or update the other cleanup effect since it's no longer needed
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

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
      <svg
        ref={svgRef}
        id="audioForma-visual"
        width={Math.max(width, 1)}
        height={Math.max(height, 1)}
        style={{
          position: "absolute",
          zIndex: 1000,
        }}
      >
        <filter id="blurMe">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" />
        </filter>
        <rect
          height={height}
          width={width}
          x={0}
          y={0}
          fill="black"
          opacity=".6"
        />
        {chroma.map((chromaPresence, chromaIndex) => {
          const chromaRadius = radius * 0.8;
          const note = noteNames[chromaIndex as keyof typeof noteNames];
          const degrees = noteAngles[note as keyof typeof noteAngles] - 90;
          const angle = (degrees / 360) * 2 * Math.PI;
          const x = Math.cos(angle) * chromaRadius;
          const y = Math.sin(angle) * chromaRadius;
          const translateValue = `${width / 2}, ${getYMove(chromaRadius, 8)}`;
          return (
            <text
              x={`${x}px`}
              y={`${y}px`}
              fill={BASE_COLOR}
              fontSize="16px"
              transform={`translate(${translateValue})`}
              fontWeight="600"
              fontFamily="sans-serif"
              opacity={chromaPresence}
              textAnchor="middle"
            >
              {note}
            </text>
          );
        })}
        {latestData.current.pathData.map((point, index) => (
          <g key={index}>
            {index > 0 && (
              <line
                x1={point[0]}
                y1={point[1]}
                x2={latestData.current.pathData[index - 1][0]}
                y2={latestData.current.pathData[index - 1][1]}
                stroke="white"
                strokeWidth={0.5}
                opacity={0.25}
              />
            )}
            <circle
              cx={point[0]}
              cy={point[1]}
              r={2}
              fill="white"
              opacity={0.5}
            />
          </g>
        ))}
        <path ref={backgroundPathRef} filter="url(#blurMe)" strokeWidth={20} />
        <path ref={pathRef} stroke="white" />
        {octaves.map((octave) => {
          const octaveIndex = octaves.indexOf(octave);
          const translateValue = `${width / 2}, ${getYMove(
            radius,
            octaveIndex
          )}`;
          const noteNameValues = Object.values(noteNames);

          return noteNameValues.map((note) => {
            const degrees = noteAngles[note as keyof typeof noteAngles] - 90;
            const angle = (degrees / 360) * 2 * Math.PI;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            const amplitude = keyOctaveAmplitudes[`${note}${octave}`] || 0;
            const rotateValue = noteAngles[note as keyof typeof noteAngles];

            const amplitudeScale = scaleLinear()
              .domain([0, BUFFER_SIZE / 2])
              .range([0, 200]);
            return (
              <g>
                <rect
                  x={`${x - Math.min(amplitudeScale(amplitude), 50)}px`}
                  y={`${y}px`}
                  key={`${note}${octave}`}
                  width={`${Math.max(
                    Math.min(amplitudeScale(amplitude) * 2, 100),
                    0
                  )}px`}
                  height={`${2 * (10 - octave)}px`}
                  fill={BASE_COLOR}
                  fillOpacity="0.6"
                  strokeOpacity="0.2"
                  strokeWidth={4}
                  rx={`${Math.min(4, amplitudeScale(amplitude) / 2)}px`}
                  transform={`translate(${translateValue}) rotate(${rotateValue} ${x} ${y})`}
                  stroke={BASE_COLOR}
                />
              </g>
            );
          });
        })}
      </svg>
    </div>
  );
};

export default Visual;
