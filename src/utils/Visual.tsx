import { hsl } from "d3-color";
import { scaleLinear } from "d3-scale";
import { curveBasisClosed, curveLinearClosed, line } from "d3-shape";
import Meyda from "meyda";
import React, { useEffect, useRef, useState } from "react";
import { interpolate } from "d3-interpolate";
import { select } from "d3-selection";
import "d3-transition"; // needed for d3 transitions to work

import { octaves, noteAngles, noteNames, BUFFER_SIZE } from "./consts";
import { processPowerSpectrum } from "./processPowerSpectrum";

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

  const scaledRadius = radius * Math.min(power / BUFFER_SIZE, 1);

  const xMove = width / 2;
  const yMove = getYMove(radius, octaveIndex);

  const angle = (degrees / 360) * 2 * Math.PI;
  const y = Math.sin(angle) * scaledRadius + yMove;
  const x = Math.cos(angle) * scaledRadius + xMove;
  return [x, y, degrees];
};

interface VisualProps {
  videoElement: HTMLVideoElement;
}

const Visual: React.FC<VisualProps> = ({ videoElement }) => {
  const [audioContext, setAudioContext] = useState<AudioContext>();
  const [analyzer, setAnalyzer] = useState<any>();
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

  // Add resize observer ref
  const resizeObserver = useRef<ResizeObserver>();

  // Update dimensions based on video element
  const updateDimensions = () => {
    const videoWidth = videoElement.clientWidth;
    const videoHeight = videoElement.clientHeight;
    setWidth(videoWidth);
    setHeight(videoHeight);
    setRadius(Math.min(videoWidth, videoHeight) / 3); // Adjust divisor as needed
  };

  // Add effect for dimension handling
  useEffect(() => {
    // Initial dimension setup
    updateDimensions();

    // Setup resize observer
    resizeObserver.current = new ResizeObserver(updateDimensions);
    resizeObserver.current.observe(videoElement);

    // Cleanup
    return () => {
      resizeObserver.current?.disconnect();
    };
  }, [videoElement]);

  useEffect(() => {
    // Initialize audio context when video starts playing
    const handlePlay = () => {
      if (!audioContext) {
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaElementSource(videoElement);
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
        } catch (e) {
          // If video is already connected to another context
          if (e instanceof DOMException && e.name === "InvalidStateError") {
            // Get the existing context
            const existingCtx = new AudioContext();
            const destination = existingCtx.destination;

            // Create analyzer without creating new MediaElementSource
            const meydaAnalyzer = Meyda.createMeydaAnalyzer({
              audioContext: existingCtx,
              source: destination,
              bufferSize: BUFFER_SIZE,
              featureExtractors: ["powerSpectrum"],
              callback: (features: { powerSpectrum: number[] }) => {
                if (features.powerSpectrum) {
                  const newKeyOctaveAmplitudes = processPowerSpectrum(
                    features.powerSpectrum,
                    existingCtx
                  );
                  setKeyOctaveAmplitudes(newKeyOctaveAmplitudes);
                }
              },
            });

            meydaAnalyzer.start();
            setAudioContext(existingCtx);
            setAnalyzer(meydaAnalyzer);
          } else {
            console.error("Error setting up audio context:", e);
          }
        }
      }
    };

    videoElement.addEventListener("play", handlePlay);

    // Cleanup
    return () => {
      videoElement.removeEventListener("play", handlePlay);
      if (analyzer) {
        analyzer.stop();
      }
      if (audioContext) {
        audioContext.close();
      }
    };
  }, [videoElement]);

  useEffect(() => {
    const amplitudesSorted = Object.entries(keyOctaveAmplitudes).sort(
      (a, b) => b[1] - a[1]
    );

    if (amplitudesSorted.length > 0 && pathRef.current) {
      const strongestNote = amplitudesSorted[0];
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
            strongestNote[1] > BUFFER_SIZE * 0.75
              ? curveLinearClosed
              : curveBasisClosed
          );

        const renderPath = () => {
          const path = pathRef.current;
          path?.setAttribute("stroke-width", "2");
          path?.setAttribute("fill-opacity", "0.5");
          const color = hsl(degrees, 0.7, 0.5);
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
        {octaves.map((octave) => {
          const octaveIndex = octaves.indexOf(octave);
          return (
            <circle
              key={octave}
              r={radius * 1.2}
              fill="black"
              opacity={0.1}
              cx={width / 2}
              cy={getYMove(radius, octaveIndex)}
              onClick={() => {
                show ? setRadius(2) : updateDimensions();
              }}
            />
          );
        })}
        {octaves.map((octave) => {
          const octaveIndex = octaves.indexOf(octave);
          const translateValue = `${width / 2}, ${getYMove(
            radius,
            octaveIndex
          )}`;
          const probablyPercussion = octave > 6;
          const noteNameValues = Object.values(noteNames);

          return noteNameValues.map((note) => {
            const degrees = noteAngles[note as keyof typeof noteAngles] - 90;
            const angle = (degrees / 360) * 2 * Math.PI;
            const x = Math.cos(angle) * radius;
            const y = Math.sin(angle) * radius;

            const amplitude = keyOctaveAmplitudes[`${note}${octave}`] || 0;

            const color = hsl(degrees, 0.7, 0.5);
            const rotateValue = noteAngles[note as keyof typeof noteAngles];
            if (probablyPercussion) {
              return (
                <line
                  key={`${note}${octave}`}
                  x1={x - Math.min(amplitude, 100)}
                  x2={x + Math.min(amplitude, 100)}
                  y1={y}
                  y2={y}
                  opacity={0.4}
                  transform={`translate(${translateValue}) rotate(${rotateValue} ${x} ${y})`}
                />
              );
            } else {
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
                  opacity="0.9"
                  rx={`${Math.min(4, amplitudeScale(amplitude) / 2)}px`}
                  transform={`translate(${translateValue}) rotate(${rotateValue} ${x} ${y})`}
                  stroke="white"
                />
              );
            }
          });
        })}
        <path
          ref={pathRef}
          id="audioforma-path"
          strokeWidth="4"
          opacity={0.9}
        />
      </svg>
    </>
  );
};

export { Visual };
