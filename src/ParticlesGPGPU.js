import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { NOISE, SDF, SDF_FIELD, PALETTE } from './ShaderChunks.js';

// GPGPU simulation. Positions/velocities live in float render targets and are advected by
// a blend of curl turbulence and the shared SDF field, so particles can either roam freely
// or snap onto the surface of the procedural shape the raymarch layer is drawing.
export default class ParticlesGPGPU {
  constructor(renderer, options = {}){
    this.renderer = renderer;
    this.count = options.count || 32768;
    this.noiseScale = options.noiseScale || 0.0025;
    this.curl = options.curl || 1.0;
    this.damping = options.damping || 0.985;
    this.bounds = options.bounds || 300.0;
    this.forceFallback = !!options.forceFallback;
    this.size = Math.ceil(Math.sqrt(this.count));
    this.texWidth = this.size; this.texHeight = this.size;
    this.simpleFallback = false;

    this.mode = 'curl';
    this.targetMode = 'curl';
    this.modeBlend = 0.0;
    this.modeBlendDuration = 0.5;
    this._modeTimer = 0;

    this.initDone = false;
    this._frames = 0;
  }

  setParams(opts = {}){
    if(typeof opts.noiseScale !== 'undefined') this.noiseScale = opts.noiseScale;
    if(typeof opts.curl !== 'undefined') this.curl = opts.curl;
    if(typeof opts.damping !== 'undefined') this.damping = opts.damping;
    if(typeof opts.explode !== 'undefined') this._pendingExplode = opts.explode;
    if(typeof opts.attractor !== 'undefined') this._pendingAttractor = opts.attractor;

    const pu = this.particleMat && this.particleMat.uniforms;
    if(pu){
      if(typeof opts.pointSize !== 'undefined') pu.uPointSize.value = opts.pointSize;
      if(typeof opts.particleOpacity !== 'undefined') pu.uOpacity.value = opts.particleOpacity;
      if(opts.palette){
        pu.uPalA.value.fromArray(opts.palette.a); pu.uPalB.value.fromArray(opts.palette.b);
        pu.uPalC.value.fromArray(opts.palette.c); pu.uPalD.value.fromArray(opts.palette.d);
      }
    }
    if(typeof opts.particleCount !== 'undefined' && this.particleGeo){
      this.particleGeo.setDrawRange(0, Math.max(0, Math.min(this.texWidth * this.texHeight, Math.round(opts.particleCount))));
    }

    // the shape field is evaluated in both compute passes, so keep them in lockstep
    const shared = {
      shapeA:'uShapeA', shapeB:'uShapeB', shapeMix:'uShapeMix', shapeScale:'uShapeScale',
      shapeWarp:'uShapeWarp', shapeSpin:'uShapeSpin', audioDeform:'uAudioDeform'
    };
    for(const mat of [this.velMat, this.posMat]){
      if(!mat) continue;
      for(const key in shared){
        if(typeof opts[key] !== 'undefined' && mat.uniforms[shared[key]]) mat.uniforms[shared[key]].value = opts[key];
      }
    }

    const vu = this.velMat && this.velMat.uniforms;
    if(vu){
      if(typeof opts.shapeAttract !== 'undefined'){
        vu.uShapeAttract.value = opts.shapeAttract;
        // snapping strength follows the preset's shape lock
        this.posMat.uniforms.uSnap.value = opts.shapeAttract * 0.3;
      }
      if(typeof opts.swirl !== 'undefined') vu.uSwirl.value = opts.swirl;
    }
    if(typeof opts.shell !== 'undefined' && this.posMat) this.posMat.uniforms.uShell.value = opts.shell;
  }

  setMode(m, duration = 0.6){
    this.targetMode = m;
    this.modeBlendDuration = Math.max(0.01, duration);
    this._modeTimer = 0;
  }

