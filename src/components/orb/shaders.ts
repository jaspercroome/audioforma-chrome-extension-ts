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
 * Veins: one instanced tube per note and octave, built in the vertex shader.
 *
 * Each vein is a meridian on its octave's shell (radius = octave), at the
 * note's azimuth on the circle of fifths. Along its length it is a timeline:
 * the equator is now, and the note's level over the last few seconds is read
 * from a history texture and streams toward both poles. So a held note is a
 * long, even vein; a repeated note is a string of beads flowing outward; and
 * each attack flashes white at the equator as it happens.
 */
export const veinVertex = /* glsl */ `
attribute float aU;       // 0..1 along the vein, pole to pole through the equator
attribute float aTheta;   // around the tube
attribute float iPhi;     // azimuth: the note's place on the circle of fifths
attribute float iOctaveT; // 0..1 from the innermost to the outermost octave
attribute float iTube;
attribute vec3 iColor;
attribute float iSeed;
attribute float iRow;     // this vein's row in the history texture
attribute float iFlash;   // attack flash, 0..1

uniform sampler2D uHistory;
uniform float uRows;
uniform float uColumns;
uniform float uHead;      // index of the head column, which holds "now"
uniform float uCarry;     // 0-1: how far time has run into the next column
uniform float uSpan;      // fraction of the texture covered by the whole history
uniform float uLatMax;
uniform float uInner;
uniform float uReach;
uniform float uCurve;
uniform float uSpread;
uniform float uTime;
uniform float uRadiusScale;

varying vec3 vColor;
varying float vLevel;
varying float vFlash;
varying float vS;
varying vec3 vNormalV;
varying vec3 vViewPos;

${simplex3d}

float levelAt(float s) {
  // Columns ago. The column behind the head was last written uCarry columns
  // ago and older ones follow one per column; in between, blend from the live
  // head column back to it. So the past slides smoothly rather than stepping.
  float ago = s * uSpan * uColumns;
  float column = ago < uCarry ? uHead - ago / max(uCarry, 1e-3) : uHead - 1.0 - (ago - uCarry);
  return texture2D(uHistory, vec2((column + 0.5) / uColumns, (iRow + 0.5) / uRows)).r;
}

vec3 veinPoint(float u) {
  float signedS = 2.0 * u - 1.0;
  float s = abs(signedS);
  float lat = signedS * uLatMax;
  float r = uInner + uReach * uSpread * pow(iOctaveT, uCurve);
  // A slow organic meander that grows toward the tips.
  float wander = snoise(vec3(s * 2.6 + iSeed * 5.0, iSeed * 3.1, uTime * 0.11)) * 0.06 * (0.25 + s);
  float phi = iPhi + wander;
  return r * vec3(cos(lat) * cos(phi), sin(lat), cos(lat) * sin(phi));
}

void main() {
  vec3 center = veinPoint(aU);
  vec3 tangent = normalize(veinPoint(aU + 0.003) - veinPoint(aU - 0.003));
  vec3 outward = normalize(center);
  vec3 N = normalize(outward - dot(outward, tangent) * tangent);
  vec3 B = cross(tangent, N);

  float s = abs(2.0 * aU - 1.0);
  float level = levelAt(s);
  float flash = iFlash * exp(-s * 16.0);
  float thickness = iTube * (0.3 + 2.2 * level + 0.8 * flash) * (1.0 - 0.5 * s) * uRadiusScale;
  vec3 offset = cos(aTheta) * N + sin(aTheta) * B;
  vec3 pos = center + thickness * offset;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vNormalV = normalize(normalMatrix * offset);
  vViewPos = mv.xyz;
  vColor = iColor;
  vLevel = level;
  vFlash = flash;
  vS = s;
  gl_Position = projectionMatrix * mv;
}
`;

