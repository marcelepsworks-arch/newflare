import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import ParticlesGPGPU from './ParticlesGPGPU.js';
import PresetManager from './Presets.js';
import { GUI } from 'https://cdn.jsdelivr.net/npm/lil-gui@0.18.0/dist/lil-gui.esm.min.js';

export default class Renderer {
  constructor(canvas){
    this.canvas = canvas;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.particlesSystem = null;
    this.animating = false;
    this._lastTime = 0;
  }

  async init(){
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias:true, preserveDrawingBuffer:true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    // initialize shared browser-side logging helpers for shader errors
    try{
      if(typeof window !== 'undefined' && !window.__NEWFLARE_logInitialized){
        window.__NEWFLARE_logBuffer = [];
        window.__NEWFLARE_autoSaveLogs = true;
        window.__NEWFLARE_appendLog = function(tag, text){
          try{
            const ts = new Date().toISOString();
            const entry = `--- ${ts} ---\n[${tag}]\n${text}\n\n`;
            window.__NEWFLARE_logBuffer.push(entry);
            if(window.__NEWFLARE_logBuffer.length > 200) window.__NEWFLARE_logBuffer.shift();
          }catch(e){ console.warn('NEWFLARE appendLog failed', e); }
        };
        window.__NEWFLARE_saveLogs = function(){
          try{
            const blob = new Blob([window.__NEWFLARE_logBuffer.join('\n')], { type: 'text/plain;charset=utf-8' });
            const name = `newflare-shader-log-${(new Date()).toISOString().replace(/[:.]/g,'-')}.txt`;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(()=>URL.revokeObjectURL(url), 15000);
          }catch(e){ console.warn('NEWFLARE saveLogs failed', e); }
        };
        window.__NEWFLARE_dumpAllLogs = function(){ console.log(window.__NEWFLARE_logBuffer.join('\n')); };
        window.__NEWFLARE_logInitialized = true;
      }
    }catch(e){ console.warn('Failed to initialize NEWFLARE log helpers', e); }

    // Wrap GL info log functions to capture logs and auto-save them
    try{
      const gl = this.renderer.getContext();
      if(gl && !window.__NEWFLARE_glWrapped){
        const origGetProgramInfoLog = gl.getProgramInfoLog.bind(gl);
        gl.getProgramInfoLog = function(program){
          try{
            const info = origGetProgramInfoLog(program);
            if(info && info.length){
              console.error('WebGL Program Info Log:', info);
              try{ window.__NEWFLARE_appendLog('PROGRAM_INFO', info); }catch(_){ }
            }
            return info;
          }catch(e){ return origGetProgramInfoLog(program); }
        };
        const origGetShaderInfoLog = gl.getShaderInfoLog.bind(gl);
        gl.getShaderInfoLog = function(shader){
          try{
            const info = origGetShaderInfoLog(shader);
            if(info && info.length){
              console.error('WebGL Shader Info Log:', info);
              try{ window.__NEWFLARE_appendLog('SHADER_INFO', info); }catch(_){ }
            }
            return info;
          }catch(e){ return origGetShaderInfoLog(shader); }
        };
        window.__NEWFLARE_glWrapped = true;
      }
    }catch(e){ console.warn('Failed to wrap GL info log functions', e); }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 2000);
    this.camera.position.z = 300;

    // ambient
    const amb = new THREE.AmbientLight(0xffffff, 0.2); this.scene.add(amb);

    // GPGPU particles system
    this.particlesSystem = new ParticlesGPGPU(this.renderer, { count: 131072, noiseScale:0.0025, curl:1.2, damping:0.985 });
    await this.particlesSystem.init();
    this.scene.add(this.particlesSystem.particlesMesh);

    // presets manager: auto-crossfade between high-quality presets on onset
    this.presetManager = new PresetManager(this.particlesSystem);
    // apply initial preset instantly
    this.presetManager._applyToSystem(this.presetManager.current);

