import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { NOISE, PALETTE } from './ShaderChunks.js';

// Animated backdrop: drifting colour fields fused together with a nebula texture.
// A flat black background is what made the scene read as "a small object in the void";
// this fills the frame and keeps evolving with the track.
export default class BackgroundLayer {
  constructor(){
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: 1 },
        uEnergy: { value: 0 },
        uPulse: { value: 0 },
        uTilt: { value: 0 },
        uIntensity: { value: 0.55 },
        uContrast: { value: 1.0 },
        uPalA: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalB: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalC: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uPalD: { value: new THREE.Vector3(0.0, 0.33, 0.67) }
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        varying vec2 vUv;
        uniform float uTime, uAspect, uEnergy, uPulse, uTilt, uIntensity, uContrast;
        uniform vec3 uPalA, uPalB, uPalC, uPalD;
        ${NOISE}
        ${PALETTE}

        void main(){
          vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
          float t = uTime * 0.06;

          // three drifting colour fields, summed so they blend where they overlap
          vec3 col = vec3(0.0);
          for(int i = 0; i < 3; i++){
            float f = float(i);
            vec2 c = vec2(
              sin(t * (0.7 + f * 0.31) + f * 2.1),
              cos(t * (0.5 + f * 0.27) + f * 1.3)
            ) * (0.34 + f * 0.06);
            float d = length(p - c);
            float w = exp(-d * d * (5.0 - f * 1.1));
            col += cosPalette(f * 0.21 + t * 0.9 + uTilt * 0.15, uPalA, uPalB, uPalC, uPalD) * w;
          }

          // nebula texture so the gradient has structure instead of reading as a blur
          float n = fbm3(vec3(p * 2.3, uTime * 0.04));
          col *= 0.45 + 0.85 * (n * 0.5 + 0.5);

          // horizon-style vertical grade underneath everything
          col += cosPalette(0.6 + t * 0.5, uPalA, uPalB, uPalC, uPalD) * (0.10 + 0.10 * (1.0 - vUv.y));

          col *= uIntensity * (0.65 + uEnergy * 0.5 + uPulse * 0.25);
          col = pow(max(col, 0.0), vec3(uContrast));
          // keep it well below the subject so the geometry still reads as the subject
          gl_FragColor = vec4(min(col, vec3(0.55)), 1.0);
        }`,
      depthWrite: false,
      depthTest: false
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setPalette(pal){
    const u = this.material.uniforms;
    u.uPalA.value.fromArray(pal.a);
    u.uPalB.value.fromArray(pal.b);
    u.uPalC.value.fromArray(pal.c);
    u.uPalD.value.fromArray(pal.d);
  }

  setParams(p = {}){
    if(typeof p.bgIntensity !== 'undefined') this.material.uniforms.uIntensity.value = p.bgIntensity;
    if(typeof p.bgContrast !== 'undefined') this.material.uniforms.uContrast.value = p.bgContrast;
  }

  render(renderer, target, time, energy, pulse, tilt){
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uEnergy.value = energy;
    u.uPulse.value = pulse;
    u.uTilt.value = tilt;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.uAspect.value = size.x / size.y;

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
  }
}
