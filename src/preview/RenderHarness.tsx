import React, { useEffect, useRef } from "react";
import { advance, RootState } from "@react-three/fiber";
import { emptyOrbFrame, OrbFrame } from "../utils/orbAnalysis";
import { OrbScene } from "../components/orb/OrbScene";
import { analyzeBuffer, encodeWav, frameAt, Timeline } from "./analysis";
import { PART_B_START, renderDemoOffline } from "./demoSong";

type RenderApi = {
  prepare: () => Promise<{ duration: number; frames: number; hopSeconds: number; partB: number; wavBase64: string }>;
  renderFrame: (t: number) => void;
  glInfo: () => unknown;
  frameAt: (t: number) => unknown;
};

declare global {
  interface Window {
    __AUDIOFORMA_RENDER__?: boolean;
    __audioforma?: RenderApi;
  }
}

const toBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};

/** Deterministic, frame-by-frame rendering of the demo for captured stills and clips. */
export const RenderHarness = () => {
  const frameRef = useRef<OrbFrame>(emptyOrbFrame());
  const timelineRef = useRef<Timeline | null>(null);
  const glRef = useRef<RootState["gl"] | null>(null);

  useEffect(() => {
    window.__audioforma = {
      prepare: async () => {
        const buffer = await renderDemoOffline(48000);
        const timeline = await analyzeBuffer(buffer);
        timelineRef.current = timeline;
        return {
          duration: timeline.duration,
          frames: timeline.frames.length,
          hopSeconds: timeline.hopSeconds,
          partB: PART_B_START + 0.05,
          wavBase64: toBase64(encodeWav(buffer)),
        };
      },
      renderFrame: (t: number) => {
        if (timelineRef.current) frameRef.current = frameAt(timelineRef.current, t);
        advance(t);
      },
      glInfo: () => glRef.current?.info,
      frameAt: (t: number) => {
        if (!timelineRef.current) return null;
        const f = frameAt(timelineRef.current, t);
        return { ...f, levels: Array.from(f.levels) };
      },
    };
  }, []);

  return (
    <OrbScene
      frameRef={frameRef}
      settings={{ mood: true, autoRotate: false, spread: 1 }}
      renderMode
      onCreated={(state) => {
        glRef.current = state.gl;
      }}
    />
  );
};
