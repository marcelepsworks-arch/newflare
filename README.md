# Newflare — Audio-Reactive Visualizer (Prototype)

Prototype webapp that demonstrates audio capture (file, tab, mic), basic audio analysis and a WebGL particle visualizer.

Run locally (recommended):

```bash
# from project folder
npx serve .
# or
python -m http.server 3000
```

Open `http://localhost:3000` and load a local MP3 or capture a tab.

Files of interest:
- `index.html` — app shell
- `src/AudioSourceManager.js` — load file, capture tab, mic
- `src/AudioAnalyzer.js` — analyser + 6 bands + spectral flux
- `src/Renderer.js` — Three.js prototype renderer
- `src/Recorder.js` — start/stop recording (MediaRecorder fallback)
-
Run with built-in Node static server:

```bash
node server.js
# then open http://localhost:3000
```

Or use the npm script:

```bash
npm start
# or
npm run serve:npx
```

Notes:
- For tab capture, select the tab with audio when prompted by the browser.
- For 4K recording, use a capable machine and consider increasing `bitsPerSecond` in `Recorder.js`.
