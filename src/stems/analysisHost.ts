import { FrameBatch, StemAnalyzer, StemRole } from "./stemAnalysis";

/** Where one stem's audio goes to be analysed; batches of frames come back in order. */
export interface AnalysisChannel {
  push(samples: Float32Array): void;
  finish(): void;
  dispose(): void;
}

export type AnalysisCallbacks = {
  onBatch: (batch: FrameBatch) => void;
  onFinished?: () => void;
  onError?: (message: string) => void;
};

// Resolved when this script first runs: the worker file sits next to it.
const SCRIPT_URL =
  typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null)?.src ?? "" : "";

export const workerUrl = (file = "stemWorker.js") => new URL(file, SCRIPT_URL || location.href).href;

/**
 * Analysis in a Web Worker. Audio sent before the worker is ready is held;
 * if the worker can't start (blocked script, no worker support), the held
 * audio is replayed into an inline analyser instead, so nothing is lost.
 */
class WorkerChannel implements AnalysisChannel {
  private worker: Worker | null;
  private ready = false;
  private held: Array<Float32Array | "finish"> = [];
  private fallback: AnalysisChannel | null = null;

  constructor(url: string, private sampleRate: number, private role: StemRole, private callbacks: AnalysisCallbacks) {
    this.worker = new Worker(url);
    this.worker.onmessage = (event) => {
      const message = event.data;
      if (message.type === "ready") {
        this.ready = true;
        const held = this.held;
        this.held = [];
        held.forEach((item) => (item === "finish" ? this.finish() : this.push(item)));
      } else if (message.type === "batch") callbacks.onBatch(message.batch);
      else if (message.type === "finished") callbacks.onFinished?.();
      else if (message.type === "error") callbacks.onError?.(message.message);
    };
    this.worker.onerror = (event) => {
      event.preventDefault?.();
      if (!this.ready) this.useFallback();
      else callbacks.onError?.(event.message || "Analysis worker failed");
    };
    this.worker.postMessage({ type: "init", sampleRate, role });
  }

  private useFallback() {
    this.worker?.terminate();
    this.worker = null;
    this.fallback = new InlineChannel(this.sampleRate, this.role, this.callbacks);
    const held = this.held;
    this.held = [];
    held.forEach((item) => (item === "finish" ? this.fallback!.finish() : this.fallback!.push(item)));
  }

  push(samples: Float32Array) {
    if (this.fallback) this.fallback.push(samples);
    else if (!this.ready) this.held.push(samples);
    else this.worker!.postMessage({ type: "push", samples }, [samples.buffer]);
  }

  finish() {
    if (this.fallback) this.fallback.finish();
    else if (!this.ready) this.held.push("finish");
    else this.worker!.postMessage({ type: "finish" });
  }

  dispose() {
    this.worker?.terminate();
    this.fallback?.dispose();
  }
}

/**
 * The same analysis on the main thread, for pages where workers aren't
 * available. Work is sliced into short pieces so rendering keeps going.
 */
class InlineChannel implements AnalysisChannel {
  private analyzer: StemAnalyzer;
  private queue: Array<Float32Array | "finish"> = [];
  private busy = false;
  private disposed = false;
  private static readonly SLICE = 8192;

  constructor(sampleRate: number, role: StemRole, private callbacks: AnalysisCallbacks) {
    this.analyzer = new StemAnalyzer(sampleRate, role);
  }

  push(samples: Float32Array) {
    for (let at = 0; at < samples.length; at += InlineChannel.SLICE) {
      this.queue.push(samples.subarray(at, at + InlineChannel.SLICE));
    }
    this.pump();
  }

  finish() {
    this.queue.push("finish");
    this.pump();
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
  }

  private pump() {
    if (this.busy || this.disposed) return;
    this.busy = true;
    setTimeout(() => {
      this.busy = false;
      if (this.disposed) return;
      const started = performance.now();
      while (this.queue.length && performance.now() - started < 8) {
        const item = this.queue.shift()!;
        try {
          if (item === "finish") {
            const batch = this.analyzer.finish();
            if (batch) this.callbacks.onBatch(batch);
            this.callbacks.onFinished?.();
          } else {
            const batch = this.analyzer.push(item);
            if (batch) this.callbacks.onBatch(batch);
          }
        } catch (error) {
          this.callbacks.onError?.(error instanceof Error ? error.message : String(error));
        }
      }
      if (this.queue.length) this.pump();
    }, 0);
  }
}

/** A worker when possible (it keeps the frame rate smooth), otherwise inline. */
export const createAnalysisChannel = (
  sampleRate: number,
  role: StemRole,
  callbacks: AnalysisCallbacks,
  options: { useWorker?: boolean } = {}
): AnalysisChannel => {
  if (options.useWorker !== false && typeof Worker !== "undefined") {
    try {
      return new WorkerChannel(workerUrl(), sampleRate, role, callbacks);
    } catch {
      // Blocked or unsupported: fall through to the inline analyser.
    }
  }
  return new InlineChannel(sampleRate, role, callbacks);
};
