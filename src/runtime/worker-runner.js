// Outer worker: runs the user's sketch inside a nested subworker so that a
// blocking (infinite) loop can be detected and terminated from here.

const pending = new Map();
let nextId = 1;
let subworker = null;
let subworkerUrl = null;
let watchdog = null;

onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || !msg.type) return;

  if (msg.type === "response") {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      msg.error ? p.reject(msg.error) : p.resolve(msg.result);
    }
    return;
  }

  if (msg.type === "start") {
    startSubworker(msg.code || "", msg.config || {});
    return;
  }

  if (msg.type === "stop") {
    stopAll();
  }
};

function startSubworker(code, config) {
  cleanup();

  // Max time the subworker may go without responding (blocking loop).
  const maxBlockMs = config.maxBlockMs || 5000;

  const subSrc = `
    const userCode = ${JSON.stringify(code)};
    const pending = new Map();
    let nextId = 1;

    // Heartbeat: if the user's code blocks the thread, these stop arriving
    // and the outer worker terminates us.
    setInterval(() => postMessage({ type: 'heartbeat' }), 250);

    function callOuter(method, args = []) {
      postMessage({ type: 'call', method, args });
    }

    function requestOuter(method, args = []) {
      const id = String(nextId++);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        postMessage({ type: 'request', id, method, args });
      });
    }

    onmessage = (e) => {
      const m = e.data;
      if (!m || !m.type) return;

      if (m.type === 'response') {
        const p = pending.get(m.id);
        if (p) {
          pending.delete(m.id);
          m.error ? p.reject(m.error) : p.resolve(m.result);
        }
      }
    };

    (async () => {
      try {
        const startTime = performance.now();
        const api = {
          pinMode: (p, m) => callOuter('pinMode', [p, m]),
          digitalWrite: (p, v) => callOuter('digitalWrite', [p, v]),
          digitalRead: (p) => requestOuter('digitalRead', [p]),
          analogRead: (p) => requestOuter('analogRead', [p]),
          analogWrite: (p, v) => callOuter('analogWrite', [p, v]),
          delay: (ms) => new Promise((r) => setTimeout(r, Number(ms) || 0)),
          millis: () => Promise.resolve(Math.floor(performance.now() - startTime)),
          Serial: {
            begin: () => {},
            print: (t = '') => callOuter('serialPrint', [String(t)]),
            println: (t = '') => callOuter('serialPrint', [String(t) + '\\n']),
          },
          HIGH: 1,
          LOW: 0,
          INPUT: 'INPUT',
          OUTPUT: 'OUTPUT',
          INPUT_PULLUP: 'INPUT_PULLUP',
          A0: 'A0', A1: 'A1', A2: 'A2', A3: 'A3', A4: 'A4', A5: 'A5',
        };

        // Shadow globals the sketch should not touch. ('eval' cannot be a
        // parameter name in strict mode, so it is not listed here.)
        const banned = ['self', 'postMessage', 'globalThis', 'window', 'Function', 'importScripts', 'Worker'];
        const params = Object.keys(api).concat(banned);

        const wrapperBody =
          '"use strict";\\n' +
          userCode +
          '\\nreturn { setup: (typeof setup === "function") ? setup : null, loop: (typeof loop === "function") ? loop : null };';

        const wrapper = new Function(...params, wrapperBody);
        const result = wrapper(...Object.values(api), ...banned.map(() => undefined));

        postMessage({ type: 'started' });

        if (result.setup) await result.setup();

        while (true) {
          const start = performance.now();
          if (result.loop) await result.loop();
          const duration = Math.round(performance.now() - start);
          postMessage({ type: 'tick', duration });

          await new Promise((r) => setTimeout(r, 0));
        }
      } catch (err) {
        postMessage({ type: 'error', error: String((err && err.stack) || err) });
      }
    })();
  `;

  subworkerUrl = URL.createObjectURL(
    new Blob([subSrc], { type: "application/javascript" }),
  );
  const sw = new Worker(subworkerUrl);
  subworker = sw;

  let lastSeen = performance.now();
  watchdog = setInterval(() => {
    if (performance.now() - lastSeen > maxBlockMs) {
      killWithError(
        `Possible infinite loop: sketch did not respond for ${maxBlockMs} ms`,
      );
    }
  }, 250);

  sw.onmessage = (ev) => {
    if (sw !== subworker) return; // stale subworker
    lastSeen = performance.now();

    const m = ev.data;
    if (!m || !m.type) return;

    if (m.type === "heartbeat") return;

    if (m.type === "call") {
      postMessage(m);
      return;
    }

    if (m.type === "request") {
      const id = String(nextId++);
      pending.set(id, {
        resolve: (res) => sw.postMessage({ type: "response", id: m.id, result: res }),
        reject: (err) => sw.postMessage({ type: "response", id: m.id, error: err }),
      });
      postMessage({ type: "request", id, method: m.method, args: m.args });
      return;
    }

    if (m.type === "error") {
      killWithError(m.error);
      return;
    }

    postMessage(m);
  };

  sw.onerror = (e) => {
    if (sw !== subworker) return;
    e.preventDefault();
    killWithError(e.message || "Subworker error");
  };
}

function cleanup() {
  if (watchdog) {
    clearInterval(watchdog);
    watchdog = null;
  }
  if (subworker) {
    try { subworker.terminate(); } catch (e) {}
    subworker = null;
  }
  if (subworkerUrl) {
    URL.revokeObjectURL(subworkerUrl);
    subworkerUrl = null;
  }
  pending.clear();
}

function killWithError(err) {
  cleanup();
  postMessage({ type: "error", error: String(err) });
}

function stopAll() {
  cleanup();
  postMessage({ type: "stopped" });
}
