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

export const Classic = (props: ClassicProps) => {
    const { chroma, keyOctaveAmplitudes, width, height, radius, colorScale } = props;
    const latestData = useRef({
        pathData: [] as Array<[number, number]>,
        color: "#ff5200",
        path: "",
      });
      const animationFrame = useRef<number>();
      const strongestNoteCoords = useRef<Array<{x: number, y: number, z: number}>>([{x: 0, y: 0, z: 0}]);
      const pathRef = useRef<SVGPathElement>(null);
      const backgroundPathRef = useRef<SVGPathElement>(null);
      const svgRef = useRef<SVGSVGElement>(null);


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

  );
};