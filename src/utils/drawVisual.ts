import { interpolate } from "d3-interpolate";
import { scaleLinear } from "d3-scale";
import { select } from "d3-selection";
import { line, curveLinearClosed, curveBasisClosed } from "d3-shape";
import { ColorScale, getColor } from "./colors";
import { BUFFER_SIZE, noteAngles, octaves } from "./consts";

export const getYMove = (radius: number, octaveIndex: number) => {
  return radius + octaveIndex * 24;
};

export const getPathCoords = (
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

export const drawVisual = (args: {
  keyOctaveAmplitudes: Record<string, number>;
  width: number;
  radius: number;
  pathRef: React.RefObject<SVGPathElement>;
  backgroundPathRef: React.RefObject<SVGPathElement>;
  strongestNoteCoords: React.MutableRefObject<[number, number][]>;
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
    const [x, y, degree] = getPathCoords(
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
          degree,
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