    // overlay scene to draw trail texture on top
    this.overlayScene = new THREE.Scene();
    this.overlayCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const quadGeo = new THREE.PlaneGeometry(2,2);
    this.overlayMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null }, uOpacity: { value: 1.0 } },
      vertexShader: `precision highp float; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform sampler2D uTexture; uniform float uOpacity; void main(){ vec4 c = texture2D(uTexture, vUv); gl_FragColor = vec4(c.rgb, c.a * uOpacity); }`,
      transparent: true, depthWrite:false
    });
    // debug hook to log shader sources when compiled
    this.overlayMat.__debugName = 'overlayMat';
    this.overlayMat.onBeforeCompile = (shader, renderer)=>{ try{ this.overlayMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader }; console.log('onBeforeCompile overlayMat'); }catch(e){} };
    this.overlayQuad = new THREE.Mesh(quadGeo, this.overlayMat);
    this.overlayScene.add(this.overlayQuad);

    window.addEventListener('resize', ()=>this.onResize());

    // Setup GUI controls
    try{
      this.gui = new GUI({ width: 320 });
      // Position GUI so it doesn't overlap the topbar controls (topbar z-index = 1000)
      const guiEl = this.gui.domElement;
      guiEl.style.position = 'fixed';
      guiEl.style.top = '72px';
      guiEl.style.right = '12px';
      guiEl.style.zIndex = '900';
      guiEl.style.maxHeight = '75vh';
      guiEl.style.overflow = 'auto';
      const sys = this.particlesSystem;
      const pm = this.presetManager;
      const hasParticleUniforms = sys && sys.particleMat && sys.particleMat.uniforms;
      const hasTrailUniforms = sys && sys.trailCompositeMat && sys.trailCompositeMat.uniforms;
      const state = {
        preset: pm.presets[0].name,
        nextPreset: ()=> pm.next(0.6),
        autoOnset: true,
        noiseScale: sys.noiseScale,
        curl: sys.curl,
        damping: sys.damping,
        pointSize: hasParticleUniforms ? sys.particleMat.uniforms.uPointSize.value : 2.0,
        color: hasParticleUniforms ? '#' + sys.particleMat.uniforms.uColor.value.getHexString() : '#00ffd5',
        trailDecay: hasTrailUniforms ? this.particlesSystem.trailCompositeMat.uniforms.uDecay.value : 0.96
      };

      const pFolder = this.gui.addFolder('Presets');
      pFolder.add(state, 'preset', pm.presets.map(p=>p.name)).name('Select').onChange((v)=>{ pm.select(v, 0.6); });
      pFolder.add(state, 'nextPreset').name('Next Preset');
      pFolder.add(state, 'autoOnset').name('Auto Onset');
      pFolder.open();

      const pSys = this.gui.addFolder('Particles');
      pSys.add(state, 'noiseScale', 0.0001, 0.01, 0.0001).name('Noise Scale').onChange(v=> sys.setParams({ noiseScale:v }));
      pSys.add(state, 'curl', 0.1, 6.0, 0.01).name('Curl').onChange(v=> sys.setParams({ curl:v }));
      pSys.add(state, 'damping', 0.8, 0.999, 0.001).name('Damping').onChange(v=> sys.setParams({ damping:v }));
      pSys.add(state, 'pointSize', 0.5, 8.0, 0.1).name('Point Size').onChange(v=> sys.setParams({ pointSize:v }));
      pSys.addColor(state, 'color').name('Color').onChange(v=> sys.setParams({ color: parseInt(v.replace('#',''),16) }));
      pSys.add(state, 'trailDecay', 0.7, 0.999, 0.001).name('Trail Decay').onChange(v=> sys.setParams({ trailDecay:v }));
      pSys.open();

      this._guiState = state;
    }catch(e){ console.warn('GUI init failed', e); }
  }

  onResize(){
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  start(renderCallback){
    if(this.animating) return;
    this.animating = true;
    console.log('Renderer.start called, scene children:', this.scene.children.length, 'camera z:', this.camera.position.z);
    this._lastTime = performance.now() / 1000;
    const loop = (t)=>{
      if(!this.animating) return;
      const now = t/1000;
      const dt = Math.min(0.06, now - this._lastTime);
      this._lastTime = now;
      try{
        renderCallback(now, dt);
      }catch(err){
        console.error('Render callback exception', err);
      }
      // if particles system detected GL error, stop anim and surface debug info
      if(this.particlesSystem && this.particlesSystem._broken){
        console.error('ParticlesGPGPU detected GL error; stopping renderer to avoid infinite GL spam.');
        if(window && window.__NEWFLARE_dumpShaders) window.__NEWFLARE_dumpShaders();
        if(window && window.__NEWFLARE_saveLogs) window.__NEWFLARE_saveLogs();
        this.stop();
        return;
      }
      this.renderer.render(this.scene, this.camera);
      // draw trail overlay if available
      if(this.particlesSystem && this.particlesSystem.trailTexture){
        this.overlayMat.uniforms.uTexture.value = this.particlesSystem.trailTexture;
        this.renderer.render(this.overlayScene, this.overlayCamera);
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(){ this.animating = false; }

  update(time, features){
    // forward to particles GPGPU and handle mode switching on onset
    const bands = Array.isArray(features) ? features : (features && features.bands ? features.bands : null);
    const dt = 1/60;
    this.particlesSystem.step(time, dt, bands);
    // step presets manager so parameters smoothly interpolate
    if(this.presetManager) this.presetManager.step(dt);
    // if full features object provided, check onset and trigger preset crossfade
    if(features && typeof features === 'object' && features.onset){
      if(!this._presetIndex) this._presetIndex = 0;
      this._presetIndex = (this._presetIndex + 1);
      // trigger change to next preset (PresetManager handles wrap)
      this.presetManager.next(0.6);
      // also cycle particle mode occasionally for more variety
      if(!this._modeIndex) this._modeIndex = 0;
      this._modeIndex = (this._modeIndex + 1) % 3;
      const modes = ['curl','attract','explode'];
      const next = modes[this._modeIndex];
      this.particlesSystem.setMode(next, 0.6);
    }
  }
}