  _makeDataRT(){
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

  _supportsGpuCompute(){
    if(this.forceFallback) return false;
    const caps = this.renderer.capabilities;
    if(!caps.isWebGL2) return false;
    const gl = this.renderer.getContext();
    if(!gl.getExtension('EXT_color_buffer_float')) return false;
    return caps.maxVertexTextures > 0;
  }

  async init(){
    if(!this._supportsGpuCompute()){
      this._initCpuFallback();
      return;
    }

    const renderer = this.renderer;
    const particles = this.texWidth * this.texHeight;

    this.posRT1 = this._makeDataRT();
    this.posRT2 = this._makeDataRT();
    this.velRT1 = this._makeDataRT();
    this.velRT2 = this._makeDataRT();

    const posArray = new Float32Array(particles * 4);
    const velArray = new Float32Array(particles * 4);
    for(let i=0;i<particles;i++){
      const r = this.bounds * 0.5 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      posArray[i*4+0] = r * Math.sin(phi) * Math.cos(theta);
      posArray[i*4+1] = r * Math.sin(phi) * Math.sin(theta);
      posArray[i*4+2] = r * Math.cos(phi);
      posArray[i*4+3] = Math.random();
      velArray[i*4+3] = 1.0;
    }
    const posInitTex = new THREE.DataTexture(posArray, this.texWidth, this.texHeight, THREE.RGBAFormat, THREE.FloatType);
    posInitTex.needsUpdate = true;
    const velInitTex = new THREE.DataTexture(velArray, this.texWidth, this.texHeight, THREE.RGBAFormat, THREE.FloatType);
    velInitTex.needsUpdate = true;

    this.computeScene = new THREE.Scene();
    this.computeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.computeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.computeQuad.frustumCulled = false;
    this.computeScene.add(this.computeQuad);

    const passVertex = `void main(){ gl_Position = vec4(position, 1.0); }`;

    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null }, uTexSize: { value: new THREE.Vector2(this.texWidth, this.texHeight) } },
      vertexShader: passVertex,
      fragmentShader: `precision highp float;
        uniform sampler2D uTexture; uniform vec2 uTexSize;
        void main(){ gl_FragColor = texture2D(uTexture, gl_FragCoord.xy / uTexSize); }`,
      depthWrite: false, depthTest: false
    });

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
        uAttractor: { value: new THREE.Vector3() },
        uExplode: { value: 0.0 },
        uBounds: { value: this.bounds },
        uShapeA: { value: 0 },
        uShapeB: { value: 1 },
        uShapeMix: { value: 0 },
        uShapeScale: { value: 120.0 },
        uShapeWarp: { value: 0.0 },
        uShapeSpin: { value: 0.12 },
        uAudioDeform: { value: 0.0 },
        uShapeAttract: { value: 0.6 },
        uSwirl: { value: 0.5 }
      },
      vertexShader: passVertex,
      fragmentShader: `precision highp float;
        uniform sampler2D uPos; uniform sampler2D uVel; uniform vec2 uTexSize;
        uniform float uTime, uDelta, uNoiseScale, uCurl, uDamping;
        uniform float uBands[6];
        uniform float uModeBlend, uExplode, uBounds, uShapeAttract, uSwirl;
        uniform vec3 uAttractor;
        ${NOISE}
        ${SDF}
        ${SDF_FIELD}
        void main(){
          vec2 uv = gl_FragCoord.xy / uTexSize;
          vec4 rec = texture2D(uPos, uv);
          vec3 pos = rec.xyz;
          float seed = rec.w;
          vec3 vel = texture2D(uVel, uv).xyz;

          vec3 radial = length(pos) > 1e-4 ? normalize(pos) : vec3(0.0, 1.0, 0.0);
          float bass = uBands[0] + uBands[1];
          float mids = uBands[2] + uBands[3];
          float highs = uBands[4] + uBands[5];

          // free-roaming turbulence
          vec3 turbulence = curlNoise(pos * uNoiseScale + vec3(uTime * 0.08)) * uCurl;

          // SDF surface capture: descend the gradient until the particle sits on the skin
          float d = shapeField(pos, uTime);
          vec3 n = shapeNormal(pos, uTime);
          vec3 onSurface = -n * clamp(d, -80.0, 80.0) * 0.05;
          // Flow ALONG the surface. The field is offset per particle: without the seed,
          // particles that meet at a point share one flow direction and never separate again.
          vec3 flow = curlNoise(pos * uNoiseScale * 1.7 + vec3(seed * 13.0) + vec3(uTime * 0.05));
          vec3 tangentFlow = flow - n * dot(flow, n);
          vec3 skim = (length(tangentFlow) > 1e-4 ? normalize(tangentFlow) : vec3(0.0)) * uSwirl * (1.0 + mids);
          vec3 shapeForce = onSurface + skim;

          vec3 toAttractor = uAttractor - pos;
          float dist = max(length(toAttractor), 8.0);
          vec3 attractForce = (toAttractor / dist) * (600.0 / (dist * dist));
          vec3 explodeForce = radial * uExplode;

          vec3 audioImp = radial * bass * 1.1 + turbulence * highs * 0.7;

          vec3 wander = mix(turbulence, attractForce + explodeForce, uModeBlend);
          vec3 force = mix(wander, shapeForce, uShapeAttract) + audioImp;

          float over = length(pos) - uBounds;
          if(over > 0.0) force -= radial * over * 0.03;

          vel += force * uDelta * 60.0;
          vel *= uDamping;
          vel = clamp(vel, vec3(-45.0), vec3(45.0));
          gl_FragColor = vec4(vel, 1.0);
        }`,
      depthWrite: false, depthTest: false
    });

    // Integration + a positional projection onto the SDF skin. Forces alone leave the cloud
    // orbiting the surface as a blob; snapping the position is what makes the shape crisp.
    this.posMat = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uDelta: { value: 0.016 },
        uTexSize: { value: new THREE.Vector2(this.texWidth, this.texHeight) },
        uTime: { value: 0 }, uSnap: { value: 0.25 }, uShell: { value: 6.0 },
        uShapeA: { value: 0 }, uShapeB: { value: 1 }, uShapeMix: { value: 0 },
        uShapeScale: { value: 120.0 }, uShapeWarp: { value: 0.0 },
        uShapeSpin: { value: 0.12 }, uAudioDeform: { value: 0.0 }
      },
      vertexShader: passVertex,
      fragmentShader: `precision highp float;
        uniform sampler2D uPos; uniform sampler2D uVel; uniform vec2 uTexSize;
        uniform float uDelta, uTime, uSnap, uShell;
        ${NOISE}
        ${SDF}
        ${SDF_FIELD}
        void main(){
          vec2 uv = gl_FragCoord.xy / uTexSize;
          vec4 p = texture2D(uPos, uv);
          vec3 v = texture2D(uVel, uv).xyz;
          vec3 pos = p.xyz + v * uDelta * 60.0;
          if(uSnap > 0.001){
            float d = shapeField(pos, uTime);
            // per-particle shell thickness keeps the surface from reading as a hard crust
            float target = (p.w - 0.5) * uShell;
            vec3 n = shapeNormal(pos, uTime);
            pos -= n * clamp(d - target, -120.0, 120.0) * uSnap;
          }
          gl_FragColor = vec4(pos, p.w);
        }`,
      depthWrite: false, depthTest: false
    });

    // --- point sprites: an accent layer on top of the solid geometry ---
    this.particleGeo = new THREE.BufferGeometry();
    const positions = new Float32Array(particles * 3);
    const uvs = new Float32Array(particles * 2);
    let p = 0, q = 0;
    for(let y=0;y<this.texHeight;y++){
      for(let x=0;x<this.texWidth;x++){
        positions[p++] = 0; positions[p++] = 0; positions[p++] = 0;
        uvs[q++] = (x + 0.5) / this.texWidth;
        uvs[q++] = (y + 0.5) / this.texHeight;
      }
    }
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.particleGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.particleGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), this.bounds * 4);

    this.particleMat = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null },
        uVelTex: { value: null },
        uPointSize: { value: 2.0 },
        uTime: { value: 0.0 },
        uOpacity: { value: 1.0 },
        uPalA: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalB: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalC: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uPalD: { value: new THREE.Vector3(0.0, 0.33, 0.67) }
      },
      vertexShader: `precision highp float;
        uniform sampler2D uPosTex; uniform sampler2D uVelTex;
        uniform float uPointSize, uTime;
        uniform vec3 uPalA, uPalB, uPalC, uPalD;
        varying vec3 vColor; varying float vFade;
        ${PALETTE}
        void main(){
          vec4 p = texture2D(uPosTex, uv);
          vec3 vel = texture2D(uVelTex, uv).xyz;
          float speed = length(vel);
          vColor = cosPalette(p.w * 0.6 + speed * 0.05 + uTime * 0.02, uPalA, uPalB, uPalC, uPalD);
          vColor *= 0.5 + min(speed * 0.15, 1.1);
          vec4 mv = modelViewMatrix * vec4(p.xyz, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPointSize * (300.0 / max(-mv.z, 1.0));
          vFade = clamp(1.0 - (-mv.z - 120.0) / 700.0, 0.12, 1.0);
        }`,
      fragmentShader: `precision highp float;
        varying vec3 vColor; varying float vFade; uniform float uOpacity;
        void main(){
          float d = length(gl_PointCoord - vec2(0.5));
          if(d > 0.5) discard;
          float a = smoothstep(0.5, 0.05, d) * vFade * uOpacity;
          gl_FragColor = vec4(vColor * a, a);
        }`,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });

    this.particlesMesh = new THREE.Points(this.particleGeo, this.particleMat);
    this.particlesMesh.frustumCulled = false;

    this._runPass(this.copyMat, this.posRT1, { uTexture: posInitTex });
    this._runPass(this.copyMat, this.velRT1, { uTexture: velInitTex });
    renderer.setRenderTarget(null);

    this.posRead = this.posRT1; this.posWrite = this.posRT2;
    this.velRead = this.velRT1; this.velWrite = this.velRT2;
    this.posTexture = this.posRead.texture;
    this.velTexture = this.velRead.texture;

    this.initDone = true;
    this._checkGLError('init');
  }

  _runPass(material, target, uniforms){
    if(uniforms) for(const k in uniforms) if(material.uniforms[k]) material.uniforms[k].value = uniforms[k];
    this.computeQuad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.computeScene, this.computeCamera);
  }

  // gl.getError() stalls the pipeline, so only probe while things are still warming up
  _checkGLError(label){
    if(this._frames > 3 || this._broken) return true;
    const gl = this.renderer.getContext();
    const err = gl.getError();
    if(err !== gl.NO_ERROR){
      console.error('WebGL error after', label, err);
      this._broken = true;
      return false;
    }
    return true;
  }

  step(time, delta, bands){
    if(!this.initDone || this._broken) return;
    if(this.simpleFallback) return this._stepCpu(time, delta, bands);

    if(this.mode !== this.targetMode){
      this._modeTimer += delta;
      const t = Math.min(1.0, this._modeTimer / this.modeBlendDuration);
      const from = (this.mode === 'curl') ? 0.0 : 1.0;
      const to = (this.targetMode === 'curl') ? 0.0 : 1.0;
      this.modeBlend = from + (to - from) * t;
      if(t >= 1.0) this.mode = this.targetMode;
    }

    const vu = this.velMat.uniforms;
    vu.uPos.value = this.posRead.texture;
    vu.uVel.value = this.velRead.texture;
    vu.uTime.value = time;
    vu.uDelta.value = delta;
    vu.uNoiseScale.value = this.noiseScale;
    vu.uCurl.value = this.curl;
    vu.uDamping.value = this.damping;
    vu.uModeBlend.value = this.modeBlend;
    vu.uExplode.value = (this.mode === 'explode' || this.targetMode === 'explode') ? (this._pendingExplode || 2.0) : 0.0;
    if(this._pendingAttractor){
      vu.uAttractor.value.set(this._pendingAttractor[0], this._pendingAttractor[1], this._pendingAttractor[2]);
    } else {
      vu.uAttractor.value.set(Math.sin(time*0.7)*50.0, Math.cos(time*0.5)*30.0, Math.sin(time*0.3)*40.0);
    }
    const b = vu.uBands.value;
    for(let i=0;i<6;i++) b[i] = (bands && bands[i]) || 0.0;

    this._runPass(this.velMat, this.velWrite);
    if(!this._checkGLError('velPass')) return;

    this._runPass(this.posMat, this.posWrite, { uPos: this.posRead.texture, uVel: this.velWrite.texture, uDelta: delta, uTime: time });
    if(!this._checkGLError('posPass')) return;

    this.renderer.setRenderTarget(null);

    let tmp = this.posRead; this.posRead = this.posWrite; this.posWrite = tmp;
    tmp = this.velRead; this.velRead = this.velWrite; this.velWrite = tmp;

    this.posTexture = this.posRead.texture;
    this.velTexture = this.velRead.texture;
    this.particleMat.uniforms.uPosTex.value = this.posTexture;
    this.particleMat.uniforms.uVelTex.value = this.velTexture;
    this.particleMat.uniforms.uTime.value = time;
    this._frames++;
  }

  // --- CPU fallback (no WebGL2 / no float render targets) ---
  _initCpuFallback(){
    this.simpleFallback = true;
    this.cpuCount = Math.min(this.count, 15000);
    this.cpuPositions = new Float32Array(this.cpuCount * 3);
    this.cpuVelocities = new Float32Array(this.cpuCount * 3);
    const colors = new Float32Array(this.cpuCount * 3);
    for(let i=0;i<this.cpuCount;i++){
      const ix = i * 3;
      const r = this.bounds * 0.5 * Math.cbrt(Math.random());
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      this.cpuPositions[ix] = r * Math.sin(phi) * Math.cos(theta);
      this.cpuPositions[ix+1] = r * Math.sin(phi) * Math.sin(theta);
      this.cpuPositions[ix+2] = r * Math.cos(phi);
      const c = new THREE.Color().setHSL((i / this.cpuCount) * 0.6 + 0.4, 0.8, 0.6);
      colors[ix] = c.r; colors[ix+1] = c.g; colors[ix+2] = c.b;
    }
    this.cpuGeometry = new THREE.BufferGeometry();
    this.cpuGeometry.setAttribute('position', new THREE.BufferAttribute(this.cpuPositions, 3));
    this.cpuGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.particleMat = new THREE.PointsMaterial({
      size: 2.5, vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    });
    this.particlesMesh = new THREE.Points(this.cpuGeometry, this.particleMat);
    this.particlesMesh.frustumCulled = false;
    this.initDone = true;
    console.warn('NEWFLARE: GPGPU unavailable, using CPU particle fallback.');
  }

  _stepCpu(time, delta, bands){
    const pos = this.cpuPositions, vel = this.cpuVelocities;
    const ax = Math.sin(time*0.7)*50.0, ay = Math.cos(time*0.5)*30.0, az = Math.sin(time*0.3)*40.0;
    const bass = bands ? (bands[0] + bands[1]) : 0;
    for(let i=0;i<this.cpuCount;i++){
      const ix = i * 3;
      const dx = ax - pos[ix], dy = ay - pos[ix+1], dz = az - pos[ix+2];
      const dist = Math.max(Math.sqrt(dx*dx + dy*dy + dz*dz), 8.0);
      const f = 600.0 / (dist * dist) * delta * 60.0;
      const rl = Math.max(Math.hypot(pos[ix], pos[ix+1], pos[ix+2]), 1e-4);
      const push = bass * 1.2 * delta * 60.0;
      vel[ix]   = (vel[ix]   + dx/dist*f + pos[ix]  /rl*push) * this.damping;
      vel[ix+1] = (vel[ix+1] + dy/dist*f + pos[ix+1]/rl*push) * this.damping;
      vel[ix+2] = (vel[ix+2] + dz/dist*f + pos[ix+2]/rl*push) * this.damping;
      pos[ix]   += vel[ix]   * delta * 60.0;
      pos[ix+1] += vel[ix+1] * delta * 60.0;
      pos[ix+2] += vel[ix+2] * delta * 60.0;
    }
    this.cpuGeometry.attributes.position.needsUpdate = true;
  }
}
