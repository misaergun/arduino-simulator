# Virtual Arduino Simulator

A browser-based Arduino simulator that runs Arduino-style C sketches with no board, toolchain, or installation. Write a sketch, press **Run**, and watch LEDs, a buzzer, pin states, and serial output respond in real time on a virtual Arduino Uno.

## Live Demo

**[arduino-simulator-zeta.vercel.app](https://arduino-simulator-zeta.vercel.app/)**

## Features

### Core Simulation

- **Arduino-style sketches** with `setup()` / `loop()`, `int` / `float` / `bool` declarations, and `for (int i = 0; ...)` loops
- **Digital I/O** via `pinMode`, `digitalWrite`, and `digitalRead` with `INPUT`, `OUTPUT`, and `INPUT_PULLUP`
- **Analog I/O** via `analogRead(A0)` (0–1023) and `analogWrite(pin, 0–255)` for PWM
- **Timing** with `delay(ms)` and `millis()`
- **Serial console** supporting `Serial.begin`, `Serial.print`, and `Serial.println`

### Hardware UI

- **Arduino Uno board** rendered in SVG, with pin holes at real Uno header positions and parts connected by jumper wires
- **PWM LEDs** on pins 13 and 12 that fade smoothly with the duty cycle; the onboard **L** LED mirrors pin 13
- **Buzzer** on pin 8 that plays a 900 Hz tone with a pulsing visual indicator while the pin is HIGH
- **Inputs:** push button on pin 2 (hold for HIGH), toggle switch on pin 4, and a potentiometer slider on A0
- **Live pin table** showing the mode and value of every pin in use
- **Responsive layout** that stacks the editor and board on narrow screens

### Developer Experience

- **Code editor** with Arduino/C syntax highlighting, line numbers, and current-line highlight, built on a native `<textarea>` so editing, undo, and paste work as expected
- **Safe execution** in a Web Worker keeps the page responsive; blocking sketches (e.g. `while (true) {}`) are stopped automatically after about one second
- **Robust input handling** clamps invalid or out-of-range values (`NaN`, negative, too large) instead of crashing
- **Extensible components** declared in HTML: any element with `class="led"` or `class="buzzer"` and `data-pin="<pin>"` is driven automatically, and wrapping it in a `.part` with `data-x`, `data-y`, and `data-wire` places and wires it on the board

## Getting Started

The app uses ES modules and Web Workers, which browsers block on `file://` URLs. Serve the project root over HTTP:

```bash
cd arduino-simulator
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000) in a recent version of Chrome, Firefox, Safari, or Edge.

> Asset paths are root-relative (e.g. `/src/ui/ui.js`), so the server must be started from the project root.

## Example Sketches

### Blink

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

### Fade

```cpp
void setup() {}

void loop() {
  for (int i = 0; i <= 255; i += 5) {
    analogWrite(13, i);
    delay(30);
  }
}
```

### Potentiometer to LED Brightness

Move the A0 slider to change the LED brightness.

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

### Switch to LEDs and Buzzer

Flip the switch on pin 4 to toggle the outputs.

```cpp
void setup() {
  pinMode(4, INPUT);
  pinMode(12, OUTPUT);
  pinMode(13, OUTPUT);
  pinMode(8, OUTPUT);
}

void loop() {
  int on = digitalRead(4);
  digitalWrite(13, on);
  digitalWrite(8, on);
  analogWrite(12, on ? 0 : 60);
  delay(50);
}
```

### Button

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

| Function                         | Notes                                                                    |
| -------------------------------- | ------------------------------------------------------------------------ |
| `pinMode(pin, mode)`             | `INPUT`, `OUTPUT`, `INPUT_PULLUP` (pull-up pins read HIGH by default)    |
| `digitalWrite(pin, value)`       | Requires `OUTPUT` mode, otherwise ignored with a warning; disables PWM   |
| `digitalRead(pin)`               | Returns `0` or `1`                                                       |
| `analogWrite(pin, value)`        | Clamped to 0–255; sets the pin to `OUTPUT` automatically                 |
| `analogRead(pin)`                | Accepts `A0`–`A5`, `0`–`5`, or `14`–`19`; returns 0–1023 (`0` if invalid) |
| `delay(ms)`                      | Pauses the sketch                                                        |
| `millis()`                       | Milliseconds since the sketch started                                    |
| `Serial.begin / print / println` | `begin` is accepted and ignored                                          |
| `HIGH`, `LOW`, `A0`–`A5`         | Constants                                                                |

## Project Structure

```
index.html                 Page layout and single entry point (src/ui/ui.js)
src/
  simulator/
    simulator.js           ArduinoSimulator: pin model, events, value validation
  runtime/
    transform.js           Converts Arduino-style sketches to JavaScript
    runner.js              Starts/stops the worker and serves pin requests
    worker-runner.js       Runs the sketch in a nested worker with a watchdog
  ui/
    ui.js                  Entry point: buttons, status, serial console
    editor.js              Syntax-highlighted code editor
    board-layout.js        Uno board drawing, part placement, and wiring
    render.js              LED, buzzer, and pin-table rendering
    controls.js            Push button, toggle switch, and A0 slider
    audio.js               Buzzer tone generation (Web Audio)
    style.css              Styles
```

The architecture is layered with one-way dependencies: `ui` → `runtime` → `simulator`. The simulator contains no DOM code and the transform is a pure function, so both can be used and tested independently.

## How It Works

1. **Transform.** The sketch is converted to JavaScript using lightweight text rules rather than a full C++ compiler. `setup()` and `loop()` become `async` functions, declarations become `let`, and blocking calls (`delay`, `digitalRead`, `analogRead`, `millis`) are awaited.
2. **Execute.** The converted code runs inside a Web Worker, guarded by a watchdog that stops sketches that block.
3. **Simulate.** Each pin operation is sent to the main thread, where `ArduinoSimulator` updates pin state and emits events (`pinChanged`, `analogChanged`, `modeChanged`, `serial`).
4. **Render.** The UI subscribes to these events and updates the board, components, pin table, and serial console.

## Limitations

- **Not a full compiler.** Only common sketch patterns are recognized.
- **Only `setup()` and `loop()` are converted.** Helper functions (e.g. `int readSensor() { ... }`) are not, and calling `delay` or `digitalRead` inside them fails.
- **Limited types.** Outside `for` loops, only `int`, `float`, and `bool` declarations are supported; `long`, `unsigned long`, `byte`, `String`, and arrays are not yet supported.
- **Fixed on-screen components.** Outputs are the LEDs on pins 13 and 12 and the buzzer on pin 8; inputs are the button on pin 2, the switch on pin 4, and the slider on A0.
- **Approximate timing.** Timing follows browser timers, not real hardware clock speed.

## Motivation

Getting started with Arduino usually requires a physical board, components, and a local toolchain. This project removes that barrier: anyone can write, run, and experiment with Arduino sketches directly in the browser. It also served as a hands-on exercise in building a layered simulation engine, running untrusted code safely in Web Workers, and translating a C-like language into JavaScript.
