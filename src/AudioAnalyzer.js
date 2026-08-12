import BeatTracker from './BeatTracker.js';

export default class AudioAnalyzer {
  constructor(audioContext, inputNode){
    this.audioContext = audioContext;
    this.inputNode = inputNode;
    this.beatTracker = new BeatTracker();

    this.fftSize = 2048;
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = this.fftSize;
    this.freqData = new Float32Array(this.analyser.frequencyBinCount);

    // connect inputNode (masterGain) to analyser (tap)
    if(inputNode) inputNode.connect(this.analyser);

    // band config (Hz ranges)
    this.bands = [ [20,60],[60,250],[250,500],[500,2000],[2000,4000],[4000,20000] ];
    this.smoothed = new Array(this.bands.length).fill(0);
    this.smoothing = 0.85;
    // per-band running peak, so a quiet mix drives the visuals as hard as a loud one
    this.bandPeak = new Array(this.bands.length).fill(0.05);
    this.peakDecay = 0.9995;
    this.peakFloor = 0.04;

    // spectral flux / onset detection state
    this.prevSpectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.spectralFlux = 0;
    this.fluxHistory = new Array(43).fill(0); // history for adaptive threshold
    this.fluxHistoryIndex = 0;
    this.onsetThreshold = 0.0;
    this.onsetCooldown = 0;

    // energy / RMS buffer (for normalization)
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.energyHistory = new Array(60).fill(0);
    this.energyIndex = 0;
    this.maxEnergy = 1e-6;
    this.rms = 0;
  }

  _getFreqIndex(freq){
    const nyquist = this.audioContext.sampleRate/2;
    return Math.round(freq/nyquist * this.analyser.frequencyBinCount);
  }

  update(){
    // frequency-domain
    this.analyser.getFloatFrequencyData(this.freqData);
    // convert to linear magnitudes in range 0..1
    const mags = new Float32Array(this.freqData.length);
    for(let i=0;i<this.freqData.length;i++) mags[i] = Math.max(0, (this.freqData[i]+140)/140);

    // compute band averages with smoothing
    const bandVals = [];
    for(let b=0;b<this.bands.length;b++){
      const [f0,f1] = this.bands[b];
      const i0 = Math.max(0, this._getFreqIndex(f0));
      const i1 = Math.min(this.freqData.length-1, this._getFreqIndex(f1));
      let s=0; let n=0;
      for(let i=i0;i<=i1;i++){ s+=mags[i]; n++; }
      const avg = n? s/n : 0;
      // exponential smoothing per-band
      this.smoothed[b] = this.smoothing * this.smoothed[b] + (1-this.smoothing) * avg;
      // adaptive gain: track the recent peak and report the band relative to it
      this.bandPeak[b] = Math.max(this.bandPeak[b] * this.peakDecay, this.smoothed[b], this.peakFloor);
      bandVals.push(Math.min(1, this.smoothed[b] / this.bandPeak[b]));
    }

    // spectral flux (sum of positive differences)
    let flux = 0;
    for(let i=0;i<mags.length;i++){
      const diff = mags[i] - this.prevSpectrum[i];
      if(diff>0) flux += diff;
    }
    // normalize flux by bin count
    flux = flux / mags.length;
    this.spectralFlux = flux;

    // maintain flux history for adaptive threshold
    this.fluxHistory[this.fluxHistoryIndex] = flux;
    this.fluxHistoryIndex = (this.fluxHistoryIndex + 1) % this.fluxHistory.length;

    // compute moving mean and std of flux
    let mean = 0; for(let v of this.fluxHistory) mean += v; mean /= this.fluxHistory.length;
    let variance = 0; for(let v of this.fluxHistory) variance += (v-mean)*(v-mean); variance /= this.fluxHistory.length;
    const std = Math.sqrt(variance);

    // adaptive threshold (mean + k * std)
    const k = 1.5; // sensitivity param (expose in GUI later)
    const threshold = mean + k * std;

    // onset detection with simple cooldown
    let onset = false; let confidence = 0;
    if(this.onsetCooldown>0) this.onsetCooldown--;
    if(flux > threshold && this.onsetCooldown===0){
      onset = true;
      confidence = Math.min(1, (flux - threshold) / (std + 1e-6));
      this.onsetCooldown = 6; // frames to ignore (reduce repeats)
    }

    // time-domain RMS / energy
    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0; for(let i=0;i<this.timeData.length;i++){ const sV=this.timeData[i]; sum += sV*sV; }
    const rms = Math.sqrt(sum / this.timeData.length);
    this.rms = rms;
    // energy history
    this.energyHistory[this.energyIndex] = rms;
    this.energyIndex = (this.energyIndex + 1) % this.energyHistory.length;
    // A 1-second window pins energyNorm at ~1 for any steady track. Normalise against a
    // slowly decaying peak instead so quiet passages actually read as quiet.
    this.maxEnergy = Math.max(this.maxEnergy * 0.9995, rms, 0.01);

    // save prev spectrum for next frame
    this.prevSpectrum.set(mags);

    // spectral tilt: -1 = bass dominated, +1 = treble dominated. Drives colour and the
    // kind of shape the director reaches for, so the visuals track the *character* of the
    // sound and not just its loudness.
    const low = bandVals[0] + bandVals[1];
    const mid = bandVals[2] + bandVals[3];
    const high = bandVals[4] + bandVals[5];
    const spectralTilt = (high - low) / (high + low + 1e-6);
    const midRatio = mid / (low + mid + high + 1e-6);

    // tempo + beat phase, driven by the same onset envelope
    const beat = this.beatTracker.update(this.audioContext.currentTime, flux, onset);

    // return rich feature set
    return Object.assign({
      bands: bandVals,
      spectralFlux: this.spectralFlux,
      onset: onset,
      onsetConfidence: confidence,
      rms: this.rms,
      energyNorm: this.rms / (this.maxEnergy + 1e-9),
      spectralTilt,
      midRatio
    }, beat);
  }

  // Backwards-compatible getter: returns band array only
  getBands(){
    const res = this.update();
    return res.bands;
  }

  // full features
  getFeatures(){
    return this.update();
  }
}
