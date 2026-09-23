// Static hygiene gate (V6 2026-09-24): the 1.4.0 splash bug was an undeclared
// identifier referenced across the ejection stage split — green doors never saw
// it because it only threw at runtime. This scanner reads every src/*.js and
// src/ejection/*.js, collects declared identifiers (const/let/var with
// destructuring, function/class names, parameters, imports, catch bindings) and
// reports any identifier *used* as a base of a member call (`x.` / `x(`) that
// was never declared and is not a known browser/JS global.
// Zero reports expected on green code; wire into check-build before publish.
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
  ...readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).map(f => path.join(root, 'src', f)),
  ...readdirSync(path.join(root, 'src', 'ejection')).filter(f => f.endsWith('.js')).map(f => path.join(root, 'src', 'ejection', f)),
];

const KEYWORDS = new Set(('if,for,while,switch,catch,return,typeof,new,delete,void,in,of,instanceof,do,else,case,break,continue,function,const,let,var,class,import,export,default,throw,try,finally,await,async,yield,this,super,extends,static,typeof,void,with,label,true,false,null,undefined,NaN,Infinity').split(','));
const GLOBALS = new Set(('window,document,navigator,location,history,matchMedia,requestAnimationFrame,cancelAnimationFrame,setInterval,setTimeout,setImmediate,clearInterval,clearTimeout,clearImmediate,console,fetch,URL,URLSearchParams,performance,localStorage,sessionStorage,innerWidth,innerHeight,devicePixelRatio,createImageBitmap,Blob,File,FileReader,Image,CustomEvent,Event,EventTarget,getComputedStyle,PointerEvent,KeyboardEvent,WheelEvent,AbortController,ResizeObserver,MutationObserver,IntersectionObserver,screen,alert,confirm,prompt,mediaDevices,self,globalThis,Math,JSON,Object,Array,String,Number,Boolean,Date,RegExp,Error,TypeError,RangeError,Promise,Map,Set,WeakMap,WeakSet,Symbol,BigInt,isNaN,parseFloat,parseInt,structuredClone,crypto,atob,btoa,TextEncoder,TextDecoder,queueMicrotask,reportError,eval,Function,Reflect,Proxy,Intl,ArrayBuffer,Uint8Array,Uint8ClampedArray,Int8Array,Uint16Array,Int16Array,Uint32Array,Int32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView,ImageData,CanvasRenderingContext2D,OffscreenCanvas,Path2D,scrollTo,scrollBy,CSS,audio').split(','));

