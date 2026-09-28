import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Meyda from "meyda";
import { AudioFeatures, BUFFER_SIZE, FEATURE_EXTRACTORS, HOP_SIZE, noteNames } from "../utils/consts";
import { fifthsIndex } from "../utils/notes";
import { fifthsAngleToHue, linearToHex, oklchToLinear } from "../utils/noteColors";
import { emptyOrbFrame, OrbAnalyzer, OrbFrame } from "../utils/orbAnalysis";
import { harmonicHistoryFrames, HarmonicMask, processPowerSpectrum } from "../utils/processPowerSpectrum";
import { LowBandAnalyzer, LOW_FFT_SIZE } from "../utils/lowBand";
import { OrbScene, OrbSettings } from "../components/orb/OrbScene";
import { analyzeBuffer, frameAt, Timeline } from "./analysis";
import { PART_B_START, renderDemoOffline } from "./demoSong";
import { Compass } from "./Compass";

type Mode = "idle" | "demo" | "file";

const NOTES_BY_FIFTHS = Object.values(noteNames).sort((a, b) => fifthsIndex(a) - fifthsIndex(b));

const describe = (frame: OrbFrame) => {
  const angle = Math.atan2(frame.here.y, frame.here.x);
  const step = ((Math.round(angle / (Math.PI / 6)) % 12) + 12) % 12;
  const focus = Math.min(1, Math.hypot(frame.here.x, frame.here.y));
  const [r, g, b] = oklchToLinear(fifthsAngleToHue((angle * 180) / Math.PI), 0.74);
  const s = Math.min(1, Math.max(0, (focus - 0.04) / 0.36));
  const color = linearToHex([1 + (r - 1) * s, 1 + (g - 1) * s, 1 + (b - 1) * s]);
  return {
    here: { ...frame.here },
    home: { ...frame.home },
    centre: focus > 0.02 ? NOTES_BY_FIFTHS[step] : "none",
    lean: frame.lean,
    focus,
    energy: frame.energy,
    color,
  };
};

const leanWords = (lean: number) =>
  lean > 0.08 ? "sharpward, brighter" : lean < -0.08 ? "flatward, darker" : "at home";

