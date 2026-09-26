import { noteNames } from "./consts";
import { fifthsIndex } from "./notes";

/**
 * Note colours for the orb: one hue per step around the circle of fifths, so
 * harmonically close notes get neighbouring colours (Malinowski-style
 * harmonic colouring). The wheel is oriented so the sharp side runs warm
 * (G orange, D amber, A yellow) and the flat side runs cool (Bb purple,
 * Eb violet, Ab blue). Colours are computed in OKLCH for even brightness,
 * at the most saturated chroma sRGB allows for each hue.
 */

export type RGB = [number, number, number];

const HUE_OF_C = 15; // degrees in OKLCH; C lands on a rose red
const LIGHTNESS = 0.66;

const oklabToLinearSrgb = (L: number, a: number, b: number): RGB => {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};

const inGamut = ([r, g, b]: RGB) => [r, g, b].every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** Linear-sRGB colour for an OKLCH hue at the given lightness, at maximum in-gamut chroma. */
export const oklchToLinear = (hueDeg: number, lightness = LIGHTNESS, chromaScale = 0.96): RGB => {
  const h = (hueDeg * Math.PI) / 180;
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 24; i++) {
    const c = (lo + hi) / 2;
    if (inGamut(oklabToLinearSrgb(lightness, c * Math.cos(h), c * Math.sin(h)))) lo = c;
    else hi = c;
  }
  const chroma = lo * chromaScale;
  const rgb = oklabToLinearSrgb(lightness, chroma * Math.cos(h), chroma * Math.sin(h));
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as RGB;
};

const linearToSrgbChannel = (v: number) =>
  v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;

export const linearToHex = (rgb: RGB) =>
  "#" +
  rgb
    .map((v) => Math.round(linearToSrgbChannel(v) * 255).toString(16).padStart(2, "0"))
    .join("");

/** Hue (degrees) for a position on the circle of fifths, 0 = C, 30 per step sharpward. */
export const fifthsAngleToHue = (angleDeg: number) => (HUE_OF_C + angleDeg + 360) % 360;

/** Linear-sRGB colour per pitch class (index 0 = C, 1 = C#, ... 11 = B). */
export const NOTE_COLORS_LINEAR: RGB[] = Array.from({ length: 12 }, (_, pc) =>
  oklchToLinear(fifthsAngleToHue(fifthsIndex(noteNames[pc]) * 30))
);

export const NOTE_COLORS_HEX = NOTE_COLORS_LINEAR.map(linearToHex);
