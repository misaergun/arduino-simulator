// simulator.js

// Convert anything (undefined, NaN, Infinity, strings) to an integer in [min, max].
function toSafeInt(raw, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export class ArduinoSimulator {
  constructor({ digitalPins = 14, analogBase = 14 } = {}) {
    this._events = new EventTarget();
    this._startTime = performance.now();

    // internal pin model: keys are string numbers
    this._pins = new Map();
    this._digitalCount = digitalPins;
    this._analogBase = analogBase;
    

    for (let i = 0; i < this._digitalCount; i++) {
      this._pins.set(String(i), {
        mode: "INPUT",
        value: 0,
        pwm: 0,
        analogValue: 0,
      });
    }
  }

  // Event helpers
  on(name, fn) {
    this._events.addEventListener(name, fn);
  }
  off(name, fn) {
    this._events.removeEventListener(name, fn);
  }
  _emit(name, detail) {
    try {
      this._events.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (e) {
      // swallow
    }
  }

  // Pure logic methods
  _ensurePin(key) {
    const k = String(key);
    if (!this._pins.has(k))
      this._pins.set(k, { mode: "INPUT", value: 0, pwm: 0, analogValue: 0 });
    return this._pins.get(k);
  }

  // Returns a shallow copy of pin state
  getPin(pin) {
    const p = this._pins.get(String(pin));
    if (!p) return { mode: "INPUT", value: 0, pwm: 0, analogValue: 0 };
    return {
      mode: p.mode,
      value: p.value,
      pwm: p.pwm,
      analogValue: p.analogValue,
    };
  }

  digitalRead(pin) {
    const p = this._pins.get(String(pin));
    return p ? (p.value ? 1 : 0) : 0;
  }

  // Forcefully set a pin value (used for inputs from UI)
  setPinValue(pin, value) {
    const p = this._ensurePin(pin);
    const v = value ? 1 : 0;
    const old = p.value;
    if (old === v) return; // avoid event spam
    p.value = v;
    this._emit("pinChanged", { pin: String(pin), value: v, mode: p.mode });
  }

  pinMode(pin, mode) {
    const p = this._ensurePin(pin);
    const m = String(mode).toUpperCase();
    if (m !== "INPUT" && m !== "OUTPUT" && m !== "INPUT_PULLUP") {
      throw new Error("Invalid mode: " + String(mode));
    }
    if (p.mode === m) return; // no change
    p.mode = m;
    if (
      m === "INPUT_PULLUP" &&
      (p.value === 0 || typeof p.value === "undefined")
    )
      p.value = 1;
    this._emit("modeChanged", { pin: String(pin), mode: m });
  }

  digitalWrite(pin, value) {
    const p = this._ensurePin(pin);
    if (String(p.mode).toUpperCase() !== "OUTPUT") {
      const msg = `digitalWrite on non-OUTPUT pin ${pin}`;
      this._emit("warning", { message: msg, pin: String(pin) });
      console.warn(msg);
      return;
    }
    const v = value ? 1 : 0;
    const hadPwm = p.pwm !== 0;
    p.pwm = 0; // digitalWrite turns PWM off, as on real hardware
    if (p.value === v && !hadPwm) return;
    p.value = v;
    this._emit("pinChanged", { pin: String(pin), value: v, mode: p.mode });
  }

  analogWrite(pin, raw) {
    const p = this._ensurePin(pin);
    const v = toSafeInt(raw, 0, 255);
    // like real Arduino: analogWrite configures the pin as OUTPUT itself
    if (p.mode !== "OUTPUT") {
      p.mode = "OUTPUT";
      this._emit("modeChanged", { pin: String(pin), mode: p.mode });
    }
    const newVal = v > 0 ? 1 : 0;
    if (p.pwm === v && p.value === newVal) return; // no change
    p.pwm = v;
    if (p.value !== newVal) {
      p.value = newVal;
      this._emit("pinChanged", { pin: String(pin), value: p.value, mode: p.mode });
    }
    // `pwm` kept for backward compatibility
    this._emit("analogChanged", {
      pin: String(pin),
      value: v,
      normalized: v / 255,
      pwm: v,
    });
  }

  setAnalogValue(pin, value) {
    // Accept only A<n> strings for analog inputs
    const s = String(pin).toUpperCase();
    const m = /^A(\d+)$/i.exec(s);
    if (!m) throw new Error("setAnalogValue requires analog pin like 'A0'");
    const key = `A${Number(m[1])}`;
    const v = toSafeInt(value, 0, 1023);
    const p = this._ensurePin(key);
    const old = p.analogValue;
    if (old === v) return;
    p.analogValue = v;
    this._emit("analogInputChanged", { pin: String(key), value: v });
  }

  analogRead(pin) {
    // Accepts 'A0'..'An', channel numbers 0..5, or board numbers (14 = A0).
    let key = null;
    const m = /^A(\d+)$/i.exec(String(pin).trim());
    if (m) key = `A${Number(m[1])}`;
    else {
      const n = typeof pin === "number" ? pin : NaN;
      if (Number.isInteger(n) && n >= 0) {
        key = `A${n >= this._analogBase ? n - this._analogBase : n}`;
      }
    }
    if (!key) {
      this._emit("warning", { message: `analogRead on invalid pin ${pin}` });
      return 0;
    }
    const p = this._pins.get(key);
    return p ? toSafeInt(p.analogValue, 0, 1023) : 0;
  }

  _toAnalogKey(pin) {
    // Deprecated: prefer explicit 'A#' strings
    const s = String(pin).toUpperCase();
    const m = /^A(\d+)$/i.exec(s);
    if (m) return `A${Number(m[1])}`;
    if (!isNaN(Number(pin))) return String(Number(pin));
    return s;
  }

  millis() {
    return Math.floor(performance.now() - this._startTime);
  }

  serialPrint(text) {
    this._emit("serial", { text: String(text) });
  }

  // Export a snapshot of all pins for UI rendering
  snapshotPins() {
    const out = {};
    for (const [k, v] of this._pins.entries())
      out[k] = {
        mode: v.mode,
        value: v.value,
        pwm: v.pwm,
        analogValue: v.analogValue,
      };
    return out;
  }
}