export const veinFragment = /* glsl */ `
varying vec3 vColor;
varying float vLevel;
varying float vFlash;
varying float vS;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float core = pow(facing, 1.6);
  float lvl = clamp(vLevel, 0.0, 1.0);
  // Colour arrives with the first trace of sound and opacity follows loudness,
  // so a faint note is a faint thread of its colour rather than something that
  // pops between grey and neon as its level wavers.
  float tint = smoothstep(0.0, 0.05, lvl + vFlash);
  float awake = smoothstep(0.02, 0.22, lvl + vFlash); // ('active' is reserved in GLSL ES 3.0)

  // Dormant: a faint glass filament, so the orb's structure shows but stays quiet.
  vec3 dormant = vec3(0.7, 0.73, 0.78) * (0.7 + 0.3 * core);
  // Awake: saturated neon, kept near 1 in the dominant channel (brighter values
  // get desaturated by the tone mapper and read pastel on the white room).
  // A struck note brightens briefly toward white at the equator.
  vec3 neon = vColor * (1.0 + 0.5 * lvl) * (0.55 + 0.45 * core);
  neon = mix(neon, vec3(1.15 + 0.35 * vFlash), clamp(vFlash * 0.6, 0.0, 0.5) * (0.3 + 0.7 * core));
  vec3 color = mix(dormant, neon, tint);

  float tips = 1.0 - smoothstep(0.72, 1.0, vS);
  float alpha = mix(0.08 + 0.08 * core, 1.0, awake) * tips;
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
varying vec3 vColor;
varying float vLevel;
varying float vFlash;
varying float vS;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  float lvl = clamp(vLevel + vFlash, 0.0, 1.2);
  float tips = 1.0 - smoothstep(0.65, 1.0, vS);
  float alpha = pow(facing, 3.0) * smoothstep(0.1, 0.7, lvl) * (0.08 + 0.1 * lvl) * tips;
  gl_FragColor = vec4(vColor * (1.0 + 0.6 * lvl), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * Beat lines on the glass. Each drum hit starts a ring at the equator that
 * travels toward both poles at the same speed as the veins' history, so the
 * rings form a moving beat grid you can line notes up against. Kicks draw
 * wide rings, snares medium, hats fine ones.
 */
export const MAX_BEAT_LINES = 16;
export const beatVertex = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewPos;
void main() {
  vPos = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

export const beatFragment = /* glsl */ `
uniform vec4 uLines[${MAX_BEAT_LINES}]; // start time, strength, width (radians), active
uniform float uTime;
uniform float uLatMax;
uniform float uHistorySeconds;
uniform float uTravel; // 1: rings travel poleward with the history; 0: they fade at the equator
uniform float uFade;   // seconds
uniform float uLife;   // seconds
varying vec3 vPos;
varying vec3 vNormalV;
varying vec3 vViewPos;

void main() {
  float lat = abs(asin(clamp(normalize(vPos).y, -1.0, 1.0)));
  float glint = 0.0;
  float groove = 0.0;
  for (int i = 0; i < ${MAX_BEAT_LINES}; i++) {
    vec4 line = uLines[i];
    if (line.w < 0.5) continue;
    float age = uTime - line.x;
    if (age < 0.0 || age > uLife) continue;
    float front = uTravel * age / uHistorySeconds * uLatMax;
    float d = (lat - front) / line.z;
    float fade = line.y * exp(-age / uFade) * (1.0 - smoothstep(0.7, 1.0, age / uLife));
    glint += fade * exp(-d * d * 2.0);
    groove += fade * exp(-(d + 1.1) * (d + 1.1) * 2.0);
  }
  float facing = abs(dot(normalize(vNormalV), normalize(-vViewPos)));
  // Strongest toward the silhouette, faint where the glass faces the camera,
  // so the rings frame the veins instead of fogging them.
  float rim = 0.3 + 0.7 * pow(1.0 - facing, 0.8);
  // Graphite rings with a soft trailing shadow: dark enough to read against a
  // white room, like latitude lines etched into the glass.
  vec3 color = mix(vec3(0.3, 0.33, 0.4), vec3(0.12, 0.13, 0.17), glint / (glint + groove + 1e-4));
  float alpha = clamp(1.25 * glint + 0.3 * groove, 0.0, 0.8) * rim;
  gl_FragColor = vec4(color, alpha);
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
