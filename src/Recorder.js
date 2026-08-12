export function startRecording(canvas, audioContext, opts = {}){
  const { mimeType = 'video/webm;codecs=vp9', bitsPerSecond = 35000000, frameRate = 60 } = opts;
  const videoStream = canvas.captureStream(frameRate);
  const audioDest = audioContext.createMediaStreamDestination();
  // Caller should connect master gain to this destination
  // e.g. masterGain.connect(audioDest);

  const combined = new MediaStream();
  videoStream.getVideoTracks().forEach(t => combined.addTrack(t));
  audioDest.stream.getAudioTracks().forEach(t => combined.addTrack(t));

  const recorder = new MediaRecorder(combined, { mimeType, videoBitsPerSecond: bitsPerSecond });
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.start();
  return {
    recorder,
    audioDestination: audioDest,
    stop: async () => {
      return new Promise(resolve => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: mimeType });
          resolve(blob);
        };
        recorder.stop();
      });
    }
  };
}

export default { startRecording };
