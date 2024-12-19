import Meyda from "meyda";
import { useState } from "react";
import { BUFFER_SIZE } from "./consts";
import { processPowerSpectrum } from "./processPowerSpectrum";

export const useAnalyzer = (tabId?: number) => {
  const [keyOctaveAmplitudes, setKeyOctaveAmplitudes] = useState<
    Record<string, number>
  >({});
  const [chroma, setChroma] = useState<Array<number>>([]);
  const setupAudioCapture = async () => {
    console.log("Setting up audio capture with tabId:", tabId);
    try {
      // First get the media stream ID
      const streamId = await new Promise<string>((resolve) => {
        chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) =>
          resolve(streamId)
        );
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
          },
        } as MediaTrackConstraints,
        video: false,
      });

      console.log("Got media stream:", stream);
      if (!stream) return;

      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(ctx.destination);

      const meydaAnalyzer = Meyda.createMeydaAnalyzer({
        audioContext: ctx,
        source: source,
        bufferSize: BUFFER_SIZE,
        featureExtractors: ["powerSpectrum", "chroma"],
        callback: (features: { powerSpectrum: number[]; chroma: number[] }) => {
          if (features.powerSpectrum) {
            const newKeyOctaveAmplitudes = processPowerSpectrum(
              features.powerSpectrum,
              ctx
            );
            setKeyOctaveAmplitudes(newKeyOctaveAmplitudes);
          }
          if (features.chroma) {
            setChroma(features.chroma);
          }
        },
      });

      meydaAnalyzer.start();
      return {
        meydaAnalyzer,
        ctx,
        chroma,
        keyOctaveAmplitudes,
      };
    } catch (error) {
      console.error("Error in setupAudioCapture:", error);
    }
  };
  return setupAudioCapture().then((d) => {
    return d;
  });
};
