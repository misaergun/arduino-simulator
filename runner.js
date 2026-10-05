// runner.js
import { ArduinoSimulator } from "./simulator.js";

export function transform(code) {
  // Safer transform: avoid replacing inside strings or comments.
  const parts = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    // line comment
    if (ch === "/" && code[i + 1] === "/") {
      let j = i + 2;
      while (j < n && code[j] !== "\n") j++;
      parts.push({ type: "comment", text: code.slice(i, j) });
      i = j;
      continue;
    }
    // block comment
    if (ch === "/" && code[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(code[j] === "*" && code[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      parts.push({ type: "comment", text: code.slice(i, j) });
      i = j;
      continue;
    }
    // string literals
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch;
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") j += 2;
        else if (code[j] === q) {
          j++;
          break;
        } else j++;
      }
      parts.push({ type: "string", text: code.slice(i, j) });
      i = j;
      continue;
    }
    // otherwise, gather code until next comment or string start.
    // A lone "/" (division) is ordinary code and must be consumed here,
    // otherwise the outer loop never advances.
    let j = i;
    while (j < n) {
      const c = code[j];
      if (c === '"' || c === "'" || c === "`") break;
      if (c === "/" && (code[j + 1] === "/" || code[j + 1] === "*")) break;
      j++;
    }
    if (j === i) j = i + 1; // safety: always make progress
    parts.push({ type: "code", text: code.slice(i, j) });
    i = j;
  }

  function replaceCodeSegment(s) {
    // for-loop headers: for (int i = 0; ...) -> for (let i = 0; ...)
    s = s.replace(
      /\bfor\s*\(\s*(?:unsigned\s+)?(?:int|long|short|byte|float|double|bool|char)\s+/g,
      "for (let ",
    );

    // helper: convert C-like declarations (int/float/bool) ending with semicolon
    s = s.replace(
      /(^|[;{}\n\r])(\s*)(int|float|bool)\s+([^;]+);/gm,
      (m, prefix, ws, type, declList) => {
        // declList may be "a = 5, b" — convert to `let a = 5, b;`
        // split on commas at top level (no full parser; we assume simple inits)
        const parts = [];
        let cur = "";
        let depth = 0;
        for (let i = 0; i < declList.length; i++) {
          const ch = declList[i];
          if (ch === "," && depth === 0) {
            parts.push(cur.trim());
            cur = "";
            continue;
          }
          cur += ch;
          if (ch === "(") depth++;
          else if (ch === ")") depth = Math.max(0, depth - 1);
        }
        if (cur.trim() !== "") parts.push(cur.trim());
        const mapped = parts.join(", ");
        return `${prefix}${ws}let ${mapped};`;
      },
    );

    // Convert void setup/loop to async functions
    s = s.replace(/void\s+setup\s*\(\s*\)/g, "async function setup()");
    s = s.replace(/void\s+loop\s*\(\s*\)/g, "async function loop()");

    // Replace constants (word boundaries only)
    s = s.replace(/\bHIGH\b/g, "1").replace(/\bLOW\b/g, "0");
    s = s
      .replace(/\bOUTPUT\b/g, "'OUTPUT'")
      .replace(/\bINPUT_PULLUP\b/g, "'INPUT_PULLUP'")
      .replace(/\bINPUT\b/g, "'INPUT'");

    // Remove hardcoded analog pin mapping — leave A0..A5 as identifiers
    // (mapping will be handled by runtime `analogRead`/pin resolver)

    // Ensure `delay(...)` calls are awaited, but avoid touching property access
    // (obj.delay) or longer identifiers. We capture a preceding character to
    // ensure we don't replace substrings.
    s = s.replace(/(^|[^.\w$])delay\s*\(/g, (m, p) => `${p}await delay(`);
    // Reads go through worker RPC and return Promises — await them too.
    s = s.replace(
      /(^|[^.\w$])(digitalRead|analogRead|millis)\s*\(/g,
      (m, p, fn) => `${p}await ${fn}(`,
    );

    return s;
  }

  return parts
    .map((p) => (p.type === "code" ? replaceCodeSegment(p.text) : p.text))
    .join("");
}

let activeExecution = null; // { sim, worker }
let activeWorker = null;
export const simEvents = new EventTarget();

export async function runCode(userCode, opts = {}) {
  // stop any running sim first
  stopCode();

  const sim = new ArduinoSimulator();
  sim._startTime = performance.now();

  const transformed = transform(userCode);
  // Start a Web Worker to execute the user's sketch for full isolation.
  // The worker will RPC to this main thread to access simulator state (pins, serial, etc.).
  try {
    const worker = new Worker(new URL("./worker-runner.js", import.meta.url), {
      type: "module",
    });
    activeWorker = worker;

    // Handle requests from worker: 'call' = fire-and-forget, 'request' = needs response
    // RPC: handle messages from worker. Keep a minimal whitelist to avoid exposing internals.
    // Promise that resolves when worker signals it has started running.
    let _startedResolved = false;
    let _startedResolve;
    let _startedReject;
    // allow longer startup in some environments and collect early messages
    const _startTimeout = (opts && opts.startTimeoutMs) || 10000;
    const _startMsgs = [];
    let _startTimer = null;
    function finishStart(resolveFlag, val) {
      if (_startedResolved) return;
      _startedResolved = true;
      try {
        if (_startTimer) clearTimeout(_startTimer);
      } catch (e) {}
      if (resolveFlag) _startedResolve && _startedResolve(val);
      else _startedReject && _startedReject(val);
    }
    const _startedPromise = new Promise((resolve, reject) => {
      _startedResolve = resolve;
      _startedReject = reject;
      _startTimer = setTimeout(() => {
        if (!_startedResolved) {
          const summary = _startMsgs.slice(-10).map((m) => m.type || String(m)).join(",");
          try { worker.postMessage({ type: "stop" }); } catch (e) {}
          try { worker.terminate(); } catch (e) {}
          reject(new Error("Worker start timeout. Recent messages: " + summary));
        }
      }, _startTimeout);
    });

    worker.onmessage = async (ev) => {
      const msg = ev.data;
      if (!msg) return;
      if (!_startedResolved) _startMsgs.push(msg);
      if (!msg.type) return;

      try {
        if (msg.type === "call") {
          const { method, args } = msg;
          // whitelist fire-and-forget methods
          if (method === "pinMode") sim.pinMode(...(args || []));
          else if (method === "digitalWrite") sim.digitalWrite(...(args || []));
          else if (method === "analogWrite") sim.analogWrite(...(args || []));
          else if (method === "serialPrint") sim.serialPrint(...(args || []));
          else {
            // unknown call — ignore
          }
        } else if (msg.type === "request") {
          const { id, method, args } = msg;
          // whitelist requestable methods that return values
          if (method === "digitalRead") {
            const res = sim.digitalRead(...(args || []));
            worker.postMessage({ type: "response", id, result: res });
          } else if (method === "analogRead") {
            const res = sim.analogRead(...(args || []));
            worker.postMessage({ type: "response", id, result: res });
          } else if (method === "delay") {
            // implement delay on main thread as fallback: resolve after timeout
            const ms = Number((args && args[0]) || 0);
            setTimeout(
              () => worker.postMessage({ type: "response", id, result: null }),
              ms,
            );
          } else if (method === "millis") {
            worker.postMessage({ type: "response", id, result: sim.millis() });
          } else {
            worker.postMessage({
              type: "response",
              id,
              error: "Unknown method",
            });
          }
        } else if (msg.type === "worker-ready") {
          // worker loaded JS environment; treat as early success to avoid
          // start-timeout in restrictive environments. Final running state
          // will be set when we receive the real 'started' message.
          if (!_startedResolved) finishStart(true, sim);
        } else if (msg.type === "started") {
          // subworker or outer worker signaled actual runtime start
          if (!_startedResolved) finishStart(true, sim);
          sim._running = true;
          activeExecution = { sim, worker };
          activeWorker = worker;
          simEvents.dispatchEvent(
            new CustomEvent("sim:started", { detail: { sim } }),
          );
        } else if (msg.type === "stopped") {
          // worker finished cleanly
          try {
            worker.onmessage = null;
            worker.onerror = null;
          } catch (e) {}
          if (!_startedResolved) {
            finishStart(false, new Error("Worker stopped before start"));
          }
          sim._running = false;
          activeExecution = null;
          activeWorker = null;
          simEvents.dispatchEvent(new CustomEvent("sim:stopped"));
        } else if (msg.type === "error") {
          // worker reported an error
          try {
            worker.onmessage = null;
            worker.onerror = null;
          } catch (e) {}
          if (!_startedResolved) {
            finishStart(false, new Error(String(msg.error || "Worker error")));
          }
          sim._running = false;
          activeExecution = null;
          activeWorker = null;
          simEvents.dispatchEvent(
            new CustomEvent("sim:error", { detail: { error: msg.error } }),
          );
          simEvents.dispatchEvent(new CustomEvent("sim:stopped"));
        } else if (msg.type === "tick") {
          // worker reports iteration duration — use this for watchdog decisions
          const duration = Number(msg.duration || 0);
          simEvents.dispatchEvent(
            new CustomEvent("sim:tick", { detail: { duration } }),
          );
          // Watchdog: if configured, detect too-long iterations and stop after grace
          const tickWarnMs = (opts && opts.tickWarnMs) || 2000;
          if (duration > tickWarnMs) {
            simEvents.dispatchEvent(
              new CustomEvent("sim:warning", {
                detail: { message: `Loop iteration too long (${duration} ms)` },
              }),
            );
            // if it keeps happening stop after short delay — use centralized stop
            setTimeout(() => {
              if (activeWorker) {
                stopCode(new Error("Possible infinite loop detected"));
              }
            }, 2000);
          }
        }
      } catch (e) {
        console.error("Error handling worker message", e);
      }
    };

    worker.onerror = (e) => {
      // worker-level error: ensure cleanup
      try {
        worker.onmessage = null;
        worker.onerror = null;
      } catch (er) {}
      if (!_startedResolved) {
        finishStart(false, new Error(e && e.message ? e.message : String(e)));
      }
      sim._running = false;
      activeExecution = null;
      activeWorker = null;
      simEvents.dispatchEvent(
        new CustomEvent("sim:error", { detail: { error: e.message || e } }),
      );
      simEvents.dispatchEvent(new CustomEvent("sim:stopped"));
    };

    // Send the transformed code to the worker to start execution
    // Provide a small configuration and watchdog thresholds
    // As a robust fallback, resolve start immediately so UI doesn't hang
    // in environments where worker messages may be delayed. Runtime errors
    // will still be reported via simEvents and worker.onerror.
    try {
      if (!_startedResolved) finishStart(true, sim);
    } catch (e) {}

    worker.postMessage({
      type: "start",
      code: transformed,
      config: { tickWarnMs: opts.tickWarnMs || 1000 },
    });

    // Wait for worker to confirm it started before returning sim (but we
    // already resolved above to avoid timeouts in some environments).
    try {
      await _startedPromise;
    } catch (e) {
      // if startup failed after our early resolve, rethrow to surface error
      throw e;
    }
    return sim;
  } catch (err) {
    throw err;
  }
}

export function stopCode() {
  // Centralized stop routine — safe to call multiple times.
  try {
    if (activeWorker) {
      try {
        activeWorker.postMessage({ type: "stop" });
      } catch (e) {}
      try {
        activeWorker.terminate();
      } catch (e) {}
      activeWorker = null;
    }
    if (activeExecution && activeExecution.sim)
      activeExecution.sim._running = false;
    activeExecution = null;
  } catch (e) {}
  simEvents.dispatchEvent(new CustomEvent("sim:stopped"));
}
