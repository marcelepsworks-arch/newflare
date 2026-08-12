// Tempo tracking and beat-phase locking.
//
// Onsets alone are jittery and fire several times per bar. To drive visuals *on the beat*
// we need the period as well as the hits, so this keeps a fixed-rate onset envelope,
// estimates the period by autocorrelation, and runs a small phase-locked loop that nudges
// the predicted beat toward observed onsets.
const BIN_SECONDS = 0.01;          // envelope resolution (100 Hz), independent of frame rate
const HISTORY_BINS = 800;          // 8 s of history
const MIN_BPM = 70;
const MAX_BPM = 180;
const MIN_LAG = Math.round(60 / MAX_BPM / BIN_SECONDS);
const MAX_LAG = Math.round(60 / MIN_BPM / BIN_SECONDS);

export default class BeatTracker {
  constructor(){
    this.envelope = new Float32Array(HISTORY_BINS);
    this.binIndex = 0;
    this.binStart = -1;
    this.binAccum = 0;

    this.period = 0.5;             // seconds per beat (120 BPM until proven otherwise)
    this.confidence = 0;
    this.nextBeat = 0;
    this.beatPhase = 0;
    this.beatCount = 0;
    this.beat = false;
    this._lastAnalysis = -1;
  }

  get bpm(){ return 60 / this.period; }

  // flux: onset strength for this frame, onset: whether the detector fired
  update(now, flux, onset){
    if(this.binStart < 0){ this.binStart = now; this.nextBeat = now + this.period; }

    // accumulate into fixed-width time bins so tempo is not tied to the frame rate
    this.binAccum = Math.max(this.binAccum, flux);
    while(now - this.binStart >= BIN_SECONDS){
      this.envelope[this.binIndex] = this.binAccum;
      this.binIndex = (this.binIndex + 1) % HISTORY_BINS;
      this.binStart += BIN_SECONDS;
      this.binAccum = 0;
    }

    if(now - this._lastAnalysis > 0.5){
      this._lastAnalysis = now;
      this._estimatePeriod();
    }

    // phase correction: pull the predicted beat toward onsets that land near it
    if(onset){
      const error = this._phaseError(now);
      if(Math.abs(error) < this.period * 0.25){
        this.nextBeat -= error * 0.12;
        this.period = Math.max(60 / MAX_BPM, Math.min(60 / MIN_BPM, this.period - error * 0.01));
      }
    }

    this.beat = false;
    if(now >= this.nextBeat){
      this.beat = true;
      this.beatCount++;
      this.nextBeat += this.period;
      // a long stall (tab hidden, track seeked) must not spew catch-up beats
      if(now - this.nextBeat > this.period * 4) this.nextBeat = now + this.period;
    }
    this.beatPhase = Math.min(1, Math.max(0, 1 - (this.nextBeat - now) / this.period));

    return {
      beat: this.beat,
      beatPhase: this.beatPhase,
      beatCount: this.beatCount,
      bpm: this.bpm,
      beatConfidence: this.confidence,
      // sharp envelope that peaks on the beat and decays: the thing visuals should ride
      beatPulse: Math.exp(-this.beatPhase * 4.5)
    };
  }

  _phaseError(now){
    // signed distance from now to the closest predicted beat
    const sinceLast = now - (this.nextBeat - this.period);
    return sinceLast > this.period * 0.5 ? sinceLast - this.period : sinceLast;
  }

  _estimatePeriod(){
    const env = this.envelope;
    const n = HISTORY_BINS;
    let mean = 0;
    for(let i=0;i<n;i++) mean += env[i];
    mean /= n;
    if(mean <= 1e-7){ this.confidence = 0; return; }

    let best = 0, bestLag = 0, total = 0;
    const scores = new Float32Array(MAX_LAG + 1);
    for(let lag = MIN_LAG; lag <= MAX_LAG; lag++){
      let sum = 0;
      for(let i = 0; i < n - lag; i++){
        const a = env[(this.binIndex + i) % n] - mean;
        const b = env[(this.binIndex + i + lag) % n] - mean;
        sum += a * b;
      }
      sum /= (n - lag);
      scores[lag] = sum;
      total += Math.abs(sum);
      if(sum > best){ best = sum; bestLag = lag; }
    }
    if(bestLag === 0 || best <= 0){ this.confidence = 0; return; }

    // Autocorrelation peaks just as strongly at half and double tempo. Prefer the
    // candidate that lands in the range most music actually sits in.
    const candidates = [bestLag, bestLag * 2, Math.round(bestLag / 2)];
    let chosen = bestLag, chosenScore = -Infinity;
    for(const lag of candidates){
      if(lag < MIN_LAG || lag > MAX_LAG) continue;
      const bpm = 60 / (lag * BIN_SECONDS);
      const centred = 1 - Math.abs(bpm - 120) / 120;   // bias toward ~120 BPM
      const score = scores[lag] * (0.6 + 0.4 * centred);
      if(score > chosenScore){ chosenScore = score; chosen = lag; }
    }

    const newPeriod = chosen * BIN_SECONDS;
    this.confidence = Math.min(1, best / (total / (MAX_LAG - MIN_LAG) + 1e-9) / 6);
    // ease toward the new estimate so the beat grid never jumps mid-phrase
    this.period += (newPeriod - this.period) * (0.15 + 0.35 * this.confidence);
  }
}
