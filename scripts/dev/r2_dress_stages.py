# One-off R2 (2026-09-24) patcher: inserts set dressing into four ejection stages.
# Kept under scripts/dev/ as a record of how the change was applied; not part of the build.
import pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2]


def patch(name, imports, block, extra=None):
    p = ROOT / 'src' / 'ejection' / f'stage-{name}.js'
    s = p.read_text(encoding='utf-8')
    if 'R2 2026-09-24 set dressing' in s:
        print(name, 'already dressed, skipped')
        return
    m = re.search(r"import \{([^}]*)\} from './common.js';", s)
    have = [x.strip() for x in m.group(1).split(',')]
    for imp in imports:
        if imp not in have:
            have.append(imp)
    s = s[:m.start()] + "import {" + ", ".join(have) + "} from './common.js';" + s[m.end():]
    anchor = " stage.diagnostics = () => ({trajectory: stage.trajectory});\n"
    assert s.count(anchor) == 1, name
    s = s.replace(anchor, block + anchor)
    for o, n in (extra or []):
        assert s.count(o) == 1, (name, o[:50])
        s = s.replace(o, n)
    p.write_bytes(s.encode('utf-8'))
    print(name, 'ok')


QUICKSAND = r"""
 // R2 2026-09-24 set dressing: the whole frame used to be one flat tan. A real
 // sky gradient, a ring of shaded dunes and a slow vortex in the pit give the
 // sink a place and a direction. The vortex is driven by performance time (so
 // it pauses with the performance) and holds still under reduced motion.
 addSkyDome(ctx, {top: '#79a2c4', mid: '#ead3a2', bottom: '#c7a56a', horizon: 0.0});
 scene.fog = new THREE.Fog('#dcc38f', 10, 32);
 const duneRand = seededRandom(311);
 const duneMats = ['#c9a86f', '#b38f57', '#d6b77d'].map(c => take(new THREE.MeshStandardMaterial({color: c, roughness: 1})));
 const duneGeo = take(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
 for (let i = 0; i < 16; i++) {
  const a = i / 16 * Math.PI * 2 + duneRand() * 0.3, r = 6 + duneRand() * 7;
  const dune = new THREE.Mesh(duneGeo, duneMats[i % 3]);
  dune.position.set(Math.cos(a) * r, -0.05, Math.sin(a) * r);
  dune.scale.set(2.2 + duneRand() * 2.6, 0.35 + duneRand() * 0.7, 1.6 + duneRand() * 2.2);
  dune.rotation.y = duneRand() * Math.PI;
  scene.add(dune);
 }
 const vortexMat = take(new THREE.MeshBasicMaterial({color: '#6a4d2b', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false}));
 const vortex = new THREE.Group();
 vortex.position.y = 0.02;
 for (let k = 0; k < 3; k++) {
  const arm = new THREE.Mesh(take(new THREE.RingGeometry(0.22 + k * 0.34, 0.3 + k * 0.34, 32, 1, k * 2.1, Math.PI * 1.1)), vortexMat);
  arm.rotation.x = -Math.PI / 2;
  vortex.add(arm);
 }
 scene.add(vortex);
 const dressedUpdate = stage.update;
 stage.update = args => {
  dressedUpdate(args);
  vortex.rotation.y = reduced.value ? 0 : -args.elapsed * 0.9;
 };
"""

