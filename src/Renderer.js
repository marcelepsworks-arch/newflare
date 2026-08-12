import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import ParticlesGPGPU from './ParticlesGPGPU.js';
import PresetManager from './Presets.js';

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
      vertexShader: `void main(){ gl_Position = vec4(position,1.0); }`,
      fragmentShader: `precision highp float; uniform sampler2D uTexture; uniform float uOpacity; void main(){ vec4 c = texture(uTexture, uv); gl_FragColor = vec4(c.rgb, c.a * uOpacity); }`,
      transparent: true, depthWrite:false
    });
    this.overlayQuad = new THREE.Mesh(quadGeo, this.overlayMat);
    this.overlayScene.add(this.overlayQuad);

    window.addEventListener('resize', ()=>this.onResize());
  }

  onResize(){
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
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
      renderCallback(now, dt);
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
