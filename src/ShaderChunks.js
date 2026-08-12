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
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

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

// --- large organic bodies -------------------------------------------------
float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// several big lobes fused by a smooth minimum: one massive organic body
float sdMeta(vec3 p){
  float d = length(p - vec3(0.42, 0.05, 0.0)) - 0.58;
  d = smin(d, length(p - vec3(-0.38, 0.32, 0.18)) - 0.52, 0.38);
  d = smin(d, length(p - vec3(0.08, -0.44, -0.30)) - 0.48, 0.38);
  d = smin(d, length(p) - 0.44, 0.42);
  return d;
}

// soft mass with a noisy skin — deliberately cheap (2 octaves, not full fbm)
float sdOrganic(vec3 p){
  float skin = noise3(p * 1.7) * 0.30 + noise3(p * 3.6) * 0.13;
  return (length(p) - 0.92 - skin) * 0.7;
}

// twisted column: organic ribbon that reads very differently while rotating
float sdTwist(vec3 p){
  float a = p.y * 1.7;
  float c = cos(a), s = sin(a);
  vec3 q = vec3(c * p.x - s * p.z, p.y, s * p.x + c * p.z);
  vec2 t = vec2(length(q.xz) - 0.60, q.y * 0.55);
  return length(vec2(abs(t.x) - 0.16, t.y)) - 0.20;
}

// stacked fused spheres climbing a spiral
float sdCoral(vec3 p){
  float d = 1e9;
  for(int i = 0; i < 5; i++){
    float f = float(i);
    vec3 c = vec3(sin(f * 2.1) * 0.48, f * 0.24 - 0.48, cos(f * 2.1) * 0.48);
    d = smin(d, length(p - c) - (0.44 - f * 0.05), 0.30);
  }
  return d;
}

// --- fractal / lattice bodies --------------------------------------------
float sdMenger(vec3 p){
  float d = sdBox(p);
  float s = 1.0;
  for(int i = 0; i < 3; i++){
    vec3 a = mod(p * s, 2.0) - 1.0;
    s *= 3.0;
    vec3 r = abs(1.0 - 3.0 * abs(a));
    float da = max(r.x, r.y), db = max(r.y, r.z), dc = max(r.z, r.x);
    d = max(d, (min(da, min(db, dc)) - 1.0) / s);
  }
  return d;
}

float sdMandelbulb(vec3 p){
  vec3 w = p * 1.25;
  float m = dot(w, w), dz = 1.0;
  for(int i = 0; i < 4; i++){
    if(m > 4.0) break;
    dz = 8.0 * pow(m, 3.5) * dz + 1.0;
    float r = length(w);
    float b = 8.0 * acos(clamp(w.y / r, -1.0, 1.0));
    float a = 8.0 * atan(w.x, w.z);
    w = p * 1.25 + pow(r, 8.0) * vec3(sin(b) * sin(a), cos(b), sin(b) * cos(a));
    m = dot(w, w);
  }
  return 0.25 * log(m) * sqrt(m) / dz;
}

float sdApollonian(vec3 p){
  float s = 1.1;
  vec3 q = p * 1.3;
  for(int i = 0; i < 6; i++){
    q = -1.0 + 2.0 * fract(0.5 + 0.5 * q);
    float k = 1.15 / dot(q, q);
    q *= k; s *= k;
  }
  return 0.22 * abs(q.y) / s;
}

float sdPyramid(vec3 p){
  vec3 q = p + vec3(0.0, 0.55, 0.0);
  float m = max(abs(q.x), abs(q.z));
  return max(max(m * 0.85 + q.y * 0.5 - 0.62, -q.y - 0.02), q.y - 1.1) * 0.8;
}

float sdCross(vec3 p){
  vec3 a = abs(p);
  float bx = max(a.y, a.z) - 0.22;
  float by = max(a.x, a.z) - 0.22;
  float bz = max(a.x, a.y) - 0.22;
  float arm = min(min(max(bx, a.x - 1.0), max(by, a.y - 1.0)), max(bz, a.z - 1.0));
  return arm;
}

float sdSpring(vec3 p){
  float a = atan(p.z, p.x);
  float k = p.y * 4.0 - a * 2.0;
  k = mod(k + 3.14159265, 6.28318530) - 3.14159265;
  vec2 q = vec2(length(p.xz) - 0.68, k * 0.11);
  return max(length(q) - 0.13, abs(p.y) - 0.95);
}

float sdLattice(vec3 p){
  vec3 c = mod(p * 3.0 + 1.5, 3.0) - 1.5;
  float balls = length(c) / 3.0 - 0.14;
  return max(balls, length(p) - 1.0);
}

float sdWave(vec3 p){
  float h = sin(p.x * 3.4) * cos(p.z * 3.1) * 0.26;
  return max(abs(p.y - h) - 0.12, length(p) - 1.05);
}

float sdShell(vec3 p){
  // logarithmic spiral tube: reads as a seashell
  float a = atan(p.z, p.x);
  float r = length(p.xz);
  float turns = (log(max(r, 0.05)) * 1.6 - a) / 6.28318530;
  float f = fract(turns) - 0.5;
  vec2 q = vec2(f * r * 2.2, p.y - turns * 0.06);
  return (length(q) - 0.16 * r - 0.05) * 0.7;
}

float sdJelly(vec3 p){
  float dome = length(vec3(p.x, max(p.y - 0.1, 0.0) * 1.5, p.z)) - 0.72;
  vec3 t = p; t.y += 0.5;
  t.xz = mod(t.xz + 0.28, 0.56) - 0.28;
  float tendrils = max(length(t.xz) - 0.05, abs(p.y + 0.55) - 0.5);
  return smin(dome, tendrils, 0.18);
}

