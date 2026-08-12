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

  const canvas = document.getElementById('glCanvas');
  console.log('init: creating renderer');
  renderer = new Renderer(canvas);
  await renderer.init();

  audioManager = new AudioSourceManager();
  await audioManager.init();
  console.log('init: audio manager ready');

  analyzer = new AudioAnalyzer(audioManager.getAudioContext(), audioManager.getMasterNode());
  console.log('init: analyzer created');

  bindUI();
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
    renderer.start((time)=>{
      const features = analyzer.getFeatures();
      renderer.update(time, features);
    });
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
