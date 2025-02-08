import { curveBasisClosed, curveLinearClosed, line } from "d3-shape";
import { ColorScale, getColor } from "./colors";
import { BUFFER_SIZE, noteAngles, octaves } from "./consts";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { interpolate } from "d3-interpolate";

// Scale for cents to angle offset (±50 cents = ±15 degrees)
export const centsToAngleOffset = scaleLinear()
  .domain([-50, 50])
  .range([-Math.PI / 12, Math.PI / 12]); // ±15 degrees in radians

export const getYMove = (radius: number, octaveIndex: number) => {
  return radius + octaveIndex * 24;
};

type GetPathCoordsArgs = {
  noteOctave: string,
  width: number,
  radius: number,
  power: number,
  isClassic?: boolean,
  cents?: number
}
export const getPathCoords: (args: GetPathCoordsArgs) => {
  x: number;
  y: number;
  degrees: number;
  threeCoords: {x: number, y: number, z: number}
} = (args) => {
  const { noteOctave, power, cents, isClassic, width, radius } = args;
  const note = noteOctave.includes("#")
    ? noteOctave.slice(0, 2)
    : noteOctave.slice(0, 1);
  const octave = Number(noteOctave.split("").pop());
  const octaveIndex = octaves.indexOf(octave);
  const centsAdjustment = ((cents ?? 0) / 100) * 30;
  const degrees =
    noteAngles[note as keyof typeof noteAngles] - 90 + centsAdjustment;

  const radiusValue = isClassic ? radius : 8;

  const scaledRadius = radiusValue * Math.min(power / BUFFER_SIZE, 0.8);

  const xMove = isClassic ? width / 2 : 0;
  const yMove = isClassic ? getYMove(radius, octaveIndex) : 0;

  const angle = (degrees / 360) * 2 * Math.PI;
  const y = Math.sin(angle) * scaledRadius + yMove;
  const x = Math.cos(angle) * scaledRadius + xMove;
  const threeY = octave;
  const threeCoords = { x: x, z: y, y: threeY };
  return {
    x,
    y,
    degrees,
    threeCoords,
  };
};

export const drawVisual = (args: {
  keyOctaveAmplitudes: Record<string, number>;
  width: number;
  radius: number;
  pathRef: React.RefObject<SVGPathElement>;
  backgroundPathRef: React.RefObject<SVGPathElement>;
  strongestNoteCoords: React.MutableRefObject<
    { x: number; y: number; z: number }[]
  >;
  colorScale: ColorScale;
  latestData: React.MutableRefObject<{
    pathData: Array<[number, number]>;
    color: string;
    path: string;
  }>;
}) => {
  const {
    width,
    radius,
    keyOctaveAmplitudes,
    pathRef,
    backgroundPathRef,
    strongestNoteCoords,
    colorScale,
    latestData,
  } = args;

  const amplitudesSorted = Object.entries(keyOctaveAmplitudes).sort(
    (a, b) => b[1] - a[1]
  );
      const widthScale = scaleLinear().domain([0, 10]).range([0.5, 4]);
  const colorNumberScale = scaleLinear().domain([0, 1]).range([0, 1]);

  if (amplitudesSorted.length > 0 && pathRef.current) {
    const strongestNote = amplitudesSorted[0];
    const strongestNotePower = strongestNote[1] / BUFFER_SIZE;
    const { x, y, degrees } = getPathCoords(
      {
        noteOctave: strongestNote[0] ?? "",
        power: strongestNote[1],
        width,
        radius,
        isClassic: true,
      }
    );

    const lastCoords =
      strongestNoteCoords.current[strongestNoteCoords.current.length - 1];
    const isSame = x === lastCoords.x && y === lastCoords.y;

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
      const bgLineGenerator = line()
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
        const color = getColor({
          power: strongestNotePower,
          colorScale,
          colorNumberScale,
          degrees,
        });
        select(path)
          .transition()
          .duration(100)
          .attrTween("d", () => {
            const newPath =
              lineGenerator(latestData.current.pathData) ?? "M10,10 L20,20";
            const currentPath = path?.getAttribute("d") ?? newPath;
            return interpolate(currentPath, newPath);
          })
          .attrTween("fill", () => {
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
          .on("end", () => {
            requestAnimationFrame(renderPath);
          });

        const pathBg = backgroundPathRef.current;
        pathBg?.setAttribute("fill-opacity", "0.5");
        select(pathBg)
          .transition()
          .duration(100)
          .attrTween("d", () => {
            const newBgPath =
              bgLineGenerator(latestData.current.pathData) ?? "M10,10 L20,20";
            const currentBgPath = path?.getAttribute("d") ?? newBgPath;
            return interpolate(currentBgPath, newBgPath);
          })
          .attrTween("fill", () => {
            return interpolate(
              pathBg?.getAttribute("fill") || "#ff5200",
              color.toString()
            );
          })
          .attrTween("stroke", () => {
            return interpolate(
              pathBg?.getAttribute("stroke") || "#ff5200",
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
};
