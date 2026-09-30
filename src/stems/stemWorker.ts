// Web Worker: runs one stem's analysis off the main thread.
import { FrameBatch, StemAnalyzer, StemRole } from "./stemAnalysis";

type Incoming =
  | { type: "init"; sampleRate: number; role: StemRole }
  | { type: "push"; samples: Float32Array }
  | { type: "finish" };

type WorkerScope = {
  onmessage: ((event: MessageEvent<Incoming>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

const scope = self as unknown as WorkerScope;
let analyzer: StemAnalyzer | null = null;

const send = (batch: FrameBatch | null, done = false) => {
  if (batch) scope.postMessage({ type: "batch", batch }, [batch.bytes.buffer, batch.floats.buffer]);
  if (done) scope.postMessage({ type: "finished" });
};

scope.onmessage = (event) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      analyzer = new StemAnalyzer(message.sampleRate, message.role);
      scope.postMessage({ type: "ready" });
    }
    else if (message.type === "push") send(analyzer?.push(message.samples) ?? null);
    else if (message.type === "finish") send(analyzer?.finish() ?? null, true);
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
