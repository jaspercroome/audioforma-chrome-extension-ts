import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { VoiceSource, VoiceStem } from "../components/orb/Voices";
import { StemSession } from "../stems/session";
import { ServiceStream, streamFromService } from "../stems/serviceSource";
import { sortStems } from "../stems/styles";
import { emptyOrbFrame, OrbFrame } from "../utils/orbAnalysis";
import { DEMO_STEMS, loadDemoStems } from "./demoStems";

/** Stems of 5.85 s, like the service sends (one htdemucs segment's stride). */
const DEMO_CHUNK_SECONDS = 5.85;
/** Keep voices on screen this long after the song ends, so trails drain away. */
const TAIL_SECONDS = 4;

export type StemStatus = {
  source: "demo" | "service" | null;
  /** One line for the transport panel. */
  text: string;
  /** Separation progress 0-1 (service only). */
  separated: number;
  active: boolean;
};

const IDLE: StemStatus = { source: null, text: "", separated: 0, active: false };

const percent = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Plays stems in the Voices view: the demo's own instruments, or a song
 * streamed from the stem service while Demucs is still separating it.
 */
export const useStemPlayback = (
  frameRef: React.MutableRefObject<OrbFrame>,
  beatFrameRef: React.MutableRefObject<OrbFrame>
) => {
  const sourceRef = useRef<VoiceSource | null>(null);
  const sessionRef = useRef<StemSession | null>(null);
  const streamRef = useRef<ServiceStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const phaseRef = useRef<string>("");
  const [stems, setStems] = useState<VoiceStem[]>([]);
  const [status, setStatus] = useState<StemStatus>(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  /** Create (or wake) the audio context. Call from a click so the browser allows sound. */
  const audioContext = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      // Demucs works at 44.1 kHz: matching it means no per-chunk resampling seams.
      ctxRef.current = new AudioContext({ sampleRate: 44100, latencyHint: "playback" });
    }
    if (ctxRef.current.state === "suspended") void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.cancel();
    streamRef.current = null;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    sourceRef.current = null;
    phaseRef.current = "";
    frameRef.current = emptyOrbFrame();
    beatFrameRef.current = emptyOrbFrame();
    setStems([]);
    setStatus(IDLE);
  }, [frameRef, beatFrameRef]);

  const begin = (session: StemSession, source: StemStatus["source"]) => {
    sessionRef.current = session;
    sourceRef.current = {
      songTime: () => session.songTime(),
      active: () =>
        session.playback === "playing" ||
        session.playback === "buffering" ||
        (session.playback === "ended" && session.songTime() < session.duration + TAIL_SECONDS),
      timelines: session.timelines,
      audible: (stem) => session.player.audible(stem),
    };
    setStems(sortStems(session.stems.map((s) => s.name)).map((name) => session.stems.find((s) => s.name === name)!));
    setStatus({ source, text: "Starting…", separated: 0, active: true });
  };

  const startDemo = useCallback(async () => {
    stop();
    setError(null);
    const ctx = audioContext();
    setStatus({ source: "demo", text: "Preparing the demo stems…", separated: 0, active: true });
    try {
      const demo = await loadDemoStems(44100);
      const session = new StemSession(
        ctx,
        { sampleRate: demo.sampleRate, stems: DEMO_STEMS.map((s) => s.name), duration: demo.duration },
        { onError: setError }
      );
      // Relabel with the demo's instruments.
      session.stems.forEach((stem) => {
        const demoStem = DEMO_STEMS.find((d) => d.name === stem.name);
        if (demoStem) stem.style = demoStem.style;
      });
      begin(session, "demo");
      const chunk = Math.round(DEMO_CHUNK_SECONDS * demo.sampleRate);
      const length = demo.mono[DEMO_STEMS[0].name].length;
      for (let at = 0; at < length; at += chunk) {
        const audio: Record<string, Float32Array[]> = {};
        for (const { name } of DEMO_STEMS) audio[name] = demo.channels[name].map((c) => c.slice(at, at + chunk));
        session.addChunk(at / demo.sampleRate, audio);
      }
      session.endStream();
    } catch (e) {
      setError(`The demo stems couldn't be prepared: ${e instanceof Error ? e.message : e}`);
      stop();
    }
  }, [audioContext, stop]);

  const startService = useCallback(
    (server: string, file: File, model: string) => {
      stop();
      setError(null);
      const ctx = audioContext();
      setStatus({ source: "service", text: `Uploading ${file.name}…`, separated: 0, active: true });
      phaseRef.current = "uploading";
      streamRef.current = streamFromService(server, file, model, {
        onStatus: (state) => (phaseRef.current = state),
        onMeta: (meta) => {
          phaseRef.current = "separating";
          const session = new StemSession(
            ctx,
            { sampleRate: meta.sample_rate, stems: meta.stems, duration: meta.duration, model: meta.model },
            { onError: setError }
          );
          begin(session, "service");
        },
        onChunk: (chunk, audio) => sessionRef.current?.addChunk(chunk.start, audio),
        onProgress: (progress) => {
          if (sessionRef.current) sessionRef.current.speed = progress.speed;
        },
        onDone: () => {
          phaseRef.current = "done";
          sessionRef.current?.endStream();
        },
        onError: (message) => {
          setError(message);
          stop();
        },
      });
    },
    [audioContext, stop]
  );

  const toggleMute = useCallback((stem: string) => {
    const player = sessionRef.current?.player;
    if (!player) return;
    player.setMuted(stem, !player.isMuted(stem));
    rerender();
  }, []);

  const toggleSolo = useCallback((stem: string) => {
    const player = sessionRef.current?.player;
    if (!player) return;
    player.setSolo(player.solo === stem ? null : stem);
    rerender();
  }, []);

  const replay = useCallback(() => {
    const session = sessionRef.current;
    if (session && session.playback === "ended") session.play(0);
  }, []);

  // Drive playback and feed the orb: the mix for its centre light and mood,
  // the drum stem for the rings on the glass.
  useEffect(() => {
    let raf = 0;
    let lastTick = 0;
    const mixFrame = emptyOrbFrame();
    const drumFrame = emptyOrbFrame();
    const loop = (now: number) => {
      const session = sessionRef.current;
      if (session) {
        if (now - lastTick > 100) {
          session.tick();
          lastTick = now;
        }
        const t = session.songTime();
        const playing = session.playback !== "waiting";
        session.mix.toOrbFrame(playing ? session.mix.indexAt(t) : -1, mixFrame);
        frameRef.current = mixFrame;
        const drums = session.timelines.drums;
        if (drums) {
          drums.toOrbFrame(playing ? drums.indexAt(t) : -1, drumFrame);
          beatFrameRef.current = drumFrame;
        } else {
          beatFrameRef.current = mixFrame;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [frameRef, beatFrameRef]);

  // A status line, a few times a second.
  useEffect(() => {
    const id = window.setInterval(() => {
      const session = sessionRef.current;
      if (!session) return;
      const separated = session.duration > 0 ? Math.min(1, session.received / session.duration) : 0;
      const phase = phaseRef.current;
      const parts: string[] = [];
      if (status.source === "service" && !session.streamEnded) {
        const speed = session.speed > 0 ? ` · ${session.speed.toFixed(1)}× real time` : "";
        parts.push(phase === "separating" ? `Separating ${percent(separated)}${speed}` : phase.replace("_", " "));
      }
      if (session.playback === "waiting") parts.push(session.received > 0 ? "buffering before playback" : "waiting for the first stems");
      else if (session.playback === "buffering") parts.push("buffering");
      else if (session.playback === "playing") parts.push("playing");
      else parts.push("finished");
      const text = parts.join(" · ");
      setStatus((s) => (s.text === text && s.separated === separated ? s : { ...s, text, separated }));
    }, 250);
    return () => window.clearInterval(id);
  }, [status.source]);

  useEffect(() => () => stop(), [stop]);

  const player = sessionRef.current?.player;
  return {
    stems,
    status,
    error,
    sourceRef,
    playing: !!sessionRef.current,
    ended: sessionRef.current?.playback === "ended",
    isMuted: (stem: string) => player?.isMuted(stem) ?? false,
    soloed: player?.solo ?? null,
    audioContext,
    startDemo,
    startService,
    stop,
    replay,
    toggleMute,
    toggleSolo,
  };
};
