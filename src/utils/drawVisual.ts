import { curveBasisClosed, curveLinearClosed, line } from "d3-shape";
import { ColorScale, getColor } from "./colors";
import { BUFFER_SIZE, noteAngles, octaves } from "./consts";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { interpolate } from "d3-interpolate";
import { parseNoteKey } from "./notes";

// Scale for cents to angle offset (±50 cents = ±15 degrees)
export const centsToAngleOffset = scaleLinear()
  .domain([-50, 50])
  .range([-Math.PI / 12, Math.PI / 12]); // ±15 degrees in radians

export const OCTAVE_SPACING_PX = 24;

/**
 * Vertical centre of one octave ring in the classic view. When the window
 * height is known the whole stack is centred; otherwise it keeps the old
 * top-anchored layout.
 */
export const getYMove = (radius: number, octaveIndex: number, height?: number) => {
  if (height === undefined) return radius + octaveIndex * OCTAVE_SPACING_PX;
  const stackMiddle = ((octaves.length - 1) * OCTAVE_SPACING_PX) / 2;
  return height / 2 - stackMiddle + octaveIndex * OCTAVE_SPACING_PX;
};

/** Largest ring radius that keeps the octave stack inside the window. */
export const classicRadius = (width: number, height: number) =>
  Math.max(
    40,
    Math.min(
      Math.min(width, height) * 0.4,
      (height - (octaves.length - 1) * OCTAVE_SPACING_PX) / 2 - 24
    )
  );

type GetPathCoordsArgs = {
  noteOctave: string;
  width: number;
  radius: number;
  power: number;
  isClassic?: boolean;
  cents?: number;
  height?: number;
};
export const getPathCoords: (args: GetPathCoordsArgs) => {
  x: number;
  y: number;
  degrees: number;
  threeCoords: { x: number; y: number; z: number };
} = (args) => {
  const { noteOctave, power, cents, isClassic, width, radius, height } = args;
  const parsed = parseNoteKey(noteOctave);
  if (!parsed) {
    return { x: NaN, y: NaN, degrees: NaN, threeCoords: { x: NaN, y: NaN, z: NaN } };
  }
  const { note, octave } = parsed;
  const octaveIndex = octaves.indexOf(octave);
  const centsAdjustment = ((cents ?? 0) / 100) * 30;
  const degrees = noteAngles[note] - 90 + centsAdjustment;

  const radiusValue = isClassic ? radius : 8;

  const scaledRadius = radiusValue * Math.min(power / BUFFER_SIZE, 0.8);

  const xMove = isClassic ? width / 2 : 0;
  const yMove = isClassic ? getYMove(radius, octaveIndex, height) : 0;

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

// Normalised power (strongest note / BUFFER_SIZE) above which the blob switches
// from a smooth to an angular outline. The old check compared normalised power
// against BUFFER_SIZE * 0.75, so it could never trigger.
const SHARP_OUTLINE_POWER = 0.75;

export const drawVisual = (args: {
  keyOctaveAmplitudes: Record<string, number>;
  width: number;
  height?: number;
  radius: number;
  pathRef: React.RefObject<SVGPathElement>;
  backgroundPathRef: React.RefObject<SVGPathElement>;
  strongestNoteCoords: React.MutableRefObject<{ x: number; y: number; z: number }[]>;
  colorScale: ColorScale;
  latestData: React.MutableRefObject<{
    pathData: Array<[number, number]>;
    color: string;
    path: string;
  }>;
}) => {
  const {
    width,
    height,
    radius,
    keyOctaveAmplitudes,
    pathRef,
    backgroundPathRef,
    strongestNoteCoords,
    colorScale,
    latestData,
  } = args;

  const amplitudesSorted = Object.entries(keyOctaveAmplitudes)
    .filter(([key, value]) => Number.isFinite(value) && parseNoteKey(key))
    .sort((a, b) => b[1] - a[1]);
  // Stroke width follows normalised power (0-1); the old domain was 0-10.
  const widthScale = scaleLinear().domain([0, 1]).range([0.5, 4]).clamp(true);
  const colorNumberScale = scaleLinear().domain([0, 1]).range([0, 1]);

  if (amplitudesSorted.length > 0 && pathRef.current) {
    const strongestNote = amplitudesSorted[0];
    const strongestNotePower = strongestNote[1] / BUFFER_SIZE;
    const { x, y, degrees } = getPathCoords({
      noteOctave: strongestNote[0] ?? "",
      power: strongestNote[1],
      width,
      height,
      radius,
      isClassic: true,
    });

    const lastCoords = strongestNoteCoords.current[strongestNoteCoords.current.length - 1];
    const isSame = !!lastCoords && x === lastCoords.x && y === lastCoords.y;

    if (Number.isFinite(x) && Number.isFinite(y) && !isSame) {
      strongestNoteCoords.current = [{ x, y, z: 0 }];
      const curve = strongestNotePower > SHARP_OUTLINE_POWER ? curveLinearClosed : curveBasisClosed;
      const lineGenerator = line().curve(curve);
      const bgLineGenerator = line().curve(curve);

      const renderPath = () => {
        const path = pathRef.current;
        const pathBg = backgroundPathRef.current;
        // Stop the animation chain once the classic view has unmounted.
        if (!path || !pathBg) return;
        path.setAttribute("fill-opacity", "0.5");
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
            const newPath = lineGenerator(latestData.current.pathData) ?? "M10,10 L20,20";
            const currentPath = path.getAttribute("d") ?? newPath;
            return interpolate(currentPath, newPath);
          })
          .attrTween("fill", () => interpolate(path.getAttribute("fill") || "#ff5200", color.toString()))
          .attrTween("stroke-width", () => {
            const currentWidth = path.getAttribute("stroke-width") ?? "1px";
            return interpolate(currentWidth, widthScale(strongestNotePower) + "px");
          })
          .on("end", () => {
            requestAnimationFrame(renderPath);
          });

        pathBg.setAttribute("fill-opacity", "0.5");
        select(pathBg)
          .transition()
          .duration(100)
          .attrTween("d", () => {
            const newBgPath = bgLineGenerator(latestData.current.pathData) ?? "M10,10 L20,20";
            const currentBgPath = path.getAttribute("d") ?? newBgPath;
            return interpolate(currentBgPath, newBgPath);
          })
          .attrTween("fill", () => interpolate(pathBg.getAttribute("fill") || "#ff5200", color.toString()))
          .attrTween("stroke", () => interpolate(pathBg.getAttribute("stroke") || "#ff5200", color.toString()));
        // Only the foreground path re-queues the loop, so there is a single
        // animation chain per update rather than two.
      };
      latestData.current.pathData.push([x, y]);
      latestData.current.pathData.splice(0, Math.max(0, latestData.current.pathData.length - 20));

      requestAnimationFrame(renderPath);
    }
  }
};
