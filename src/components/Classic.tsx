import { scaleLinear } from "d3-scale";
import "d3-transition";
import React, { useEffect, useRef } from "react";
import { drawVisual, getYMove } from "../utils/drawVisual";
import { ColorScale, BASE_COLOR } from "../utils/colors";
import { noteAngles, octaves, noteNames, BUFFER_SIZE } from "../utils/consts";

interface ClassicProps {
  chroma: number[];
  keyOctaveAmplitudes: Record<string, number>;
  width: number;
  height: number;
  radius: number;
  colorScale: ColorScale;
}

const amplitudeScale = scaleLinear().domain([0, BUFFER_SIZE / 2]).range([0, 200]);

export const Classic = (props: ClassicProps) => {
  const { chroma, keyOctaveAmplitudes, width, height, radius, colorScale } = props;
  const latestData = useRef({
    pathData: [] as Array<[number, number]>,
    color: "#ff5200",
    path: "",
  });
  const strongestNoteCoords = useRef<Array<{ x: number; y: number; z: number }>>([]);
  const pathRef = useRef<SVGPathElement>(null);
  const backgroundPathRef = useRef<SVGPathElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    drawVisual({
      keyOctaveAmplitudes,
      width,
      height,
      radius,
      pathRef,
      backgroundPathRef,
      strongestNoteCoords,
      colorScale,
      latestData,
    });
  }, [keyOctaveAmplitudes, width, height, radius, colorScale]);

  const noteNameValues = Object.values(noteNames);
  const labelCenterY = getYMove(radius, (octaves.length - 1) / 2, height);

  return (
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
      <rect height={height} width={width} x={0} y={0} fill="black" opacity=".6" />
      {chroma.map((chromaPresence, chromaIndex) => {
        const chromaRadius = radius * 0.8;
        const note = noteNames[chromaIndex];
        const degrees = noteAngles[note] - 90;
        const angle = (degrees / 360) * 2 * Math.PI;
        const x = Math.cos(angle) * chromaRadius;
        const y = Math.sin(angle) * chromaRadius;
        return (
          <text
            key={`label-${note}`}
            x={`${x}px`}
            y={`${y}px`}
            fill={BASE_COLOR}
            fontSize="16px"
            transform={`translate(${width / 2}, ${labelCenterY})`}
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
        <g key={`trail-${index}`}>
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
          <circle cx={point[0]} cy={point[1]} r={2} fill="white" opacity={0.5} />
        </g>
      ))}
      <path ref={backgroundPathRef} filter="url(#blurMe)" strokeWidth={20} />
      <path ref={pathRef} stroke="white" />
      {octaves.map((octave, octaveIndex) => {
        const translateValue = `${width / 2}, ${getYMove(radius, octaveIndex, height)}`;
        return (
          <g key={`octave-${octave}`}>
            {noteNameValues.map((note) => {
              const degrees = noteAngles[note] - 90;
              const angle = (degrees / 360) * 2 * Math.PI;
              const x = Math.cos(angle) * radius;
              const y = Math.sin(angle) * radius;
              const amplitude = Math.max(0, keyOctaveAmplitudes[`${note}${octave}`] || 0);
              const rotateValue = noteAngles[note];
              return (
                <rect
                  key={`${note}${octave}`}
                  x={`${x - Math.min(amplitudeScale(amplitude), 50)}px`}
                  y={`${y}px`}
                  width={`${Math.max(Math.min(amplitudeScale(amplitude) * 2, 100), 0)}px`}
                  height={`${2 * (10 - octave)}px`}
                  fill={BASE_COLOR}
                  fillOpacity="0.6"
                  strokeOpacity="0.2"
                  strokeWidth={4}
                  rx={`${Math.min(4, amplitudeScale(amplitude) / 2)}px`}
                  transform={`translate(${translateValue}) rotate(${rotateValue} ${x} ${y})`}
                  stroke={BASE_COLOR}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
};
