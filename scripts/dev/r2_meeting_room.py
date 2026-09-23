# One-off R2 (2026-09-24) patcher: promotes the courtroom look to the default
# meeting backdrop (windows set INTO a taller wall, wainscot, rug, ceiling, low
# chandelier) and removes the ?look=court sample branch and its pulled-back camera.
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
p = ROOT / 'src' / 'immersion-meeting.js'
s = p.read_text(encoding='utf-8')
assert 'R2 courtroom backdrop' not in s, 'already applied'

# 1) new backdrop
start = s.index('function buildBackdrop(scene) {')
end = s.index('export function createMeetingStage(')
BACKDROP = r"""// R2 2026-09-24 courtroom backdrop (was a dark 2m band in a brown void). The
// V8 sample's windows floated because they rose above a 2m wall; the wall is
// now 3.4m with a wainscot, chair rail and crown trim, the windows sit inside
// it, and a ceiling closes the room. Camera stays the player's seat POV.
// Everything is emissive/standard material -- no extra real-time lights.
function buildBackdrop(scene) {
 const parts = [];
 const keep = o => { parts.push(o); return o; };
 const add = (geo, mat, setup) => { const m = new THREE.Mesh(keep(geo), keep(mat)); setup(m); scene.add(m); return m; };
 const R = 4.4, H = 3.4;
 add(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({color: '#3a2a1f', roughness: 0.9}), m => { m.rotation.x = -Math.PI / 2; m.position.y = -0.002; });
 add(new THREE.CircleGeometry(2.45, 48), new THREE.MeshStandardMaterial({color: '#5c2b27', roughness: 1}), m => { m.rotation.x = -Math.PI / 2; m.position.y = 0.001; });
 add(new THREE.RingGeometry(2.45, 2.6, 48), new THREE.MeshStandardMaterial({color: '#b08a4a', roughness: 0.8}), m => { m.rotation.x = -Math.PI / 2; m.position.y = 0.0015; });
 add(new THREE.CylinderGeometry(R, R, H, 48, 1, true), new THREE.MeshStandardMaterial({color: '#4d3528', roughness: 1, side: THREE.BackSide}), m => { m.position.y = H / 2; });
 add(new THREE.CylinderGeometry(R - 0.02, R - 0.02, 1.0, 48, 1, true), new THREE.MeshStandardMaterial({color: '#2e1f17', roughness: 0.9, side: THREE.BackSide}), m => { m.position.y = 0.5; });
 const trimMat = keep(new THREE.MeshStandardMaterial({color: '#6a4a30', roughness: 0.8, side: THREE.BackSide}));
 for (const [y, h] of [[1.03, 0.08], [H - 0.06, 0.12]]) {
  const trim = new THREE.Mesh(keep(new THREE.CylinderGeometry(R - 0.03, R - 0.03, h, 48, 1, true)), trimMat);
  trim.position.y = y; scene.add(trim);
 }
 add(new THREE.CircleGeometry(R, 48), new THREE.MeshStandardMaterial({color: '#20160f', roughness: 1}), m => { m.rotation.x = Math.PI / 2; m.position.y = H; });
 // arched windows set into the wall, facing the table; night blue outside
 const paneMat = keep(new THREE.MeshStandardMaterial({color: '#8ea7cf', emissive: '#5f7cae', emissiveIntensity: 0.8, roughness: 0.6}));
 const frameMat = keep(new THREE.MeshStandardMaterial({color: '#2a1b12', roughness: 0.9}));
 const paneGeo = keep(new THREE.PlaneGeometry(0.9, 1.35));
 const archGeo = keep(new THREE.CircleGeometry(0.45, 18, 0, Math.PI));
 const frameGeo = keep(new THREE.PlaneGeometry(1.06, 1.95));
 const barGeo = keep(new THREE.PlaneGeometry(0.04, 1.8));
 for (const a of [Math.PI, Math.PI - 0.62, Math.PI + 0.62, Math.PI - 1.3, Math.PI + 1.3]) {
  const g = new THREE.Group();
  g.position.set(Math.sin(a) * (R - 0.05), 0, Math.cos(a) * (R - 0.05));
  g.lookAt(0, 0, 0);
  const frame = new THREE.Mesh(frameGeo, frameMat); frame.position.set(0, 1.9, -0.005); g.add(frame);
  const pane = new THREE.Mesh(paneGeo, paneMat); pane.position.set(0, 1.78, 0); g.add(pane);
  const arch = new THREE.Mesh(archGeo, paneMat); arch.position.set(0, 2.455, 0); g.add(arch);
  const bar = new THREE.Mesh(barGeo, frameMat); bar.position.set(0, 1.95, 0.004); g.add(bar);
  scene.add(g); parts.push(g);
 }
 // low chandelier over the table: rod from the ceiling, gold ring, candle glow
 const gold = keep(new THREE.MeshStandardMaterial({color: '#c9a13b', roughness: 0.35, metalness: 0.6}));
 const glowMat = keep(new THREE.MeshStandardMaterial({color: '#ffe6b0', emissive: '#ffd684', emissiveIntensity: 1.2}));
 const lamp = new THREE.Group();
 const rod = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.018, 0.018, H - 2.0, 8)), gold); rod.position.y = (H - 2.0) / 2; lamp.add(rod);
 const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.5, 0.035, 8, 32)), gold); ring.rotation.x = Math.PI / 2; lamp.add(ring);
 const bulbGeo = keep(new THREE.SphereGeometry(0.05, 10, 8));
 for (let b = 0; b < 6; b++) {
  const a = b / 6 * Math.PI * 2;
  const bulb = new THREE.Mesh(bulbGeo, glowMat); bulb.position.set(Math.cos(a) * 0.5, 0.06, Math.sin(a) * 0.5); lamp.add(bulb);
 }
 lamp.position.y = 2.0;
 scene.add(lamp); parts.push(lamp);
 return parts;
}

"""
s = s[:start] + BACKDROP + s[end:]

# 2) drop the sample declarations
for line in [
    " // V8 2026-09-24 SAMPLE (?look=court): a brighter courtroom interior — back\n",
    " // windows, wainscot ring and a hanging chandelier — plus a slightly wider\n",
    " // camera so all eight seats fit. SAMPLE ONLY: the default path (no query\n",
    " // param) builds exactly the 1.5.1 backdrop and camera.\n",
    " const courtParts = [];\n",
    " const courtLook = typeof location !== 'undefined' && new URLSearchParams(location.search).get('look') === 'court';\n",
    "   for (const part of courtParts) part.dispose();\n",
]:
    assert s.count(line) == 1, line
    s = s.replace(line, '')

# 3) drop the sample geometry block (if (courtLook) { ... scene.add(court);\n })
b0 = s.index(' if (courtLook) {\n  const court = new THREE.Group();')
b1 = s.index('  scene.add(court);\n }\n', b0) + len('  scene.add(court);\n }\n')
s = s[:b0] + s[b1:]

# 4) drop the sample camera override
cam = (" if (courtLook) {\n  // sample camera: pulled back/up so all eight seats read inside the frame\n"
       "  camera.position.set(0, 1.32, 2.12);\n  camera.lookAt(0, 0.78, 0);\n }\n")
assert s.count(cam) == 1
s = s.replace(cam, '')
assert 'courtLook' not in s and 'courtParts' not in s
p.write_bytes(s.encode('utf-8'))
print('meeting room promoted; sample branch removed')
