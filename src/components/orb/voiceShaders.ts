/**
 * Shader for the Voices view's bodies: comet tubes, their heads, and chord
 * notes (instanced dots). Flat and matte: a solid fill with no lighting, so
 * each voice reads as a clean shape, like ink on paper.
 *
 * - uColor: the instrument's colour (instanced dots use instanceColor).
 * - uWhiten: pales the whole body toward white (a muted stem's ghost).
 * - aFade (tube only, with the TUBE define): 0 at the head to 1 at the
 *   tail's end. The tail pales along it (uTailWhiten at the end), and older
 *   stretches sit a hair behind newer ones, so where a line doubles back on
 *   itself the newer pass is always on top.
 */
export const bodyVertex = /* glsl */ `
#ifdef TUBE
attribute float aFade;
#endif
uniform vec3 uColor;
uniform float uWhiten;
uniform float uTailWhiten;
varying vec3 vColor;

void main() {
  vec4 local = vec4(position, 1.0);
  vec3 color = uColor;
  #ifdef USE_INSTANCING
    local = instanceMatrix * local;
  #endif
  #ifdef USE_INSTANCING_COLOR
    color = instanceColor;
  #endif
  float whiten = uWhiten;
  float behind = 0.0;
  #ifdef TUBE
    whiten = 1.0 - (1.0 - whiten) * (1.0 - uTailWhiten * pow(aFade, 1.2));
    behind = aFade;
  #endif
  vColor = mix(color, vec3(1.0), whiten);
  gl_Position = projectionMatrix * modelViewMatrix * local;
  gl_Position.z += behind * 4e-5 * gl_Position.w;
}
`;

export const bodyFragment = /* glsl */ `
varying vec3 vColor;

void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
