import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { PALETTE, MATERIAL } from './ShaderChunks.js';

const BASE_GEOMETRIES = {
  icosa: () => new THREE.IcosahedronGeometry(1, 0),
  tetra: () => new THREE.TetrahedronGeometry(1.25, 0),
  box:   () => new THREE.BoxGeometry(1.4, 1.4, 1.4),
  octa:  () => new THREE.OctahedronGeometry(1.2, 0),
  blade: () => new THREE.ConeGeometry(0.6, 2.6, 4)
};

// Solid instanced geometry advected by the GPGPU simulation. Same motion field as the
// particles, but real filled polyhedra with shading — the shapes layer, not points.
export default class ShardsLayer {
  constructor(options = {}){
    this.count = options.count || 3000;
    this.shape = options.shape || 'icosa';
    this.geometries = {};
    this.mesh = null;
  }

  init(texWidth, texHeight){
    this.texWidth = texWidth; this.texHeight = texHeight;

    const total = texWidth * texHeight;
    const refs = new Float32Array(this.count * 2);
    const seeds = new Float32Array(this.count);
    // spread the instances evenly across the simulation texture
    const stride = Math.max(1, Math.floor(total / this.count));
    for(let i=0;i<this.count;i++){
      const idx = (i * stride) % total;
      const x = idx % texWidth, y = Math.floor(idx / texWidth);
      refs[i*2]   = (x + 0.5) / texWidth;
      refs[i*2+1] = (y + 0.5) / texHeight;
      seeds[i] = Math.random();
    }
    this.refs = new THREE.InstancedBufferAttribute(refs, 2);
    this.seeds = new THREE.InstancedBufferAttribute(seeds, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uPosTex: { value: null },
        uVelTex: { value: null },
        uTime: { value: 0 },
        uScale: { value: 3.2 },
        uEnergy: { value: 0 },
        uBass: { value: 0 },
        uPalA: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalB: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalC: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uPalD: { value: new THREE.Vector3(0.0, 0.33, 0.67) },
        uOpacity: { value: 1.0 },
        uMetal: { value: 0.7 },
        uIrid: { value: 0.55 }
      },
      vertexShader: `precision highp float;
        uniform sampler2D uPosTex; uniform sampler2D uVelTex;
        uniform float uTime; uniform float uScale; uniform float uEnergy; uniform float uBass;
        attribute vec2 aRef; attribute float aSeed;
        varying vec3 vNormalW; varying float vSpeed; varying float vSeed; varying vec3 vViewPos;

        mat3 orient(vec3 dir, float spin){
          vec3 up = length(dir) > 1e-4 ? normalize(dir) : vec3(0.0, 1.0, 0.0);
          vec3 ref = abs(up.y) > 0.95 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 ax = normalize(cross(ref, up));
          vec3 az = cross(up, ax);
          float c = cos(spin), s = sin(spin);
          vec3 rx = ax * c + az * s;
          vec3 rz = -ax * s + az * c;
          return mat3(rx, up, rz);
        }

        void main(){
          vec3 center = texture2D(uPosTex, aRef).xyz;
          vec3 vel = texture2D(uVelTex, aRef).xyz;
          float speed = length(vel);
          mat3 m = orient(vel, uTime * (0.4 + aSeed * 1.6) + aSeed * 6.28);
          // bass makes the solids pop in size, highs stay in the particle layer
          float s = uScale * (0.55 + aSeed * 0.9) * (1.0 + uBass * 0.9 + min(speed * 0.03, 0.6));
          vec3 world = center + m * (position * s);
          vNormalW = normalize(m * normal);
          vSpeed = speed; vSeed = aSeed;
          vec4 mv = modelViewMatrix * vec4(world, 1.0);
          vViewPos = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `precision highp float;
        varying vec3 vNormalW; varying float vSpeed; varying float vSeed; varying vec3 vViewPos;
        uniform vec3 uPalA, uPalB, uPalC, uPalD;
        uniform float uTime; uniform float uEnergy; uniform float uOpacity;
        uniform float uMetal; uniform float uIrid;
        ${PALETTE}
        ${MATERIAL}
        void main(){
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(-vViewPos);
          vec3 l1 = normalize(vec3(0.5, 0.9, 0.6));
          vec3 l2 = normalize(vec3(-0.6, -0.3, 0.5));
          float ndv = max(dot(n, v), 0.0);
          float diff = max(dot(n, l1), 0.0);
          float fill = max(dot(n, l2), 0.0) * 0.4;
          float rim = pow(1.0 - ndv, 2.0);
          float spec = pow(max(dot(reflect(-l1, n), v), 0.0), 40.0);

          float t = vSeed + vSpeed * 0.02 + uTime * 0.03 + uEnergy * 0.2;
          vec3 base = cosPalette(t, uPalA, uPalB, uPalC, uPalD);
          vec3 rimCol = cosPalette(t + 0.4, uPalA, uPalB, uPalC, uPalD);

          vec3 env = envSample(reflect(-v, n), base);
          float f = fresnelSchlick(ndv, mix(0.04, 0.92, uMetal));
          vec3 irid = iridescence(ndv, uIrid);

          vec3 col = base * (0.18 + diff * 0.95 + fill) * (1.0 - uMetal * 0.8)
                   + env * f * (0.5 + uMetal) * irid
                   + rimCol * rim * 1.1 * irid + vec3(spec * (0.5 + uMetal));
          gl_FragColor = vec4(col * uOpacity, 1.0);
        }`,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide
    });

    this.setShape(this.shape);
    return this.mesh;
  }

  _buildGeometry(name){
    if(!this.geometries[name]){
      const base = (BASE_GEOMETRIES[name] || BASE_GEOMETRIES.icosa)();
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute('position', base.attributes.position);
      geo.setAttribute('normal', base.attributes.normal);
      geo.setAttribute('uv', base.attributes.uv);
      geo.setAttribute('aRef', this.refs);
      geo.setAttribute('aSeed', this.seeds);
      geo.instanceCount = this.count;
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4000);
      this.geometries[name] = geo;
    }
    return this.geometries[name];
  }

  setShape(name){
    if(!BASE_GEOMETRIES[name]) name = 'icosa';
    this.shape = name;
    const geo = this._buildGeometry(name);
    if(!this.mesh){
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.frustumCulled = false;
    } else {
      this.mesh.geometry = geo;
    }
  }

  setParams(p = {}){
    const u = this.material.uniforms;
    if(typeof p.shardScale !== 'undefined') u.uScale.value = p.shardScale;
    if(typeof p.shardOpacity !== 'undefined') u.uOpacity.value = p.shardOpacity;
    if(typeof p.metal !== 'undefined') u.uMetal.value = p.metal;
    if(typeof p.irid !== 'undefined') u.uIrid.value = p.irid;
    if(typeof p.shardCount !== 'undefined'){
      const geo = this.mesh && this.mesh.geometry;
      if(geo) geo.instanceCount = Math.max(0, Math.min(this.count, Math.round(p.shardCount)));
    }
    if(p.shardShape && p.shardShape !== this.shape) this.setShape(p.shardShape);
    if(p.palette) this.setPalette(p.palette);
  }

  setPalette(pal){
    const u = this.material.uniforms;
    u.uPalA.value.fromArray(pal.a);
    u.uPalB.value.fromArray(pal.b);
    u.uPalC.value.fromArray(pal.c);
    u.uPalD.value.fromArray(pal.d);
  }

  update(posTex, velTex, time, energy, bass){
    const u = this.material.uniforms;
    u.uPosTex.value = posTex;
    u.uVelTex.value = velTex;
    u.uTime.value = time;
    u.uEnergy.value = energy;
    u.uBass.value = bass;
  }
}
