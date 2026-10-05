import { runCode, stopCode, simEvents } from "../runtime/runner.js";
import { attachInputControls } from "./controls.js";
import { renderLed, createPinTable } from "./render.js";

const PIN_EVENTS = ["pinChanged", "analogChanged", "modeChanged", "analogInputChanged"];
const WARNING_DURATION_MS = 2500;

const $ = (id) => document.getElementById(id);

// Detaches the current run's controls and listeners; null when nothing is running.
let detachCurrentRun = null;

function setStatus(text) {
  const el = $("status");
  if (el) el.textContent = "Status: " + text;
}

function detachRun() {
  if (detachCurrentRun) {
    detachCurrentRun();
    detachCurrentRun = null;
  }
}

function appendSerial(text) {
  const el = $("serial");
  if (!el) return;
  const line = document.createElement("div");
  line.textContent = text;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function clearSerial() {
  const el = $("serial");
  if (el) el.innerHTML = "";
}

function copyCode() {
  navigator.clipboard?.writeText($("code").value).catch(() => {});
}

function showWarning(message) {
  const banner = document.createElement("div");
  banner.className = "warning-banner";
  banner.textContent = message;
  const container = document.querySelector(".editor-panel");
  if (container) container.insertBefore(banner, container.firstChild);
  setTimeout(() => {
    banner.remove();
    setStatus("Running");
  }, WARNING_DURATION_MS);
}

// Binds a freshly started simulator to the page; returns a function that unbinds it.
function bindSimulator(sim) {
  const detachControls = attachInputControls(sim);
  const pinTable = $("pin-table");
  const renderPinTable = pinTable ? createPinTable(pinTable) : () => {};

  // LED first and isolated, so a table problem can never freeze it
  const onPinChanged = () => {
    try {
      renderLed(sim);
    } catch (e) {
      console.error("LED render failed", e);
    }
    try {
      renderPinTable(sim.snapshotPins());
    } catch (e) {
      console.error("Pin table render failed", e);
    }
  };
  const onSerial = (ev) => appendSerial(String(ev.detail && ev.detail.text));

  for (const name of PIN_EVENTS) sim.on(name, onPinChanged);
  sim.on("serial", onSerial);
  onPinChanged();

  return () => {
    detachControls();
    for (const name of PIN_EVENTS) sim.off(name, onPinChanged);
    sim.off("serial", onSerial);
  };
}

async function run() {
  setStatus("Starting");
  try {
    detachRun();
    const sim = await runCode($("code").value);
    setStatus("Running");
    detachCurrentRun = bindSimulator(sim);
  } catch (e) {
    setStatus("Error");
    alert("Error: " + (e && e.message ? e.message : e));
  }
}

function stop() {
  stopCode();
  setStatus("Stopped");
  detachRun();
}

function init() {
  $("runBtn")?.addEventListener("click", run);
  $("stopBtn")?.addEventListener("click", stop);
  $("clearSerialBtn")?.addEventListener("click", clearSerial);
  $("copyCodeBtn")?.addEventListener("click", copyCode);

  simEvents.addEventListener("sim:started", () => setStatus("Running"));
  simEvents.addEventListener("sim:stopped", () => setStatus("Stopped"));
  simEvents.addEventListener("sim:error", (ev) => {
    const err = ev.detail && ev.detail.error;
    setStatus("Error");
    alert("Runtime error: " + (err && err.message ? err.message : err));
  });
  simEvents.addEventListener("sim:warning", (ev) => {
    setStatus("Warning");
    showWarning(ev.detail && ev.detail.message);
  });
}

init();
