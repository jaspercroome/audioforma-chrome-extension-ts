import { parseWav } from "./wav";

/** What the stem service (audioforma-stems /api/stream) sends. */
export type ServiceMeta = {
  job_id: string;
  model: string;
  sample_rate: number;
  channels: number;
  stems: string[];
  frames: number;
  duration: number;
  chunk_seconds: number;
  chunk_count: number;
};

export type ServiceChunk = {
  index: number;
  start: number;
  start_frame: number;
  frames: number;
  duration: number;
  urls: Record<string, string>;
};

export type ServiceProgress = { fraction: number; seconds_done: number; elapsed: number; speed: number };

export type ServiceHandlers = {
  onStatus?: (state: string) => void;
  onMeta: (meta: ServiceMeta) => void;
  /** Chunks are delivered in order, decoded: one Float32Array per channel per stem. */
  onChunk: (chunk: ServiceChunk, audio: Record<string, Float32Array[]>) => void;
  onProgress?: (progress: ServiceProgress) => void;
  onDone?: () => void;
  onError: (message: string) => void;
};

export type ServiceStream = { cancel: () => void };

/**
 * Upload a song to the stem service and follow its separation: stems arrive
 * chunk by chunk over Server-Sent Events while Demucs is still working.
 */
export const streamFromService = (
  server: string,
  file: File,
  model: string,
  handlers: ServiceHandlers
): ServiceStream => {
  const base = server.replace(/\/+$/, "");
  let cancelled = false;
  let events: EventSource | null = null;
  let chain = Promise.resolve();

  const fail = (message: string) => {
    if (cancelled) return;
    cancelled = true;
    events?.close();
    handlers.onError(message);
  };

  const fetchChunk = async (chunk: ServiceChunk) => {
    const entries = await Promise.all(
      Object.entries(chunk.urls).map(async ([stem, url]) => {
        const response = await fetch(base + url);
        if (!response.ok) throw new Error(`chunk ${chunk.index} of ${stem}: HTTP ${response.status}`);
        return [stem, parseWav(await response.arrayBuffer()).channels] as const;
      })
    );
    return Object.fromEntries(entries) as Record<string, Float32Array[]>;
  };

  (async () => {
    const form = new FormData();
    form.append("file", file);
    form.append("model", model);
    let job: { job_id: string; events_url: string };
    try {
      const response = await fetch(`${base}/api/stream`, { method: "POST", body: form });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail ?? `HTTP ${response.status}`);
      }
      job = await response.json();
    } catch (error) {
      fail(`Couldn't reach the stem service at ${base}: ${error instanceof Error ? error.message : error}`);
      return;
    }
    if (cancelled) return;

    events = new EventSource(base + job.events_url);
    const on = (name: string, handle: (data: any) => void) =>
      events!.addEventListener(name, (event) => {
        if (!cancelled) handle(JSON.parse((event as MessageEvent).data));
      });

    on("status", (data) => handlers.onStatus?.(data.state));
    on("meta", (data) => handlers.onMeta(data));
    on("progress", (data) => handlers.onProgress?.(data));
    on("chunk", (data: ServiceChunk) => {
      // Fetch in order so chunks are handed over in order.
      chain = chain
        .then(() => (cancelled ? null : fetchChunk(data)))
        .then((audio) => {
          if (audio && !cancelled) handlers.onChunk(data, audio);
        })
        .catch((error) => fail(`Couldn't load stems: ${error instanceof Error ? error.message : error}`));
    });
    on("done", () => {
      events?.close();
      chain = chain.then(() => {
        if (!cancelled) handlers.onDone?.();
      });
    });
    events.addEventListener("error", (event) => {
      const data = (event as MessageEvent).data;
      if (data) {
        // The service's own "error" event: separation failed.
        fail(JSON.parse(data).message ?? "Separation failed");
      } else if (events?.readyState === EventSource.CLOSED) {
        fail("Lost the connection to the stem service");
      }
      // Otherwise EventSource reconnects by itself and resumes from the last event.
    });
  })();

  return {
    cancel: () => {
      cancelled = true;
      events?.close();
    },
  };
};
