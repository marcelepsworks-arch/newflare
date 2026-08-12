import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`;

// Feedback trails (with warp) + bloom + tone mapping.
export default class PostFX {
  constructor(renderer){
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.width = size.x; this.height = size.y;

    this.sceneRT = this._rt(this.width, this.height, true);
    this.feedbackA = this._rt(this.width, this.height);
    this.feedbackB = this._rt(this.width, this.height);
    this.bloomA = this._rt(this.width >> 1, this.height >> 1);
    this.bloomB = this._rt(this.width >> 1, this.height >> 1);

    this.feedbackMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null }, uPrev: { value: null },
        uDecay: { value: 0.9 }, uZoom: { value: 1.002 }, uRotate: { value: 0.0 },
        uAspect: { value: this.width / this.height }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene; uniform sampler2D uPrev;
        uniform float uDecay, uZoom, uRotate, uAspect;
        void main(){
          vec2 c = vUv - 0.5;
          c.x *= uAspect;
          float s = sin(uRotate), co = cos(uRotate);
          c = mat2(co, -s, s, co) * c / uZoom;
          c.x /= uAspect;
          vec2 warped = c + 0.5;
          vec3 prev = texture2D(uPrev, warped).rgb * uDecay;
          if(warped.x < 0.0 || warped.x > 1.0 || warped.y < 0.0 || warped.y > 1.0) prev = vec3(0.0);
          // max() instead of additive: trails decay cleanly and can never run away to white
          gl_FragColor = vec4(max(texture2D(uScene, vUv).rgb, prev), 1.0);
        }`,
      depthWrite: false, depthTest: false
    });

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null }, uThreshold: { value: 0.55 } },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv; uniform sampler2D uTexture; uniform float uThreshold;
        void main(){
          vec3 c = texture2D(uTexture, vUv).rgb;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.4, l), 1.0);
        }`,
      depthWrite: false, depthTest: false
    });

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null }, uDirection: { value: new THREE.Vector2(1, 0) }, uTexel: { value: new THREE.Vector2() } },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv; uniform sampler2D uTexture; uniform vec2 uDirection; uniform vec2 uTexel;
        void main(){
          vec2 o = uDirection * uTexel;
          vec3 c = texture2D(uTexture, vUv).rgb * 0.227027;
          c += (texture2D(uTexture, vUv + o * 1.3846).rgb + texture2D(uTexture, vUv - o * 1.3846).rgb) * 0.316216;
          c += (texture2D(uTexture, vUv + o * 3.2308).rgb + texture2D(uTexture, vUv - o * 3.2308).rgb) * 0.070270;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthWrite: false, depthTest: false
    });

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null }, uBloom: { value: null },
        uBloomStrength: { value: 0.9 }, uExposure: { value: 1.15 },
        uChroma: { value: 0.0018 }, uVignette: { value: 0.35 }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene; uniform sampler2D uBloom;
        uniform float uBloomStrength, uExposure, uChroma, uVignette;
        void main(){
          vec2 d = (vUv - 0.5) * uChroma;
          vec3 c;
          c.r = texture2D(uScene, vUv + d).r;
          c.g = texture2D(uScene, vUv).g;
          c.b = texture2D(uScene, vUv - d).b;
          c += texture2D(uBloom, vUv).rgb * uBloomStrength;
          c *= uExposure;
          c = c / (c + vec3(1.0));                       // Reinhard
          c = pow(c, vec3(1.0 / 2.2));                   // gamma
          float r = length(vUv - 0.5);
          c *= 1.0 - uVignette * smoothstep(0.35, 0.85, r);
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthWrite: false, depthTest: false
    });
  }

  _rt(w, h, depth = false){
    return new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      depthBuffer: depth,
      stencilBuffer: false
    });
  }

  setSize(width, height){
    this.width = width; this.height = height;
    this.sceneRT.setSize(width, height);
    this.feedbackA.setSize(width, height);
    this.feedbackB.setSize(width, height);
    this.bloomA.setSize(width >> 1, height >> 1);
    this.bloomB.setSize(width >> 1, height >> 1);
    this.feedbackMat.uniforms.uAspect.value = width / height;
  }

  setParams(p = {}){
    if(typeof p.trailDecay !== 'undefined') this.feedbackMat.uniforms.uDecay.value = p.trailDecay;
    if(typeof p.feedbackZoom !== 'undefined') this.feedbackMat.uniforms.uZoom.value = p.feedbackZoom;
    if(typeof p.feedbackRotate !== 'undefined') this.feedbackMat.uniforms.uRotate.value = p.feedbackRotate;
    if(typeof p.bloom !== 'undefined') this.compositeMat.uniforms.uBloomStrength.value = p.bloom;
    if(typeof p.exposure !== 'undefined') this.compositeMat.uniforms.uExposure.value = p.exposure;
    if(typeof p.chroma !== 'undefined') this.compositeMat.uniforms.uChroma.value = p.chroma;
    if(typeof p.vignette !== 'undefined') this.compositeMat.uniforms.uVignette.value = p.vignette;
  }

  _pass(material, target, uniforms){
    if(uniforms) for(const k in uniforms) if(material.uniforms[k]) material.uniforms[k].value = uniforms[k];
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // sceneRT already holds the rendered frame; produces the final image on screen
  present(){
    const r = this.renderer;

    this._pass(this.feedbackMat, this.feedbackB, { uScene: this.sceneRT.texture, uPrev: this.feedbackA.texture });
    const swap = this.feedbackA; this.feedbackA = this.feedbackB; this.feedbackB = swap;
    const lit = this.feedbackA.texture;

    this._pass(this.brightMat, this.bloomA, { uTexture: lit });
    const texel = new THREE.Vector2(1 / (this.width >> 1), 1 / (this.height >> 1));
    for(let i = 0; i < 2; i++){
      this._pass(this.blurMat, this.bloomB, { uTexture: this.bloomA.texture, uDirection: new THREE.Vector2(1, 0), uTexel: texel });
      this._pass(this.blurMat, this.bloomA, { uTexture: this.bloomB.texture, uDirection: new THREE.Vector2(0, 1), uTexel: texel });
    }

    this._pass(this.compositeMat, null, { uScene: lit, uBloom: this.bloomA.texture });
    r.setRenderTarget(null);
  }
}
