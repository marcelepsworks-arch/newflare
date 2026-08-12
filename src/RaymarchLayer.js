import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';
import { NOISE, SDF, SDF_FIELD, PALETTE, MATERIAL } from './ShaderChunks.js';

// Solid, lit, procedural geometry raymarched from the shared SDF field.
// This is the "filled shape" layer: it is not made of points at all.
export default class RaymarchLayer {
  constructor(renderer, scale = 0.5){
    this.renderer = renderer;
    // Fractal fields cost far too much at native resolution (a 96-step march over a
    // mandelbulb is ~10^8 SDF evaluations per frame and will trip a GPU reset), so the
    // body is marched at half res and blitted up with its depth intact.
    this.scale = scale;
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
        uProjView: { value: new THREE.Matrix4() },
        uOffsetA: { value: new THREE.Vector3() },
        uOffsetB: { value: new THREE.Vector3() },
        uSplit: { value: 0.0 },
        uScaleRatio: { value: 1.0 },
        uBandDir: { value: [
          new THREE.Vector3( 0.00,  1.00,  0.00),
          new THREE.Vector3( 0.89,  0.45,  0.00),
          new THREE.Vector3( 0.28,  0.00,  0.96),
          new THREE.Vector3(-0.81, -0.20,  0.55),
          new THREE.Vector3(-0.50, -0.85, -0.15),
          new THREE.Vector3( 0.35, -0.30, -0.89)
        ] },
        uBandLevel: { value: new Array(6).fill(0) },
        uBandBulge: { value: 0.22 },
        uBandSharp: { value: 2.2 },
        uLiquid: { value: 0.0 },
        uBandHueSpread: { value: 0.16 },
        uMetal: { value: 0.6 },
        uIrid: { value: 0.5 }
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        varying vec2 vUv;
        uniform float uTime; uniform vec2 uResolution;
        uniform vec3 uCamPos; uniform mat4 uCamMatrix; uniform float uFocal; uniform mat4 uProjView;
        uniform vec3 uPalA, uPalB, uPalC, uPalD;
        uniform float uOpacity, uGlow, uEnergy, uMetal, uIrid;
        uniform float uBandHueSpread;
        ${NOISE}
        ${SDF}
        ${SDF_FIELD}
        ${PALETTE}
        ${MATERIAL}

        void main(){
          vec2 uv = (vUv * 2.0 - 1.0);
          uv.x *= uResolution.x / uResolution.y;

          vec3 ro = uCamPos;
          vec3 rd = normalize((uCamMatrix * vec4(uv, -uFocal, 0.0)).xyz);

          float t = 0.0;
          float hit = -1.0;
          float glow = 0.0;
          float minDist = 1e9;
          for(int i = 0; i < 64; i++){
            vec3 p = ro + rd * t;
            float d = shapeField(p, uTime);
            minDist = min(minDist, d);
            // accumulate proximity glow so the shape reads even when the ray misses
            glow += 0.0035 / (1.0 + d * d * 0.05);
            // tolerance widens with distance: far hits do not need sub-unit precision
            if(d < 0.3 + t * 0.002){ hit = t; break; }
            t += max(d * 0.85, 1.2);
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
            float ndv = max(dot(n, -rd), 0.0);
            float diff = max(dot(n, l1), 0.0);
            float rim = pow(1.0 - ndv, 2.5);
            float spec = pow(max(dot(reflect(-l1, n), -rd), 0.0), 48.0);
            float fill = max(dot(n, l2), 0.0) * 0.35;
            // cheap AO from how early the ray converged: crevices stay dark
            float ao = clamp(minDist / 40.0 + 0.55, 0.0, 1.0);

            // the band that owns this part of the surface tints it, so each frequency
            // reads as its own colour on one continuous body
            vec3 sdir = length(p) > 1e-4 ? normalize(p) : vec3(0.0, 1.0, 0.0);
            float wsum = 0.0, bandHue = 0.0;
            for(int i = 0; i < 6; i++){
              float w = bandWeight(sdir, i) * (0.15 + uBandLevel[i]);
              bandHue += (float(i) / 6.0) * w; wsum += w;
            }
            bandHue = wsum > 1e-4 ? bandHue / wsum : 0.0;

            float tPal = 0.35 + 0.3 * dot(n, vec3(0.0, 1.0, 0.0)) + uEnergy * 0.12
                       + uTime * 0.008 + bandHue * uBandHueSpread;
            vec3 base = cosPalette(tPal, uPalA, uPalB, uPalC, uPalD);
            vec3 rimCol = cosPalette(tPal + 0.35, uPalA, uPalB, uPalC, uPalD);

            // metal reflects the environment instead of scattering light diffusely
            vec3 env = envSample(reflect(rd, n), base);
            float f = fresnelSchlick(ndv, mix(0.04, 0.92, uMetal));
            vec3 irid = iridescence(ndv, uIrid);

            vec3 diffuse = base * (0.25 + diff * 0.9 + fill) * (1.0 - uMetal * 0.8);
            col = (diffuse + env * f * (0.5 + uMetal) * irid) * ao
                + rimCol * rim * 1.3 * irid + vec3(spec) * (0.5 + uMetal);
            col *= 1.0 - smoothstep(300.0, 1200.0, hit) * 0.75; // distance falloff
          }

          vec3 glowCol = cosPalette(uTime * 0.02 + 0.15, uPalA, uPalB, uPalC, uPalD);
          col += glowCol * min(glow, 0.7) * 0.22 * uGlow * (0.4 + uEnergy * 0.8);

          // alpha lets the animated background show through wherever the body is not
          float alpha = hit > 0.0 ? 1.0 : clamp(min(glow, 0.7) * 1.4, 0.0, 1.0);
          gl_FragColor = vec4(col * uOpacity, alpha * uOpacity);
        }`,
      depthWrite: true,
      depthTest: false
    });

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.rt = this._makeTarget(size.x * this.scale, size.y * this.scale);

    // upsample pass: restores both colour and depth into the main scene target
    this.blitMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: null }, uDepth: { value: null } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        varying vec2 vUv; uniform sampler2D uColor; uniform sampler2D uDepth;
        void main(){
          vec4 c = texture2D(uColor, vUv);
          if(c.a <= 0.001) discard;   // leave the background untouched where nothing was hit
          gl_FragColor = c;
          gl_FragDepth = texture2D(uDepth, vUv).r;
        }`,
      transparent: true, depthWrite: true, depthTest: false
    });
    this.blitQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMat);
    this.blitQuad.frustumCulled = false;
    this.blitScene = new THREE.Scene();
    this.blitScene.add(this.blitQuad);
  }

  _makeTarget(w, h){
    const width = Math.max(1, Math.floor(w)), height = Math.max(1, Math.floor(h));
    const rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false
    });
    rt.depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
    return rt;
  }

  setSize(width, height){
    this.rt.setSize(Math.max(1, Math.floor(width * this.scale)), Math.max(1, Math.floor(height * this.scale)));
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
    if(typeof params.liquid !== 'undefined') u.uLiquid.value = params.liquid;
    if(typeof params.split !== 'undefined') u.uSplit.value = params.split;
    if(typeof params.scaleRatio !== 'undefined') u.uScaleRatio.value = params.scaleRatio;
    if(params.offsetA) u.uOffsetA.value.fromArray(params.offsetA);
    if(params.offsetB) u.uOffsetB.value.fromArray(params.offsetB);
    if(typeof params.metal !== 'undefined') u.uMetal.value = params.metal;
    if(typeof params.irid !== 'undefined') u.uIrid.value = params.irid;
    if(typeof params.bandBulge !== 'undefined') u.uBandBulge.value = params.bandBulge;
    if(typeof params.bandHueSpread !== 'undefined') u.uBandHueSpread.value = params.bandHueSpread;
    if(params.bandLevels) for(let i=0;i<6;i++) u.uBandLevel.value[i] = params.bandLevels[i];
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
    u.uResolution.value.set(this.rt.width, this.rt.height);

    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(this.scene, this.camera);

    // upsample into the scene target, restoring depth so solids occlude correctly
    this.blitMat.uniforms.uColor.value = this.rt.texture;
    this.blitMat.uniforms.uDepth.value = this.rt.depthTexture;
    renderer.setRenderTarget(target);
    renderer.render(this.blitScene, this.camera);
  }
}
