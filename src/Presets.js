// Cosine palettes: color(t) = a + b * cos(2*PI*(c*t + d))
export const PALETTES = {
  Spectrum: { a:[0.50,0.50,0.50], b:[0.50,0.50,0.50], c:[1.00,1.00,1.00], d:[0.00,0.33,0.67] },
  Neon:     { a:[0.60,0.40,0.55], b:[0.45,0.45,0.45], c:[1.00,1.00,0.60], d:[0.85,0.95,0.30] },
  Gold:     { a:[0.55,0.45,0.32], b:[0.45,0.38,0.28], c:[1.00,0.70,0.40], d:[0.00,0.15,0.20] },
  Ocean:    { a:[0.10,0.42,0.55], b:[0.35,0.35,0.45], c:[0.90,1.00,1.00], d:[0.10,0.20,0.35] },
  Electro:  { a:[0.75,0.45,0.45], b:[0.30,0.40,0.30], c:[2.00,1.00,1.00], d:[0.00,0.25,0.25] },
  Aurora:   { a:[0.25,0.50,0.42], b:[0.45,0.40,0.50], c:[1.00,1.00,0.80], d:[0.30,0.20,0.55] },
  Ember:    { a:[0.55,0.30,0.22], b:[0.45,0.30,0.20], c:[1.00,1.00,1.00], d:[0.00,0.10,0.20] },
  Ultra:    { a:[0.45,0.35,0.60], b:[0.45,0.35,0.45], c:[1.00,0.80,1.20], d:[0.60,0.40,0.20] }
};

// Shape ids match sdShape() in ShaderChunks.js
export const SHAPES = {
  sphere:0, torus:1, box:2, gyroid:3, octaStar:4, helix:5, ripple:6, bloom:7,
  meta:8, organic:9, twist:10, coral:11, menger:12, mandelbulb:13, apollonian:14,
  pyramid:15, cross:16, spring:17, lattice:18, wave:19, shell:20, jelly:21,
  knot:22, cage:23
};

const NUMERIC_KEYS = [
  'shapeMix','shapeScale','shapeWarp','shapeSpin','audioDeform','shapeAttract','swirl',
  'noiseScale','curl','damping','pointSize','particleOpacity','particleCount',
  'shardScale','shardCount','shardOpacity','raymarchOpacity','glow',
  'trailDecay','feedbackZoom','feedbackRotate','bloom','exposure','chroma','vignette',
  'camDist','camSpin','camBob',
  'liquid','metal','irid','streak','rays','ghosts','grain'
];
const SNAP_KEYS = ['shapeA','shapeB','shardShape'];

const DEFAULTS = {
  palette: 'Spectrum',
  shapeA: SHAPES.sphere, shapeB: SHAPES.torus, shapeMix: 0.0,
  shapeScale: 120.0, shapeWarp: 0.0, shapeSpin: 0.12, audioDeform: 0.35,
  shapeAttract: 0.5, swirl: 0.5,
  noiseScale: 0.0025, curl: 1.2, damping: 0.985,
  pointSize: 2.0, particleOpacity: 0.8, particleCount: 32768,
  shardShape: 'icosa', shardScale: 2.4, shardCount: 1400, shardOpacity: 1.0,
  raymarchOpacity: 1.0, glow: 1.0,
  trailDecay: 0.88, feedbackZoom: 1.0, feedbackRotate: 0.0,
  bloom: 0.9, exposure: 1.15, chroma: 0.0018, vignette: 0.35,
  camDist: 480, camSpin: 0.05, camBob: 18,
  liquid: 0.0, metal: 0.6, irid: 0.5,
  streak: 0.30, rays: 0.18, ghosts: 0.12, grain: 0.045
};