float sdKnot(vec3 p){
  float a = atan(p.z, p.x);
  vec2 q = vec2(length(p.xz) - 0.68, p.y);
  q = rot2(a * 1.5) * q;
  return length(vec2(abs(q.x) - 0.20, q.y)) - 0.11;
}

float sdCage(vec3 p){
  vec3 a = abs(p) - vec3(0.78);
  float shell = length(max(a, 0.0)) + min(max(a.x, max(a.y, a.z)), 0.0);
  return max(shell - 0.05, -(max(abs(p.x), max(abs(p.y), abs(p.z))) - 0.62));
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
  if(id < 7.5) return sdBloom(p);
  if(id < 8.5) return sdMeta(p);
  if(id < 9.5) return sdOrganic(p);
  if(id < 10.5) return sdTwist(p);
  if(id < 11.5) return sdCoral(p);
  if(id < 12.5) return sdMenger(p);
  if(id < 13.5) return sdMandelbulb(p);
  if(id < 14.5) return sdApollonian(p);
  if(id < 15.5) return sdPyramid(p);
  if(id < 16.5) return sdCross(p);
  if(id < 17.5) return sdSpring(p);
  if(id < 18.5) return sdLattice(p);
  if(id < 19.5) return sdWave(p);
  if(id < 20.5) return sdShell(p);
  if(id < 21.5) return sdJelly(p);
  if(id < 22.5) return sdKnot(p);
  return sdCage(p);
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
uniform float uLiquid;
uniform vec3 uOffsetA;
uniform vec3 uOffsetB;
uniform float uSplit;
uniform float uScaleRatio;
// Multi-band organic equaliser: each frequency band owns a direction on the body and
// swells it from that side. Six lobes fused by the smooth field read as one organism
// breathing with the mix, rather than six separate meters.
uniform vec3 uBandDir[6];
uniform float uBandLevel[6];
uniform float uBandBulge;
uniform float uBandSharp;

// weight of each band at a given surface direction, and the dominant band there
float bandWeight(vec3 dir, int i){
  return pow(max(dot(dir, uBandDir[i]), 0.0), uBandSharp);
}
float bandSwell(vec3 dir){
  float sum = 0.0;
  for(int i = 0; i < 6; i++) sum += uBandLevel[i] * bandWeight(dir, i);
  return sum;
}

// Flowing domain warp: displacing space itself (rather than the surface) is what makes
// any shape read as liquid — it melts and runs instead of just wobbling.
vec3 liquefy(vec3 p, float time){
  if(uLiquid <= 0.001) return p;
  vec3 flow = vec3(
    noise3(p * 1.3 + vec3(time * 0.35, 0.0, 0.0)),
    noise3(p * 1.3 + vec3(11.0, -time * 0.28, 0.0)),
    noise3(p * 1.3 + vec3(23.0, 0.0, time * 0.22))
  );
  return p + flow * uLiquid * 0.45;
}

// The two shape slots are evaluated either as one morphing body (uSplit = 0) or as two
// separate bodies sitting at different offsets (uSplit = 1). Both cases cost the same
// two SDF evaluations, so splitting the scene apart is effectively free.
float shapeField(vec3 world, float time){
  vec3 base = world;
  base.xz = rot2(time * uShapeSpin) * base.xz;
  base.xy = rot2(time * uShapeSpin * 0.6) * base.xy;

  float scaleB = uShapeScale * mix(1.0, uScaleRatio, uSplit);
  vec3 pa = liquefy((base - uOffsetA * uSplit) / uShapeScale, time);
  vec3 pb = liquefy((base - uOffsetB * uSplit) / scaleB, time);

  float da = sdShape(pa, uShapeA) * uShapeScale;
  float db = sdShape(pb, uShapeB) * scaleB;

  float d = mix(mix(da, db, uShapeMix), smin(da, db, 45.0), uSplit);

  // band lobes: cheap directional swell, six dot products rather than six more SDFs
  if(uBandBulge > 0.001){
    vec3 dir = length(base) > 1e-4 ? normalize(base) : vec3(0.0, 1.0, 0.0);
    d -= bandSwell(dir) * uBandBulge * uShapeScale;
  }

  // audio-driven surface displacement keeps the silhouette breathing with the track
  vec3 q = base / uShapeScale;
  d -= uAudioDeform * 0.35 * uShapeScale * sin(q.x * 4.0 + time) * sin(q.y * 4.0 - time * 0.7) * sin(q.z * 4.0);
  d += uShapeWarp * 0.18 * uShapeScale * fbm3(q * 1.6 + time * 0.15);
  return d;
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

// Metallic / iridescent surface response, shared by the raymarched body and the shards
// so both layers read as the same material.
export const MATERIAL = `
// cheap procedural environment: a horizon gradient plus two key lights to reflect
vec3 envSample(vec3 dir, vec3 tint){
  float y = dir.y * 0.5 + 0.5;
  vec3 sky = mix(vec3(0.02, 0.03, 0.06), vec3(0.30, 0.38, 0.52), pow(y, 1.5));
  float key = pow(max(dot(dir, normalize(vec3(0.4, 0.8, 0.3))), 0.0), 28.0);
  float rim = pow(max(dot(dir, normalize(vec3(-0.6, 0.2, -0.7))), 0.0), 10.0);
  return sky * tint * 1.3 + vec3(1.0) * key * 1.8 + tint * rim * 0.7;
}

// thin-film interference: the shifting oil-slick colour that sells "metal"
vec3 iridescence(float cosTheta, float strength){
  vec3 shift = 0.5 + 0.5 * cos(6.28318530 * (3.0 * (1.0 - cosTheta) + vec3(0.0, 0.33, 0.67)));
  return mix(vec3(1.0), shift, strength);
}

float fresnelSchlick(float cosTheta, float f0){
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}
`;