CHANDELIER = r"""
 // R2 2026-09-24 set dressing: the drop used to happen in a black box, so the
 // swing and fall had no room to read against. A chapel shell (walls with a
 // wainscot band, moonlit arched windows, pillars, pew rows, a carpet runner),
 // a cool window fill light, and a floor shadow that darkens and tightens as
 // the chandelier comes down -- the classic "look up!" warning.
 scene.fog = new THREE.Fog('#1d1510', 10, 26);
 const wallMat = take(new THREE.MeshStandardMaterial({color: '#5a4230', roughness: 0.95}));
 const wainMat = take(new THREE.MeshStandardMaterial({color: '#33241a', roughness: 0.9}));
 const paneMat = take(new THREE.MeshStandardMaterial({color: '#9fb6de', emissive: '#6d86b8', emissiveIntensity: 0.9, roughness: 0.6}));
 const frameMat = take(new THREE.MeshStandardMaterial({color: '#2a1d14', roughness: 0.9}));
 const boxGeo = take(new THREE.BoxGeometry(1, 1, 1));
 const room = 5.2, wallH = 5.2;
 for (const [x, z, w, d] of [[0, -room, room * 2, 0.3], [0, room, room * 2, 0.3], [-room, 0, 0.3, room * 2], [room, 0, 0.3, room * 2]]) {
  const wall = new THREE.Mesh(boxGeo, wallMat);
  wall.position.set(x, wallH / 2, z); wall.scale.set(w, wallH, d); scene.add(wall);
  const wain = new THREE.Mesh(boxGeo, wainMat);
  wain.position.set(x * 0.97, 0.55, z * 0.97); wain.scale.set(Math.max(w, 0.3), 1.1, Math.max(d, 0.3)); scene.add(wain);
 }
 const paneGeo = take(new THREE.PlaneGeometry(1, 2.2));
 const archGeo = take(new THREE.CircleGeometry(0.5, 16, 0, Math.PI));
 const frameGeo = take(new THREE.PlaneGeometry(1.2, 2.9));
 const windowAt = (x, z, rotY) => {
  const g = new THREE.Group();
  const frame = new THREE.Mesh(frameGeo, frameMat); frame.position.set(0, 2.75, -0.01); g.add(frame);
  const pane = new THREE.Mesh(paneGeo, paneMat); pane.position.set(0, 2.5, 0); g.add(pane);
  const arch = new THREE.Mesh(archGeo, paneMat); arch.position.set(0, 3.6, 0); g.add(arch);
  g.position.set(x, 0, z); g.rotation.y = rotY; scene.add(g);
 };
 for (const x of [-3, 0, 3]) windowAt(x, -room + 0.17, 0);
 for (const z of [-2.6, 1.2]) { windowAt(-room + 0.17, z, Math.PI / 2); windowAt(room - 0.17, z, -Math.PI / 2); }
 const pillarGeo = take(new THREE.CylinderGeometry(0.22, 0.26, wallH, 12));
 const pillarMat = take(new THREE.MeshStandardMaterial({color: '#6b523c', roughness: 0.85}));
 for (const [x, z] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
  const pillar = new THREE.Mesh(pillarGeo, pillarMat); pillar.position.set(x, wallH / 2, z); scene.add(pillar);
 }
 const pewGeo = take(new THREE.BoxGeometry(1.7, 0.42, 0.42));
 const pewMat = take(new THREE.MeshStandardMaterial({color: '#4a3020', roughness: 0.8}));
 for (let row = 0; row < 3; row++) for (const x of [-2.2, 2.2]) {
  const pew = new THREE.Mesh(pewGeo, pewMat); pew.position.set(x, 0.21, -1.4 - row * 1.0); scene.add(pew);
 }
 const runner = new THREE.Mesh(take(new THREE.PlaneGeometry(1.3, room * 2)),
  take(new THREE.MeshStandardMaterial({color: '#6a1f24', roughness: 1})));
 runner.rotation.x = -Math.PI / 2; runner.position.y = 0.004; scene.add(runner);
 const windowFill = new THREE.DirectionalLight('#9fb4e0', 0.55);
 windowFill.position.set(-3, 4, -5); scene.add(windowFill);
 // Floor warning shadow: grows darker and tighter as the chandelier drops.
 const shadow = new THREE.Mesh(take(new THREE.CircleGeometry(0.8, 28)),
  take(new THREE.MeshBasicMaterial({color: '#000000', transparent: true, opacity: 0.2, depthWrite: false})));
 shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.008; scene.add(shadow);
 const dressedUpdate = stage.update;
 stage.update = args => {
  dressedUpdate(args);
  const hK = clamp01(1 - (chandelier.position.y - 0.1) / 3.1); // 0 hanging high -> 1 on the floor
  shadow.position.x = chandelier.position.x; shadow.position.z = chandelier.position.z;
  shadow.scale.setScalar(1.35 - hK * 0.55);
  shadow.material.opacity = 0.18 + hK * 0.5;
  shadow.visible = chandelier.visible !== false;
 };
"""

