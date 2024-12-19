import { hsl } from "d3-color";
import {
  interpolateCool,
  interpolateWarm,
  interpolateCubehelixDefault,
  interpolateInferno,
  interpolatePurples,
} from "d3-scale-chromatic";

export type ColorScale =
  | "Rainbow - Cool"
  | "Rainbow - Warm"
  | "Cubehelix"
  | "Inferno"
  | "Purples";

export const BASE_COLOR = "#eeffcc";

export const getColor = (args: {
  power: number;
  colorScale: ColorScale;
  colorNumberScale: (t: number) => number;
  degree: number;
}) => {
  const { power, colorScale, colorNumberScale, degree } = args;
  switch (colorScale) {
    case "Rainbow - Cool": {
      return interpolateCool(colorNumberScale(power));
    }
    case "Rainbow - Warm": {
      return interpolateWarm(colorNumberScale(power));
    }
    case "Cubehelix": {
      return interpolateCubehelixDefault(colorNumberScale(power));
    }
    case "Inferno": {
      return interpolateInferno(colorNumberScale(power));
    }
    case "Purples": {
      return interpolatePurples(colorNumberScale(power));
    }
    default: {
      return hsl(degree, 0.7, power).toString();
    }
  }
};
