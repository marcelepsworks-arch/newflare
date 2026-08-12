export default class PresetManager {
  constructor(particlesSystem){
    this.system = particlesSystem;
    this.presets = this._buildPresets();
    this.index = 0;
    this.current = Object.assign({}, this.presets[0]);
    this.target = Object.assign({}, this.presets[0]);
    this.start = Object.assign({}, this.presets[0]);
    this.timer = 0;
    this.duration = 0;
  }

  _buildPresets(){
    // A selection of diverse presets tuned for rich motion graphics
    return [
      { name:'DeepPulse', noiseScale:0.002, curl:1.6, damping:0.98, color:0x00ffd5, pointSize:2.5, explode:0.0, attractor:[0,0,0], trailDecay:0.94 },
      { name:'GlassSwirl', noiseScale:0.0035, curl:2.4, damping:0.985, color:0xff7fd4, pointSize:1.8, explode:0.0, attractor:[10, -20, 0], trailDecay:0.92 },
      { name:'StrobeFlux', noiseScale:0.0012, curl:0.9, damping:0.96, color:0xffffff, pointSize:3.6, explode:0.0, attractor:[0,0,0], trailDecay:0.88 },
      { name:'Magnetic', noiseScale:0.0028, curl:1.2, damping:0.99, color:0x7afcff, pointSize:2.2, explode:0.0, attractor:[-30,10,20], trailDecay:0.95 },
      { name:'Vortex', noiseScale:0.0018, curl:3.2, damping:0.98, color:0xffb86b, pointSize:1.6, explode:0.0, attractor:[0,0,0], trailDecay:0.9 },
      { name:'Nebula', noiseScale:0.003, curl:1.0, damping:0.992, color:0x6b5bff, pointSize:1.2, explode:0.0, attractor:[20,-10,30], trailDecay:0.97 },
      { name:'Explode', noiseScale:0.0008, curl:0.6, damping:0.9, color:0xff3b3b, pointSize:4.2, explode:3.0, attractor:[0,0,0], trailDecay:0.84 },
      { name:'CalmFlow', noiseScale:0.0045, curl:0.8, damping:0.995, color:0x9df5c8, pointSize:1.0, explode:0.0, attractor:[-10,5,0], trailDecay:0.99 },
      { name:'MetallicPipes', noiseScale:0.0022, curl:1.8, damping:0.975, color:0xb7f0ff, pointSize:2.0, explode:0.0, attractor:[0,0,-40], trailDecay:0.91 },
      { name:'GlassShatter', noiseScale:0.0010, curl:4.0, damping:0.94, color:0xffe47a, pointSize:3.8, explode:1.6, attractor:[0,0,0], trailDecay:0.86 },
      { name:'Aurora', noiseScale:0.0032, curl:1.1, damping:0.99, color:0x42ffb8, pointSize:1.6, explode:0.0, attractor:[-40,30,10], trailDecay:0.96 },
      { name:'PulseField', noiseScale:0.0016, curl:2.0, damping:0.97, color:0xff66ff, pointSize:2.8, explode:0.0, attractor:[0,0,0], trailDecay:0.9 }
    ];
  }

  _lerp(a,b,t){
    return a + (b-a)*t;
  }

  _lerpVec(a,b,t){
    return [ this._lerp(a[0],b[0],t), this._lerp(a[1],b[1],t), this._lerp(a[2],b[2],t) ];
  }

  next(duration = 0.6){
    this.index = (this.index + 1) % this.presets.length;
    this.start = Object.assign({}, this.current);
    this.target = Object.assign({}, this.presets[this.index]);
    this.timer = 0;
    this.duration = Math.max(0.01, duration);
  }

  step(dt){
    if(this.duration <= 0){
      // direct apply
      this.current = Object.assign({}, this.target);
      this._applyToSystem(this.current);
      return;
    }
    this.timer += dt;
    let t = Math.min(1.0, this.timer / this.duration);
    // ease in-out cubic
    const ease = t<0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
    const cur = {};
    cur.noiseScale = this._lerp(this.start.noiseScale, this.target.noiseScale, ease);
    cur.curl = this._lerp(this.start.curl, this.target.curl, ease);
    cur.damping = this._lerp(this.start.damping, this.target.damping, ease);
    cur.pointSize = this._lerp(this.start.pointSize || 2.0, this.target.pointSize || 2.0, ease);
    cur.color = Math.round(this._lerp((this.start.color||0), (this.target.color||0), ease));
    cur.explode = this._lerp(this.start.explode||0, this.target.explode||0, ease);
    cur.attractor = this._lerpVec(this.start.attractor||[0,0,0], this.target.attractor||[0,0,0], ease);
    cur.trailDecay = this._lerp(this.start.trailDecay||0.95, this.target.trailDecay||0.95, ease);
    this.current = cur;
    this._applyToSystem(cur);
    if(t>=1.0) this.duration = 0;
  }

  _applyToSystem(p){
    if(!this.system) return;
    this.system.setParams({ noiseScale: p.noiseScale, curl: p.curl, damping: p.damping, pointSize: p.pointSize, color: p.color, explode: p.explode, attractor: p.attractor, trailDecay: p.trailDecay });
  }

  // allow selecting a preset by name
  select(name, duration=0.6){
    const idx = this.presets.findIndex(x=>x.name===name);
    if(idx>=0){ this.index = idx; this.next(duration); }
  }
}
