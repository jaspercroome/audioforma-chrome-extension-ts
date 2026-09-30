import React, { useEffect, useRef, useState } from "react";
import { advance, RootState } from "@react-three/fiber";
import { emptyOrbFrame, OrbFrame } from "../utils/orbAnalysis";
import { OrbScene, OrbVoices } from "../components/orb/OrbScene";
import { VoiceSource } from "../components/orb/Voices";
import { StemAnalyzer } from "../stems/stemAnalysis";
import { StemTimeline } from "../stems/timeline";
import { analyzeBuffer, encodeWav, frameAt, Timeline } from "./analysis";
import { PART_B_START, renderDemoOffline } from "./demoSong";
import { DEMO_STEMS, loadDemoStems } from "./demoStems";

type View = "harmony" | "melody";

type RenderApi = {
  prepare: () => Promise<{ duration: number; frames: number; hopSeconds: number; partB: number; wavBase64: string }>;
  /** Analyse the demo's instruments as separate stems and switch to the Voices view. */
  prepareVoices: () => Promise<{ duration: number; stems: string[]; frames: Record<string, number>; wavBase64: string }>;
  setView: (view: View) => Promise<void>;
  renderFrame: (t: number) => void;
  glInfo: () => unknown;
  frameAt: (t: number) => unknown;
  /** Debug: a stem's analysis between two times. */
  stemFrames: (stem: string, from: number, to: number) => unknown;
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

const analyseStem = (samples: Float32Array, sampleRate: number, role: StemAnalyzer["role"]) => {
  const analyzer = new StemAnalyzer(sampleRate, role);
  const timeline = new StemTimeline(analyzer.hopSeconds, analyzer.firstFrameSeconds);
  const first = analyzer.push(samples);
  if (first) timeline.append(first);
  const tail = analyzer.finish();
  if (tail) timeline.append(tail);
  return timeline;
};

/** Deterministic, frame-by-frame rendering of the demo for captured stills and clips. */
export const RenderHarness = () => {
  const frameRef = useRef<OrbFrame>(emptyOrbFrame());
  const beatFrameRef = useRef<OrbFrame>(emptyOrbFrame());
  const timelineRef = useRef<Timeline | null>(null);
  const glRef = useRef<RootState["gl"] | null>(null);
  const timeRef = useRef(0);
  const sourceRef = useRef<VoiceSource | null>(null);
  const mixRef = useRef<StemTimeline | null>(null);
  const drumsRef = useRef<StemTimeline | null>(null);
  const [voices, setVoices] = useState<OrbVoices | undefined>(undefined);
  const [view, setView] = useState<View>("harmony");
  const viewResolve = useRef<(() => void) | null>(null);
  const viewRef = useRef<View>("harmony");

  useEffect(() => {
    viewResolve.current?.();
    viewResolve.current = null;
  }, [view, voices]);

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
      prepareVoices: async () => {
        const demo = await loadDemoStems();
        const timelines: Record<string, StemTimeline> = {};
        const mix = new Float32Array(demo.mono[DEMO_STEMS[0].name].length);
        for (const stem of DEMO_STEMS) {
          const mono = demo.mono[stem.name];
          for (let i = 0; i < mix.length; i++) mix[i] += mono[i];
          timelines[stem.name] = analyseStem(mono, demo.sampleRate, stem.style.role);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        mixRef.current = analyseStem(mix, demo.sampleRate, "mix");
        drumsRef.current = timelines.drums ?? null;
        sourceRef.current = {
          songTime: () => timeRef.current,
          active: () => true,
          timelines,
          audible: () => true,
        };
        setVoices({ stems: DEMO_STEMS, sourceRef, beatFrameRef });
        return {
          duration: demo.duration,
          stems: DEMO_STEMS.map((s) => s.name),
          frames: Object.fromEntries(Object.entries(timelines).map(([k, t]) => [k, t.count])),
          wavBase64: toBase64(encodeWav(demo.mixBuffer)),
        };
      },
      setView: (next: View) =>
        new Promise<void>((resolve) => {
          // Same view: React won't re-render, so there's nothing to wait for.
          if (next === viewRef.current) return resolve();
          viewRef.current = next;
          viewResolve.current = resolve;
          setView(next);
        }),
      renderFrame: (t: number) => {
        timeRef.current = t;
        if (mixRef.current) {
          mixRef.current.toOrbFrame(mixRef.current.indexAt(t), frameRef.current);
          if (drumsRef.current) drumsRef.current.toOrbFrame(drumsRef.current.indexAt(t), beatFrameRef.current);
        } else if (timelineRef.current) {
          frameRef.current = frameAt(timelineRef.current, t);
        }
        advance(t);
      },
      glInfo: () => glRef.current?.info,
      stemFrames: (stem: string, from: number, to: number) => {
        const timeline = sourceRef.current?.timelines[stem];
        if (!timeline) return null;
        const rows = [];
        for (let k = Math.max(0, timeline.indexAt(from)); k <= timeline.indexAt(to); k++) {
          let best = -1;
          let level = 0;
          for (let v = 0; v < 96; v++) {
            if (timeline.global(k, v) > level) {
              level = timeline.global(k, v);
              best = v;
            }
          }
          rows.push({
            t: +timeline.timeOf(k).toFixed(3),
            hz: +timeline.pitchHz(k).toFixed(1),
            conf: +timeline.pitchConfidence(k).toFixed(2),
            energy: +timeline.energy(k).toFixed(2),
            top: best + 24,
            topLevel: +level.toFixed(2),
          });
        }
        return rows;
      },
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
      settings={{ mood: true, autoRotate: false, spread: 1, view }}
      renderMode
      voices={voices}
      onCreated={(state) => {
        glRef.current = state.gl;
      }}
    />
  );
};