export const PreviewApp = () => {
  const frameRef = useRef<OrbFrame>(emptyOrbFrame());
  const demoBufferRef = useRef<AudioBuffer | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const playbackRef = useRef<{ stop: () => void } | null>(null);
  const clockRef = useRef({ mode: "idle" as Mode, startedAt: 0 });

  const reducedMotion = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);
  const [settings, setSettings] = useState<OrbSettings>({ mood: true, autoRotate: !reducedMotion, spread: 1 });
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<Mode>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [readout, setReadout] = useState(() => describe(emptyOrbFrame()));
  const [section, setSection] = useState<"bright" | "melancholy">("bright");

  // Render and analyse the demo once, with the extension's own analysis code.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const buffer = await renderDemoOffline(48000);
      if (cancelled) return;
      demoBufferRef.current = buffer;
      const result = await analyzeBuffer(buffer, (p) => !cancelled && setProgress(p));
      if (!cancelled) setTimeline(result);
    })().catch((e) => setError(`The demo couldn't be prepared: ${e instanceof Error ? e.message : e}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const demoTime = useCallback(() => {
    const c = clockRef.current;
    if (c.mode !== "demo" || !ctxRef.current) return 0;
    return Math.max(0, ctxRef.current.currentTime - c.startedAt);
  }, []);

  // Demo frames follow the audio clock while it plays. Nothing plays at rest,
  // so nothing lights up: the orb only ever shows sound you can hear.
  useEffect(() => {
    if (!timeline) return;
    let raf = 0;
    const tick = () => {
      if (clockRef.current.mode === "demo") frameRef.current = frameAt(timeline, demoTime());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [timeline, demoTime]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setReadout(describe(frameRef.current));
      setSection(demoTime() >= PART_B_START ? "melancholy" : "bright");
    }, 120);
    return () => window.clearInterval(id);
  }, [demoTime]);

  const stopPlayback = useCallback(() => {
    playbackRef.current?.stop();
    playbackRef.current = null;
    clockRef.current = { mode: "idle", startedAt: 0 };
    frameRef.current = emptyOrbFrame(); // silence: the veins fade and drain away
    setMode("idle");
    setFileName(null);
  }, []);

  const audioContext = async () => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    if (ctxRef.current.state === "suspended") await ctxRef.current.resume();
    return ctxRef.current;
  };

  const playDemo = async () => {
    if (!demoBufferRef.current || !timeline) return;
    stopPlayback();
    setError(null);
    const ctx = await audioContext();
    const source = ctx.createBufferSource();
    source.buffer = demoBufferRef.current;
    source.connect(ctx.destination);
    const startAt = ctx.currentTime + 0.05;
    source.start(startAt);
    const playback = {
      stop: () => {
        source.onended = null;
        try {
          source.stop();
        } catch {
          /* already stopped */
        }
        source.disconnect();
      },
    };
    source.onended = () => playbackRef.current === playback && stopPlayback();
    playbackRef.current = playback;
    clockRef.current = { mode: "demo", startedAt: startAt };
    setMode("demo");
  };

  const playFile = async (file: File) => {
    stopPlayback();
    setError(null);
    try {
      const ctx = await audioContext();
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const out = ctx.createGain();
      source.connect(out);
      out.connect(ctx.destination);
      // Same live path as the extension: Meyda on the playing audio.
      const hopSeconds = HOP_SIZE / ctx.sampleRate;
      const mask = new HarmonicMask(harmonicHistoryFrames(hopSeconds));
      const orb = new OrbAnalyzer({ hopSeconds, sampleRate: ctx.sampleRate, fftSize: BUFFER_SIZE });
      const tap = ctx.createAnalyser();
      tap.fftSize = LOW_FFT_SIZE;
      out.connect(tap);
      const recent = new Float32Array(LOW_FFT_SIZE);
      const lowBand = new LowBandAnalyzer(ctx.sampleRate);
      const analyzer = Meyda.createMeydaAnalyzer({
        audioContext: ctx,
        source: out,
        bufferSize: BUFFER_SIZE,
        hopSize: HOP_SIZE,
        featureExtractors: [...FEATURE_EXTRACTORS],
        callback: (features: AudioFeatures) => {
          if (!features?.powerSpectrum) return;
          const { fullSpectrumAmps } = processPowerSpectrum(features, ctx, mask);
          tap.getFloatTimeDomainData(recent);
          frameRef.current = orb.update(fullSpectrumAmps, features, lowBand.analyze(recent));
        },
      });
      analyzer.start();
      source.start();
      const playback = {
        stop: () => {
          analyzer.stop();
          source.onended = null;
          try {
            source.stop();
          } catch {
            /* already stopped */
          }
          source.disconnect();
          out.disconnect();
          tap.disconnect();
        },
      };
      source.onended = () => playbackRef.current === playback && stopPlayback();
      playbackRef.current = playback;
      clockRef.current = { mode: "file", startedAt: ctx.currentTime };
      setMode("file");
      setFileName(file.name);
    } catch {
      setError(`${file.name} couldn't be played. Try an MP3, WAV, M4A or OGG file.`);
    }
  };

  // Drop a file anywhere on the page.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) void playFile(file);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  const status = !timeline
    ? `Rendering the demo song… ${Math.round(progress * 100)}%`
    : mode === "file"
    ? `Playing ${fileName}`
    : mode === "demo"
    ? section === "bright"
      ? "Playing the demo: bright section, C · G · Am · F"
      : "Playing the demo: melancholy section, Am · F · Fm · C"
    : "Ready. The orb lights up when sound plays.";

  return (
    <div className="stage">
      <OrbScene frameRef={frameRef} settings={settings} />

      <div className="overlay">
        <header className="panel brand">
          <h1>Audioforma</h1>
          <p>Orb mode. Each vein is one note in one octave; the louder the note, the thicker the vein.</p>
          <dl className="axes">
            <div>
              <dt>Around</dt>
              <dd>Note, by its place on the circle of fifths (and its colour)</dd>
            </div>
            <div>
              <dt>Out</dt>
              <dd>Octave: bass at the core, treble past the glass</dd>
            </div>
            <div>
              <dt>Up/down</dt>
              <dd>Time: the equator is now, the last 4 s stream to the poles</dd>
            </div>
            <div>
              <dt>Rings</dt>
              <dd>Drum hits on the glass: kick wide, snare medium, hats fine</dd>
            </div>
          </dl>
        </header>

        <div className="panel toggles">
          <label htmlFor="mood-toggle">
            <input
              id="mood-toggle"
              type="checkbox"
              checked={settings.mood}
              onChange={(e) => setSettings((s) => ({ ...s, mood: e.target.checked }))}
            />
            Mood lighting
          </label>
          <label htmlFor="rotate-toggle">
            <input
              id="rotate-toggle"
              type="checkbox"
              checked={settings.autoRotate}
              onChange={(e) => setSettings((s) => ({ ...s, autoRotate: e.target.checked }))}
            />
            Auto-rotate
          </label>
          <label htmlFor="spread-range" className="range">
            <span>
              Octave spread <output htmlFor="spread-range">{settings.spread.toFixed(2)}x</output>
            </span>
            <input
              id="spread-range"
              type="range"
              min={0.55}
              max={1.6}
              step={0.05}
              value={settings.spread}
              onChange={(e) => setSettings((s) => ({ ...s, spread: parseFloat(e.target.value) }))}
            />
          </label>
        </div>

        <div className="panel transport">
          <p className="status" aria-live="polite">
            {status}
          </p>
          <div className="buttons">
            {mode === "idle" ? (
              <button type="button" className="primary" onClick={playDemo} disabled={!timeline}>
                Play demo with sound
              </button>
            ) : (
              <button type="button" className="primary" onClick={stopPlayback}>
                Stop
              </button>
            )}
            <input
              id="audio-file"
              className="visually-hidden"
              type="file"
              accept="audio/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void playFile(file);
                e.target.value = "";
              }}
            />
            <label htmlFor="audio-file" className="secondary">
              Play your own file
            </label>
          </div>
          <p className="hint">Or drop an audio file anywhere. It stays in your browser.</p>
          {error && <p className="error">{error}</p>}
        </div>

        <div className="panel readout">
          <Compass here={readout.here} home={readout.home} color={readout.color} />
          <dl>
            <div>
              <dt>Centre</dt>
              <dd>{readout.centre}</dd>
            </div>
            <div>
              <dt>Lean</dt>
              <dd>
                {readout.lean >= 0 ? "+" : "−"}
                {Math.abs(readout.lean).toFixed(2)} <span>{leanWords(readout.lean)}</span>
              </dd>
            </div>
            <div>
              <dt>Focus</dt>
              <dd>{Math.round(readout.focus * 100)}%</dd>
            </div>
            <div>
              <dt>Energy</dt>
              <dd>{Math.round(readout.energy * 100)}%</dd>
            </div>
          </dl>
          <p className="legend-note">Dot: harmonic centre now. Ring: home, averaged over ~20 s.</p>
        </div>
      </div>

      {dragging && <div className="drop">Drop to play</div>}
    </div>
  );
};
