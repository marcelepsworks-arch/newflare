// Shared GLSL building blocks (GLSL ES 1.00 — three.js ShaderMaterial dialect).
// Keep everything here dependency-free so any pass can concatenate what it needs.

export const NOISE = `
vec3 hash33(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}
float noise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dot(hash33(i + vec3(0.0,0.0,0.0)), f - vec3(0.0,0.0,0.0)),
            dot(hash33(i + vec3(1.0,0.0,0.0)), f - vec3(1.0,0.0,0.0)), u.x),
        mix(dot(hash33(i + vec3(0.0,1.0,0.0)), f - vec3(0.0,1.0,0.0)),
            dot(hash33(i + vec3(1.0,1.0,0.0)), f - vec3(1.0,1.0,0.0)), u.x), u.y),
    mix(mix(dot(hash33(i + vec3(0.0,0.0,1.0)), f - vec3(0.0,0.0,1.0)),
            dot(hash33(i + vec3(1.0,0.0,1.0)), f - vec3(1.0,0.0,1.0)), u.x),
        mix(dot(hash33(i + vec3(0.0,1.0,1.0)), f - vec3(0.0,1.0,1.0)),
            dot(hash33(i + vec3(1.0,1.0,1.0)), f - vec3(1.0,1.0,1.0)), u.x), u.y), u.z);
}
float fbm3(vec3 p){
  float a = 0.5, s = 0.0;
  for(int i = 0; i < 4; i++){ s += a * noise3(p); p *= 2.02; a *= 0.5; }
  return s;
}
vec3 potential(vec3 p){ return vec3(noise3(p), noise3(p + 31.416), noise3(p - 47.853)); }
vec3 curlNoise(vec3 p){
  const float e = 0.12;
  vec3 dx = vec3(e,0.0,0.0), dy = vec3(0.0,e,0.0), dz = vec3(0.0,0.0,e);
  vec3 px0 = potential(p - dx), px1 = potential(p + dx);
  vec3 py0 = potential(p - dy), py1 = potential(p + dy);
  vec3 pz0 = potential(p - dz), pz1 = potential(p + dz);
  vec3 c = vec3(
    (py1.z - py0.z) - (pz1.y - pz0.y),
    (pz1.x - pz0.x) - (px1.z - px0.z),
    (px1.y - px0.y) - (py1.x - py0.x)
  ) / (2.0 * e);
  float l = length(c);
  return l > 1e-5 ? c / l : vec3(0.0, 1.0, 0.0);
}
`;

// Signed distance field library. Every shape is normalised to roughly unit radius so
// they can be linearly blended into each other without one swallowing the next.
export const SDF = `
float sdSphere(vec3 p){ return length(p) - 1.0; }

float sdTorus(vec3 p){
  vec2 q = vec2(length(p.xz) - 0.75, p.y);
  return length(q) - 0.32;
}

float sdBox(vec3 p){
  vec3 q = abs(p) - vec3(0.72);
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - 0.12;
}

float sdGyroid(vec3 p){
  float shell = length(p) - 1.0;
  float g = (abs(dot(sin(p * 4.0), cos(p.zxy * 4.0))) - 0.35) / 4.0;
  return max(shell, g);
}

float sdOctaStar(vec3 p){
  vec3 a = abs(p);
  float oct = (a.x + a.y + a.z - 1.25) * 0.57735027;
  return max(oct, -(length(p) - 0.55));
}

float sdHelix(vec3 p){
  float ang = atan(p.z, p.x);
  float k = p.y * 3.0 - ang * 1.5;
  k = mod(k + 3.14159265, 6.28318530) - 3.14159265;
  vec2 q = vec2(length(p.xz) - 0.7, k * 0.16);
  return length(q) - 0.16;
}

float sdRipple(vec3 p){
  float r = length(p.xz);
  float h = sin(r * 7.0 - 1.0) * 0.18 * exp(-r * 0.5);
  return max(length(vec3(p.x, p.y - h, p.z)) - 1.0, -(length(p) - 0.35)) * 0.9;
}

float sdBloom(vec3 p){
  float ang = atan(p.z, p.x);
  float petals = 0.78 + 0.3 * sin(ang * 6.0) * cos(p.y * 3.2);
  return length(p) - petals;
}

// id is a uniform (uniform control flow), so the branch is free on every GPU we target
float sdShape(vec3 p, float id){
  if(id < 0.5) return sdSphere(p);
  if(id < 1.5) return sdTorus(p);
  if(id < 2.5) return sdBox(p);
  if(id < 3.5) return sdGyroid(p);
  if(id < 4.5) return sdOctaStar(p);
  if(id < 5.5) return sdHelix(p);
  if(id < 6.5) return sdRipple(p);
  return sdBloom(p);
}
`;

// Morphing field shared by the simulation and the raymarcher so particles and the
// rendered surface are always describing the same object.
export const SDF_FIELD = `
uniform float uShapeA;
uniform float uShapeB;
uniform float uShapeMix;
uniform float uShapeScale;
uniform float uShapeWarp;
uniform float uShapeSpin;
uniform float uAudioDeform;

mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

float shapeField(vec3 world, float time){
  vec3 p = world / uShapeScale;
  p.xz = rot2(time * uShapeSpin) * p.xz;
  p.xy = rot2(time * uShapeSpin * 0.6) * p.xy;
  float d = mix(sdShape(p, uShapeA), sdShape(p, uShapeB), uShapeMix);
  // audio-driven surface displacement keeps the silhouette breathing with the track
  d -= uAudioDeform * 0.35 * sin(p.x * 4.0 + time) * sin(p.y * 4.0 - time * 0.7) * sin(p.z * 4.0);
  d += uShapeWarp * 0.18 * fbm3(p * 1.6 + time * 0.15);
  return d * uShapeScale;
}

vec3 shapeNormal(vec3 world, float time){
  vec2 e = vec2(uShapeScale * 0.01, 0.0);
  return normalize(vec3(
    shapeField(world + e.xyy, time) - shapeField(world - e.xyy, time),
    shapeField(world + e.yxy, time) - shapeField(world - e.yxy, time),
    shapeField(world + e.yyx, time) - shapeField(world - e.yyx, time)
  ));
}
`;

// Cosine palette from DESIGN.md: color(t) = a + b * cos(2*PI*(c*t + d))
export const PALETTE = `
vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d){
  return a + b * cos(6.28318530 * (c * t + d));
}
`;
