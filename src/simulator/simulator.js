const VALID_MODES = ["INPUT", "OUTPUT", "INPUT_PULLUP"];

// Convert anything (undefined, NaN, Infinity, strings) to an integer in [min, max].
function toSafeInt(raw, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function createPin() {
  return { mode: "INPUT", value: 0, pwm: 0, analogValue: 0 };
}

/**
 * Pin-level model of an Arduino board. Holds pin state and emits events
 * (`pinChanged`, `modeChanged`, `analogChanged`, `analogInputChanged`,
 * `serial`, `warning`) whenever that state changes.
 *
 * Digital pins are keyed by their number ("0".."13"), analog inputs by "A<n>".
 */
export class ArduinoSimulator {
  constructor({ digitalPins = 14, analogBase = 14 } = {}) {
    this._events = new EventTarget();
    this._startTime = performance.now();
    this._pins = new Map();
    this._analogBase = analogBase;

    for (let i = 0; i < digitalPins; i++) {
      this._pins.set(String(i), createPin());
    }
  }

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
      // a failing listener must never break the simulation
    }
  }

  _ensurePin(key) {
    const k = String(key);
    if (!this._pins.has(k)) this._pins.set(k, createPin());
    return this._pins.get(k);
  }

  /** Returns a copy of a pin's state (defaults for unknown pins). */
  getPin(pin) {
    const p = this._pins.get(String(pin));
    return p ? { ...p } : createPin();
  }

  /** Returns a copy of every pin's state, keyed by pin name. */
  snapshotPins() {
    const out = {};
    for (const [k, v] of this._pins.entries()) out[k] = { ...v };
    return out;
  }

  pinMode(pin, mode) {
    const p = this._ensurePin(pin);
    const m = String(mode).toUpperCase();
    if (!VALID_MODES.includes(m)) {
      throw new Error("Invalid mode: " + String(mode));
    }
    if (p.mode === m) return;
    p.mode = m;
    if (m === "INPUT_PULLUP" && !p.value) p.value = 1;
    this._emit("modeChanged", { pin: String(pin), mode: m });
  }

  digitalRead(pin) {
    const p = this._pins.get(String(pin));
    return p && p.value ? 1 : 0;
  }

  digitalWrite(pin, value) {
    const p = this._ensurePin(pin);
    if (p.mode !== "OUTPUT") {
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

  /** Sets a pin's value from outside the sketch (e.g. a UI button). */
  setPinValue(pin, value) {
    const p = this._ensurePin(pin);
    const v = value ? 1 : 0;
    if (p.value === v) return;
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
    if (p.pwm === v && p.value === newVal) return;
    p.pwm = v;
    if (p.value !== newVal) {
      p.value = newVal;
      this._emit("pinChanged", { pin: String(pin), value: p.value, mode: p.mode });
    }
    this._emit("analogChanged", {
      pin: String(pin),
      value: v,
      normalized: v / 255,
      pwm: v,
    });
  }

  /** Sets an analog input reading (0..1023) from outside the sketch. Pin must be "A<n>". */
  setAnalogValue(pin, value) {
    const m = /^A(\d+)$/i.exec(String(pin));
    if (!m) throw new Error("setAnalogValue requires analog pin like 'A0'");
    const key = `A${Number(m[1])}`;
    const v = toSafeInt(value, 0, 1023);
    const p = this._ensurePin(key);
    if (p.analogValue === v) return;
    p.analogValue = v;
    this._emit("analogInputChanged", { pin: key, value: v });
  }

  /** Accepts "A0".."An", channel numbers 0..5, or board numbers (14 = A0). */
  analogRead(pin) {
    let key = null;
    const m = /^A(\d+)$/i.exec(String(pin).trim());
    if (m) {
      key = `A${Number(m[1])}`;
    } else if (typeof pin === "number" && Number.isInteger(pin) && pin >= 0) {
      key = `A${pin >= this._analogBase ? pin - this._analogBase : pin}`;
    }
    if (!key) {
      this._emit("warning", { message: `analogRead on invalid pin ${pin}` });
      return 0;
    }
    const p = this._pins.get(key);
    return p ? toSafeInt(p.analogValue, 0, 1023) : 0;
  }

  millis() {
    return Math.floor(performance.now() - this._startTime);
  }

  serialPrint(text) {
    this._emit("serial", { text: String(text) });
  }
}
