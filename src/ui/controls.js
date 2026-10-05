const BUTTON_PIN = 2;
const ANALOG_PIN = "A0";

/**
 * Connects the on-screen inputs (push button on pin 2, slider on A0) to a
 * simulator instance. Returns a function that disconnects them again.
 */
export function attachInputControls(sim) {
  const button = document.getElementById("btn-2");
  const buttonState = document.getElementById("btn-2-state");
  const slider = document.getElementById("slider-a0");
  const sliderValue = document.getElementById("a0-val");
  if (!button && !slider) return () => {};

  const setPressed = (pressed) => {
    // with INPUT_PULLUP a pressed button pulls the pin LOW
    const pullup = sim.getPin(BUTTON_PIN).mode === "INPUT_PULLUP";
    sim.setPinValue(BUTTON_PIN, pressed !== pullup ? 1 : 0);

    const high = sim.getPin(BUTTON_PIN).value;
    if (buttonState) buttonState.textContent = high ? "HIGH" : "LOW";
    button.classList.toggle("active", Boolean(high));
  };

  const press = (e) => {
    e.preventDefault();
    setPressed(true);
  };
  const release = () => setPressed(false);

  // [target, event, handler]. Pointer events cover mouse and touch; the
  // mouse/touch pair is only a fallback for browsers without them.
  const listeners = window.PointerEvent
    ? [
        [button, "pointerdown", press],
        [window, "pointerup", release],
        [button, "pointercancel", release],
      ]
    : [
        [button, "mousedown", press],
        [window, "mouseup", release],
        [button, "touchstart", press],
        [window, "touchend", release],
      ];

  const onSliderInput = (e) => {
    const value = Number(e.target.value || 0);
    sliderValue.textContent = String(value);
    sim.setAnalogValue(ANALOG_PIN, value);
  };
  if (slider && sliderValue) {
    listeners.push([slider, "input", onSliderInput, { passive: true }]);
  }

  for (const [target, type, handler, options] of listeners) {
    target.addEventListener(type, handler, options);
  }

  // start the sim with the slider's current position, not 0
  if (slider) sim.setAnalogValue(ANALOG_PIN, Number(slider.value || 0));

  return function detach() {
    for (const [target, type, handler] of listeners) {
      target.removeEventListener(type, handler);
    }
  };
}