// Strip comments and string contents while KEEPING code inside template ${...}
// and treating /.../flag regex literals as opaque (their flags are not code).
const REGEX_KEYWORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'delete', 'void', 'new', 'do', 'else', '=', '(', '[', '!', '&', '|', '?', '{', '}', ';', '<', '>', '+', '-', '*', '%', '~', '^', ',', ':', '']);
function keywordBefore(src, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  const end = j + 1;
  while (j >= 0 && /[A-Za-z_$]/.test(src[j])) j--;
  const word = src.slice(j + 1, end);
  return word.length > 0 && REGEX_KEYWORDS.has(word);
}
function toCodeSkeleton(src) {
  let out = '', i = 0;
  const n = src.length;
  // mode stack: code | line | block | single | double | template | regex.
  // Template `${...}` returns to its template at the matching '}' — tracked with
  // braceDepth so object literals inside the interpolation do not confuse it.
  const modeStack = ['code'];
  const braceDepth = [];
  let braceInterp = []; // per-template: interpolation depth at the moment of entry
  let prevSignificant = '';
  const mode = () => modeStack[modeStack.length - 1];
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (mode() === 'code') {
      if (c === '/' && c2 === '/') { modeStack.push('line'); i += 2; out += '  '; continue; }
      if (c === '/' && c2 === '*') { modeStack.push('block'); i += 2; out += '  '; continue; }
      if (c === "'") { modeStack.push('single'); out += "''"; i++; continue; }
      if (c === '"') { modeStack.push('double'); out += '""'; i++; continue; }
      if (c === '`') { modeStack.push('template'); out += '`'; i++; braceInterp.push(0); continue; }
      if (c === '{') { if (braceInterp.length) braceInterp[braceInterp.length - 1]++; }
      if (c === '}') {
        if (braceInterp.length) {
          if (braceInterp[braceInterp.length - 1] === 0) {
            // closes a template interpolation: drop the code frame — the
            // template frame below becomes current again
            braceInterp.pop();
            modeStack.pop();
            out += c; i++;
            continue;
          }
          braceInterp[braceInterp.length - 1]--;
        }
      }
      if (c === '/' && (prevSignificant === '' || /[=(,:[!&|?{};<>+\-*%~^]/.test(prevSignificant) ||
        (/[A-Za-z_$]/.test(prevSignificant) && keywordBefore(src, i)))) {
        modeStack.push('regex');
        out += '/*'; i++; let inClass = false;
        while (i < n) {
          if (src[i] === '\\') { out += '  '; i += 2; continue; }
          if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
          else if (src[i] === '/' && !inClass) break;
          out += src[i] === '\n' ? '\n' : ' '; i++;
        }
        i++; // the closing '/'
        while (i < n && /[a-z]/i.test(src[i])) { out += ' '; i++; }
        out += '*/';
        modeStack.pop();
        prevSignificant = ')';
        continue;
      }
      if (!/\s/.test(c)) prevSignificant = c;
      out += c; i++; continue;
    }
    if (mode() === 'line') { if (c === '\n') { modeStack.pop(); out += c; } else out += ' '; i++; continue; }
    if (mode() === 'block') { if (c === '*' && c2 === '/') { modeStack.pop(); out += '  '; i += 2; } else { out += c === '\n' ? '\n' : ' '; i++; } continue; }
    if (mode() === 'single') { if (c === '\\') { out += '  '; i += 2; continue; } if (c === "'") { modeStack.pop(); out += c; } else out += ' '; i++; continue; }
    if (mode() === 'double') { if (c === '\\') { out += '  '; i += 2; continue; } if (c === '"') { modeStack.pop(); out += c; } else out += ' '; i++; continue; }
    if (mode() === 'template') {
      if (c === '\\') { out += '  '; i += 2; continue; }
      if (c === '`') { modeStack.pop(); braceInterp.pop(); out += '`'; i++; continue; }
      if (c === '$' && c2 === '{') { modeStack.push('code'); braceInterp.push(0); out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    if (mode() === 'regex') { i++; continue; }
  }
  return out;
}

function collectIdentifiers(skeleton) {
  const declared = new Set();
  const push = name => { if (/^[A-Za-z_$][\w$]*$/.test(name) && !KEYWORDS.has(name)) declared.add(name); };
  const idIn = s => s.match(/[A-Za-z_$][\w$]*/g) || [];
  let m;
  // const/let/var declarator lists: `const a = 1, b = [x]` and destructuring.
  // The list runs to a DEPTH-0 ';' (so callbacks containing ';' inside their own
  // braces stay inside one declarator list — main.js's `const gltf=loadAsync(...),
  // root=...,host=...` pattern); depth-0 ',' splits declarators.
  const declRe = /\b(?:const|let|var)\s+/g;
  while ((m = declRe.exec(skeleton))) {
    let depth = 0, end = m.index + m[0].length;
    for (; end < skeleton.length; end++) {
      const c = skeleton[end];
      if (depth === 0 && c === ';') break;
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
    }
    const head = skeleton.slice(m.index + m[0].length, end);
    let d2 = 0, start = 0;
    const parts = [];
    for (let i = 0; i < head.length; i++) {
      const c = head[i];
      if ('([{'.includes(c)) d2++;
      else if (')]}'.includes(c)) d2--;
      else if (c === ',' && d2 === 0) { parts.push(head.slice(start, i)); start = i + 1; }
    }
    parts.push(head.slice(start));
    for (const p of parts) {
      const left = p.split('=')[0];
      for (const name of idIn(left)) push(name);
    }
  }
  // function declarations, method shorthand `name(args) {`, and their parameters
  // (one level of paren nesting so `(a, {b = () => {}}) = {}` params still parse)
  const callBlockRe = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(((?:[^()]|\([^()]*\))*)\)\s*{/g;
  // `if (...) {`, `for (...) {` etc. are NOT parameter lists. Treating their
  // conditions as declarations is exactly how the first version of this gate
  // passed the 1.4.0 flush bug (`if (k >= 1 && splash.userData...) {`).
  const CONTROL = new Set(['if', 'for', 'while', 'switch', 'with']);
  while ((m = callBlockRe.exec(skeleton))) {
    if (CONTROL.has(m[1])) continue;
    push(m[1]);
    for (const name of idIn(m[2])) push(name);
  }
  const arrowIdentRe = /([A-Za-z_$][\w$]*)\s*=>/g;
  while ((m = arrowIdentRe.exec(skeleton))) push(m[1]);
  const parenRe = /\(((?:[^()]|\([^()]*\))*)\)\s*(?:=>|{)/g;
  while ((m = parenRe.exec(skeleton))) {
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(skeleton[j])) j--;
    let k = j;
    while (k >= 0 && /[\w$]/.test(skeleton[k])) k--;
    if (CONTROL.has(skeleton.slice(k + 1, j + 1))) continue;
    for (const name of idIn(m[1])) push(name);
  }
  // imports: default, named {a, b as c}, namespace * as ns
  const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\}|\*\s*as\s+([A-Za-z_$][\w$]*))?\s*from/g;
  while ((m = importRe.exec(skeleton))) {
    if (m[1]) push(m[1]);
    if (m[3]) push(m[3]);
    if (m[2]) for (const part of m[2].split(',')) {
      const names = idIn(part);
      if (names.length) push(names[names.length - 1]); // `a as b` binds b
    }
  }
  return declared;
}

// Self-test on every run: the exact shape of the 1.4.0 flush bug must be
// reported. If this ever stops firing, the gate has gone blind again.
{
  const sample = toCodeSkeleton("export function f(k) {\n if (k >= 1 && splash.userData.last !== 1) { splash.userData.last = 1; }\n}\n");
  const known = collectIdentifiers(sample);
  if (known.has('splash')) { console.log('check-undeclared: FAIL — self-test: a control-statement condition was treated as a declaration'); process.exit(1); }
}

const findings = [];
for (const file of targets) {
  const rel = path.relative(root, file).replaceAll('\\', '/');
  const skeleton = toCodeSkeleton(readFileSync(file, 'utf8'));
  const declared = collectIdentifiers(skeleton);
  const useRe = /(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?=[.(])/g;
  let line = 1, m;
  for (let i = 0; i < skeleton.length; i++) if (skeleton[i] === '\n') { /* track lazily below */ break; }
  const lineAt = idx => skeleton.slice(0, idx).split('\n').length;
  while ((m = useRe.exec(skeleton))) {
    const name = m[1];
    if (KEYWORDS.has(name) || GLOBALS.has(name) || declared.has(name)) continue;
    findings.push({file: rel, line: lineAt(m.index), name});
  }
}

if (findings.length) {
  console.log(`check-undeclared: FAIL — ${findings.length} undeclared base identifier(s)`);
  for (const f of findings) console.log(`  ${f.file}:${f.line} — '${f.name}' used but never declared`);
  process.exit(1);
}
console.log(`check-undeclared: PASS — ${targets.length} files scanned, no undeclared base identifiers`);
