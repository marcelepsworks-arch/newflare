# Credits

No source code from any of the audited projects has been copied into Newflare.
Where an algorithm was adapted, it was reimplemented from the described behaviour
and is credited below, as `EXTERNAL_REFERENCES.md` requires.

## Algorithms adapted

**projectM** — https://github.com/projectM-visualizer/projectm (LGPL)
The per-band loudness model in `src/AudioAnalyzer.js` follows the approach in
`src/libprojectM/Audio/Loudness.cpp`: a fast-attack / slow-release average
(0.2 rising, 0.5 falling), a long-running average (0.992) used as the reference,
relative values reported as `current / longAverage` so 1.0 means "normal for this
track", and frame-rate normalisation of every decay rate via `rate^(30 * dt)`.
Reimplemented in JavaScript; no C++ was copied, so the LGPL does not reach this
project.

**MilkDrop** (Ryan Geiss) — https://www.geisswerks.com/milkdrop/
The feedback warp in `src/PostFX.js` follows MilkDrop's per-vertex mesh idea:
zoom and rotation vary with distance from centre (`rad`) plus an angular ripple,
rather than a single global transform. Implemented per-pixel instead of on a mesh.

**Inigo Quilez** — https://iquilezles.org/articles/
Signed distance function primitives, the smooth-minimum (`smin`) fusion operator,
and the cosine palette formula `a + b*cos(2π(c*t + d))` used throughout
`src/ShaderChunks.js` and `src/Presets.js`.

**Krzysztof Narkowicz** — https://knarkowicz.wordpress.com/2016/01/06/aces-filmic-tone-mapping-curve/
The ACES filmic tone mapping approximation in `src/PostFX.js`.

**Beat tracking** — the autocorrelation-of-onset-envelope method in
`src/BeatTracker.js` is the standard MIR approach (Scheirer, Ellis and others),
implemented from the published technique.

## Audited but not used

`EXTERNAL_REFERENCES.md` also lists Hydra, ofxGpuParticles, Particula and
WebGL-Audio-Visualization. Their repositories were not consulted while writing
this code. The ping-pong FBO simulation, spectral flux onset detection and
framebuffer feedback that Newflare implements are standard techniques arrived at
independently, not ports of those projects.
