import { SHAPES, PALETTES } from './Presets.js';

const PALETTE_NAMES = Object.keys(PALETTES);

// Shapes grouped by the kind of sound they suit. Bass-heavy passages pull toward big
// soft bodies, treble-heavy ones toward hard angular geometry, mids toward structures.
const SHAPE_POOLS = {
  low:  [SHAPES.meta, SHAPES.organic, SHAPES.jelly, SHAPES.coral, SHAPES.bloom, SHAPES.sphere, SHAPES.shell],
  mid:  [SHAPES.torus, SHAPES.helix, SHAPES.gyroid, SHAPES.spring, SHAPES.lattice, SHAPES.wave, SHAPES.twist, SHAPES.ripple],
  high: [SHAPES.box, SHAPES.octaStar, SHAPES.menger, SHAPES.cross, SHAPES.pyramid, SHAPES.knot, SHAPES.cage, SHAPES.apollonian, SHAPES.mandelbulb]
};

// Camera setups. Changing the shot is what stops a scene from reading as one long
// static orbit — the same geometry looks like a different piece from a new angle.
export const SHOTS = [
  { dist: 470, height:   40, spin:  0.05, bob: 20 },
  { dist: 380, height:  110, spin: -0.14, bob: 10 },
  { dist: 700, height:  -70, spin:  0.03, bob: 35 },
  { dist: 520, height:  230, spin:  0.10, bob:  6 },
  { dist: 340, height:    0, spin:  0.22, bob: 14 },
  { dist: 620, height:  120, spin: -0.07, bob: 28 }
];

// Everything is scheduled in beats, so changes land with the music instead of on a
// wall-clock timer that drifts against it.
const SCHEDULE = {
  advanceShape: 4,
  palette: 8,
  shot: 8,
  layout: 12,
  preset: 32
};

const rand = (a, b) => a + Math.random() * (b - a);

const pickDifferent = (list, current) => {
  if(list.length < 2) return list[0];
  let v = current;
  while(v === current) v = list[Math.floor(Math.random() * list.length)];
  return v;
};

export default class Director {
  constructor(handlers){
    this.handlers = handlers;
    this.lastFired = { advanceShape: 0, palette: 0, shot: 0, layout: 0, preset: 0 };
    this.enabled = true;
    this.shotIndex = 0;
    this.paletteName = PALETTE_NAMES[0];
    this.lastShape = SHAPES.torus;
    this.tilt = 0;
  }

  // called once per frame with the analyser's beat-aware feature set
  update(features){
    if(!this.enabled || !features) return;
    this.tilt = features.spectralTilt || 0;
    this.midRatio = features.midRatio || 0;

    const beats = features.beatCount || 0;
    // a weak tempo estimate means the grid is guesswork; hold the big changes back
    const confident = (features.beatConfidence || 0) > 0.15;

    for(const key in SCHEDULE){
      // jitter the interval so the show never settles into an obvious loop
      const every = SCHEDULE[key] + (Math.random() < 0.35 ? SCHEDULE[key] : 0);
      if(beats - this.lastFired[key] < every) continue;
      if(!confident && key !== 'advanceShape') continue;
      this.lastFired[key] = beats;
      this[key]();
    }
  }

  _poolForSound(){
    if(this.tilt > 0.2) return SHAPE_POOLS.high;
    if(this.tilt < -0.2) return SHAPE_POOLS.low;
    return this.midRatio > 0.3 ? SHAPE_POOLS.mid : SHAPE_POOLS.low;
  }

  advanceShape(){
    const pool = this._poolForSound();
    this.lastShape = pickDifferent(pool, this.lastShape);
    // the renderer decides which slot is currently hidden, so nothing pops mid-morph
    this.handlers.onShape(this.lastShape);
  }

  shot(){
    this.shotIndex = pickDifferent(SHOTS.map((_, i) => i), this.shotIndex);
    this.handlers.onShot(SHOTS[this.shotIndex]);
  }

  palette(){
    this.paletteName = pickDifferent(PALETTE_NAMES, this.paletteName);
    this.handlers.onPalette(this.paletteName);
  }

  // Splits the field into two bodies in different parts of the frame, or pulls it back
  // into a single centred one. Offsets are also what the camera reframes around.
  layout(){
    const split = Math.random() < 0.55 ? rand(0.7, 1.0) : 0.0;
    const spread = rand(90, 190);
    const angle = rand(0, Math.PI * 2);
    const offA = [Math.cos(angle) * spread, rand(-70, 70), Math.sin(angle) * spread * 0.6];
    const offB = [-offA[0] * rand(0.6, 1.3), rand(-70, 70), -offA[2] * rand(0.6, 1.3)];
    this.handlers.onLayout({
      split,
      offsetA: offA,
      offsetB: offB,
      scaleRatio: rand(0.45, 1.35),
      // frame one of the bodies rather than always centring the whole scene
      lookAt: split > 0 && Math.random() < 0.6 ? (Math.random() < 0.5 ? offA : offB) : [0, 0, 0]
    });
  }

  preset(){ this.handlers.onPreset(); }
}