BOULDER = r"""
 // R2 2026-09-24 set dressing: the corridor was two blank walls in a brown
 // void. An open sky over the temple run, stone coursing along both walls
 // (instanced, colour-varied), torches with warm glow, and a rounder boulder.
 addSkyDome(ctx, {top: '#4d6e80', mid: '#c49a66', bottom: '#2a2218', horizon: 0.05});
 scene.fog = new THREE.Fog('#3a2e20', 10, 30);
 const stoneRand = seededRandom(77);
 const stoneGeo = take(new THREE.BoxGeometry(1, 1, 1));
 const stoneMat = take(new THREE.MeshStandardMaterial({color: '#ffffff', roughness: 0.95}));
 const perWall = 34;
 const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, perWall * 2 * 2);
 const sm = new THREE.Matrix4(), sq = new THREE.Quaternion(), ss = new THREE.Vector3(), sp = new THREE.Vector3(), sc = new THREE.Color();
 let si = 0;
 for (const zSide of [-2.6, 2.6]) for (let course = 0; course < 2; course++) for (let k = 0; k < perWall; k++) {
  const w = 0.42 + stoneRand() * 0.12;
  const x = -8.3 + k * 0.5 + (course ? 0.25 : 0);
  sm.compose(sp.set(x, 0.5 + course * 0.95 + stoneRand() * 0.04, zSide - Math.sign(zSide) * 0.33), sq, ss.set(w, 0.86, 0.1));
  stones.setMatrixAt(si, sm);
  sc.set('#8a7456').offsetHSL(0, (stoneRand() - 0.5) * 0.08, (stoneRand() - 0.5) * 0.14);
  stones.setColorAt(si, sc);
  si++;
 }
 stones.count = si;
 scene.add(take(stones));
 const torchGeo = take(new THREE.PlaneGeometry(0.16, 0.3));
 const torchMat = take(new THREE.MeshBasicMaterial({color: '#ffb35a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false}));
 const postGeo = take(new THREE.CylinderGeometry(0.035, 0.045, 0.5, 6));
 const postMat = take(new THREE.MeshStandardMaterial({color: '#2a1d12', roughness: 1}));
 for (const x of [-6, -2, 2, 6]) for (const zSide of [-2.2, 2.2]) {
  const post = new THREE.Mesh(postGeo, postMat); post.position.set(x, 2.1, zSide); scene.add(post);
  const flame = new THREE.Mesh(torchGeo, torchMat); flame.position.set(x, 2.45, zSide); scene.add(flame);
 }
 for (const x of [-4, 4]) {
  const glow = new THREE.PointLight('#ffb35a', 3.2, 6, 1.6);
  glow.position.set(x, 2.4, 0); scene.add(glow);
 }
"""

