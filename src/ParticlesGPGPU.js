import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

export default class ParticlesGPGPU {
  constructor(renderer, options = {}){
    this.renderer = renderer;
    this.count = options.count || 131072; // default ~128k
    this.noiseScale = options.noiseScale || 0.0025;
    this.curl = options.curl || 1.0;
    this.damping = options.damping || 0.985;
    this.forceFallback = (typeof options.forceFallback !== 'undefined') ? options.forceFallback : true;
    this.size = Math.ceil(Math.sqrt(this.count));
    this.texWidth = this.size; this.texHeight = this.size;
    this.simpleFallback = false;

    this.initDone = false;
  }

  // Apply parameter set to the running system (immediate)
  setParams(opts = {}){
    if(typeof opts.noiseScale !== 'undefined') this.noiseScale = opts.noiseScale;
    if(typeof opts.curl !== 'undefined') this.curl = opts.curl;
    if(typeof opts.damping !== 'undefined') this.damping = opts.damping;
    if(typeof opts.pointSize !== 'undefined'){
      if(this.particleMat && this.particleMat.uniforms && this.particleMat.uniforms.uPointSize){
        this.particleMat.uniforms.uPointSize.value = opts.pointSize;
      } else if(this.particleMat && this.particleMat.isPointsMaterial){
        this.particleMat.size = opts.pointSize;
      }
    }
    if(typeof opts.color !== 'undefined'){
      if(this.particleMat && this.particleMat.uniforms && this.particleMat.uniforms.uColor){
        this.particleMat.uniforms.uColor.value.set(opts.color);
      } else if(this.particleMat && this.particleMat.color){
        this.particleMat.color.set(opts.color);
      }
    }
    if(typeof opts.explode !== 'undefined') this._pendingExplode = opts.explode;
    if(typeof opts.attractor !== 'undefined') this._pendingAttractor = opts.attractor;
    if(typeof opts.trailDecay !== 'undefined') this._pendingTrailDecay = opts.trailDecay;
  }

  _makeRenderTarget(){
    return new THREE.WebGLRenderTarget(this.texWidth, this.texHeight, {
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.FloatType,
      depthBuffer: false,
      stencilBuffer: false
    });
  }

