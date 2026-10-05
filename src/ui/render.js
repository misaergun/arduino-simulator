const LED_PIN = 13;

const isAnalogKey = (key) => /^A\d+$/.test(key);

// Digital pins first (numeric order), then analog pins A0, A1, ...
const pinOrder = (key) => (isAnalogKey(key) ? 1000 + Number(key.slice(1)) : Number(key));

/** Shows the LED pin's state: brightness from its PWM duty cycle, else full on/off. */
export function renderLed(sim) {
  const led = document.getElementById("led");
  const pwmLabel = document.getElementById("led-pwm");
  const pin = sim.getPin(LED_PIN);
  const brightness = pin.pwm > 0 ? pin.pwm / 255 : pin.value > 0 ? 1 : 0;

  if (led) {
    led.style.setProperty("--brightness", String(brightness));
    led.classList.toggle("on", brightness > 0);
  }
  if (pwmLabel) pwmLabel.textContent = "PWM: " + (pin.pwm || 0);
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
