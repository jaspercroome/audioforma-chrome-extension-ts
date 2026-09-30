/**
 * Shaders for the Voices view.
 *
 * Ribbon: a camera-facing strip through a list of points, with a width and
 * opacity per point. Used for melodic trails; zero width leaves a gap (a rest).
 */
export const ribbonVertex = /* glsl */ `
attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aSide;
attribute float aWidth;
attribute float aAlpha;
varying float vAlpha;
varying float vSide;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 prev = (modelViewMatrix * vec4(aPrev, 1.0)).xyz;
  vec3 next = (modelViewMatrix * vec4(aNext, 1.0)).xyz;
  vec3 tangent = next - prev;
  tangent = length(tangent) > 1e-6 ? normalize(tangent) : vec3(0.0, 1.0, 0.0);
  vec3 toCamera = normalize(-mvPosition.xyz);
  vec3 side = cross(tangent, toCamera);
  side = length(side) > 1e-6 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  mvPosition.xyz += side * aSide * aWidth;
  vAlpha = aAlpha;
  vSide = aSide;
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const ribbonFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
varying float vSide;

void main() {
  float across = abs(vSide);
  float edge = 1.0 - smoothstep(0.6, 1.0, across);
  // A slightly lighter spine gives the strip some roundness.
  vec3 color = uColor * (0.8 + 0.35 * (1.0 - across));
  gl_FragColor = vec4(color, vAlpha * edge);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Sparks: round, soft points sized in world units. Used for notes in chords. */
export const sparkVertex = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(0.1, -mvPosition.z);
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const sparkFragment = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;

void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float disc = 1.0 - smoothstep(0.55, 1.0, d);
  float core = 1.0 - smoothstep(0.0, 0.45, d);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), core * 0.3), vAlpha * disc);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