// Each preset is a different *kind* of animation, not just a recolour: some are dominated
// by the solid raymarched body, some by flying polyhedra, some by the particle veil.
const PRESET_LIST = [
  { name:'Monolith', palette:'Ultra', shapeA:SHAPES.box, shapeB:SHAPES.octaStar, shapeMix:0.15,
    shapeScale:130, shapeSpin:0.10, audioDeform:0.5, shapeAttract:0.75, swirl:0.77,
    raymarchOpacity:1.0, glow:0.8, shardShape:'box', shardScale:2.9, shardCount:900,
    particleCount:12000, pointSize:1.6, particleOpacity:0.45, trailDecay:0.82, bloom:0.8, camDist:510 },

  { name:'Toroid', palette:'Neon', shapeA:SHAPES.torus, shapeB:SHAPES.helix, shapeMix:0.0,
    shapeScale:135, shapeSpin:0.28, audioDeform:0.3, shapeAttract:0.9, swirl:3.00,
    raymarchOpacity:0.85, glow:1.1, shardShape:'blade', shardScale:2.2, shardCount:2600,
    particleCount:26000, pointSize:1.4, particleOpacity:0.7, trailDecay:0.9, feedbackRotate:0.004,
    bloom:1.1, camDist:450, camSpin:0.12 },

  { name:'Gyroid', palette:'Aurora', shapeA:SHAPES.gyroid, shapeB:SHAPES.sphere, shapeMix:0.1,
    shapeScale:150, shapeSpin:0.06, shapeWarp:0.25, audioDeform:0.6, shapeAttract:0.95, swirl:1.98,
    raymarchOpacity:1.0, glow:0.9, shardShape:'tetra', shardScale:1.7, shardCount:3000,
    particleCount:18000, pointSize:1.2, particleOpacity:0.5, trailDecay:0.86, bloom:1.0, camDist:495 },

  { name:'Bloom', palette:'Ember', shapeA:SHAPES.bloom, shapeB:SHAPES.ripple, shapeMix:0.25,
    shapeScale:125, shapeSpin:0.18, audioDeform:0.75, shapeAttract:0.8, swirl:2.42,
    raymarchOpacity:0.95, glow:1.3, shardShape:'octa', shardScale:2.4, shardCount:1600,
    particleCount:22000, pointSize:2.0, particleOpacity:0.65, trailDecay:0.9, bloom:1.3,
    chroma:0.003, camDist:435 },

  { name:'Shatter', palette:'Electro', shapeA:SHAPES.octaStar, shapeB:SHAPES.box, shapeMix:0.5,
    shapeScale:115, shapeSpin:0.35, audioDeform:0.9, shapeAttract:0.25, swirl:0.88,
    curl:2.6, damping:0.965, raymarchOpacity:0.5, glow:0.7,
    shardShape:'tetra', shardScale:3.6, shardCount:3000, particleCount:14000,
    pointSize:2.4, particleOpacity:0.6, trailDecay:0.78, bloom:1.2, chroma:0.004, camDist:450 },

  { name:'Helix', palette:'Ocean', shapeA:SHAPES.helix, shapeB:SHAPES.torus, shapeMix:0.2,
    shapeScale:140, shapeSpin:0.4, audioDeform:0.35, shapeAttract:0.95, swirl:3.00,
    raymarchOpacity:0.8, glow:1.0, shardShape:'blade', shardScale:1.9, shardCount:2400,
    particleCount:24000, pointSize:1.3, particleOpacity:0.7, trailDecay:0.92,
    feedbackZoom:1.004, bloom:1.0, camDist:465, camSpin:0.18 },

  { name:'Ripple', palette:'Gold', shapeA:SHAPES.ripple, shapeB:SHAPES.sphere, shapeMix:0.35,
    shapeScale:145, shapeSpin:0.05, shapeWarp:0.15, audioDeform:0.85, shapeAttract:0.9, swirl:1.54,
    raymarchOpacity:1.0, glow:1.2, shardShape:'icosa', shardScale:1.6, shardCount:1200,
    particleCount:20000, pointSize:1.5, particleOpacity:0.55, trailDecay:0.93,
    feedbackZoom:1.006, bloom:1.1, vignette:0.45, camDist:450 },

  { name:'Swarm', palette:'Spectrum', shapeA:SHAPES.sphere, shapeB:SHAPES.gyroid, shapeMix:0.6,
    shapeScale:160, shapeSpin:0.08, audioDeform:0.4, shapeAttract:0.15, swirl:0.66,
    curl:2.2, noiseScale:0.004, damping:0.99, raymarchOpacity:0.35, glow:0.6,
    shardShape:'icosa', shardScale:1.4, shardCount:2200, particleCount:32768,
    pointSize:1.8, particleOpacity:0.85, trailDecay:0.94, bloom:1.0, camDist:510 },

  { name:'Vault', palette:'Ultra', shapeA:SHAPES.box, shapeB:SHAPES.gyroid, shapeMix:0.4,
    shapeScale:170, shapeSpin:0.03, shapeWarp:0.3, audioDeform:0.5, shapeAttract:0.85, swirl:1.10,
    raymarchOpacity:1.0, glow:0.75, shardShape:'box', shardScale:2.2, shardCount:1400,
    particleCount:16000, pointSize:1.4, particleOpacity:0.5, trailDecay:0.85,
    feedbackZoom:0.997, bloom:0.85, exposure:1.02, camDist:540 },

  { name:'Pulsar', palette:'Neon', shapeA:SHAPES.sphere, shapeB:SHAPES.bloom, shapeMix:0.5,
    shapeScale:110, shapeSpin:0.22, audioDeform:1.1, shapeAttract:0.6, swirl:3.00,
    raymarchOpacity:0.9, glow:1.4, shardShape:'octa', shardScale:2.6, shardCount:2000,
    particleCount:20000, pointSize:2.2, particleOpacity:0.75, trailDecay:0.9,
    feedbackRotate:-0.005, bloom:1.35, chroma:0.0035, camDist:420, camSpin:0.1 },

  { name:'Mercury', palette:'Ultra', shapeA:SHAPES.meta, shapeB:SHAPES.organic, shapeMix:0.4,
    shapeScale:145, shapeSpin:0.07, audioDeform:0.5, shapeAttract:0.9, swirl:1.2,
    liquid:0.55, metal:0.95, irid:0.75, raymarchOpacity:1.0, glow:0.7,
    shardShape:'icosa', shardScale:2.0, shardCount:1200, particleCount:14000,
    pointSize:1.3, particleOpacity:0.4, trailDecay:0.86, bloom:1.0, streak:0.46,
    rays:0.25, camDist:470, camSpin:0.06 },

  { name:'Lava', palette:'Ember', shapeA:SHAPES.organic, shapeB:SHAPES.jelly, shapeMix:0.3,
    shapeScale:150, shapeSpin:0.04, shapeWarp:0.2, audioDeform:0.9, shapeAttract:0.85, swirl:1.6,
    liquid:0.85, metal:0.25, irid:0.3, raymarchOpacity:1.0, glow:1.4,
    shardShape:'octa', shardScale:2.2, shardCount:1000, particleCount:22000,
    pointSize:1.8, particleOpacity:0.6, trailDecay:0.92, bloom:1.3, streak:0.25,
    rays:0.35, grain:0.06, camDist:460 },

  { name:'Chrome', palette:'Ocean', shapeA:SHAPES.menger, shapeB:SHAPES.cage, shapeMix:0.25,
    shapeScale:160, shapeSpin:0.09, audioDeform:0.35, shapeAttract:0.9, swirl:0.9,
    liquid:0.1, metal:1.0, irid:0.65, raymarchOpacity:1.0, glow:0.6,
    shardShape:'box', shardScale:1.8, shardCount:1800, particleCount:16000,
    pointSize:1.2, particleOpacity:0.45, trailDecay:0.84, bloom:0.9, streak:0.55,
    rays:0.20, chroma:0.0026, camDist:520 },

  { name:'Nautilus', palette:'Gold', shapeA:SHAPES.shell, shapeB:SHAPES.coral, shapeMix:0.35,
    shapeScale:150, shapeSpin:0.13, audioDeform:0.55, shapeAttract:0.92, swirl:1.4,
    liquid:0.35, metal:0.8, irid:0.85, raymarchOpacity:1.0, glow:1.0,
    shardShape:'blade', shardScale:1.7, shardCount:2000, particleCount:20000,
    pointSize:1.4, particleOpacity:0.55, trailDecay:0.9, bloom:1.1, streak:0.38,
    rays:0.23, camDist:480, camSpin:0.11 },

  { name:'Fractal', palette:'Aurora', shapeA:SHAPES.mandelbulb, shapeB:SHAPES.apollonian, shapeMix:0.3,
    shapeScale:135, shapeSpin:0.05, audioDeform:0.4, shapeAttract:0.95, swirl:0.8,
    liquid:0.2, metal:0.7, irid:0.6, raymarchOpacity:1.0, glow:0.85,
    shardShape:'tetra', shardScale:1.5, shardCount:2400, particleCount:18000,
    pointSize:1.1, particleOpacity:0.5, trailDecay:0.88, bloom:1.0, streak:0.34,
    rays:0.28, camDist:500 },

  { name:'Liquid', palette:'Neon', shapeA:SHAPES.twist, shapeB:SHAPES.wave, shapeMix:0.5,
    shapeScale:155, shapeSpin:0.16, audioDeform:0.8, shapeAttract:0.8, swirl:2.0,
    liquid:1.0, metal:0.55, irid:0.9, raymarchOpacity:0.95, glow:1.2,
    shardShape:'icosa', shardScale:1.6, shardCount:2600, particleCount:26000,
    pointSize:1.5, particleOpacity:0.65, trailDecay:0.93, feedbackZoom:1.003,
    bloom:1.2, streak:0.50, rays:0.30, chroma:0.003, camDist:450, camSpin:0.14 }
];

