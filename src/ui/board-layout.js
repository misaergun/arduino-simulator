const SVG_NS = "http://www.w3.org/2000/svg";

// Stage coordinate system (matches the viewBox in index.html). 1 unit = 1 mil.
const STAGE_W = 2950;
const STAGE_H = 2900;
const BOARD = { x: 200, y: 760 };

const PIN_PITCH = 100;
const TOP_ROW_Y = 100;
const BOTTOM_ROW_Y = 2000;
const PWM_PINS = [3, 5, 6, 9, 10, 11];

// Uno header x positions, in mils from the board's left edge. D8..D13 sit
// 160 mil from D7, not 100 - the well-known Uno header offset.
const digitalX = (n) => (n <= 7 ? 2600 - PIN_PITCH * n : 1740 - PIN_PITCH * (n - 8));
const analogX = (n) => 2000 + PIN_PITCH * n;

function digitalLabel(n) {
  if (n === 1) return "TX→1";
  if (n === 0) return "RX←0";
  return (PWM_PINS.includes(n) ? "~" : "") + n;
}

const TOP_HEADER = [
  { label: "SCL", x: 840 },
  { label: "SDA", x: 940 },
  { label: "AREF", x: 1040 },
  { label: "GND", x: 1140 },
  ...Array.from({ length: 14 }, (_, i) => 13 - i).map((n) => ({ label: digitalLabel(n), x: digitalX(n) })),
];

const BOTTOM_HEADER = [
  ...["", "IO", "RST", "3V3", "5V", "GND", "GND", "VIN"].map((label, i) => ({ label, x: 1100 + PIN_PITCH * i })),
  ...Array.from({ length: 6 }, (_, n) => ({ label: "A" + n, x: analogX(n) })),
];

/** Stage coordinates of a header pin: 0..13 or "A0".."A5". */
export function pinPosition(pin) {
  const analog = /^A(\d)$/i.exec(String(pin));
  const x = analog ? analogX(Number(analog[1])) : digitalX(Number(pin));
  return { x: BOARD.x + x, y: BOARD.y + (analog ? BOTTOM_ROW_Y : TOP_ROW_Y) };
}

function svg(tag, attrs, parent) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  parent.appendChild(el);
  return el;
}

// Splits a header row into its physical strips wherever the gap exceeds one pitch.
function strips(pins) {
  const groups = [];
  for (const pin of pins) {
    const last = groups[groups.length - 1];
    if (last && pin.x - last[last.length - 1].x === PIN_PITCH) last.push(pin);
    else groups.push([pin]);
  }
  return groups;
}

function drawHeaderRow(group, pins, y, labelSide) {
  for (const strip of strips(pins)) {
    const x0 = strip[0].x - PIN_PITCH / 2;
    svg("rect", { class: "header-strip", x: x0, y: y - 50, width: strip.length * PIN_PITCH, height: 100 }, group);
  }
  for (const { label, x } of pins) {
    svg("rect", { class: "header-hole", x: x - 22, y: y - 22, width: 44, height: 44 }, group);
    if (!label) continue;
    // top labels read upward below the header, like the Uno silkscreen
    const text =
      labelSide === "below"
        ? svg("text", { class: "silk silk-pin", x, y: y + 90, "text-anchor": "end", transform: `rotate(-90 ${x} ${y + 90})`, dy: "0.35em" }, group)
        : svg("text", { class: "silk silk-pin silk-pin-small", x, y: y - 75, "text-anchor": "middle" }, group);
    text.textContent = label;
  }
}

function drawWire(group, from, to, bendY, color) {
  const d = `M ${from.x} ${from.y} V ${bendY} H ${to.x} V ${to.y}`;
  svg("path", { class: "wire-shadow", d }, group);
  svg("path", { class: "wire", d, stroke: color }, group);
  // the jumper's plastic plug sitting in the header
  svg("rect", { class: "wire-plug", x: to.x - 26, y: to.y - 60, width: 52, height: 80, rx: 6 }, group);
}

/**
 * Lays out the hardware stage: draws the header pins, places every part that
 * has data-x / data-y (stage units), and draws a jumper wire from each part
 * with data-wire="<pin>" to that header pin. Positions are percentages, so
 * the whole stage scales with its width and never needs re-layout.
 */
export function layoutBoard(stage) {
  if (!stage) return;
  const headers = stage.querySelector("#board-headers");
  const wires = stage.querySelector("#board-wires");
  if (headers) {
    headers.replaceChildren();
    drawHeaderRow(headers, TOP_HEADER, TOP_ROW_Y, "below");
    drawHeaderRow(headers, BOTTOM_HEADER, BOTTOM_ROW_Y, "above");
  }
  if (wires) wires.replaceChildren();

  for (const part of stage.querySelectorAll("[data-x][data-y]")) {
    const x = Number(part.dataset.x);
    const y = Number(part.dataset.y);
    part.style.left = (x / STAGE_W) * 100 + "%";
    part.style.top = (y / STAGE_H) * 100 + "%";

    if (wires && part.dataset.wire !== undefined) {
      const to = pinPosition(part.dataset.wire);
      const bendY = Number(part.dataset.bend || to.y - 160);
      drawWire(wires, { x, y: y - 40 }, to, bendY, part.dataset.wireColor || "#e67e22");
    }
  }
}
