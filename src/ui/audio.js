const BEEP_HZ = 900;
const VOLUME = 0.05; // square waves are loud; keep it gentle
const RAMP_S = 0.005; // gain time constant: short fades avoid audible clicks

let ctx = null;
// One oscillator per pin, started once and gated by its gain, so repeated
// HIGH writes can never stack overlapping sounds.
const voices = new Map();

/**
 * Creates or resumes the AudioContext. Browsers only allow audio after a user
 * gesture, so call this from a click handler (e.g. the Run button).
 */
export function unlockAudio() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  if (!ctx) ctx = new AudioCtx();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
}

function voiceFor(pin) {
  let gain = voices.get(pin);
  if (!gain) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = BEEP_HZ;
    gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    voices.set(pin, gain);
  }
  return gain;
}

/** Turns the tone for `pin` on or off. Silent until unlockAudio() has run. */
export function setTone(pin, on) {
  if (!ctx) return;
  const gain = voiceFor(String(pin));
  gain.gain.setTargetAtTime(on ? VOLUME : 0, ctx.currentTime, RAMP_S);
}