  _initCpuFallback(){
    this.simpleFallback = true;
    this.cpuCount = this.count;
    this.cpuPositions = new Float32Array(this.cpuCount * 3);
    this.cpuVelocities = new Float32Array(this.cpuCount * 3);
    const uvs = new Float32Array(this.cpuCount * 2);
    const colors = new Float32Array(this.cpuCount * 3);
    for(let i=0;i<this.cpuCount;i++){
      const angle = (i / this.cpuCount) * Math.PI * 8.0;
      const radius = 180.0 * (0.4 + Math.random() * 0.6);
      const x = Math.cos(angle) * radius * 0.5;
      const y = Math.sin(angle) * radius * 0.5;
      const z = (Math.random() - 0.5) * 140.0;
      const ix = i * 3;
      this.cpuPositions[ix] = x;
      this.cpuPositions[ix + 1] = y;
      this.cpuPositions[ix + 2] = z;
      this.cpuVelocities[ix] = (Math.random() - 0.5) * 5.5;
      this.cpuVelocities[ix + 1] = (Math.random() - 0.5) * 5.5;
      this.cpuVelocities[ix + 2] = (Math.random() - 0.5) * 5.5;
      const hue = (i / this.cpuCount) * 0.75 + Math.random() * 0.05;
      const sat = 0.75 + Math.random() * 0.2;
      const val = 0.75 + Math.random() * 0.25;
      const c = new THREE.Color().setHSL(hue % 1.0, sat, val);
      colors[ix] = c.r;
      colors[ix + 1] = c.g;
      colors[ix + 2] = c.b;
      uvs[i*2] = (i % this.texWidth + 0.5) / this.texWidth;
      uvs[i*2+1] = (Math.floor(i / this.texWidth) + 0.5) / this.texHeight;
    }
    this.cpuGeometry = new THREE.BufferGeometry();
    this.cpuGeometry.setAttribute('position', new THREE.BufferAttribute(this.cpuPositions, 3));
    this.cpuGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.cpuGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0.0 },
        uPointSize: { value: 4.5 },
        uBaseColor: { value: new THREE.Color(0xffffff) }
      },
      vertexShader: `#ifdef GL_ES\n#define texture2D texture\n#define textureCube texture\n#endif\nprecision highp float; attribute vec3 color; uniform float uTime; uniform float uPointSize; varying vec3 vColor; varying float vPulse; void main(){ vec3 p = position; p.x += sin(uTime * 0.64 + position.y * 0.04) * 8.0; p.y += cos(uTime * 0.54 + position.x * 0.038) * 9.0; p.z += sin(uTime * 0.32 + position.x * 0.016) * 3.0; vPulse = 0.5 + 0.5 * sin(uTime * 2.2 + position.x * 0.03 + position.y * 0.025); vColor = color * (0.8 + 0.2 * sin(uTime * 1.3 + position.z * 0.05)); gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); gl_PointSize = uPointSize + vPulse * 3.5; }`,
      fragmentShader: `#ifdef GL_ES\n#define texture2D texture\n#define textureCube texture\n#endif\nprecision highp float; varying vec3 vColor; varying float vPulse; void main(){ float d = length(gl_PointCoord - vec2(0.5)); float alpha = smoothstep(0.5, 0.28, d); vec3 col = vColor * (0.7 + 0.3 * vPulse);
        gl_FragColor = vec4(col, alpha * 0.85);
      }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.particlesMesh = new THREE.Points(this.cpuGeometry, this.particleMat);
    this.particlesMesh.frustumCulled = false;
    this.initDone = true;
    console.warn('NEWFLARE: CPU fallback initialized for particle rendering with animated colors.');
    try{ window.__NEWFLARE_appendLog('INFO', 'CPU fallback initialized for particle rendering with animated colors.'); }catch(e){}
  }

  async init(){
    const renderer = this.renderer;
    const isWebGL2 = renderer.capabilities.isWebGL2;
    const glslCompat = `#ifdef GL_ES\n#define texture2D texture\n#define textureCube texture\n#endif\n`;
    const useGpuCompute = !this.forceFallback && isWebGL2;
    if(!useGpuCompute){
      this._initCpuFallback();
      return;
    }
    // create render targets for pos and vel (ping-pong)
    this.posRT1 = this._makeRenderTarget();
    this.posRT2 = this._makeRenderTarget();
    this.velRT1 = this._makeRenderTarget();
    this.velRT2 = this._makeRenderTarget();

    // initial data textures
    const size = this.texWidth * this.texHeight * 4;
    const posArray = new Float32Array(size);
    const velArray = new Float32Array(size);
    for(let i=0;i<this.texWidth*this.texHeight;i++){
      const x = (Math.random()-0.5)*200.0;
      const y = (Math.random()-0.5)*200.0;
      const z = (Math.random()-0.5)*200.0;
      posArray[i*4+0] = x; posArray[i*4+1] = y; posArray[i*4+2] = z; posArray[i*4+3] = 1.0;
      velArray[i*4+0] = 0; velArray[i*4+1] = 0; velArray[i*4+2] = 0; velArray[i*4+3] = 0;
    }

    const posInitTex = new THREE.DataTexture(posArray, this.texWidth, this.texHeight, THREE.RGBAFormat, THREE.FloatType);
    posInitTex.needsUpdate = true;
    const velInitTex = new THREE.DataTexture(velArray, this.texWidth, this.texHeight, THREE.RGBAFormat, THREE.FloatType);
    velInitTex.needsUpdate = true;

    // full-screen quad scene for computation
    this.computeScene = new THREE.Scene();
    this.computeCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const quadGeo = new THREE.PlaneGeometry(2,2);

    // copy material to initialize RTs
    const copyMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null } },
      vertexShader: `${glslCompat}precision highp float; varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
      fragmentShader: `${glslCompat}varying vec2 vUv; uniform sampler2D uTexture; void main(){ vec4 c = texture2D(uTexture, vUv); gl_FragColor = c; }`,
      depthWrite: false
    });
    // debug: log shader sources when compiled
    copyMat.__debugName = 'copyMat';
    copyMat.onBeforeCompile = (shader, renderer)=>{
      try{ console.groupCollapsed('onBeforeCompile', copyMat.__debugName); console.log('VERTEX:\n', shader.vertexShader); console.log('FRAGMENT:\n', shader.fragmentShader); console.groupEnd(); }catch(e){}
      copyMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
      try{ window.__NEWFLARE_appendLog('SHADER_SOURCE_copyMat', 'VERTEX:\n' + shader.vertexShader + '\nFRAGMENT:\n' + shader.fragmentShader); }catch(e){}
    };
    this.copyMesh = new THREE.Mesh(quadGeo, copyMat);
    this.computeScene.add(this.copyMesh);

    // velocity update shader
    this.velMat = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uTexSize: { value: new THREE.Vector2(this.texWidth, this.texHeight) },
        uTime: { value: 0 },
        uDelta: { value: 0.016 },
        uNoiseScale: { value: this.noiseScale },
        uCurl: { value: this.curl },
        uDamping: { value: this.damping },
        uBands: { value: new Array(6).fill(0) },
        uModeBlend: { value: 0.0 },
        uAttractor: { value: new THREE.Vector3(0.0,0.0,0.0) },
        uExplode: { value: 0.0 }
      },
      vertexShader: `precision highp float; void main(){ gl_Position = vec4(position,1.0); }`,
      fragmentShader: `${glslCompat}precision highp float;
      // fallback sin-based noise (simple & compatible)
      uniform sampler2D uPos; uniform sampler2D uVel; uniform vec2 uTexSize; uniform float uTime; uniform float uDelta; uniform float uNoiseScale; uniform float uCurl; uniform float uDamping; uniform float uBands[6]; uniform float uModeBlend; uniform vec3 uAttractor; uniform float uExplode;
      float snoise(vec3 p){ return sin(p.x*12.9898 + p.y*78.233 + p.z*37.719) * 0.5 + 0.5; }
      vec3 curlNoise(vec3 p){
        float e = 0.0001;
        float n1 = snoise(vec3(p.x, p.y+e, p.z));
        float n2 = snoise(vec3(p.x, p.y-e, p.z));
        float a = (n1-n2)/(2.0*e);
        float n3 = snoise(vec3(p.x, p.y, p.z+e));
        float n4 = snoise(vec3(p.x, p.y, p.z-e));
        float b = (n3-n4)/(2.0*e);
        float n5 = snoise(vec3(p.x+e, p.y, p.z));
        float n6 = snoise(vec3(p.x-e, p.y, p.z));
        float c = (n5-n6)/(2.0*e);
        return normalize(vec3(b - a, c - b, a - c));
      }
      void main(){
        vec2 uv = gl_FragCoord.xy / uTexSize;
        vec4 p = texture2D(uPos, uv);
        vec4 v = texture2D(uVel, uv);
        vec3 pos = p.xyz;
        vec3 vel = v.xyz;
        vec3 n = curlNoise(pos * uNoiseScale + vec3(uTime*0.1));
        vec3 curlForce = n * uCurl;
        // attractor force
        vec3 dir = uAttractor - pos;
        float dist = length(dir) + 1e-5;
        vec3 attractForce = normalize(dir) * (1.0 / (dist*0.15));
        // explode force (radial)
        vec3 explodeForce = normalize(pos) * uExplode;
        // audio impulse from bass
        float bass = uBands[0];
        vec3 audioImp = normalize(pos + vec3(0.0001)) * bass * 0.5;
        // mix modes: 0=curl, 1=attract+explode
        vec3 mixed = mix(curlForce, attractForce + explodeForce, uModeBlend);
        vec3 force = mixed + audioImp;
        vel += force * uDelta * 60.0;
        vel *= uDamping;
        gl_FragColor = vec4(vel, 1.0);
      }`
    });
    this.velMat.__debugName = 'velMat';
    this.velMat.onBeforeCompile = (shader, renderer)=>{
      this.velMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
      console.log('onBeforeCompile velMat');
      try{ window.__NEWFLARE_appendLog('SHADER_SOURCE_velMat', 'VERTEX:\n' + shader.vertexShader + '\nFRAGMENT:\n' + shader.fragmentShader); }catch(e){}
    };

    // position update shader
    this.posMat = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null },
        uVel: { value: null },
        uDelta: { value: 0.016 }, uTexSize: { value: new THREE.Vector2(this.texWidth, this.texHeight) }
      },
      vertexShader: `${glslCompat}precision highp float; void main(){ gl_Position = vec4(position,1.0); }`,
      fragmentShader: `${glslCompat}precision highp float; uniform sampler2D uPos; uniform sampler2D uVel; uniform vec2 uTexSize; uniform float uDelta; void main(){ vec2 uv = gl_FragCoord.xy / uTexSize; vec4 p = texture2D(uPos, uv); vec4 v = texture2D(uVel, uv); vec3 pos = p.xyz + v.xyz * uDelta * 60.0; gl_FragColor = vec4(pos,1.0); }`
    });
    this.posMat.__debugName = 'posMat';
    this.posMat.onBeforeCompile = (shader, renderer)=>{
      this.posMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
      console.log('onBeforeCompile posMat');
      try{ window.__NEWFLARE_appendLog('SHADER_SOURCE_posMat', 'VERTEX:\n' + shader.vertexShader + '\nFRAGMENT:\n' + shader.fragmentShader); }catch(e){}
    };

    this.quad = new THREE.Mesh(quadGeo, this.velMat);
    this.computeScene.add(this.quad);

    // particle render material
    this.particleGeo = new THREE.BufferGeometry();
    const particles = this.texWidth * this.texHeight;
    const positions = new Float32Array(particles*3);
    const uvs = new Float32Array(particles*2);
    let ptr = 0; let uvptr=0;
    for(let y=0;y<this.texHeight;y++){
      for(let x=0;x<this.texWidth;x++){
        positions[ptr++] = 0; positions[ptr++] = 0; positions[ptr++] = 0;
        uvs[uvptr++] = (x + 0.5)/this.texWidth; uvs[uvptr++] = (y + 0.5)/this.texHeight;
      }
    }
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    this.particleGeo.setAttribute('uv', new THREE.BufferAttribute(uvs,2));

    const normalParticleMat = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null }, uPointSize: { value: 2.0 }, uColor: { value: new THREE.Color(0x00ffd5) }, uTexSize: { value: new THREE.Vector2(this.texWidth, this.texHeight) }
      },
      vertexShader: `precision highp float; uniform sampler2D uPosTex; uniform float uPointSize; uniform vec2 uTexSize; varying vec3 vColor; varying vec3 vNormal; attribute vec2 uv; void main(){ vec4 p = texture2D(uPosTex, uv); vec3 pos = p.xyz; vColor = vec3(0.5+pos.x*0.002, 0.3+pos.y*0.002, 0.6);
        vec2 off = vec2(1.0,0.0)/uTexSize;
        vec3 pR = texture2D(uPosTex, uv + off.xy).xyz;
        vec3 pU = texture2D(uPosTex, uv + off.yx).xyz;
        vNormal = normalize(cross(pR - pos, pU - pos));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0);
        gl_PointSize = uPointSize * (300.0 / - (modelViewMatrix * vec4(pos,1.0)).z);
      }`,
      fragmentShader: `precision highp float; varying vec3 vColor; varying vec3 vNormal; void main(){ float d = length(gl_PointCoord - vec2(0.5)); if(d>0.5) discard; vec3 lightDir = normalize(vec3(0.3,0.6,0.8)); float diff = max(dot(normalize(vNormal), lightDir), 0.0); vec3 col = vColor * (0.6 + 0.6 * diff); gl_FragColor = vec4(col, 1.0 - d*1.8); }`,
      transparent: true
    });
    normalParticleMat.__debugName = 'particleMat';
    normalParticleMat.onBeforeCompile = (shader, renderer)=>{
      normalParticleMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
      console.log('onBeforeCompile particleMat');
      try{ window.__NEWFLARE_appendLog('SHADER_SOURCE_particleMat', 'VERTEX:\n' + shader.vertexShader + '\nFRAGMENT:\n' + shader.fragmentShader); }catch(e){}
    };

    const fallbackParticleMat = new THREE.ShaderMaterial({
      uniforms: { uPosTex: { value: null }, uPointSize:{ value:2.0 }, uColor:{ value: new THREE.Color(0x00ffd5) }, uTime:{ value:0.0 } },
      vertexShader: `precision highp float; uniform float uPointSize; uniform float uTime; varying vec3 vColor; attribute vec2 uv; void main(){ vec2 p = uv - 0.5; float z = sin((uv.x + uv.y) * 12.0 + uTime * 2.0) * 30.0; vec3 pos = vec3(p.x * 400.0, p.y * 400.0, z); vColor = vec3(0.5 + p.x*0.5, 0.3 + p.y*0.5, 0.6); gl_Position = projectionMatrix * modelViewMatrix * vec4(pos,1.0); gl_PointSize = uPointSize * 2.0; }`,
      fragmentShader: `precision highp float; varying vec3 vColor; void main(){ float d = length(gl_PointCoord - vec2(0.5)); if(d>0.5) discard; vec3 col = vColor; gl_FragColor = vec4(col, 1.0 - d*1.8); }`,
      transparent: true
    });
    fallbackParticleMat.__debugName = 'particleMat_fallback';
    fallbackParticleMat.onBeforeCompile = (shader, renderer)=>{
      fallbackParticleMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
      console.log('onBeforeCompile particleMat_fallback');
      try{ window.__NEWFLARE_appendLog('SHADER_SOURCE_particleMat_fallback', 'VERTEX:\n' + shader.vertexShader + '\nFRAGMENT:\n' + shader.fragmentShader); }catch(e){}
    };

    const forceFallback = this.forceFallback || ((typeof window !== 'undefined' && window.__NEWFLARE_forceFallback) ? true : false);
    this.particleMat = (forceFallback || !renderer.capabilities.isWebGL2) ? fallbackParticleMat : normalParticleMat;
    this.particleMatFallback = fallbackParticleMat;
    this.particleMatNormal = normalParticleMat;
    this.particlesMesh = new THREE.Points(this.particleGeo, this.particleMat);
    if(forceFallback){
      console.warn('NEWFLARE: forcing WebGL1-safe particle fallback material');
      try{ window.__NEWFLARE_appendLog('INFO', 'Forcing particle fallback material due to compatibility issues'); }catch(e){}
    }

    // --- Trails: render particles into a current frame RT and composite with previous trail ---
    this.currentFrameRT = this._makeRenderTarget();
    this.trailRT1 = this._makeRenderTarget();
    this.trailRT2 = this._makeRenderTarget();
    this.trailRead = this.trailRT1; this.trailWrite = this.trailRT2;

    // composite shader: fade previous trail and add current frame
    this.trailCompositeMat = new THREE.ShaderMaterial({
      uniforms: {
        uPrev: { value: null }, uCurr: { value: null }, uDecay: { value: 0.96 }, uTexSize: { value: new THREE.Vector2(this.texWidth, this.texHeight) }
      },
      vertexShader: `${glslCompat}void main(){ gl_Position = vec4(position,1.0); }`,
      fragmentShader: `${glslCompat}precision highp float; uniform sampler2D uPrev; uniform sampler2D uCurr; uniform float uDecay; uniform vec2 uTexSize; void main(){ vec2 uv = gl_FragCoord.xy / uTexSize; vec4 prev = texture2D(uPrev, uv) * uDecay; vec4 cur = texture2D(uCurr, uv); // additive blend
        vec4 outc = prev + cur; outc = clamp(outc, 0.0, 1.0); gl_FragColor = outc; }`,
      depthWrite: false
    });
    this.trailCompositeMat.__debugName = 'trailCompositeMat';
    this.trailCompositeMat.onBeforeCompile = (shader, renderer)=>{
      this.trailCompositeMat.__lastShader = { vertex: shader.vertexShader, fragment: shader.fragmentShader };
      console.log('onBeforeCompile trailCompositeMat');
      try{ window.__NEWFLARE_appendLog('SHADER_SOURCE_trailCompositeMat', 'VERTEX:\n' + shader.vertexShader + '\nFRAGMENT:\n' + shader.fragmentShader); }catch(e){}
    };

    this.trailQuad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), this.trailCompositeMat);
    this.computeScene.add(this.trailQuad);

    // mode blending state
    this.mode = 'curl';
    this.targetMode = 'curl';
    this.modeBlend = 0.0; // 0=curl, 1=attract/explode
    this.modeBlendDuration = 0.5;
    this._modeTimer = 0;

    // expose setter
    this.setMode = (m, duration=0.6)=>{
      this.targetMode = m;
      this.modeBlendDuration = Math.max(0.01, duration);
      this._modeTimer = 0;
    };

    // initialize RTs by copying initial data textures
    this.copyMesh.material = copyMat;
    this.copyMesh.material.uniforms.uTexture.value = posInitTex;
    renderer.setRenderTarget(this.posRT1); renderer.render(this.computeScene, this.computeCamera);
    this._checkGLError(renderer, 'init.copy.posRT1');
    this.copyMesh.material.uniforms.uTexture.value = velInitTex;
    renderer.setRenderTarget(this.velRT1); renderer.render(this.computeScene, this.computeCamera);
    this._checkGLError(renderer, 'init.copy.velRT1');
    renderer.setRenderTarget(null);

    // set current RT pointers
    this.posRead = this.posRT1; this.posWrite = this.posRT2;
    this.velRead = this.velRT1; this.velWrite = this.velRT2;

    this.initDone = true;
    // expose quick dump helper
    try{ window.__NEWFLARE_dumpShaders = ()=>{
      console.log('velMat', this.velMat && this.velMat.__lastShader);
      console.log('posMat', this.posMat && this.posMat.__lastShader);
      console.log('particleMat', this.particleMat && this.particleMat.__lastShader);
      console.log('trailCompositeMat', this.trailCompositeMat && this.trailCompositeMat.__lastShader);
      console.log('copyMat', this.copyMesh && this.copyMesh.material && this.copyMesh.material.__lastShader);
    }; }catch(e){}
  }

  // helper: check GL error and log useful debug data
  _checkGLError(renderer, label){
    try{
      const gl = renderer.getContext();
      const err = gl.getError();
      if(err !== gl.NO_ERROR){
        console.error('WebGL GL_ERROR after', label, err);
        // dump last compiled shader snippets for quick inspection
        try{ console.log('VEL MAT last shader', this.velMat && this.velMat.__lastShader); }catch(e){}
        try{ console.log('POS MAT last shader', this.posMat && this.posMat.__lastShader); }catch(e){}
        try{ console.log('PARTICLE MAT last shader', this.particleMat && this.particleMat.__lastShader); }catch(e){}
        try{ console.log('COPY MAT last shader', this.copyMesh && this.copyMesh.material && this.copyMesh.material.__lastShader); }catch(e){}
        // mark broken so we can bail out of step()
        this._broken = true;
        return false;
      }
    }catch(e){ console.warn('checkGLError failed', e); }
    return true;
  }

  step(time, delta, bands){
    if(!this.initDone) return;
    if(this.simpleFallback){
      const positions = this.cpuPositions;
      const velocities = this.cpuVelocities;
      const count = this.cpuCount;
      const attractX = Math.sin(time * 0.7) * 50.0;
      const attractY = Math.cos(time * 0.5) * 30.0;
      const attractZ = Math.sin(time * 0.3) * 40.0;
      const damp = 0.96;
      for(let i=0;i<count;i++){
        const idx = i * 3;
        let px = positions[idx];
        let py = positions[idx + 1];
        let pz = positions[idx + 2];
        let vx = velocities[idx];
        let vy = velocities[idx + 1];
        let vz = velocities[idx + 2];
        const dx = attractX - px;
        const dy = attractY - py;
        const dz = attractZ - pz;
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) + 1e-5;
        const force = 1.5 / (dist * 0.15);
        vx += dx / dist * force * delta * 60.0;
        vy += dy / dist * force * delta * 60.0;
        vz += dz / dist * force * delta * 60.0;
        const noise = Math.sin((px + py + pz + time) * 0.5) * 0.12;
        vx += noise * delta * 20.0;
        vy += noise * delta * 20.0;
        vz += noise * delta * 20.0;
        vx *= damp;
        vy *= damp;
        vz *= damp;
        px += vx * delta * 60.0;
        py += vy * delta * 60.0;
        pz += vz * delta * 60.0;
        positions[idx] = px;
        positions[idx + 1] = py;
        positions[idx + 2] = pz;
        velocities[idx] = vx;
        velocities[idx + 1] = vy;
        velocities[idx + 2] = vz;
      }
      this.cpuGeometry.attributes.position.needsUpdate = true;
      if(this.particleMat.uniforms && this.particleMat.uniforms.uTime){
        this.particleMat.uniforms.uTime.value = time;
      }
      return;
    }
    const renderer = this.renderer;
    // advance mode blend
    if(this.mode !== this.targetMode){
      this._modeTimer += delta;
      const t = Math.min(1.0, this._modeTimer / this.modeBlendDuration);
      // decide direction: if target is 'curl' -> blend to 0, else to 1
      const targetVal = (this.targetMode === 'curl') ? 0.0 : 1.0;
      const start = (this.mode === 'curl') ? 0.0 : 1.0;
      this.modeBlend = start + (targetVal - start) * t;
      if(t>=1.0){ this.mode = this.targetMode; }
    }
    // apply pending attractor/explode/trailDecay set via setParams
    if(this._pendingAttractor) this.velMat.uniforms.uAttractor.value = new THREE.Vector3(...this._pendingAttractor);
    if(typeof this._pendingExplode !== 'undefined') this.velMat.uniforms.uExplode.value = this._pendingExplode;
    if(typeof this._pendingTrailDecay !== 'undefined') this.trailCompositeMat.uniforms.uDecay.value = this._pendingTrailDecay;
    // update velocity
    this.velMat.uniforms.uPos.value = this.posRead.texture;
    this.velMat.uniforms.uVel.value = this.velRead.texture;
    this.velMat.uniforms.uTime.value = time;
    this.velMat.uniforms.uDelta.value = delta;
    this.velMat.uniforms.uNoiseScale.value = this.noiseScale;
    this.velMat.uniforms.uCurl.value = this.curl;
    this.velMat.uniforms.uDamping.value = this.damping;
    this.velMat.uniforms.uModeBlend.value = this.modeBlend;
    // simple attractor placed near origin or slightly moving
    const attract = new THREE.Vector3(Math.sin(time*0.7)*50.0, Math.cos(time*0.5)*30.0, Math.sin(time*0.3)*40.0);
    this.velMat.uniforms.uAttractor.value = attract;
    this.velMat.uniforms.uExplode.value = (this.mode === 'explode') ? 2.0 : 0.0;
    // pass bands
    const b = this.velMat.uniforms.uBands.value;
    for(let i=0;i<6;i++) b[i] = bands && bands[i] ? bands[i] : 0.0;
    this.quad.material = this.velMat;
    renderer.setRenderTarget(this.velWrite);
    renderer.render(this.computeScene, this.computeCamera);
    if(!this._checkGLError(renderer, 'velWrite')) return;

    // update position
    this.posMat.uniforms.uPos.value = this.posRead.texture;
    this.posMat.uniforms.uVel.value = this.velWrite.texture;
    this.posMat.uniforms.uDelta.value = delta;
    this.quad.material = this.posMat;
    renderer.setRenderTarget(this.posWrite);
    renderer.render(this.computeScene, this.computeCamera);
    if(!this._checkGLError(renderer, 'posWrite')) return;

    renderer.setRenderTarget(null);

    // swap
    let tmp = this.posRead; this.posRead = this.posWrite; this.posWrite = tmp;
    tmp = this.velRead; this.velRead = this.velWrite; this.velWrite = tmp;

    // update particle material to read positions
    this.particleMat.uniforms.uPosTex.value = this.posRead.texture;

    // --- render current particle frame into currentFrameRT ---
    const oldMat = this.particlesMesh.material;
    // render points on black background into currentFrameRT
    renderer.setRenderTarget(this.currentFrameRT);
    renderer.setClearColor(0x000000, 0.0);
    renderer.clear(true, true, true);
    // render particlesMesh alone
    const savedSceneVisible = this.particlesMesh.visible;
    // We render particles only: create a temp scene
    const tmpScene = new THREE.Scene();
    tmpScene.add(this.particlesMesh);
    renderer.render(tmpScene, this.computeCamera);
    if(!this._checkGLError(renderer, 'render.particles.currentFrame')) return;
    // cleanup
    renderer.setRenderTarget(null);

    // composite currentFrameRT with previous trail into trailWrite
    this.trailCompositeMat.uniforms.uPrev.value = this.trailRead.texture;
    this.trailCompositeMat.uniforms.uCurr.value = this.currentFrameRT.texture;
    this.trailCompositeMat.uniforms.uDecay.value = 0.96;
    this.trailQuad.material = this.trailCompositeMat;
    renderer.setRenderTarget(this.trailWrite);
    renderer.render(this.computeScene, this.computeCamera);
    if(!this._checkGLError(renderer, 'trailComposite')) return;
    renderer.setRenderTarget(null);

    // swap trail RTs
    let ttmp = this.trailRead; this.trailRead = this.trailWrite; this.trailWrite = ttmp;

    // expose trail texture
    this.trailTexture = this.trailRead.texture;
  }
}
