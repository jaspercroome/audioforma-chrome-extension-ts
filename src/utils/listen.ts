export const listen = (stream:MediaStream) => {
    const audioContext = new AudioContext();
    const analyser = audioContext.createAnalyser();
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    analyser.connect(audioContext.destination);

    return { audioContext, analyser };
}