const lerp = (a, b, t) => a + (b - a) * t;
const lerpArr = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

export default class PresetManager {
  constructor(apply){
    this.apply = apply;
    this.presets = PRESET_LIST.map(p => Object.assign({}, DEFAULTS, p));
    this.index = 0;
    this.current = Object.assign({}, this.presets[0]);
    this.start = Object.assign({}, this.presets[0]);
    this.target = Object.assign({}, this.presets[0]);
    this.timer = 0;
    this.duration = 0;
    this.applyCurrent();
  }

  get name(){ return this.presets[this.index].name; }

  _transitionTo(index, duration){
    this.index = index;
    this.start = Object.assign({}, this.current);
    this.target = Object.assign({}, this.presets[index]);
    this.timer = 0;
    this.duration = Math.max(0.01, duration);
  }

  next(duration = 1.2){ this._transitionTo((this.index + 1) % this.presets.length, duration); }

  select(name, duration = 1.2){
    const idx = this.presets.findIndex(p => p.name === name);
    if(idx >= 0) this._transitionTo(idx, duration);
  }

  step(dt){
    if(this.duration <= 0) return;
    this.timer += dt;
    const t = Math.min(1.0, this.timer / this.duration);
    const e = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;

    const cur = {};
    for(const k of NUMERIC_KEYS) cur[k] = lerp(this.start[k], this.target[k], e);
    // ids and geometry names cannot be interpolated: swap them at the crossfade midpoint
    for(const k of SNAP_KEYS) cur[k] = e < 0.5 ? this.start[k] : this.target[k];

    const pa = PALETTES[this.start.palette] || PALETTES.Spectrum;
    const pb = PALETTES[this.target.palette] || PALETTES.Spectrum;
    cur.palette = this.target.palette;
    cur.paletteValues = {
      a: lerpArr(pa.a, pb.a, e), b: lerpArr(pa.b, pb.b, e),
      c: lerpArr(pa.c, pb.c, e), d: lerpArr(pa.d, pb.d, e)
    };

    this.current = cur;
    this.apply(cur);
    if(t >= 1.0) this.duration = 0;
  }

  applyCurrent(){
    const p = Object.assign({}, this.current);
    const pal = PALETTES[p.palette] || PALETTES.Spectrum;
    p.paletteValues = { a: pal.a.slice(), b: pal.b.slice(), c: pal.c.slice(), d: pal.d.slice() };
    this.apply(p);
  }
}
