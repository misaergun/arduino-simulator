// Lightweight code editor: the real <textarea> stays on top with transparent
// text (so editing, selection, undo and paste are native), and a highlighted
// copy of its content is rendered underneath, with a line-number gutter.

const KEYWORDS = new Set([
  "void", "int", "float", "double", "bool", "boolean", "char", "byte", "long",
  "short", "unsigned", "signed", "const", "static", "volatile", "String",
  "if", "else", "for", "while", "do", "switch", "case", "default",
  "break", "continue", "return", "struct", "sizeof",
]);
const CONSTANTS = new Set([
  "HIGH", "LOW", "INPUT", "OUTPUT", "INPUT_PULLUP", "LED_BUILTIN",
  "true", "false", "A0", "A1", "A2", "A3", "A4", "A5",
]);
const BUILTINS = new Set(["Serial"]);

// One pass over the source. Groups: 1 comment, 2 string, 3 preprocessor,
// 4 number, 5 identifier.
const TOKEN =
  /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)|(^[ \t]*#[^\n]*)|(\b(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[fFuUlL]*)\b)|([A-Za-z_]\w*)/gm;
// an identifier directly followed by "(" is a function name
const CALL_AFTER = /\s*\(/y;

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls, text) => `<span class="tok-${cls}">${escapeHtml(text)}</span>`;

function identifierClass(word, isCall) {
  if (KEYWORDS.has(word)) return "keyword";
  if (CONSTANTS.has(word)) return "constant";
  if (BUILTINS.has(word)) return "builtin";
  if (isCall) return "function";
  return null;
}

/** Returns HTML for `code` with Arduino/C tokens wrapped in `tok-*` spans. */
export function highlight(code) {
  let html = "";
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    html += escapeHtml(code.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[1]) html += span("comment", m[1]);
    else if (m[2]) html += span("string", m[2]);
    else if (m[3]) html += span("preproc", m[3]);
    else if (m[4]) html += span("number", m[4]);
    else {
      CALL_AFTER.lastIndex = last;
      const cls = identifierClass(m[5], CALL_AFTER.test(code));
      html += cls ? span(cls, m[5]) : escapeHtml(m[5]);
    }
  }
  return html + escapeHtml(code.slice(last));
}

/**
 * Turns `textarea` (inside a `.code-editor`) into a highlighted editor.
 * Expects sibling `.editor-highlight`, `.editor-gutter` and `.editor-active-line`
 * elements; any that are missing are simply skipped.
 */
export function initEditor(textarea) {
  const root = textarea && textarea.closest(".code-editor");
  if (!root) return;
  const highlightEl = root.querySelector(".editor-highlight");
  const gutter = root.querySelector(".editor-gutter");
  const activeLine = root.querySelector(".editor-active-line");
  const lineHeight = () => parseFloat(getComputedStyle(textarea).lineHeight) || 20;
  const paddingTop = () => parseFloat(getComputedStyle(textarea).paddingTop) || 0;

  let lineCount = 0;
  let currentLine = -1;

  const syncScroll = () => {
    if (highlightEl) {
      highlightEl.scrollTop = textarea.scrollTop;
      highlightEl.scrollLeft = textarea.scrollLeft;
    }
    if (gutter) gutter.scrollTop = textarea.scrollTop;
    if (activeLine) {
      const y = paddingTop() + currentLine * lineHeight() - textarea.scrollTop;
      activeLine.style.transform = `translateY(${y}px)`;
    }
  };

  const updateActiveLine = () => {
    const line = textarea.value.slice(0, textarea.selectionStart).split("\n").length - 1;
    if (line === currentLine) return;
    gutter?.children[currentLine]?.classList.remove("active");
    currentLine = line;
    gutter?.children[currentLine]?.classList.add("active");
    syncScroll();
  };

  const render = () => {
    const code = textarea.value;
    // a trailing newline would otherwise not render as a line in the <pre>
    if (highlightEl) highlightEl.innerHTML = highlight(code) + "\n";

    const count = code.split("\n").length;
    if (gutter && count !== lineCount) {
      lineCount = count;
      gutter.innerHTML = Array.from({ length: count }, (_, i) => `<span>${i + 1}</span>`).join("");
      currentLine = -1; // re-apply the active marker to the new spans
    }
    updateActiveLine();
    syncScroll();
  };

  textarea.addEventListener("input", render);
  textarea.addEventListener("scroll", syncScroll, { passive: true });
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === textarea) updateActiveLine();
  });
  render();
}
