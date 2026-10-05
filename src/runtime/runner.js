import { ArduinoSimulator } from "../simulator/simulator.js";
import { transform } from "./transform.js";

// The worker kills a sketch that stops responding for this long (e.g. `while (true) {}`).
const MAX_BLOCK_MS = 1000;
// A single loop() iteration longer than this triggers a warning, then a stop.
const LONG_TICK_MS = 2000;
const LONG_TICK_GRACE_MS = 2000;

/**
 * Lifecycle events for the running sketch:
 * `sim:started`, `sim:stopped`, `sim:error` ({ error }), `sim:warning` ({ message }).
 */
export const simEvents = new EventTarget();

let activeWorker = null;

function emit(name, detail) {
  simEvents.dispatchEvent(new CustomEvent(name, { detail }));
}

// Main-thread side of the worker RPC. Only these simulator methods are exposed.
const CALLS = ["pinMode", "digitalWrite", "analogWrite", "serialPrint"];
const REQUESTS = ["digitalRead", "analogRead", "millis"];

/**
 * Transforms and starts a sketch in a Web Worker, stopping any sketch already running.
 * Resolves with the ArduinoSimulator instance that holds the sketch's pin state.
 */
export async function runCode(userCode) {
  stopCode();

  const sim = new ArduinoSimulator();
  const worker = new Worker(new URL("./worker-runner.js", import.meta.url), {
    type: "module",
  });
  activeWorker = worker;

  const finish = () => {
    worker.onmessage = null;
    worker.onerror = null;
    activeWorker = null;
  };

  worker.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || !msg.type) return;

    try {
      switch (msg.type) {
        case "call":
          if (CALLS.includes(msg.method)) sim[msg.method](...(msg.args || []));
          break;

        case "request":
          if (REQUESTS.includes(msg.method)) {
            const result = sim[msg.method](...(msg.args || []));
            worker.postMessage({ type: "response", id: msg.id, result });
          } else {
            worker.postMessage({ type: "response", id: msg.id, error: "Unknown method" });
          }
          break;

        case "started":
          emit("sim:started", { sim });
          break;

        case "stopped":
          finish();
          emit("sim:stopped");
          break;

        case "error":
          finish();
          emit("sim:error", { error: msg.error });
          emit("sim:stopped");
          break;

        case "tick": {
          const duration = Number(msg.duration || 0);
          if (duration > LONG_TICK_MS) {
            emit("sim:warning", { message: `Loop iteration too long (${duration} ms)` });
            setTimeout(() => {
              if (activeWorker) stopCode();
            }, LONG_TICK_GRACE_MS);
          }
          break;
        }
      }
    } catch (e) {
      console.error("Error handling worker message", e);
    }
  };

  worker.onerror = (e) => {
    finish();
    emit("sim:error", { error: e.message || e });
    emit("sim:stopped");
  };

  worker.postMessage({
    type: "start",
    code: transform(userCode),
    config: { maxBlockMs: MAX_BLOCK_MS },
  });

  return sim;
}

/** Stops the running sketch, if any. Safe to call multiple times. */
export function stopCode() {
  if (activeWorker) {
    try {
      activeWorker.postMessage({ type: "stop" });
      activeWorker.terminate();
    } catch (e) {
      // worker already gone
    }
    activeWorker = null;
  }
  emit("sim:stopped");
}
