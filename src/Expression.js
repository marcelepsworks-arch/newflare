// Maps musical texture onto visual response.
//
// A preset describes a *style*; this decides how hard that style is played moment to
// moment. The rules it encodes:
//
//   quiet and sparse   -> little movement, few elements, the shape holds crisp and still
//   isolated hits      -> each one lands as a visible impulse rather than a smear
//   dense arrangement  -> many elements, faster morphing, the form loosens up
//
// So a solo piano does not look like a wall of drums, and neither looks like silence.
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export default class Expression {
  constructor(){
    this.intensity = 0;    // how loud, relative to the track's own recent peak
    this.complexity = 0;   // how much is going on
    this.density = 0;      // event rate
    this.impulse = 0;      // decaying kick from individual onsets
  }

  update(features, dt){
    if(!features) return;
    // slow followers: visual response should track phrases, not individual frames
    this.intensity += (clamp01(features.energyNorm || 0) - this.intensity) * Math.min(1, dt * 2.5);
    this.complexity += ((features.complexity || 0) - this.complexity) * Math.min(1, dt * 1.2);
    this.density += ((features.density || 0) - this.density) * Math.min(1, dt * 1.5);

    // An isolated hit in a sparse passage should read much louder than the same hit
    // buried in a busy one — that contrast is what makes single sounds legible.
    if(features.onset){
      const isolation = 1.0 - this.density * 0.7;
      const strength = 0.35 + (features.onsetConfidence || 0) * 0.4 + (features.crest || 0) * 0.5;
      this.impulse = Math.min(1.6, this.impulse + strength * isolation);
    }
    this.impulse *= Math.exp(-dt * 3.2);
  }

  // Returns the preset's parameters scaled by how the music is actually playing.
  apply(preset){
    const i = this.intensity, c = this.complexity, d = this.density;
    const hit = this.impulse;

    // amount of motion allowed at all: near-silence should be nearly still
    const motion = clamp01(0.12 + i * 0.88);

    return {
      // fewer things on screen when little is playing; the full count is reserved for
      // arrangements that actually earn it
      particleCount: Math.round(preset.particleCount * (0.18 + c * 0.82)),
      shardCount: Math.round(preset.shardCount * (0.22 + c * 0.78)),

      // movement scales with level, and damping rises as the track thins out
      curl: preset.curl * (0.35 + motion * 0.9 + hit * 0.35),
      swirl: preset.swirl * (0.30 + motion * 0.95),
      damping: lerp(0.997, preset.damping, motion),

      // sparse tonal passages hold the shape crisp; dense ones let it dissolve
      shapeAttract: clamp01(preset.shapeAttract * lerp(1.15, 0.55, c)),
      audioDeform: preset.audioDeform * (0.30 + i * 0.7 + hit * 0.9),

      // busier music morphs and travels faster
      morphScale: 0.35 + d * 1.3 + i * 0.4,
      // a multiplier, so the director's camera shots keep their own character
      camSpinScale: 0.45 + i * 0.85 + d * 0.3,

      // the look follows suit, with hits pushing the highlights
      bloom: preset.bloom * (0.55 + i * 0.6 + hit * 0.45),
      streak: preset.streak * (0.4 + i * 0.8 + hit * 0.7),
      bgIntensity: preset.bgIntensity * (0.55 + i * 0.55 + c * 0.25),
      pointSize: preset.pointSize * (0.7 + hit * 0.6),
      shardScale: preset.shardScale * (0.8 + i * 0.25 + hit * 0.35)
    };
  }
}
