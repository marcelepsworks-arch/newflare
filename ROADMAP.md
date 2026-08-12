# Newflare — Roadmap

Objectiu: Crear una webapp premium d'un visualitzador audio-reactiu en temps real, 4K, amb opcions d'entrada múltiples, GPGPU particles, SDF raymarching, i gravació d'àudio/vídeo de qualitat.

Fases i entregables

Phase 0 — Audit (Complet)
- Auditar repos: projectM, Hydra, ofxGpuParticles, Particula, WebGL-Audio-Visualization
- Resultat: Llista de mòduls a adaptar i llicències (LGPL, MIT)

Phase 1 — Scaffold i infra bàsica (2 setmanes)
- Crear repo, `index.html`, `main.js`, `package.json`
- `AudioSourceManager.js` (FilePicker, Drag&Drop, Tab capture, Mic)
- `AudioAnalyzer.js` (WebAudio AnalyserNode, FFT bins, spectral flux)
- Entrega: demo BETA local (carregar MP3 i veure espectre)

Phase 2 — Motor gràfic i GPGPU particles (3-4 setmanes)
- Integrar Three.js + WebGL2 renderer (fallback WebGPU opcional)
- `ParticlesGPGPU.js` amb ping-pong render targets i shaders GLSL
- SDF raymarching shaders per formes procedurals
- Entrega: Visualitzador interactiu amb paràmetres bàsics

Phase 3 — DSP avançat i detecció d'onsets (2 setmanes)
- Implementar spectral flux + peak picking, RMS, energy buffer (60 frames)
- Smooth per-banda i mapping a paràmetres visuals
- Entrega: Onset events fiables i sincronització amb presets

Phase 4 — UI, presets i presets morphing (2 setmanes)
- `lil-gui` o Web Component UI, gestor de presets JSON amb crossfade
- Paletes cosinus, exposició, bloom, FOV, resolució dinàmica
- Entrega: Editor de presets i galeríes

Phase 5 — Gravació i export (2 setmanes)
- `Recorder.js` (MediaRecorder + WebCodecs fallback), configuracions 4K@60
- Opcions de bitrate, format, i escalat dinàmic
- Entrega: Export MP4/WebM descargable

Phase 6 — Optimització + Testing (Ongoing)
- Dynamic resolution scaling, perf profiling (Chrome DevTools), test hardware
- Docs, examples, presets pack, deploy

Prioritats immediates
1. Scaffold i `AudioSourceManager.js` + demo MP3 upload
2. Implementar `AudioAnalyzer.js` amb 6 bandes i spectral flux
3. Primer pipeline GPGPU per partícules (ping-pong)

Riscos i dependències
- Llicències: projectM LGPL (cal revisar abans d'incorporar codi C++ directament)
- Captura d'àudio de pestanya depèn de l'usuari seleccionant la pestanya amb `getDisplayMedia` i permisos
- WebCodecs no està disponible en tots els navegadors; usar `MediaRecorder` com a fallback

Estimació total: 10-12 setmanes per un MVP robust (una sola persona amb experiència en WebGL/WebAudio), menys si s'aproven mòduls portats.

Contacte i repositori local: c:/Users/User/Documents/Programació/Newflare
