import { hsl } from "d3-color";
import { scaleLinear } from "d3-scale";
import { curveBasisClosed, curveLinearClosed, line } from "d3-shape";
import Meyda from "meyda";
import React, { useEffect, useRef, useState } from "react";
import { interpolate } from "d3-interpolate";
import { select } from "d3-selection";
import "d3-transition";

import { octaves, noteAngles, noteNames, BUFFER_SIZE } from "../utils/consts";
import { processPowerSpectrum } from "../utils/processPowerSpectrum";
import { MeydaAnalyzer } from "meyda/dist/esm/meyda-wa";

const getYMove = (radius: number, octaveIndex: number) => {
  return radius + octaveIndex * 24;
};

const getPathCoords = (
  noteOctave: string,
  width: number,
  radius: number,
  power: number
) => {
  const note = noteOctave.includes("#")
    ? noteOctave.slice(0, 2)
    : noteOctave.slice(0, 1);
  const octave = Number(noteOctave.split("").pop());
  const octaveIndex = octaves.indexOf(octave);
  const degrees = noteAngles[note as keyof typeof noteAngles] - 90;

  const scaledRadius = radius * Math.min(power / BUFFER_SIZE, 0.8);

  const xMove = width / 2;
  const yMove = getYMove(radius, octaveIndex);

  const angle = (degrees / 360) * 2 * Math.PI;
  const y = Math.sin(angle) * scaledRadius + yMove;
  const x = Math.cos(angle) * scaledRadius + xMove;
  return [x, y, degrees];
};

