export type DecodedWav = { sampleRate: number; channels: Float32Array[] };

/**
 * Minimal WAV reader for the stem service's chunks (16-bit PCM; 32-bit float
 * also accepted). Decoding ourselves keeps chunks at their own sample rate:
 * decodeAudioData would resample each chunk separately and leave seams.
 */
export const parseWav = (data: ArrayBuffer): DecodedWav => {
  const view = new DataView(data);
  const tag = (offset: number) =>
    String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
  if (data.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bits = 0;
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channelCount = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
      if (format === 0xfffe && size >= 26) format = view.getUint16(body + 24, true); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === "data") {
      if (!channelCount) throw new Error("WAV data before format");
      const bytesPerSample = bits / 8;
      const available = Math.min(size, data.byteLength - body);
      const frames = Math.floor(available / (bytesPerSample * channelCount));
      const channels = Array.from({ length: channelCount }, () => new Float32Array(frames));
      if (format === 1 && bits === 16) {
        for (let i = 0; i < frames; i++) {
          for (let c = 0; c < channelCount; c++) {
            channels[c][i] = view.getInt16(body + (i * channelCount + c) * 2, true) / 32768;
          }
        }
      } else if (format === 3 && bits === 32) {
        for (let i = 0; i < frames; i++) {
          for (let c = 0; c < channelCount; c++) {
            channels[c][i] = view.getFloat32(body + (i * channelCount + c) * 4, true);
          }
        }
      } else {
        throw new Error(`Unsupported WAV encoding (format ${format}, ${bits}-bit)`);
      }
      return { sampleRate, channels };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data");
};
