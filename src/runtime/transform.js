/**
 * Converts an Arduino-style C sketch into JavaScript that the worker can run.
 *
 * This is a set of text rewrites, not a compiler. Comments and string
 * literals are split out first so the rewrites only touch real code.
 */
export function transform(code) {
  return tokenize(code)
    .map((part) => (part.type === "code" ? rewriteCode(part.text) : part.text))
    .join("");
}

// Splits source into "code", "comment" and "string" segments.
function tokenize(code) {
  const parts = [];
  const n = code.length;
  let i = 0;

  while (i < n) {
    const ch = code[i];

    if (ch === "/" && code[i + 1] === "/") {
      let j = i + 2;
      while (j < n && code[j] !== "\n") j++;
      parts.push({ type: "comment", text: code.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === "/" && code[i + 1] === "*") {
      let j = i + 2;
      while (j < n && !(code[j] === "*" && code[j + 1] === "/")) j++;
      j = Math.min(n, j + 2);
      parts.push({ type: "comment", text: code.slice(i, j) });
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") j += 2;
        else if (code[j] === ch) {
          j++;
          break;
        } else j++;
      }
      parts.push({ type: "string", text: code.slice(i, j) });
      i = j;
      continue;
    }

    // Plain code up to the next comment or string. A lone "/" (division)
    // is ordinary code and must be consumed here, or the loop never advances.
    let j = i;
    while (j < n) {
      const c = code[j];
      if (c === '"' || c === "'" || c === "`") break;
      if (c === "/" && (code[j + 1] === "/" || code[j + 1] === "*")) break;
      j++;
    }
    if (j === i) j = i + 1;
    parts.push({ type: "code", text: code.slice(i, j) });
    i = j;
  }

  return parts;
}

// Splits "a = f(1, 2), b" on top-level commas only.
function splitDeclarations(declList) {
  const parts = [];
  let cur = "";
  let depth = 0;
  for (const ch of declList) {
    if (ch === "," && depth === 0) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
  }
  if (cur.trim() !== "") parts.push(cur.trim());
  return parts;
}

function rewriteCode(s) {
  // for (int i = 0; ...) -> for (let i = 0; ...)
  s = s.replace(
    /\bfor\s*\(\s*(?:unsigned\s+)?(?:int|long|short|byte|float|double|bool|char)\s+/g,
    "for (let ",
  );

  // int a = 5, b;  ->  let a = 5, b;
  s = s.replace(
    /(^|[;{}\n\r])(\s*)(int|float|bool)\s+([^;]+);/gm,
    (m, prefix, ws, type, declList) =>
      `${prefix}${ws}let ${splitDeclarations(declList).join(", ")};`,
  );

  s = s.replace(/void\s+setup\s*\(\s*\)/g, "async function setup()");
  s = s.replace(/void\s+loop\s*\(\s*\)/g, "async function loop()");

  s = s.replace(/\bHIGH\b/g, "1").replace(/\bLOW\b/g, "0");
  s = s
    .replace(/\bOUTPUT\b/g, "'OUTPUT'")
    .replace(/\bINPUT_PULLUP\b/g, "'INPUT_PULLUP'")
    .replace(/\bINPUT\b/g, "'INPUT'");

  // These calls return Promises in the worker, so they must be awaited.
  // The leading group skips property access (obj.delay) and longer identifiers.
  s = s.replace(/(^|[^.\w$])delay\s*\(/g, (m, p) => `${p}await delay(`);
  s = s.replace(
    /(^|[^.\w$])(digitalRead|analogRead|millis)\s*\(/g,
    (m, p, fn) => `${p}await ${fn}(`,
  );

  return s;
}
