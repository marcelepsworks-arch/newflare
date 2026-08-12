import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { NOISE, SDF, SDF_FIELD, PALETTE } from './ShaderChunks.js';

// Solid, lit, procedural geometry raymarched from the shared SDF field.
// This is the "filled shape" layer: it is not made of points at all.
export default class RaymarchLayer {
  constructor(){
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uCamPos: { value: new THREE.Vector3(0, 0, 300) },
        uCamMatrix: { value: new THREE.Matrix4() },
        uFocal: { value: 1.4 },
        uShapeA: { value: 0 },
        uShapeB: { value: 1 },
        uShapeMix: { value: 0 },
        uShapeScale: { value: 120.0 },
        uShapeWarp: { value: 0.0 },
        uShapeSpin: { value: 0.12 },
        uAudioDeform: { value: 0.0 },
        uPalA: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalB: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
        uPalC: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
        uPalD: { value: new THREE.Vector3(0.0, 0.33, 0.67) },
        uOpacity: { value: 1.0 },
        uGlow: { value: 1.0 },
        uEnergy: { value: 0.0 },
        uProjView: { value: new THREE.Matrix4() }
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        varying vec2 vUv;
        uniform float uTime; uniform vec2 uResolution;
        uniform vec3 uCamPos; uniform mat4 uCamMatrix; uniform float uFocal; uniform mat4 uProjView;
        uniform vec3 uPalA, uPalB, uPalC, uPalD;
        uniform float uOpacity, uGlow, uEnergy;
        ${NOISE}
        ${SDF}
        ${SDF_FIELD}
        ${PALETTE}

        void main(){
          vec2 uv = (vUv * 2.0 - 1.0);
          uv.x *= uResolution.x / uResolution.y;

          vec3 ro = uCamPos;
          vec3 rd = normalize((uCamMatrix * vec4(uv, -uFocal, 0.0)).xyz);

          float t = 0.0;
          float hit = -1.0;
          float glow = 0.0;
          float minDist = 1e9;
          for(int i = 0; i < 96; i++){
            vec3 p = ro + rd * t;
            float d = shapeField(p, uTime);
            minDist = min(minDist, d);
            // accumulate proximity glow so the shape reads even when the ray misses
            glow += 0.006 / (1.0 + d * d * 0.02);
            if(d < 0.35){ hit = t; break; }
            t += max(d * 0.75, 0.6);
            if(t > 1400.0) break;
          }

          vec3 col = vec3(0.0);
          // on WebGL2 three.js compiles ShaderMaterial as ESSL 3.00, so gl_FragDepth is core.
          // Writing it lets the instanced solids depth-test against the raymarched body.
          gl_FragDepth = 1.0;
          if(hit > 0.0){
            vec3 p = ro + rd * hit;
            vec4 clip = uProjView * vec4(p, 1.0);
            gl_FragDepth = clamp(clip.z / clip.w * 0.5 + 0.5, 0.0, 1.0);
            vec3 n = shapeNormal(p, uTime);
            vec3 l1 = normalize(vec3(0.6, 0.8, 0.4));
            vec3 l2 = normalize(vec3(-0.5, -0.2, 0.7));
            float diff = max(dot(n, l1), 0.0);
            float rim = pow(1.0 - max(dot(n, -rd), 0.0), 2.5);
            float spec = pow(max(dot(reflect(-l1, n), -rd), 0.0), 32.0);
            float fill = max(dot(n, l2), 0.0) * 0.35;

            float tPal = 0.5 + 0.5 * dot(n, vec3(0.0, 1.0, 0.0)) + uEnergy * 0.25 + uTime * 0.01;
            vec3 base = cosPalette(tPal, uPalA, uPalB, uPalC, uPalD);
            vec3 rimCol = cosPalette(tPal + 0.35, uPalA, uPalB, uPalC, uPalD);

            col = base * (0.25 + diff * 0.9 + fill) + rimCol * rim * 1.6 + vec3(spec) * 0.7;
            col *= 1.0 - smoothstep(300.0, 1200.0, hit) * 0.75; // distance falloff
          }

          vec3 glowCol = cosPalette(uTime * 0.02 + 0.15, uPalA, uPalB, uPalC, uPalD);
          col += glowCol * min(glow, 1.2) * 0.28 * uGlow * (0.5 + uEnergy);

          gl_FragColor = vec4(col * uOpacity, 1.0);
        }`,
      depthWrite: true,
      depthTest: false
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setShape(params){
    const u = this.material.uniforms;
    if(typeof params.shapeA !== 'undefined') u.uShapeA.value = params.shapeA;
    if(typeof params.shapeB !== 'undefined') u.uShapeB.value = params.shapeB;
    if(typeof params.shapeMix !== 'undefined') u.uShapeMix.value = params.shapeMix;
    if(typeof params.shapeScale !== 'undefined') u.uShapeScale.value = params.shapeScale;
    if(typeof params.shapeWarp !== 'undefined') u.uShapeWarp.value = params.shapeWarp;
    if(typeof params.shapeSpin !== 'undefined') u.uShapeSpin.value = params.shapeSpin;
    if(typeof params.audioDeform !== 'undefined') u.uAudioDeform.value = params.audioDeform;
    if(typeof params.raymarchOpacity !== 'undefined') u.uOpacity.value = params.raymarchOpacity;
    if(typeof params.glow !== 'undefined') u.uGlow.value = params.glow;
    if(params.palette) this.setPalette(params.palette);
  }

  setPalette(pal){
    const u = this.material.uniforms;
    u.uPalA.value.fromArray(pal.a);
    u.uPalB.value.fromArray(pal.b);
    u.uPalC.value.fromArray(pal.c);
    u.uPalD.value.fromArray(pal.d);
  }

  render(renderer, camera, time, energy, target){
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uEnergy.value = energy;
    u.uCamPos.value.copy(camera.position);
    u.uCamMatrix.value.copy(camera.matrixWorld);
    u.uFocal.value = 1.0 / Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
    u.uProjView.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    u.uResolution.value.copy(size);

    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);
  }
}