const Visual = () => {
  const [tabId, setTabId] = useState<number>();
  const [audioContext, setAudioContext] = useState<AudioContext>();
  const [analyzer, setAnalyzer] = useState<MeydaAnalyzer>();
  const [keyOctaveAmplitudes, setKeyOctaveAmplitudes] = useState<
    Record<string, number>
  >({});
  const [width, setWidth] = useState(600);
  const [height, setHeight] = useState(600 / (16 / 9));
  const [radius, setRadius] = useState(600 / (16 / 9) / 3);
  const [show, setShow] = useState(true);

  // Add refs for animation handling
  const latestData = useRef({
    pathData: [] as Array<[number, number]>,
    color: "#ff5200",
    path: "",
  });
  const animationFrame = useRef<number>();
  const strongestNoteCoords = useRef<Array<[number, number]>>([[0, 0]]);
  const pathRef = useRef<SVGPathElement>(null);
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
    };

    chrome.runtime.onMessage.addListener(messageHandler);
    return () => {
      console.log("Cleaning up message listener");
      chrome.runtime.onMessage.removeListener(messageHandler);
    };
  }, []);

  useEffect(() => {
    const setupAudioCapture = async () => {
      console.log("Setting up audio capture with tabId:", tabId);
      try {
        // First get the media stream ID
        const streamId = await new Promise<string>((resolve) => {
          chrome.tabCapture.getMediaStreamId(
            { targetTabId: tabId },
            (streamId) => resolve(streamId)
          );
        });

        // Then use the stream ID to get the media stream
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: "tab",
              chromeMediaSourceId: streamId,
            },
          } as MediaTrackConstraints,
          video: false,
        });

        console.log("Got media stream:", stream);
        if (!stream) return;

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        source.connect(ctx.destination);

        const meydaAnalyzer = Meyda.createMeydaAnalyzer({
          audioContext: ctx,
          source: source,
          bufferSize: BUFFER_SIZE,
          featureExtractors: ["powerSpectrum"],
          callback: (features: { powerSpectrum: number[] }) => {
            if (features.powerSpectrum) {
              const newKeyOctaveAmplitudes = processPowerSpectrum(
                features.powerSpectrum,
                ctx
              );
              setKeyOctaveAmplitudes(newKeyOctaveAmplitudes);
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
    const amplitudesSorted = Object.entries(keyOctaveAmplitudes).sort(
      (a, b) => b[1] - a[1]
    );
    const luminanceScale = scaleLinear().domain([0, 10]).range([0.5, 0.8]);
    const satScale = scaleLinear().domain([0, 10]).range([0.5, 1]);
    const widthScale = scaleLinear().domain([0, 10]).range([0.5, 4]);

    if (amplitudesSorted.length > 0 && pathRef.current) {
      const strongestNote = amplitudesSorted[0];
      const strongestNotePower = strongestNote[1] / BUFFER_SIZE;
      const [x, y, degrees] = getPathCoords(
        strongestNote[0] ?? "",
        width,
        radius,
        amplitudesSorted[0][1]
      );

      const lastCoords =
        strongestNoteCoords.current[strongestNoteCoords.current.length - 1];
      const isSame = x === lastCoords[0] && y === lastCoords[1];

      if (x && y && !isSame) {
        // Update path data with new point
        const lineGenerator = line()
          .x((d) => d[0])
          .y((d) => d[1])
          .curve(
            strongestNotePower > BUFFER_SIZE * 0.75
              ? curveLinearClosed
              : curveBasisClosed
          );

        const renderPath = () => {
          const path = pathRef.current;
          path?.setAttribute("fill-opacity", "0.5");
          const color = hsl(
            degrees,
            satScale(strongestNotePower),
            luminanceScale(strongestNotePower)
          );
          select(path)
            .transition()
            .duration(100)
            .attrTween("d", function () {
              const newPath =
                lineGenerator(latestData.current.pathData) ?? "M10,10 L20,20";
              const currentPath = path?.getAttribute("d") ?? newPath;
              return interpolate(currentPath, newPath);
            })
            .attrTween("fill", function () {
              return interpolate(
                path?.getAttribute("fill") || "#ff5200",
                color.toString()
              );
            })
            .attrTween("stroke-width", () => {
              const currentWidth = path?.getAttribute("stroke-width") ?? "px";
              return interpolate(
                currentWidth,
                widthScale(strongestNotePower) + "px"
              );
            })
            .attrTween("stroke", function () {
              return interpolate(
                path?.getAttribute("stroke") || "#ff5200",
                color.toString()
              );
            })
            .on("end", () => {
              requestAnimationFrame(renderPath);
            });
        };
        latestData.current.pathData.push([x, y]);
        latestData.current.pathData.splice(
          0,
          latestData.current.pathData.length - 20
        );

        requestAnimationFrame(renderPath);
      }
    }
  }, [keyOctaveAmplitudes, width, height, radius]);

  useEffect(() => {
    // Define the handler function
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        e.preventDefault(); // Prevent browser's default Cmd/Ctrl+H behavior
        setShow((prev) => !prev);
      }
    };

    // Add event listener
    document.addEventListener("keydown", handleKeyDown);

    // Cleanup with the same function reference
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []); // Empty dependency array since we don't use any external values

  // Remove or update the other cleanup effect since it's no longer needed
  useEffect(() => {
    return () => {
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, []);

  return (
    <>
      <svg
        ref={svgRef}
        id="audioForma-visual"
        width={Math.max(width, 1)}
        height={Math.max(height, 1)}
        style={{
          visibility: show ? "visible" : "hidden",
        }}
      >
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
        <path ref={pathRef} id="audioforma-path" />
        {octaves.map((octave) => {
          const octaveIndex = octaves.indexOf(octave);
          const translateValue = `${width / 2}, ${getYMove(
            radius,
            octaveIndex
          )}`;
          // const probablyPercussion = octave > 6;
          const noteNameValues = Object.values(noteNames);

          return noteNameValues.map((note) => {
            const degrees = noteAngles[note as keyof typeof noteAngles] - 90;
            const angle = (degrees / 360) * 2 * Math.PI;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            const amplitude = keyOctaveAmplitudes[`${note}${octave}`] || 0;

            const color = hsl(degrees, 0.7, 0.5);
            const rotateValue = noteAngles[note as keyof typeof noteAngles];
            // if (probablyPercussion) {
            //   return (
            //     <line
            //       key={`${note}${octave}`}
            //       x1={x - Math.min(amplitude, 100)}
            //       x2={x + Math.min(amplitude, 100)}
            //       y1={y}
            //       y2={y}
            //       opacity={0.4}
            //       transform={`translate(${translateValue}) rotate(${rotateValue} ${x} ${y})`}
            //     />
            //   );
            // } else {
            const amplitudeScale = scaleLinear()
              .domain([0, BUFFER_SIZE / 2])
              .range([0, 200]);
            return (
              <rect
                key={`${note}${octave}`}
                x={`${x - Math.min(amplitudeScale(amplitude), 50)}px`}
                y={`${y}px`}
                width={`${Math.max(
                  Math.min(amplitudeScale(amplitude) * 2, 100),
                  0
                )}px`}
                height={`${2 * (10 - octave)}px`}
                fill={color.toString()}
                fillOpacity="0.8"
                strokeOpacity="0.2"
                strokeWidth={4}
                rx={`${Math.min(4, amplitudeScale(amplitude) / 2)}px`}
                transform={`translate(${translateValue}) rotate(${rotateValue} ${x} ${y})`}
                stroke={color.toString()}
              />
            );
            // }
          });
        })}
      </svg>
    </>
  );
};

export { Visual };
