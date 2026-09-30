/**
 * Shader for the Voices view's solid bodies: comet tubes, their heads, and
 * chord notes (instanced beads). Opaque, softly lit from the upper left like
 * the studio, with a small highlight.
 *
 * - uColor: the instrument's colour (instanced beads use instanceColor).
 * - uWhiten: lightens the whole body toward white (a muted stem's ghost).
 * - aWhiten (tube only, with the TUBE define): lightens the tail toward its
 *   end, so the tail fades into the room while staying solid.
 */
export const bodyVertex = /* glsl */ `
#ifdef TUBE
attribute float aWhiten;
#endif
uniform vec3 uColor;
uniform float uWhiten;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vColor;

void main() {
  vec4 local = vec4(position, 1.0);
  vec3 objectNormal = normal;
  vec3 color = uColor;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
    objectNormal = mat3(instanceMatrix) * objectNormal;
  #endif
  #ifdef USE_INSTANCING_COLOR
    color = instanceColor;
  #endif
  float whiten = uWhiten;
  #ifdef TUBE
    whiten = 1.0 - (1.0 - whiten) * (1.0 - aWhiten);
  #endif
  vColor = mix(color, vec3(1.0), whiten);
  vec4 mvPosition = modelViewMatrix * local;
  vViewPosition = -mvPosition.xyz;
  vNormal = normalize(normalMatrix * objectNormal);
  gl_Position = projectionMatrix * mvPosition;
}
`;

export const bodyFragment = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec3 vColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vViewPosition);
  // Key light from the upper left, in view space; wrapped so the shadow side stays soft.
  vec3 l = normalize(vec3(-0.45, 0.8, 0.6));
  float wrapped = dot(n, l) * 0.5 + 0.5;
  float light = 0.6 + 0.48 * wrapped * wrapped;
  // Edges darken a touch, so a body reads against the white room.
  float facing = max(dot(n, v), 0.0);
  float edge = mix(0.8, 1.0, smoothstep(0.0, 0.55, facing));
  float highlight = pow(max(dot(n, normalize(l + v)), 0.0), 42.0);
  vec3 color = vColor * light * edge + vec3(0.42) * highlight;
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
