// ui.js
import { runCode, stopCode, simEvents } from "./runner.js";

export function setStatus(text) {
  const el = document.getElementById("status");
  if (el) el.textContent = "Status: " + text;
}

// Determine which pin controls the LED. Priority:
// 1. input/select with id 'led-pin-select' or 'led-pin'
// 2. data-led-pin attribute on the #led element
// 3. localStorage 'ledPin'
// 4. default 13
function getLedPin() {
  const el =
    document.getElementById("led-pin-select") ||
    document.getElementById("led-pin");
  if (el) {
    const val = (
      el.value ||
      el.getAttribute("data-pin") ||
      el.textContent ||
      ""
    ).trim();
    const n = Number(val);
    if (!isNaN(n)) return n;
    return val || 13;
  }
  const ledEl = document.getElementById("led");
  if (ledEl && ledEl.dataset && ledEl.dataset.ledPin) {
    const n = Number(ledEl.dataset.ledPin);
    if (!isNaN(n)) return n;
    return ledEl.dataset.ledPin;
  }
  try {
    const stored = localStorage.getItem("ledPin");
    if (stored) {
      const n = Number(stored);
      if (!isNaN(n)) return n;
    }
  } catch (e) {}
  return 13;
}

export function clearSerial() {
  const el = document.getElementById("serial");
  if (el) el.innerHTML = "";
}

export function copyCode() {
  const code = document.getElementById("code");
  if (!code) return;
  navigator.clipboard?.writeText(code.value).catch(() => {});
}

// Attach input controls to a specific simulator instance.
// Returns a cleanup function that removes attached listeners.
function attachSimControls(sim) {
  const btn = document.getElementById("btn-2");
  const a0 = document.getElementById("slider-a0");
  const a0Val = document.getElementById("a0-val");
  if (!btn && !a0) return () => {};

  const label = document.getElementById("btn-2-state");
  const btnEl = document.getElementById("btn-2");

  const setPin = (v) => {
    if (!sim) return;
    const current = sim.getPin(2);
    const mode = current.mode || "INPUT";
    let newVal = v ? 1 : 0;
    if (String(mode).toUpperCase() === "INPUT_PULLUP") newVal = v ? 0 : 1;
    sim.setPinValue(2, newVal);
    const updated = sim.getPin(2);
    if (label) label.textContent = updated.value ? "HIGH" : "LOW";
    if (btnEl) {
      if (updated.value) btnEl.classList.add("active");
      else btnEl.classList.remove("active");
    }
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    setPin(1);
  };
  const onPointerUp = () => setPin(0);
  const onPointerCancel = () => setPin(0);
  const onMouseDown = (e) => {
    e.preventDefault();
    setPin(1);
  };
  const onMouseUp = () => setPin(0);
  const onMouseLeave = () => setPin(0);
  const onTouchStart = (e) => {
    e.preventDefault();
    setPin(1);
  };
  const onTouchEnd = () => setPin(0);

  // Pointer events cover mouse and touch when supported; only fall back when needed
  if (window.PointerEvent) {
    btn.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointerup", onPointerUp);
    btn.addEventListener("pointercancel", onPointerCancel);
  } else {
    btn.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    btn.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchend", onTouchEnd);
  }

  const onA0Input = (e) => {
    const val = Number(e.target.value || 0);
    if (a0Val) a0Val.textContent = String(val);
    if (!sim) return;
    sim.setAnalogValue("A0", val);
  };
  if (a0 && a0Val) a0.addEventListener("input", onA0Input, { passive: true });
  // start the sim with the slider's current position, not 0
  if (a0 && sim) sim.setAnalogValue("A0", Number(a0.value || 0));

  // cleanup
  return function cleanup() {
    try {
      if (window.PointerEvent) {
        btn.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("pointerup", onPointerUp);
        btn.removeEventListener("pointercancel", onPointerCancel);
      } else {
        btn.removeEventListener("mousedown", onMouseDown);
        window.removeEventListener("mouseup", onMouseUp);
        btn.removeEventListener("touchstart", onTouchStart);
        window.removeEventListener("touchend", onTouchEnd);
      }
      if (a0 && a0Val) a0.removeEventListener("input", onA0Input);
    } catch (e) {
      console.warn("Error during cleanup of sim controls", e);
    }
  };
}

// Exported helper: attach input controls to a given simulator instance.
export function wireInputs(sim) {
  return attachSimControls(sim);
}

