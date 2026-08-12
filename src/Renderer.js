import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import ParticlesGPGPU from './ParticlesGPGPU.js';
import ShardsLayer from './ShardsLayer.js';
import RaymarchLayer from './RaymarchLayer.js';
import PostFX from './PostFX.js';
import PresetManager, { PALETTES, SHAPES } from './Presets.js';
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.18.0/dist/lil-gui.esm.min.js';

const SHAPE_NAMES = Object.keys(SHAPES);

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
      this.raymarch = new RaymarchLayer();
    }

    this.postfx = new PostFX(this.renderer);
    this.presetManager = new PresetManager((p) => this.applyPreset(p));

    window.addEventListener('resize', ()=>this.onResize());
    this._buildGui();
  }

  applyPreset(p){
    const palette = p.paletteValues;
    this.particlesSystem.setParams(Object.assign({}, p, { palette }));
    if(this.shards) this.shards.setParams(Object.assign({}, p, { palette }));
    if(this.raymarch) this.raymarch.setShape(Object.assign({}, p, { palette }));
    this.postfx.setParams(p);
    this._cam = { dist: p.camDist, spin: p.camSpin, bob: p.camBob };
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
    this.particlesSystem.setParams({ palette: pal });
    if(this.shards) this.shards.setPalette(pal);
    if(this.raymarch) this.raymarch.setPalette(pal);
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
      this.renderFrame(now);
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

    this.particlesSystem.step(time, dt, bands);
    this.presetManager.step(dt);

    // continuous morph between the two shapes of the active preset
    const speed = this._guiState ? this._guiState.morphSpeed : 0.15;
    this._morphPhase += dt * speed;
    const base = this.presetManager.current.shapeMix || 0;
    const mix = Math.min(1, Math.max(0, base + 0.5 + 0.5 * Math.sin(this._morphPhase)));
    const deform = (this.presetManager.current.audioDeform || 0) * (0.4 + this._energy * 1.6);
    this.particlesSystem.setParams({ shapeMix: mix, audioDeform: deform });
    if(this.raymarch) this.raymarch.setShape({ shapeMix: mix, audioDeform: deform });

    if(this.shards){
      this.shards.update(this.particlesSystem.posTexture, this.particlesSystem.velTexture, time, this._energy, this._bass);
    }

    const autoOnset = !this._guiState || this._guiState.autoOnset;
    this._sinceSwitch = (this._sinceSwitch || 0) + dt;
    this._sinceShape = (this._sinceShape || 0) + dt;
    if(autoOnset && features && features.onset){
      // strong onsets re-roll the target shape; only rare ones change the whole preset
      if(this._sinceShape > 2.5){
        this._sinceShape = 0;
        this.setShape('shapeB', Math.floor(Math.random() * SHAPE_NAMES.length));
      }
      if(this._sinceSwitch > 12.0){
        this._sinceSwitch = 0;
        this.cyclePreset();
      }
    }
  }

  renderFrame(time){
    const r = this.renderer;
    const cam = this._cam || { dist: 320, spin: 0.05, bob: 12 };
    const dist = cam.dist * (1.0 - this._energy * 0.12);
    this.camera.position.set(
      Math.sin(time * cam.spin) * dist,
      Math.sin(time * cam.spin * 0.7) * cam.bob,
      Math.cos(time * cam.spin) * dist
    );
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();

    if(this.raymarch){
      // solid procedural body first: it owns the background, no depth involved
      this.raymarch.render(r, this.camera, time, this._energy, this.postfx.sceneRT);
    } else {
      r.setRenderTarget(this.postfx.sceneRT);
      r.setClearColor(0x000000, 1);
      r.clear(true, true, false);
    }

    // geometry + particles on top; the raymarch pass left real depth behind, so the solid
    // body correctly occludes anything orbiting behind it
    r.setRenderTarget(this.postfx.sceneRT);
    r.render(this.scene, this.camera);

    this.postfx.present();
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
