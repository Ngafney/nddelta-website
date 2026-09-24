/**
 * Does any client file reference a name that does not exist?
 *
 * The render tests mount components, but they never press a button, so the
 * inside of an onClick is dead weight to them. That is exactly where a
 * ReferenceError hides: `await api.post("descend", ...)` with the assignment
 * dropped, and a toast three lines down still reading `r.point.x`. The server
 * did the work, charged the player, and the UI said REJECTED.
 *
 * Babel already knows the answer. Every name a file uses without binding it
 * shows up in the Program scope's `globals`; anything there that is not an
 * actual browser or language global is a bug that will throw the moment that
 * line runs.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default?.default ?? traverseModule.default ?? traverseModule;
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let pass = 0;
const fails = [];
const ok = (name, fn) => {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    fails.push(name);
    console.log(`  ✗ ${name}\n    ${e.message}`);
  }
};

/** Names the browser, the language, and the build give us for free. */
const GLOBALS = new Set([
  // language
  "globalThis", "undefined", "NaN", "Infinity", "Object", "Array", "String", "Number", "Boolean",
  "Symbol", "BigInt", "Math", "JSON", "Date", "RegExp", "Error", "TypeError", "RangeError",
  "SyntaxError", "ReferenceError", "Promise", "Map", "Set", "WeakMap", "WeakSet", "Proxy",
  "Reflect", "Intl", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone", "queueMicrotask",
  "Function", "ArrayBuffer", "Uint8Array", "Int32Array", "Float64Array", "TextEncoder", "TextDecoder",
  // browser
  "window", "document", "navigator", "location", "history", "screen", "console", "fetch",
  "Headers", "Request", "Response", "AbortController", "URL", "URLSearchParams", "Blob", "File",
  "FileReader", "FormData", "localStorage", "sessionStorage", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia",
  "getComputedStyle", "alert", "confirm", "prompt", "crypto", "performance", "Image", "Audio",
  "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "TouchEvent", "ResizeObserver",
  "IntersectionObserver", "MutationObserver", "devicePixelRatio", "innerWidth", "innerHeight",
  "HTMLElement", "Node", "DOMMatrix", "Path2D", "WebSocket", "EventSource", "scrollTo",
  // build-time
  "process", "import",
]);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
  }
})(path.join(root, "src"));
files.push(path.join(root, "shared", "engine.js"), path.join(root, "shared", "orbits.js"), path.join(root, "shared", "observe.js"), path.join(root, "shared", "rules.js"), path.join(root, "shared", "rng.js"));

console.log("scope");

ok("there is client source to check at all", () => {
  assert.ok(files.length >= 8, `only found ${files.length} files`);
});

ok("no client file uses a name it never binds", () => {
  const bad = [];
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    const ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining", "nullishCoalescingOperator", "numericSeparator"],
    });
    traverse(ast, {
      Program(p) {
        for (const [name, refs] of Object.entries(p.scope.globals)) {
          if (GLOBALS.has(name)) continue;
          const line = refs?.loc?.start?.line ?? "?";
          bad.push(`${path.relative(root, file)}:${line} — ${name} is never defined`);
        }
      },
    });
  }
  assert.deepStrictEqual(bad, [], `\n    ${bad.join("\n    ")}\n`);
});

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) process.exit(1);
