export default class AudioSourceManager {
  constructor(){
    this.audioContext = null;
    this.masterGain = null;
    this.currentSource = null;
    this.mediaElement = null;
  }

  async init(){
    if(!this.audioContext){
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = 1.0;
      this.masterGain.connect(this.audioContext.destination);
    }
  }

  getAudioContext(){ return this.audioContext; }
  getMasterNode(){ return this.masterGain; }

  async loadFile(file){
    // create media element and connect
    if(this.mediaElement){
      this.mediaElement.pause();
      this.mediaElement.remove();
      this.mediaElement = null;
    }
    if(this.currentBufferSource){
      try{ this.currentBufferSource.stop(); }catch(e){}
      this.currentBufferSource = null;
    }

    const url = URL.createObjectURL(file);
    const isVideo = file.type && file.type.startsWith && file.type.startsWith('video/');
    const el = document.createElement(isVideo ? 'video' : 'audio');
    el.src = url; el.crossOrigin = 'anonymous'; el.controls = true; el.loop = true; el.autoplay = true;
    el.style.display = 'none'; document.body.appendChild(el);
    this.mediaElement = el;

    // Try media element playback first (preferred for streaming large files)
    try{
      await el.play();
      await this.audioContext.resume();
      const src = this.audioContext.createMediaElementSource(el);
      src.connect(this.masterGain);
      this.currentSource = src;
      console.log('AudioSourceManager: loaded media element and connected to masterGain');
      return el;
    }catch(err){
      console.warn('MediaElement playback failed, falling back to decodeAudioData()', err);
      // cleanup the media element we created
      try{ el.pause(); el.remove(); }catch(e){}
      this.mediaElement = null;

      // fallback: decode file to AudioBuffer and play via AudioBufferSourceNode
      try{
        const arrayBuffer = await file.arrayBuffer();
        const decoded = await this.audioContext.decodeAudioData(arrayBuffer);
        const bufSrc = this.audioContext.createBufferSource();
        bufSrc.buffer = decoded;
        bufSrc.loop = true;
        bufSrc.connect(this.masterGain);
        await this.audioContext.resume();
        bufSrc.start(0);
        this.currentBufferSource = bufSrc;
        this.currentSource = bufSrc;
        console.log('AudioSourceManager: decoded file and started AudioBufferSourceNode');
        return bufSrc;
      }catch(e){
        console.error('Failed to decode/play file fallback', e);
        throw e;
      }
    }
  }

  async captureTab(){
    try{
      const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
      // create audio source from stream
      try{ await this.audioContext.resume(); }catch(e){}
      const src = this.audioContext.createMediaStreamSource(stream);
      src.connect(this.masterGain);
      this.currentSource = src;
      // optional: show captured video element for debugging
      const v = document.createElement('video'); v.srcObject = stream; v.autoplay = true; v.muted = true; v.style.display='none'; document.body.appendChild(v);
      return stream;
    }catch(err){
      console.error('captureTab failed', err);
      throw err;
    }
  }

  async useMic(){
    try{
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try{ await this.audioContext.resume(); }catch(e){}
      const src = this.audioContext.createMediaStreamSource(stream);
      src.connect(this.masterGain);
      this.currentSource = src;
      return stream;
    }catch(err){
      console.error('Mic access denied', err);
      throw err;
    }
  }

  createMediaDestination(){
    return this.audioContext.createMediaStreamDestination();
  }
}
