import AudioSourceManager from './AudioSourceManager.js';
import AudioAnalyzer from './AudioAnalyzer.js';
import Renderer from './Renderer.js';
import { startRecording } from './Recorder.js';

let audioManager;
let analyzer;
let renderer;
let recorderHandle = null;

async function init() {
  // client-side error handlers (will show overlay)
  window.addEventListener('error', (ev)=>{
    const overlay = document.getElementById('errorOverlay');
    overlay.style.display = 'block';
    overlay.textContent = `[Error] ${ev.message} at ${ev.filename}:${ev.lineno}`;
    console.error(ev.error || ev.message);
  });
  window.addEventListener('unhandledrejection', (ev)=>{
    const overlay = document.getElementById('errorOverlay');
    overlay.style.display = 'block';
    overlay.textContent = `[UnhandledRejection] ${ev.reason}`;
    console.error('UnhandledRejection', ev.reason);
  });

  // Audio and UI come up first and independently of WebGL: if the renderer fails, the
  // user must still be able to load a track rather than face dead controls.
  audioManager = new AudioSourceManager();
  await audioManager.init();
  analyzer = new AudioAnalyzer(audioManager.getAudioContext(), audioManager.getAnalysisNode());
  bindUI();

  const canvas = document.getElementById('glCanvas');
  renderer = new Renderer(canvas);
  try{
    await renderer.init();
  }catch(err){
    console.error('Renderer init failed', err);
    const overlay = document.getElementById('errorOverlay');
    overlay.style.display = 'block';
    overlay.textContent = 'El motor gràfic no ha pogut arrencar: ' + (err.message || err);
    return;
  }

  // debug handle: lets tooling drive the audio graph and inspect live features
  window.__NEWFLARE = { audioManager, analyzer, renderer };

  renderer.start((time, dt)=>{
    try{
      const features = analyzer.getFeatures();
      renderer.update(time, features, dt);
      updateHud(features);
    }catch(err){
      console.error('Render callback error', err);
    }
  });
}

// Small readout so it is obvious at a glance whether the visuals are hearing the track.
function updateHud(features){
  const hud = document.getElementById('audioHud');
  if(!hud) return;
  const level = Math.min(1, features.energyNorm || 0);
  document.getElementById('hudLevel').style.width = (level * 100).toFixed(0) + '%';
  const locked = (features.beatConfidence || 0) > 0.15;
  document.getElementById('hudBpm').textContent = locked ? Math.round(features.bpm) + ' BPM' : '— BPM';
  const dot = document.getElementById('hudBeat');
  dot.style.opacity = (0.15 + (features.beatPulse || 0) * 0.85).toFixed(2);
  dot.style.transform = `scale(${(0.8 + (features.beatPulse || 0) * 0.6).toFixed(2)})`;
}

function bindUI(){
  const overlay = document.getElementById('errorOverlay');
  function showOverlay(msg, autoHideMs = 4000){
    overlay.style.display = 'block';
    overlay.textContent = msg;
    if(autoHideMs>0){ setTimeout(()=>{ overlay.style.display='none'; }, autoHideMs); }
  }

  function hideOverlay(){ overlay.style.display='none'; }

  document.getElementById('fileInput').addEventListener('change', async (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    try{
      await audioManager.loadFile(file);
      hideOverlay();
    }catch(err){
      console.error('loadFile failed', err);
      showOverlay('Error carregant el fitxer: '+(err.message||err));
    }
  });

  document.getElementById('captureTabBtn').addEventListener('click', async ()=>{
    try{
      const s = await audioManager.captureTab();
      if(s) hideOverlay();
    }catch(err){
      console.warn('captureTab failed', err);
      // user cancelled or denied permission; show friendly hint
      showOverlay('Captura cancel·lada o permisos denegats. Selecciona una pestanya amb àudio i prem "Comparteix".', 5000);
    }
  });

  document.getElementById('micBtn').addEventListener('click', async ()=>{
    try{
      await audioManager.useMic();
      hideOverlay();
    }catch(err){
      console.warn('Mic access denied', err);
      showOverlay('Accés al micròfon denegat o error. Revisa permisos del navegador.', 5000);
    }
  });

  document.getElementById('startVisualBtn').addEventListener('click', ()=>{
    (async ()=>{
      console.log('Start Visual clicked');
      try{
        // Ensure AudioContext resumed on user gesture
        try{ await audioManager.getAudioContext().resume(); }catch(e){ console.warn('AudioContext resume warning', e); }

        renderer.start((time, dt)=>{
          try{
            const features = analyzer.getFeatures();
            renderer.update(time, features, dt);
          }catch(err){
            console.error('Render callback error', err);
          }
        });
        hideOverlay();
      }catch(err){
        console.error('Failed to start renderer', err);
        showOverlay('Error iniciant visual: '+(err.message||err));
      }
    })();
  });

  document.getElementById('recBtn').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    if(!recorderHandle){
      // start recording
      recorderHandle = startRecording(renderer.canvas, audioManager.getAudioContext(), { frameRate:60 });
      // connect master gain to recorder audio destination for synced audio
      if(recorderHandle && recorderHandle.audioDestination){
        audioManager.getMasterNode().connect(recorderHandle.audioDestination);
      }
      btn.textContent = 'STOP';
    } else {
      const blob = await recorderHandle.stop();
      // disconnect master gain from recorder destination
      try{ audioManager.getMasterNode().disconnect(recorderHandle.audioDestination); }catch(e){}
      const url = URL.createObjectURL(blob);
      const link = document.getElementById('downloadLink');
      link.href = url; link.download = 'newflare_capture.webm'; link.style.display = 'inline-block'; link.textContent = 'Download Recording';
      btn.textContent = 'REC';
      recorderHandle = null;
    }
  });
}

window.addEventListener('DOMContentLoaded', ()=>init());
