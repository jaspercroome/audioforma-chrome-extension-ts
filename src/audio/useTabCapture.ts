import { useEffect, useState } from "react";

export type CapturedAudio = {
  context: AudioContext;
  source: AudioNode;
  stream: MediaStream;
};

const getStreamId = (tabId: number) =>
  new Promise<string>((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      const error = chrome.runtime.lastError;
      if (error || !streamId) reject(new Error(error?.message ?? "No media stream ID for tab"));
      else resolve(streamId);
    });
  });

/**
 * Capture a tab's audio (and video, for the see-through background) and keep
 * it audible. Everything is torn down when the tab changes or the component
 * unmounts; the old effect's cleanup read stale state and never ran.
 */
export const useTabCapture = (tabId?: number) => {
  const [captured, setCaptured] = useState<CapturedAudio | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tabId === undefined) return;
    let cancelled = false;
    let teardown: (() => void) | undefined;

    (async () => {
      try {
        const streamId = await getStreamId(tabId);
        const mandatory = { chromeMediaSource: "tab", chromeMediaSourceId: streamId };
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { mandatory } as MediaTrackConstraints,
          video: { mandatory } as MediaTrackConstraints,
        });
        const context = new AudioContext();
        const source = context.createMediaStreamSource(stream);
        // Tab capture mutes the tab, so route the audio back out.
        source.connect(context.destination);

        teardown = () => {
          source.disconnect();
          stream.getTracks().forEach((track) => track.stop());
          context.close().catch(() => undefined);
        };
        if (cancelled) {
          teardown();
          return;
        }
        setCaptured({ context, source, stream });
      } catch (e) {
        console.error("Error in setupAudioCapture:", e);
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      teardown?.();
      setCaptured(null);
    };
  }, [tabId]);

  return { captured, error };
};
