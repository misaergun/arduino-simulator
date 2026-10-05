import { setTone } from "./audio.js";

const isAnalogKey = (key) => /^A\d+$/.test(key);

// Digital pins first (numeric order), then analog pins A0, A1, ...
const pinOrder = (key) => (isAnalogKey(key) ? 1000 + Number(key.slice(1)) : Number(key));

/**
 * Drives the LED element `#led-<pin>` from a PWM value (0..255): on when
 * pwm > 0, with opacity and glow scaled by pwm / 255 (see `.led` in style.css).
 */
export function updateLED(pin, pwm) {
  const led = document.getElementById("led-" + pin);
  if (!led) return;
  const duty = Math.min(255, Math.max(0, Number(pwm) || 0));
  led.style.setProperty("--brightness", String(duty / 255));
  led.classList.toggle("on", duty > 0);
}

/**
 * Shows buzzer `#buzzer-<pin>` sounding while its pin is HIGH and plays its
 * tone. Acts only on a state change, so "BEEP" is logged once per start.
 */
export function updateBuzzer(pin, on) {
  const el = document.getElementById("buzzer-" + pin);
  if (!el || el.classList.contains("on") === on) return;
  el.classList.toggle("on", on);
  el.textContent = on ? "BEEP" : "silent";
  if (on) console.log(`BEEP (pin ${pin})`);
  setTone(pin, on);
}

/** Silences every buzzer, e.g. when the sketch stops. */
export function resetBuzzers() {
  for (const buzzer of document.querySelectorAll(".buzzer[data-pin]")) {
    updateBuzzer(buzzer.dataset.pin, false);
  }
}

/**
 * Updates every output component on the page from the simulator's pin state.
 * Components are discovered from the DOM (`.led[data-pin]`, `.buzzer[data-pin]`),
 * so adding one only takes an HTML element.
 */
export function renderComponents(sim) {
  for (const led of document.querySelectorAll(".led[data-pin]")) {
    const pinNo = led.dataset.pin;
    const pin = sim.getPin(pinNo);
    // analogWrite sets pin.pwm; digitalWrite clears it and sets value 0/1
    updateLED(pinNo, pin.pwm > 0 ? pin.pwm : pin.value > 0 ? 255 : 0);
    const pwmLabel = document.getElementById(`led-${pinNo}-pwm`);
    if (pwmLabel) pwmLabel.textContent = "PWM: " + (pin.pwm || 0);
  }
  for (const buzzer of document.querySelectorAll(".buzzer[data-pin]")) {
    const pinNo = buzzer.dataset.pin;
    updateBuzzer(pinNo, sim.getPin(pinNo).value > 0);
  }
}

/**
 * Builds an empty pin table inside `container` and returns a render function
 * that updates it from a pin snapshot, touching only rows and cells that changed.
 */
export function createPinTable(container) {
  container.innerHTML = "";
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>Pin</th><th>Mode</th><th>Value</th></tr></thead>";
  const tbody = document.createElement("tbody");
  table.appendChild(tbody);
  container.appendChild(table);

  const rows = new Map();

  return function render(pins) {
    const keys = Object.keys(pins).sort((a, b) => pinOrder(a) - pinOrder(b));
    const seen = new Set();

    for (const key of keys) {
      const p = pins[key];
      if (!p) continue;
      seen.add(key);
      // analog inputs show their 0..1023 reading
      const value = String(isAnalogKey(key) ? p.analogValue : p.value);

      let row = rows.get(key);
      if (!row) {
        row = document.createElement("tr");
        for (const text of [key, p.mode, value]) {
          const td = document.createElement("td");
          td.textContent = text;
          row.appendChild(td);
        }
        row.dataset.mode = p.mode;
        row.dataset.value = value;
        rows.set(key, row);
        tbody.appendChild(row);
        continue;
      }

      if (row.dataset.mode !== p.mode) {
        row.dataset.mode = p.mode;
        row.children[1].textContent = p.mode;
      }
      if (row.dataset.value !== value) {
        row.dataset.value = value;
        row.children[2].textContent = value;
      }
    }

    for (const [key, row] of rows) {
      if (!seen.has(key)) {
        row.remove();
        rows.delete(key);
      }
    }
  };
}
