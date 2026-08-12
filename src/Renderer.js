import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import ParticlesGPGPU from './ParticlesGPGPU.js';
import ShardsLayer from './ShardsLayer.js';
import RaymarchLayer from './RaymarchLayer.js';
import PostFX from './PostFX.js';
import BackgroundLayer from './BackgroundLayer.js';
import PresetManager, { PALETTES, SHAPES } from './Presets.js';
import Director, { SHOTS } from './Director.js';
import Expression from './Expression.js';
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.18.0/dist/lil-gui.esm.min.js';

const SHAPE_NAMES = Object.keys(SHAPES);
const lerp = (a, b, t) => a + (b - a) * t;

export default class Renderer {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = null;
    this.animating = false;
    this._lastTime = 0;
    this._energy = 0;
    this._bass = 0;
    this._morphPhase = 0;
  }

  async init(){
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias:false, preserveDrawingBuffer:true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.autoClear = false;

    this._installLogHelpers();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 4000);
    this.camera.position.set(0, 0, 320);

    this.particlesSystem = new ParticlesGPGPU(this.renderer, { count: 32768 });
    await this.particlesSystem.init();
    this.scene.add(this.particlesSystem.particlesMesh);

    if(!this.particlesSystem.simpleFallback){
      this.shards = new ShardsLayer({ count: 3000 });
      this.scene.add(this.shards.init(this.particlesSystem.texWidth, this.particlesSystem.texHeight));
      this.raymarch = new RaymarchLayer(this.renderer, 0.5);
    }

    this.background = new BackgroundLayer();
    this.postfx = new PostFX(this.renderer);

    // live palette + camera state must exist before PresetManager applies its first preset
    const first = PALETTES.Ink;
    this._palette = { a: first.a.slice(), b: first.b.slice(), c: first.c.slice(), d: first.d.slice() };
    this._paletteTarget = { a: first.a.slice(), b: first.b.slice(), c: first.c.slice(), d: first.d.slice() };
    this._camAngle = 0;
    this._shot = Object.assign({}, SHOTS[0]);
    this._shotTarget = Object.assign({}, SHOTS[0]);

    this.presetManager = new PresetManager((p) => this.applyPreset(p));

    this._hue = 0;
    this._mix = 0;
    this.expression = new Expression();
    // layout state is interpolated: bodies drift to their new places instead of teleporting
    this._layout = { split: 0, offsetA: [0,0,0], offsetB: [0,0,0], scaleRatio: 1 };
    this._layoutTarget = { split: 0, offsetA: [0,0,0], offsetB: [0,0,0], scaleRatio: 1 };
    this._look = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();

    this.director = new Director({
      onShape: (id) => this.advanceShape(id),
      onLayout: (l) => {
        this._layoutTarget = { split: l.split, offsetA: l.offsetA, offsetB: l.offsetB, scaleRatio: l.scaleRatio };
        this._lookTarget.fromArray(l.lookAt);
      },
      onShot: (shot) => { this._shotTarget = Object.assign({}, shot); },
      onPalette: (name) => this.setPalette(name),
      onPreset: () => this.cyclePreset()
    });

    window.addEventListener('resize', ()=>this.onResize());
    this._bindPointer();
    this._buildGui();
  }

  // Mouse control. Drag orbits, wheel dollies, moving the pointer drives a force field
  // through the particles, and clicking throws the scene into a new shape.
  _bindPointer(){
    const el = this.canvas;
    this._pointer = new THREE.Vector2();
    this._mouseWorld = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
    this._plane = new THREE.Plane();
    this._camDir = new THREE.Vector3();
    this._mouseActive = false;
    this._dragging = false;
    this._dragMoved = 0;
    this._userDist = 0;
    this._burst = 0;

    const setPointer = (e)=>{
      const r = el.getBoundingClientRect();
      this._pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this._mouseActive = true;
    };

    el.addEventListener('pointermove', (e)=>{
      setPointer(e);
      if(this._dragging){
        this._dragMoved += Math.abs(e.movementX) + Math.abs(e.movementY);
        this._camAngle -= e.movementX * 0.005;
        this._shot.height = Math.max(-320, Math.min(320, this._shot.height - e.movementY * 1.2));
      }
    });
    el.addEventListener('pointerdown', (e)=>{ setPointer(e); this._dragging = true; this._dragMoved = 0; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointerup', (e)=>{
      this._dragging = false;
      // a press without movement is a click: re-roll the shape and kick the field
      if(this._dragMoved < 6){
        this.director.advanceShape();
        this._burst = 1.0;
      }
      try{ el.releasePointerCapture(e.pointerId); }catch(_){}
    });
    el.addEventListener('pointerleave', ()=>{ this._mouseActive = false; this._dragging = false; });
    el.addEventListener('wheel', (e)=>{
      e.preventDefault();
      this._userDist = Math.max(-260, Math.min(500, this._userDist + e.deltaY * 0.35));
    }, { passive: false });
  }

  _stepPointer(dt){
    if(!this._pointer) return;
    // project the pointer onto the plane through the look target, facing the camera
    this.camera.getWorldDirection(this._camDir);
    this._plane.setFromNormalAndCoplanarPoint(this._camDir, this._look);
    this._raycaster.setFromCamera(this._pointer, this.camera);
    if(this._raycaster.ray.intersectPlane(this._plane, this._mouseWorld)){
      // repel while dragging, attract otherwise; the beat pulse makes the grip breathe
      const dir = this._dragging ? -1 : 1;
      const strength = this._mouseActive ? dir * (0.5 + this._pulse * 0.8) : 0;
      this.particlesSystem.setParams({ mouse: this._mouseWorld, mouseForce: strength + this._burst * 4.0 });
    }
    this._burst = Math.max(0, this._burst - dt * 2.0);
  }

  applyPreset(p){
    const palette = p.paletteValues;
    if(palette) this._paletteTarget = palette;
    this.particlesSystem.setParams(Object.assign({}, p, { palette: this._palette }));
    if(this.shards) this.shards.setParams(Object.assign({}, p, { palette: this._palette }));
    if(this.raymarch) this.raymarch.setShape(Object.assign({}, p, { palette: this._palette }));
    this.postfx.setParams(p);
    this.background.setParams(p);
    this._shotTarget.dist = p.camDist;
    this._shotTarget.spin = p.camSpin;
    this._shotTarget.bob = p.camBob;
  }

  _stepPalette(dt, features){
    const t = Math.min(1, dt * 1.2);
    for(const key of ['a','b','c','d']){
      const cur = this._palette[key], tgt = this._paletteTarget[key];
      for(let i=0;i<3;i++) cur[i] = lerp(cur[i], tgt[i], t);
    }

    // The phase term of the cosine palette *is* the dominant hue. Sliding it every frame
    // — faster when the track is loud, kicked on each beat — keeps the colour moving
    // instead of holding one scheme until the next palette change.
    const energy = this._energy || 0;
    const tilt = (features && features.spectralTilt) || 0;
    this._hue += dt * (0.03 + energy * 0.14) + (features && features.beat ? 0.02 : 0);
    // treble-heavy passages push the hue one way, bass-heavy the other
    const shift = this._hue + tilt * 0.12;

    const live = {
      a: this._palette.a,
      b: this._palette.b,
      c: this._palette.c,
      d: this._palette.d.map(v => v + shift)
    };
    this.particlesSystem.setParams({ palette: live });
    if(this.shards) this.shards.setPalette(live);
    if(this.raymarch) this.raymarch.setPalette(live);
    this.background.setPalette(live);
  }

  // Replace whichever shape slot the morph is currently *not* showing, so a new form
  // always arrives by fading in rather than popping.
  advanceShape(id){
    this.setShape(this._mix < 0.5 ? 'shapeB' : 'shapeA', id);
  }

  _stepLayout(dt){
    const k = Math.min(1, dt * 0.8);
    const cur = this._layout, tgt = this._layoutTarget;
    cur.split = lerp(cur.split, tgt.split, k);
    cur.scaleRatio = lerp(cur.scaleRatio, tgt.scaleRatio, k);
    for(let i=0;i<3;i++){
      cur.offsetA[i] = lerp(cur.offsetA[i], tgt.offsetA[i], k);
      cur.offsetB[i] = lerp(cur.offsetB[i], tgt.offsetB[i], k);
    }
    this.particlesSystem.setParams(cur);
    if(this.raymarch) this.raymarch.setShape(cur);
  }

  _buildGui(){
    try{
      this.gui = new GUI({ width: 300 });
      const el = this.gui.domElement;
      el.style.position = 'fixed'; el.style.top = '72px'; el.style.right = '12px';
      el.style.zIndex = '900'; el.style.maxHeight = '78vh'; el.style.overflow = 'auto';

      const pm = this.presetManager;
      const state = {
        preset: pm.presets[0].name,
        next: ()=> this.cyclePreset(),
        autoOnset: true,
        morphSpeed: 0.15,
        shapeA: SHAPE_NAMES[0],
        shapeB: SHAPE_NAMES[1],
        palette: pm.presets[0].palette,
        shardCount: pm.presets[0].shardCount,
        particleCount: pm.presets[0].particleCount,
        raymarchOpacity: pm.presets[0].raymarchOpacity,
        bloom: pm.presets[0].bloom,
        trailDecay: pm.presets[0].trailDecay,
        exposure: pm.presets[0].exposure
      };
      this._guiState = state;

      const f1 = this.gui.addFolder('Scene');
      this._presetCtrl = f1.add(state, 'preset', pm.presets.map(p=>p.name)).name('Preset').onChange(v=> pm.select(v, 1.2));
      f1.add(state, 'next').name('Next Preset');
      f1.add(state, 'autoOnset').name('React to Onsets');
      f1.open();

      const f2 = this.gui.addFolder('Shape');
      f2.add(state, 'shapeA', SHAPE_NAMES).name('Shape A').onChange(v=> this.setShape('shapeA', SHAPES[v]));
      f2.add(state, 'shapeB', SHAPE_NAMES).name('Shape B').onChange(v=> this.setShape('shapeB', SHAPES[v]));
      f2.add(state, 'morphSpeed', 0.0, 0.6, 0.01).name('Morph Speed');
      f2.add(state, 'palette', Object.keys(PALETTES)).name('Palette').onChange(v=> this.setPalette(v));
      f2.open();

      const f3 = this.gui.addFolder('Layers');
      f3.add(state, 'raymarchOpacity', 0, 1.5, 0.01).name('Solid Shape')
        .onChange(v=> this.raymarch && (this.raymarch.material.uniforms.uOpacity.value = v));
      f3.add(state, 'shardCount', 0, 3000, 10).name('Geometry Count')
        .onChange(v=> this.shards && this.shards.setParams({ shardCount: v }));
      f3.add(state, 'particleCount', 0, 32768, 256).name('Particle Count')
        .onChange(v=> this.particlesSystem.setParams({ particleCount: v }));
      f3.open();

      const f4 = this.gui.addFolder('Look');
      f4.add(state, 'bloom', 0, 2.5, 0.01).onChange(v=> this.postfx.setParams({ bloom:v }));
      f4.add(state, 'trailDecay', 0.6, 0.99, 0.005).name('Trails').onChange(v=> this.postfx.setParams({ trailDecay:v }));
      f4.add(state, 'exposure', 0.4, 2.5, 0.01).onChange(v=> this.postfx.setParams({ exposure:v }));
    }catch(e){ console.warn('GUI init failed', e); }
  }

  setShape(slot, id){
    this.presetManager.current[slot] = id;
    this.particlesSystem.setParams({ [slot]: id });
    if(this.raymarch) this.raymarch.setShape({ [slot]: id });
  }

  setPalette(name){
    const pal = PALETTES[name];
    if(!pal) return;
    this.presetManager.current.palette = name;
    // hand it to the interpolator rather than snapping: colour should drift, not cut
    this._paletteTarget = { a: pal.a.slice(), b: pal.b.slice(), c: pal.c.slice(), d: pal.d.slice() };
  }

  cyclePreset(){
    this.presetManager.next(1.2);
    if(this._presetCtrl){ this._guiState.preset = this.presetManager.name; this._presetCtrl.updateDisplay(); }
  }

  onResize(){
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.postfx.setSize(size.x, size.y);
    if(this.raymarch) this.raymarch.setSize(size.x, size.y);
  }

  start(renderCallback){
    if(this.animating) return;
    this.animating = true;
    this._lastTime = performance.now() / 1000;
    const loop = (t)=>{
      if(!this.animating) return;
      const now = t/1000;
      const dt = Math.min(0.06, now - this._lastTime);
      this._lastTime = now;
      try{ renderCallback(now, dt); }
      catch(err){ console.error('Render callback exception', err); }

      if(this.particlesSystem._broken){
        console.error('ParticlesGPGPU detected a GL error; stopping the render loop.');
        this.stop();
        return;
      }
      this.renderFrame(now, dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(){ this.animating = false; }

  update(time, features, dt = 1/60){
    const bands = Array.isArray(features) ? features : (features && features.bands) || null;
    const energy = (features && features.energyNorm) || 0;
    const bass = bands ? (bands[0] + bands[1]) * 0.5 : 0;
    // smooth the audio drive so geometry does not jitter frame to frame
    this._energy += (energy - this._energy) * 0.12;
    this._bass += (bass - this._bass) * 0.2;
    // beatPulse spikes on the beat and decays, so anything riding it lands with the music
    this._pulse = (features && features.beatPulse) || 0;
    this._tilt = (features && features.spectralTilt) || 0;
    this._beatPhase = (features && features.beatPhase) || 0;

    this.particlesSystem.step(time, dt, bands);
    this.presetManager.step(dt);

    // Band levels drive the organic equaliser. projectM's relative loudness means 1.0 is
    // "normal for this track", so the swell shows what is *changing*, not what is loud.
    if(features && features.bandAtt){
      if(!this._bandLevels) this._bandLevels = new Array(6).fill(0);
      for(let i=0;i<6;i++){
        const rel = Math.max(0, Math.min(1.6, (features.bandAtt[i] - 0.8) / 0.9));
        this._bandLevels[i] += (rel - this._bandLevels[i]) * Math.min(1, dt * 9);
      }
    }

    // scale the preset by how the music is actually being played this instant
    this.expression.update(features, dt);
    const ex = this.expression.apply(this.presetManager.current);
    if(this._bandLevels) ex.bandLevels = this._bandLevels;
    this.particlesSystem.setParams(ex);
    if(this.shards) this.shards.setParams(ex);
    this.postfx.setParams(ex);
    this.background.setParams(ex);
    this._expr = ex;
    this._stepPalette(dt, features);
    this._stepLayout(dt);
    this._stepPointer(dt);
    if(this._guiState ? this._guiState.autoOnset : true) this.director.update(features);

    // Morph is driven by beat phase when a tempo is locked, and by a free-running LFO
    // otherwise, so the fusion between the two shapes never sits still.
    const speed = this._guiState ? this._guiState.morphSpeed : 0.15;
    const locked = features && features.beatConfidence > 0.15;
    if(locked){
      // one full A->B->A sweep every 8 beats
      this._morphPhase = ((features.beatCount % 8) + features.beatPhase) / 8 * Math.PI * 2;
    } else {
      this._morphPhase += dt * speed * (this._expr ? this._expr.morphScale : 1);
    }
    const base = this.presetManager.current.shapeMix || 0;
    const mix = Math.min(1, Math.max(0, base + 0.5 + 0.5 * Math.sin(this._morphPhase)));
    this._mix = mix;
    const deform = (this._expr ? this._expr.audioDeform : 0) * (0.6 + this._pulse * 0.7);
    this.particlesSystem.setParams({ shapeMix: mix, audioDeform: deform });
    if(this.raymarch) this.raymarch.setShape({ shapeMix: mix, audioDeform: deform, bandLevels: this._bandLevels });

    if(this.shards){
      this.shards.update(this.particlesSystem.posTexture, this.particlesSystem.velTexture,
        time, this._energy, this._bass * 0.5 + this._pulse * 0.6);
    }
  }

  renderFrame(time, dt = 1/60){
    const r = this.renderer;

    // ease toward the director's current shot so cuts read as moves, not jumps
    const shot = this._shot, target = this._shotTarget;
    const k = Math.min(1, dt * 1.1);
    shot.dist = lerp(shot.dist, target.dist, k);
    shot.height = lerp(shot.height, target.height, k);
    shot.spin = lerp(shot.spin, target.spin, k);
    shot.bob = lerp(shot.bob, target.bob, k);

    this._camAngle += shot.spin * (this._expr ? this._expr.camSpinScale : 1) * dt;
    // the beat pulse pushes the camera in slightly, which sells the hit
    const dist = Math.max(120, shot.dist + (this._userDist || 0)) * (1.0 - this._energy * 0.08 - this._pulse * 0.05);
    this.camera.position.set(
      Math.sin(this._camAngle) * dist,
      shot.height + Math.sin(this._camAngle * 0.7) * shot.bob,
      Math.cos(this._camAngle) * dist
    );
    // reframe toward whichever body the director picked, so the subject moves around frame
    this._look.lerp(this._lookTarget, Math.min(1, dt * 0.7));
    this.camera.position.add(this._look);
    this.camera.lookAt(this._look);
    this.camera.updateMatrixWorld();

    // animated backdrop fills the frame and clears the target for everything after it
    this.background.render(r, this.postfx.sceneRT, time, this._energy, this._pulse, this._tilt || 0);

    if(this.raymarch){
      // solid procedural body composites on top, contributing real depth
      this.raymarch.render(r, this.camera, time, this._energy, this.postfx.sceneRT);
    }

    // geometry + particles on top; the raymarch pass left real depth behind, so the solid
    // body correctly occludes anything orbiting behind it
    r.setRenderTarget(this.postfx.sceneRT);
    r.render(this.scene, this.camera);

    this.postfx.setPulse(this._pulse);
    this.postfx.present(time);
  }

  _installLogHelpers(){
    if(typeof window === 'undefined' || window.__NEWFLARE_logInitialized) return;
    window.__NEWFLARE_logBuffer = [];
    window.__NEWFLARE_appendLog = (tag, text)=>{
      window.__NEWFLARE_logBuffer.push(`--- ${new Date().toISOString()} ---\n[${tag}]\n${text}\n`);
      if(window.__NEWFLARE_logBuffer.length > 200) window.__NEWFLARE_logBuffer.shift();
    };
    window.__NEWFLARE_saveLogs = ()=>{
      const blob = new Blob([window.__NEWFLARE_logBuffer.join('\n')], { type:'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `newflare-log-${Date.now()}.txt`;
      document.body.appendChild(a); a.click(); a.remove();
    };
    const gl = this.renderer.getContext();
    const origShaderLog = gl.getShaderInfoLog.bind(gl);
    gl.getShaderInfoLog = (shader)=>{
      const info = origShaderLog(shader);
      if(info && info.length){ console.error('WebGL Shader Info Log:', info); window.__NEWFLARE_appendLog('SHADER_INFO', info); }
      return info;
    };
    window.__NEWFLARE_logInitialized = true;
  }
}
