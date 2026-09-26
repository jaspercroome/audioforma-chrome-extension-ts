/**
 * GLSL for the orb scene.
 *
 * simplex3d: "Array and textureless GLSL 2D/3D/4D simplex noise functions",
 * Ian McEwan, Ashima Arts / Stefan Gustavson. MIT License.
 * https://github.com/ashima/webgl-noise
 */
export const simplex3d = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/**
 * Veins: one instanced tube per note and register, built entirely in the
 * vertex shader so it can meander and swell with the music. Each instance is
 * a great circle around the orb whose tilt direction is the note's position
 * on the circle of fifths, so notes a fifth apart run nearly parallel and
 * clashing notes cross.
 */
export const veinVertex = /* glsl */ `
attribute float aU;
attribute float aTheta;
attribute vec3 iAxisA;
attribute vec3 iAxisB;
attribute float iRadius;
attribute float iTube;
attribute vec3 iColor;
attribute float iSeed;
attribute float iLevel;

uniform float uTime;
uniform float uWobble;
uniform float uRadiusScale;

varying vec3 vColor;
varying float vLevel;
varying float vU;
varying float vSeed;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vTaper;

${simplex3d}

// Centre line of the vein at angle a around its ring: a great circle that
// meanders off its plane. Noise is sampled on a circle so the loop has no seam.
vec3 veinCenter(float a, float level) {
  vec3 radial = cos(a) * iAxisA + sin(a) * iAxisB;
  vec3 planeNormal = normalize(cross(iAxisA, iAxisB));
  vec3 loopCoord = vec3(cos(a), sin(a), 0.0);
  float meander = snoise(loopCoord * 1.6 + vec3(iSeed * 3.7, iSeed * 1.3, uTime * 0.09));
  float ripple = snoise(loopCoord * 4.3 + vec3(-iSeed, iSeed * 2.1, uTime * 0.23));
  return radial * (iRadius + 0.012 * ripple * (0.4 + level))
       + planeNormal * (uWobble * (0.16 * meander + 0.035 * ripple * level));
}

void main() {
  float a = aU * 6.28318530718;
  float level = clamp(iLevel, 0.0, 1.5);
  vec3 center = veinCenter(a, level);

  // Frame from the displaced curve itself, so the tube stays round where it
  // meanders instead of flattening into a twisted ribbon.
  vec3 tangent = normalize(veinCenter(a + 0.004, level) - veinCenter(a - 0.004, level));
  vec3 outward = normalize(center);
  vec3 N = normalize(outward - dot(outward, tangent) * tangent);
  vec3 B = cross(tangent, N);

  // Veins taper and bulge along their length and swell when their note sounds.
  vec3 loopCoord = vec3(cos(a), sin(a), 0.0);
  float taper = 0.55 + 0.45 * (0.5 + 0.5 * snoise(loopCoord * 2.2 + vec3(iSeed * 5.1, 7.0, 0.0)));
  float r = iTube * taper * (1.0 + 1.3 * level) * uRadiusScale;
  vec3 offset = cos(aTheta) * N + sin(aTheta) * B;
  vec3 pos = center + r * offset;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vNormalV = normalize(normalMatrix * offset);
  vViewPos = mv.xyz;
  vColor = iColor;
  vLevel = level;
  vU = aU;
  vSeed = iSeed;
  vTaper = taper;
  gl_Position = projectionMatrix * mv;
}
`;

export const veinFragment = /* glsl */ `
uniform float uTime;
uniform float uFlow;

varying vec3 vColor;
varying float vLevel;
varying float vU;
varying float vSeed;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vTaper;

void main() {
  vec3 viewDir = normalize(-vViewPos);
  float facing = abs(dot(normalize(vNormalV), viewDir));
  float core = pow(facing, 1.6);
  float lvl = clamp(vLevel, 0.0, 1.5);
  float awake = smoothstep(0.03, 0.35, lvl); // ('active' is reserved in GLSL ES 3.0)

  // Light travelling along the vein, like sap or a signal: 3 pulses per loop.
  float phase = fract(vU * 3.0 - uTime * uFlow + vSeed);
  float pulse = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.06, 0.42, phase));

  // Dormant: a pale glass filament. Awake: neon with a white-hot core.
  vec3 dormant = vec3(0.74, 0.76, 0.80) * (0.72 + 0.28 * core);
  float glow = lvl * (1.0 + 1.4 * pulse);
  // Keep the tube saturated (only the dominant channel goes past 1 and blooms),
  // with a thin white-hot filament down the middle when the note is loud.
  vec3 neon = vColor * (0.85 + 1.35 * glow) * (0.55 + 0.45 * core);
  neon = mix(neon, vec3(1.0) * (1.2 + 1.5 * glow), pow(core, 10.0) * clamp(lvl - 0.45, 0.0, 1.0) * 0.7);
  vec3 color = mix(dormant, neon, awake);

  float alpha = mix(0.22 + 0.3 * core, 1.0, awake) * smoothstep(0.0, 0.25, vTaper);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Soft coloured haze around awake veins, drawn as a fatter copy of the tube.
 * On a white room, neon reads as colour spilling into the air around the tube
 * more than as a bright halo, so this blends normally rather than additively.
 */
export const veinHaloFragment = /* glsl */ `
uniform float uTime;
uniform float uFlow;

varying vec3 vColor;
varying float vLevel;
varying float vU;
varying float vSeed;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vTaper;

void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float lvl = clamp(vLevel, 0.0, 1.5);
  float phase = fract(vU * 3.0 - uTime * uFlow + vSeed);
  float pulse = smoothstep(0.0, 0.06, phase) * (1.0 - smoothstep(0.06, 0.42, phase));
  float glow = lvl * (1.0 + pulse);
  float alpha = pow(facing, 3.0) * smoothstep(0.08, 0.7, lvl) * (0.18 + 0.14 * glow) * smoothstep(0.0, 0.3, vTaper);
  gl_FragColor = vec4(vColor * (1.0 + 0.5 * glow), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** Inner light of the orb: the "feeling" colour, breathing with the music. */
export const coreVertex = /* glsl */ `
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vPos;
void main() {
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

export const coreFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uEnergy;
uniform float uTime;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vPos;
${simplex3d}
void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float body = pow(facing, 2.2);
  float swirl = 0.5 + 0.5 * snoise(vPos * 3.0 + vec3(0.0, uTime * 0.25, uTime * 0.11));
  float intensity = (0.8 + 3.2 * uEnergy) * (0.6 * body + 0.4 * body * swirl);
  gl_FragColor = vec4(uColor * intensity, body * (0.7 + 0.3 * uEnergy));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
