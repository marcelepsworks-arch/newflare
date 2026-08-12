import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import ParticlesGPGPU from './ParticlesGPGPU.js';

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
    // if full features object provided, check onset
    if(features && typeof features === 'object' && features.onset){
      // cycle modes on onset
      if(!this._modeIndex) this._modeIndex = 0;
      this._modeIndex = (this._modeIndex + 1) % 3;
      const modes = ['curl','attract','explode'];
      const next = modes[this._modeIndex];
      this.particlesSystem.setMode(next, 0.6);
    }
  }
}