FLUSH = r"""
 // R2 2026-09-24 set dressing: the flush read as abstract blue discs. The spiral
 // now happens in a tiled washroom corner (tiled floor, back wall, a cistern and
 // seat that make the basin read as a toilet), and the landing is a lake under an
 // evening sky with ripples that spread after the splash (performance-time
 // driven; reduced motion keeps a single static ring).
 addSkyDome(ctx, {top: '#23324a', mid: '#6f8ea6', bottom: '#1c2a33', horizon: -0.05});
 if (typeof document !== 'undefined') {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const g2 = cv.getContext('2d');
  g2.fillStyle = '#d9e3e6'; g2.fillRect(0, 0, 128, 128);
  g2.strokeStyle = '#9fb0b6'; g2.lineWidth = 4;
  for (let t = 0; t <= 128; t += 32) {
   g2.beginPath(); g2.moveTo(t, 0); g2.lineTo(t, 128); g2.stroke();
   g2.beginPath(); g2.moveTo(0, t); g2.lineTo(128, t); g2.stroke();
  }
  const tiles = take(new THREE.CanvasTexture(cv));
  tiles.wrapS = tiles.wrapT = THREE.RepeatWrapping; tiles.repeat.set(3, 3); tiles.colorSpace = THREE.SRGBColorSpace;
  const floorTile = new THREE.Mesh(take(new THREE.PlaneGeometry(6, 6)), take(new THREE.MeshStandardMaterial({map: tiles, roughness: 0.4})));
  floorTile.rotation.x = -Math.PI / 2; floorTile.position.set(0, 0.004, 0); scene.add(floorTile);
  const backWall = new THREE.Mesh(take(new THREE.PlaneGeometry(6, 3)), take(new THREE.MeshStandardMaterial({map: tiles, roughness: 0.5, color: '#bcd0d8'})));
  backWall.position.set(0, 1.5, -3); scene.add(backWall);
 }
 const porcelain = take(new THREE.MeshStandardMaterial({color: '#f2f2ec', roughness: 0.3}));
 const cistern = new THREE.Mesh(take(new THREE.BoxGeometry(1.5, 0.95, 0.42)), porcelain);
 cistern.position.set(0, 0.95, -1.18); scene.add(cistern);
 const seat = new THREE.Mesh(take(new THREE.TorusGeometry(0.96, 0.07, 10, 32)), porcelain);
 seat.rotation.x = Math.PI / 2; seat.position.set(0, 0.54, 0); scene.add(seat);
 const shore = new THREE.Mesh(take(new THREE.RingGeometry(1.4, 2.2, 30)),
  take(new THREE.MeshStandardMaterial({color: '#3f6b45', roughness: 1, side: THREE.DoubleSide})));
 shore.rotation.x = -Math.PI / 2; shore.position.set(7.5, 0.008, 0); scene.add(shore);
 const rippleGeo = take(new THREE.RingGeometry(0.2, 0.27, 28));
 const ripples = [0, 1, 2].map(() => {
  const mat = take(new THREE.MeshBasicMaterial({color: '#d8eef7', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false}));
  const r = new THREE.Mesh(rippleGeo, mat);
  r.rotation.x = -Math.PI / 2; r.position.set(7.5, 0.02, 0); r.visible = false; scene.add(r);
  return r;
 });
 const dressedUpdate = stage.update;
 stage.update = args => {
  dressedUpdate(args);
  const since = args.elapsed - splashEnd;
  ripples.forEach((r, i) => {
   const t = reduced.value ? (i === 0 && since > 0 ? 0.6 : -1) : since - i * 0.35;
   r.visible = t > 0;
   if (t > 0) { r.scale.setScalar(1 + t * 3.2); r.material.opacity = Math.max(0, 0.7 - t * 0.35); }
  });
 };
"""

patch('quicksand', ['addSkyDome', 'seededRandom'], QUICKSAND)
patch('chandelier', ['clamp01', 'seededRandom'], CHANDELIER)
patch('boulder', ['addSkyDome', 'seededRandom'], BOULDER, extra=[
    (" const boulder = take(new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 0),",
     " const boulder = take(new THREE.Mesh(new THREE.DodecahedronGeometry(1.15, 1),"),
    ("  take(new THREE.MeshStandardMaterial({color: '#4a3a28', roughness: 1})));\n ground.rotation.x = -Math.PI / 2; scene.add(ground);",
     "  take(new THREE.MeshStandardMaterial({color: '#5c4832', roughness: 1})));\n ground.rotation.x = -Math.PI / 2; scene.add(ground);"),
])
patch('flush', ['addSkyDome'], FLUSH)
