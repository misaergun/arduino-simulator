# Virtual Arduino Simulator

A browser-based Arduino simulator. Write a sketch in Arduino-style C, press **Run**, and watch the LED, pin states and serial output react — no board or build tools needed.

## Features

- **Arduino-style sketches** — `setup()` / `loop()` with `int`, `float`, `bool` declarations and `for (int i = 0; ...)` loops.
- **Digital I/O** — `pinMode`, `digitalWrite`, `digitalRead` with `INPUT`, `OUTPUT` and `INPUT_PULLUP`.
- **Analog I/O** — `analogRead(A0)` returns 0–1023 from the on-screen slider; `analogWrite(pin, 0–255)` drives PWM.
- **PWM LED** — the pin 13 LED shows brightness proportional to the PWM value, or full on/off for digital writes.
- **Timing** — `delay(ms)` and `millis()`.
- **Serial console** — `Serial.begin`, `Serial.print`, `Serial.println`.
- **Inputs** — a push button on pin 2 (hold for HIGH) and an analog slider on A0.
- **Live pin table** — mode and value of every used pin, updated as the sketch runs.
- **Safe execution** — sketches run in a Web Worker, so the page stays responsive. A sketch that blocks (e.g. `while (true) {}`) is stopped automatically after about one second with an error.
- **Robust input handling** — out-of-range or invalid values (`NaN`, negative, too large) are clamped instead of crashing the simulator.

## Getting started

The app uses ES modules and Web Workers, which browsers block on `file://` URLs. Serve the folder over HTTP:

```bash
cd arduino-simulator
python3 -m http.server 8000
```

Then open <http://localhost:8000> in a recent version of Chrome, Firefox, Safari or Edge.

## Example sketches

**Blink**

```cpp
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
```

**Fade**

```cpp
void setup() {}

void loop() {
  for (int i = 0; i <= 255; i += 5) {
    analogWrite(13, i);
    delay(30);
  }
}
```

**Potentiometer → LED brightness** (move the A0 slider)

```cpp
void setup() {
  Serial.begin(9600);
}

void loop() {
  int sensor = analogRead(A0);
  analogWrite(13, sensor / 4);
  Serial.println(sensor);
  delay(100);
}
```

**Button**

```cpp
void setup() {
  pinMode(2, INPUT);
  pinMode(13, OUTPUT);
}

void loop() {
  if (digitalRead(2) == HIGH) {
    digitalWrite(13, HIGH);
  } else {
    digitalWrite(13, LOW);
  }
}
```

## Supported API

| Function | Notes |
|---|---|
| `pinMode(pin, mode)` | `INPUT`, `OUTPUT`, `INPUT_PULLUP` (pull-up pins read HIGH by default) |
| `digitalWrite(pin, value)` | Pin must be `OUTPUT`, otherwise the write is ignored with a warning. Turns PWM off. |
| `digitalRead(pin)` | Returns `0` or `1` |
| `analogWrite(pin, value)` | Value clamped to 0–255; sets the pin to `OUTPUT` automatically, as on real hardware |
| `analogRead(pin)` | `A0`–`A5`, `0`–`5` or `14`–`19`; returns 0–1023, or `0` for an invalid pin |
| `delay(ms)` | |
| `millis()` | Milliseconds since the sketch started |
| `Serial.begin / print / println` | `begin` is accepted and ignored |
| `HIGH`, `LOW`, `A0`–`A5` | |

## How it works

| File | Role |
|---|---|
| `index.html` | Page layout: editor, LED, pin table, inputs, serial console |
| `ui.js` | Button wiring, LED and pin-table rendering, input controls |
| `runner.js` | Converts the sketch to JavaScript (`transform`) and talks to the worker |
| `worker-runner.js` | Runs the sketch in a nested worker and stops it if it stops responding |
| `simulator.js` | Pin model (`ArduinoSimulator`): pin state, events, value validation |
| `style.css` | Styles |

The sketch is converted to JavaScript with a few simple text rules, not a full C++ compiler: `void setup()` / `void loop()` become `async` functions, declarations become `let`, and `delay`, `digitalRead`, `analogRead` and `millis` calls get an `await`. The converted code runs inside the worker. Each pin operation is sent as a message to the main thread, where `ArduinoSimulator` updates the pin state and fires events (`pinChanged`, `analogChanged`, `modeChanged`, `serial`) that the UI listens to.

## Limitations

- **Simple conversion rules, not a compiler.** Only common sketch patterns are recognized.
- **Only `setup()` and `loop()` are converted.** Helper functions such as `int readSensor() { ... }` are not converted, and calling `delay` or `digitalRead` inside them fails.
- **Limited types outside `for` loops.** Only `int`, `float` and `bool` declarations are converted. `long`, `unsigned long`, `byte`, `String` and arrays are not converted yet.
- **One LED and fixed inputs.** The only output on screen is the LED on pin 13. The only inputs are the button on pin 2 and the slider on A0.
- **Timing is approximate.** It follows browser timers, not real hardware clock speed.