// Wire top-level buttons
export function wireButtons() {
  const runBtn = document.getElementById("runBtn");
  const stopBtn =
    document.getElementById("stopBtn") ||
    document.getElementById("stopBtnFallback");
  let currentSimCleanup = null;

  if (runBtn) {
    runBtn.addEventListener("click", async () => {
      setStatus("Starting");
      const code = document.getElementById("code").value;
      try {
        if (currentSimCleanup) {
          currentSimCleanup();
          currentSimCleanup = null;
        }
        const sim = await runCode(code);
        setStatus("Running");
        currentSimCleanup = attachSimControls(sim);

        // wire simulator events to UI
        // incremental pin table renderer: create rows once and update changed cells
        const pinRowMap = new Map();
        // drop rows left over from a previous run; pinRowMap starts empty
        const pinTable = document.getElementById("pin-table");
        if (pinTable) pinTable.innerHTML = "";
        function ensureTable() {
          const container = document.getElementById("pin-table");
          if (!container) return null;
          let table = container.querySelector("table");
          if (!table) {
            table = document.createElement("table");
            const thead = document.createElement("thead");
            thead.innerHTML =
              "<tr><th>Pin</th><th>Mode</th><th>Value</th></tr>";
            const tbody = document.createElement("tbody");
            table.appendChild(thead);
            table.appendChild(tbody);
            container.innerHTML = "";
            container.appendChild(table);
          }
          return table.querySelector("tbody");
        }

        // LED (configurable pin): brightness 0..1 from PWM duty cycle,
        // otherwise digital HIGH/LOW
        const renderLed = () => {
          const led = document.getElementById("led");
          const pwmLabel = document.getElementById("led-pwm");
          const pled = sim.getPin(getLedPin());
          const b = pled.pwm > 0 ? pled.pwm / 255 : pled.value > 0 ? 1 : 0;
          if (led) {
            led.style.setProperty("--brightness", String(b));
            led.classList.toggle("on", b > 0);
          }
          if (pwmLabel) pwmLabel.textContent = "PWM: " + (pled.pwm || 0);
        };

        // digital pins first (numeric order), then analog pins A0, A1, ...
        const pinOrder = (key) =>
          /^A\d+$/.test(key) ? 1000 + Number(key.slice(1)) : Number(key);

        const renderPinTable = () => {
          const pins = sim.snapshotPins();
          const tbody = ensureTable();
          if (!tbody) return;

          const keys = Object.keys(pins).sort((a, b) => pinOrder(a) - pinOrder(b));
          const seen = new Set();
          for (const key of keys) {
            const p = pins[key];
            if (!p) continue;
            seen.add(key);
            // analog inputs show their 0..1023 reading
            const sval = String(/^A\d+$/.test(key) ? p.analogValue : p.value);
            let row = pinRowMap.get(key);
            if (!row) {
              row = document.createElement("tr");
              for (const text of [key, p.mode, sval]) {
                const td = document.createElement("td");
                td.textContent = text;
                row.appendChild(td);
              }
              row.dataset.pin = key;
              row.dataset.mode = p.mode;
              row.dataset.value = sval;
              pinRowMap.set(key, row);
              tbody.appendChild(row);
            } else {
              // update only changed cells
              if (row.dataset.mode !== p.mode) {
                row.dataset.mode = p.mode;
                row.children[1].textContent = p.mode;
              }
              if (row.dataset.value !== sval) {
                row.dataset.value = sval;
                row.children[2].textContent = sval;
              }
            }
          }

          for (const existing of Array.from(pinRowMap.keys())) {
            if (!seen.has(existing)) {
              pinRowMap.get(existing).remove();
              pinRowMap.delete(existing);
            }
          }
        };

        // LED first and isolated, so a table problem can never freeze it
        const onPinChanged = () => {
          try {
            renderLed();
          } catch (e) {
            console.error("LED render failed", e);
          }
          try {
            renderPinTable();
          } catch (e) {
            console.error("Pin table render failed", e);
          }
        };

        const onSerial = (ev) => {
          const el = document.getElementById("serial");
          if (!el) return;
          const div = document.createElement("div");
          div.textContent = String(ev.detail && ev.detail.text);
          el.appendChild(div);
          el.scrollTop = el.scrollHeight;
        };

        sim.on("pinChanged", onPinChanged);
        sim.on("analogChanged", onPinChanged);
        sim.on("modeChanged", onPinChanged);
        sim.on("analogInputChanged", onPinChanged);
        sim.on("serial", onSerial);

        // initial render
        onPinChanged();

        const prevCleanup = currentSimCleanup;
        currentSimCleanup = () => {
          try {
            prevCleanup && prevCleanup();
          } catch (e) {}
          sim.off("pinChanged", onPinChanged);
          sim.off("analogChanged", onPinChanged);
          sim.off("modeChanged", onPinChanged);
          sim.off("analogInputChanged", onPinChanged);
          sim.off("serial", onSerial);
        };
      } catch (e) {
        setStatus("Error");
        alert("Error: " + (e && e.message ? e.message : e));
      }
    });
  }

  const stopClick = () => {
    stopCode();
    setStatus("Stopped");
    if (currentSimCleanup) {
      currentSimCleanup();
      currentSimCleanup = null;
    }
  };
  const stopElement = document.getElementById("stopBtn");
  if (stopElement) stopElement.addEventListener("click", stopClick);
  const stopFallback = document.querySelector("[data-stop-fallback]");
  if (stopFallback) stopFallback.addEventListener("click", stopClick);

  const clearBtn = document.getElementById("clearSerialBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearSerial);
  const copyBtn = document.getElementById("copyCodeBtn");
  if (copyBtn) copyBtn.addEventListener("click", copyCode);
}

// respond to runner events
simEvents.addEventListener("sim:started", (e) => setStatus("Running"));
simEvents.addEventListener("sim:stopped", () => setStatus("Stopped"));
simEvents.addEventListener("sim:error", (ev) => {
  const err = ev.detail && ev.detail.error;
  setStatus("Error");
  alert("Runtime error: " + (err && err.message ? err.message : err));
});
simEvents.addEventListener("sim:warning", (ev) => {
  const msg = ev.detail && ev.detail.message;
  setStatus("Warning");
  // non-blocking notice — show a small alert and keep running until grace expires
  console.warn("Simulator warning:", msg);
  const banner = document.createElement("div");
  banner.textContent = msg;
  banner.style.background = "#fff3cd";
  banner.style.color = "#856404";
  banner.style.padding = "8px";
  banner.style.borderRadius = "4px";
  banner.style.margin = "8px 0";
  const container = document.querySelector(".editor-panel");
  if (container) container.insertBefore(banner, container.firstChild);
  setTimeout(() => {
    banner.remove();
    setStatus("Running");
  }, 2500);
});
