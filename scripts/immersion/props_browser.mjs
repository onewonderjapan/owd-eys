// Browser verification for the immersion prop pack: load the real GLB through the
// project's GLTFLoader, lay out the seven roots, and capture props-browser.png.
// Writes a throwaway harness page into dist/ (gitignored build output).
import {writeFileSync} from 'node:fs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const label = process.argv[2] || 'immersion';
const base = process.argv[3] || 'http://127.0.0.1:8870/';

const harness = `<!doctype html><html><head><meta charset="utf-8"><style>
 body{margin:0;background:#232833;overflow:hidden}
 #info{position:fixed;top:8px;left:12px;color:#cfd6e4;font:14px system-ui}
</style>
<script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js","three/addons/":"/vendor/three/examples/jsm/"}}</script>
</head><body><div id="info">immersion props browser check</div>
<script type="module">
import * as THREE from '/vendor/three/build/three.module.js';
import {GLTFLoader} from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
const cfg = await (await fetch('/immersion-assets.json')).json();
const errors = [];
const gltf = await new GLTFLoader().loadAsync(new URL(cfg.url, document.baseURI).href).catch(e => { errors.push(String(e)); return null; });
const result = {errors, roots: {}, packId: cfg.pack_id, url: cfg.url};
if (gltf) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#39404e');
  scene.add(new THREE.HemisphereLight('#cfd8ea', '#3a342c', 1.6));
  const sun = new THREE.DirectionalLight('#ffe8c0', 2.2); sun.position.set(3, 6, 4); scene.add(sun);
  const names = Object.entries(cfg.nodes);
  let x = 0;
  for (const [key, nodeName] of names) {
    const src = gltf.scene.getObjectByName(nodeName);
    if (!src) { errors.push('missing node ' + nodeName); continue; }
    const copy = src.clone(true);
    copy.position.x = x; x += 1.6;
    scene.add(copy);
    const box = new THREE.Box3().setFromObject(copy);
    result.roots[key] = {size: box.getSize(new THREE.Vector3()).toArray().map(v => +v.toFixed(3))};
  }
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  const span = box.getSize(new THREE.Vector3()).length();
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, .05, 80);
  camera.position.set(center.x, center.y + 2.4, center.z + span * 0.62);
  camera.lookAt(center);
  const renderer = new THREE.WebGLRenderer({antialias: true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const loop = () => { renderer.render(scene, camera); requestAnimationFrame(loop); };
  loop();
  result.rendered = true;
  window.__scene = scene; window.__camera = camera;
}
window.__propsCheck = result;
</script></body></html>`;

writeFileSync(path.join(root, 'dist', '__props_harness.html'), harness);

const {chromium} = require('playwright');
const executablePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const browser = await chromium.launch({executablePath, headless: true, args: ['--enable-unsafe-swiftshader']});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 900}});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(new URL('__props_harness.html', base).href, {waitUntil: 'networkidle'});
  await page.waitForFunction('window.__propsCheck && window.__propsCheck.rendered', {timeout: 20000});
  await page.waitForTimeout(800);
  const result = await page.evaluate('window.__propsCheck');
  await page.screenshot({path: path.join(root, 'reports', 'immersion', 'props-browser.png')});
  const report = {schema: 1, url: new URL('__props_harness.html', base).href, packId: result.packId,
    glb: result.url, roots: result.roots, errors: [...result.errors, ...pageErrors],
    screenshot: 'reports/immersion/props-browser.png',
    passed: result.errors.length === 0 && pageErrors.length === 0 && Object.keys(result.roots).length >= 7};
  writeFileSync(path.join(root, 'reports', 'immersion', 'props-browser.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.passed ? 0 : 1);
} finally {
  await browser.close();
}
