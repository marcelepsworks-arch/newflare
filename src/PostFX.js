import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.154.0/build/three.module.js';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`;

// Feedback trails, bloom, anamorphic streaks, star glints, god rays, lens ghosts,
// film grain and ACES tone mapping.
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
    this.fxA = this._rt(this.width >> 2, this.height >> 2);
    this.fxB = this._rt(this.width >> 2, this.height >> 2);
    this.raysRT = this._rt(this.width >> 2, this.height >> 2);

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
      uniforms: { uTexture: { value: null }, uThreshold: { value: 0.75 } },
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

    // Anamorphic streak + star glint in one pass: a long horizontal smear plus two
    // shorter diagonals, which is what reads as a modern lens rather than a plain blur.
    this.glintMat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null }, uTexel: { value: new THREE.Vector2() },
        uStreakLength: { value: 1.0 }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv; uniform sampler2D uTexture; uniform vec2 uTexel; uniform float uStreakLength;
        vec3 streak(vec2 dir, float len, float falloff){
          vec3 sum = vec3(0.0);
          float total = 0.0;
          for(int i = 1; i <= 12; i++){
            float f = float(i);
            float w = pow(falloff, f);
            vec2 o = dir * uTexel * f * len;
            sum += (texture2D(uTexture, vUv + o).rgb + texture2D(uTexture, vUv - o).rgb) * w;
            total += 2.0 * w;
          }
          return sum / max(total, 1e-4);
        }
        void main(){
          vec3 core = texture2D(uTexture, vUv).rgb;
          vec3 h = streak(vec2(1.0, 0.0), 6.0 * uStreakLength, 0.92);
          vec3 d1 = streak(normalize(vec2(1.0, 1.0)), 3.0 * uStreakLength, 0.84);
          vec3 d2 = streak(normalize(vec2(-1.0, 1.0)), 3.0 * uStreakLength, 0.84);
          // cool tint on the long axis is the classic anamorphic signature
          vec3 col = h * vec3(0.55, 0.75, 1.25) * 1.1 + (d1 + d2) * 0.30 + core * 0.25;
          gl_FragColor = vec4(col, 1.0);
        }`,
      depthWrite: false, depthTest: false
    });

    // Radial scatter from the frame centre — volumetric shafts off the bright body.
    this.raysMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null }, uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uDensity: { value: 0.55 } },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv; uniform sampler2D uTexture; uniform vec2 uCenter; uniform float uDensity;
        void main(){
          vec2 delta = (vUv - uCenter) * uDensity / 24.0;
          vec2 uv = vUv;
          vec3 sum = vec3(0.0);
          float w = 1.0;
          for(int i = 0; i < 24; i++){
            sum += texture2D(uTexture, uv).rgb * w;
            uv -= delta;
            w *= 0.94;
          }
          gl_FragColor = vec4(sum / 24.0, 1.0);
        }`,
      depthWrite: false, depthTest: false
    });

    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: {
        uScene: { value: null }, uBloom: { value: null }, uGlint: { value: null }, uRays: { value: null },
        uBloomStrength: { value: 0.7 }, uStreak: { value: 0.30 }, uRayStrength: { value: 0.18 },
        uGhosts: { value: 0.12 }, uGrain: { value: 0.045 },
        uExposure: { value: 0.95 }, uChroma: { value: 0.0018 }, uVignette: { value: 0.40 },
        uTime: { value: 0 }
      },
      vertexShader: QUAD_VS,
      fragmentShader: `precision highp float;
        varying vec2 vUv;
        uniform sampler2D uScene, uBloom, uGlint, uRays;
        uniform float uBloomStrength, uStreak, uRayStrength, uGhosts, uGrain;
        uniform float uExposure, uChroma, uVignette, uTime;

        // ACES filmic approximation (Narkowicz) — the modern film response curve
        vec3 aces(vec3 x){
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }

        // mirrored, scaled copies of the bloom: lens ghosts down the optical axis
        vec3 ghosts(vec2 uv){
          vec3 sum = vec3(0.0);
          vec2 v = 0.5 - uv;
          sum += texture2D(uBloom, 0.5 - v * 0.55).rgb * vec3(0.35, 0.55, 1.0);
          sum += texture2D(uBloom, 0.5 - v * 1.45).rgb * vec3(1.0, 0.45, 0.30);
          sum += texture2D(uBloom, 0.5 - v * 2.30).rgb * vec3(0.45, 1.00, 0.55);
          return sum;
        }

        float hash12(vec2 p){
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main(){
          vec2 d = (vUv - 0.5) * uChroma;
          vec3 c;
          c.r = texture2D(uScene, vUv + d).r;
          c.g = texture2D(uScene, vUv).g;
          c.b = texture2D(uScene, vUv - d).b;

          c += texture2D(uBloom, vUv).rgb * uBloomStrength;
          c += texture2D(uGlint, vUv).rgb * uStreak;
          c += texture2D(uRays, vUv).rgb * uRayStrength;
          c += ghosts(vUv) * uGhosts;

          c *= uExposure;
          c = aces(c);
          c = pow(c, vec3(1.0 / 2.2));

          float r = length(vUv - 0.5);
          c *= 1.0 - uVignette * smoothstep(0.35, 0.90, r);
          // grain last, so it sits in the image rather than getting bloomed
          c += (hash12(vUv * 1024.0 + fract(uTime) * 91.7) - 0.5) * uGrain;

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
    this.fxA.setSize(width >> 2, height >> 2);
    this.fxB.setSize(width >> 2, height >> 2);
    this.raysRT.setSize(width >> 2, height >> 2);
    this.feedbackMat.uniforms.uAspect.value = width / height;
  }

  setParams(p = {}){
    const fb = this.feedbackMat.uniforms, co = this.compositeMat.uniforms;
    if(typeof p.trailDecay !== 'undefined') fb.uDecay.value = p.trailDecay;
    if(typeof p.feedbackZoom !== 'undefined') fb.uZoom.value = p.feedbackZoom;
    if(typeof p.feedbackRotate !== 'undefined') fb.uRotate.value = p.feedbackRotate;
    if(typeof p.bloom !== 'undefined') co.uBloomStrength.value = p.bloom;
    if(typeof p.streak !== 'undefined') co.uStreak.value = p.streak;
    if(typeof p.rays !== 'undefined') co.uRayStrength.value = p.rays;
    if(typeof p.ghosts !== 'undefined') co.uGhosts.value = p.ghosts;
    if(typeof p.grain !== 'undefined') co.uGrain.value = p.grain;
    if(typeof p.exposure !== 'undefined') co.uExposure.value = p.exposure;
    if(typeof p.chroma !== 'undefined') co.uChroma.value = p.chroma;
    if(typeof p.vignette !== 'undefined') co.uVignette.value = p.vignette;
  }

  // beat-synced flash: a short lift on bloom/streaks the frame the beat lands
  setPulse(pulse){
    this._pulse = pulse || 0;
  }

  _pass(material, target, uniforms){
    if(uniforms) for(const k in uniforms) if(material.uniforms[k]) material.uniforms[k].value = uniforms[k];
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  // sceneRT already holds the rendered frame; produces the final image on screen
  present(time){
    this._pass(this.feedbackMat, this.feedbackB, { uScene: this.sceneRT.texture, uPrev: this.feedbackA.texture });
    const swap = this.feedbackA; this.feedbackA = this.feedbackB; this.feedbackB = swap;
    const lit = this.feedbackA.texture;

    this._pass(this.brightMat, this.bloomA, { uTexture: lit });
    const halfTexel = new THREE.Vector2(1 / (this.width >> 1), 1 / (this.height >> 1));
    for(let i = 0; i < 2; i++){
      this._pass(this.blurMat, this.bloomB, { uTexture: this.bloomA.texture, uDirection: new THREE.Vector2(1, 0), uTexel: halfTexel });
      this._pass(this.blurMat, this.bloomA, { uTexture: this.bloomB.texture, uDirection: new THREE.Vector2(0, 1), uTexel: halfTexel });
    }

    const quarterTexel = new THREE.Vector2(1 / (this.width >> 2), 1 / (this.height >> 2));
    this._pass(this.brightMat, this.fxA, { uTexture: lit, uThreshold: 0.95 });
    this._pass(this.glintMat, this.fxB, { uTexture: this.fxA.texture, uTexel: quarterTexel });
    this._pass(this.raysMat, this.raysRT, { uTexture: this.fxA.texture });
    this.brightMat.uniforms.uThreshold.value = 0.75;

    const pulse = this._pulse || 0;
    const co = this.compositeMat.uniforms;
    const baseBloom = co.uBloomStrength.value, baseStreak = co.uStreak.value;
    co.uBloomStrength.value = baseBloom * (1 + pulse * 0.5);
    co.uStreak.value = baseStreak * (1 + pulse * 0.9);
    this._pass(this.compositeMat, null, {
      uScene: lit, uBloom: this.bloomA.texture, uGlint: this.fxB.texture,
      uRays: this.raysRT.texture, uTime: time || 0
    });
    co.uBloomStrength.value = baseBloom;
    co.uStreak.value = baseStreak;

    this.renderer.setRenderTarget(null);
  }
}
