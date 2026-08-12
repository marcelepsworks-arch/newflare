# External references and suggested modules to adapt

This file summarizes repos audited in Phase 0 and the specific ideas/parts to port or reimplement in JS/GLSL.

- projectM (https://github.com/projectM-visualizer/projectm)
  - Relevant: `src/libprojectM` (FFT handling, beat/onset detection logic, energy buffers, preset transition math).\
  - Note: projectM is LGPL — do not copy C++ verbatim; reimplement algorithms in JS and document inspiration.

- Hydra (https://github.com/hydra-synth/hydra)
  - Relevant: multi-stage buffer feedback patterns, framebuffers compositing methods, audio bindings (uses Meyda for FFT), and live-coding modulation pipeline.
  - Files of interest: frontend shader and buffer management in `frontend/` and `hydra-synth` module.

- ofxGpuParticles (https://github.com/neilmendoza/ofxGpuParticles)
  - Relevant: ping-pong FBO patterns, GLSL update shaders for velocity/position, example shaders for curl noise and constraints.
  - Files of interest: `src/` and example shaders in `example/` folder.

- Particula (https://github.com/Humprt/particula)
  - Relevant: `main.js` Three.js particle bindings, presets management, and audio-reactive mappings.

- WebGL-Audio-Visualization (https://github.com/macobo/WebGL-Audio-Visualization)
  - Relevant: WebAudio `AnalyserNode` usage, beat detection heuristics, vertex-displacement techniques (sphere/torus demos).

Guidelines for reuse:
- Reuse algorithm ideas and shader patterns; rewrite in JS/GLSL and ensure licensing compatibility.
- Extract inspiration for ping-pong buffer setup, spectral flux approach, and palette cosines.

Links:
- projectM: https://github.com/projectM-visualizer/projectm
- hydra: https://github.com/ojack/hydra
- ofxGpuParticles: https://github.com/neilmendoza/ofxGpuParticles
- particula: https://github.com/Humprt/particula
- WebGL-Audio-Visualization: https://github.com/macobo/WebGL-Audio-Visualization

"Do not copy" note: Respect original licenses. When in doubt, port algorithms conceptually and credit the sources in `CREDITS.md`.
