// W2 GLB contract check for the immersion prop pack. Parses the real GLB cached by
// import_assets.py, validates the seven roots, pivots, transforms, axis conventions and
// bounding sizes, and verifies the append-only manifest contract. Exits 1 on failure.
import assert from 'node:assert/strict';
import {readFileSync, existsSync, statSync} from 'node:fs';
import {createHash} from 'node:crypto';

const root = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const immersion = JSON.parse(readFileSync(new URL('../../src/immersion-assets.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../../assets-manifest.json', import.meta.url), 'utf8'));
const preSnapshot = JSON.parse(readFileSync(new URL('../../reports/immersion/inputs/assets-manifest.pre-p0.json', import.meta.url), 'utf8'));

const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, result: 'passed'}); }
  catch (e) { checks.push({name, result: 'failed', error: String(e && e.message || e)}); }
};

const glbPath = new URL(`../../.cache/assets/${immersion.sha256}.glb`, import.meta.url);
const buffer = readFileSync(glbPath);
const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
assert.equal(view.getUint32(0, true), 0x46546C67, 'GLB magic');
const jsonLength = view.getUint32(12, true);
const gltf = JSON.parse(buffer.slice(20, 20 + jsonLength).toString('utf8'));

// Column-major glTF TRS composition.
function composeMatrix(node) {
  if (node.matrix) return node.matrix.slice();
  const t = node.translation || [0, 0, 0];
  const q = node.rotation || [0, 0, 0, 1];
  const s = node.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  // Row-major rotation R; stored column-major below with per-column scale.
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
  // Column-major with scale applied to columns.
  return [
    r[0] * s[0], r[3] * s[0], r[6] * s[0], 0,
    r[1] * s[1], r[4] * s[1], r[7] * s[1], 0,
    r[2] * s[2], r[5] * s[2], r[8] * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

const mul = (a, b) => {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
};
const apply = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

check('glb: 文件与清单哈希一致', () => {
  const hash = createHash('sha256').update(buffer).digest('hex');
  assert.equal(hash, immersion.sha256);
  const entry = manifest.assets.find(a => a.sha256 === immersion.sha256);
  assert.ok(entry, 'manifest entry');
  assert.equal(entry.path, immersion.url);
  assert.equal(entry.bytes, buffer.length);
  assert.ok(existsSync(glbPath));
});
check('glb: 无需解码器的压缩扩展', () => {
  const used = gltf.extensionsUsed || [];
  for (const bad of ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'])
    assert.ok(!used.includes(bad), `unexpected extension ${bad}`);
});
check('glb: 七根节点与三挂点存在', () => {
  const names = new Set((gltf.nodes || []).map(n => n.name));
  for (const name of Object.values(immersion.nodes)) assert.ok(names.has(name), `missing node ${name}`);
});
check('glb: 根节点变换归零且scene直挂', () => {
  const sceneRoots = gltf.scenes[gltf.scene || 0].nodes.map(i => gltf.nodes[i]);
  const byName = Object.fromEntries(sceneRoots.map(n => [n.name, n]));
  for (const key of ['bell', 'roundTable', 'chair', 'dock', 'sinkStone', 'chainLink', 'firepit']) {
    const node = byName[immersion.nodes[key]];
    assert.ok(node, `root ${immersion.nodes[key]} must hang on the scene`);
    for (const v of node.translation || []) assert.ok(Math.abs(v) < 1e-6, `translation ${node.name}`);
    for (const v of node.scale || [1]) assert.ok(Math.abs(v - 1) < 1e-6, `scale ${node.name}`);
  }
});
check('glb: 挂点父子关系正确', () => {
  const byName = Object.fromEntries((gltf.nodes || []).map(n => [n.name, n]));
  const bell = byName[immersion.nodes.bell];
  const bellKidNames = (bell.children || []).map(i => gltf.nodes[i].name);
  assert.ok(bellKidNames.includes(immersion.nodes.bellSwingPivot), 'swing pivot under bell');
  assert.ok(bellKidNames.includes(immersion.nodes.bellClapperPivot), 'clapper pivot under bell');
  const stone = byName[immersion.nodes.sinkStone];
  const stoneKidNames = (stone.children || []).map(i => gltf.nodes[i].name);
  assert.ok(stoneKidNames.includes(immersion.nodes.chainAnchor), 'chain anchor under stone');
});

function rootAABB(rootName) {
  const sceneRoots = gltf.scenes[gltf.scene || 0].nodes.map(i => gltf.nodes[i]);
  const rootNode = sceneRoots.find(n => n.name === rootName);
  if (!rootNode) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const walk = (node, parent, rootInv, top) => {
    const local = composeMatrix(node);
    const m = top ? local : mul(parent, local);
    if (node.mesh !== undefined) {
      const mesh = gltf.meshes[node.mesh];
      for (const prim of mesh.primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        for (const cx of [acc.min[0], acc.max[0]]) for (const cy of [acc.min[1], acc.max[1]]) for (const cz of [acc.min[2], acc.max[2]]) {
          const p = apply(top ? local : m, [cx, cy, cz]);
          for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
        }
      }
    }
    for (const c of node.children || []) walk(gltf.nodes[c], m, rootInv, false);
  };
  walk(rootNode, null, null, true);
  return {min: lo, max: hi, size: hi.map((v, i) => +(v - lo[i]).toFixed(4))};
}

check('glb: 轴向与尺寸符合契约（glTF Y-up）', () => {
  const byName = k => rootAABB(immersion.nodes[k]);
  const bell = byName('bell');
  assert.ok(Math.abs(bell.max[1] - 0.795) < 0.02 && Math.abs(bell.min[1]) < 0.01, `bell height ${bell.size}`);
  assert.ok(bell.size[0] < 0.6 && bell.size[2] < 0.3, 'bell footprint slim');
  const table = byName('roundTable');
  assert.ok(Math.abs(table.size[0] - 2.2) < 0.02 && Math.abs(table.size[2] - 2.2) < 0.02, `table diameter ${table.size}`);
  assert.ok(Math.abs(table.max[1] - 0.7215) < 0.005, `table top y ${table.max[1]}`);
  const chair = byName('chair');
  assert.ok(Math.abs(chair.size[1] - 0.64) < 0.02, `chair height ${chair.size}`);
  const rail = gltf.nodes.find(n => n.name === 'chair_back_rail');
  const railRoot = rootAABB(immersion.nodes.chair);
  assert.ok(rail, 'rail node');
  assert.ok(railRoot, 'chair aabb');
  // After export the backrest must sit at negative Z so the sitter faces +Z.
  // The rail's offset lives in its mesh vertices, so use its POSITION accessor bounds.
  const railAcc = gltf.accessors[gltf.meshes[rail.mesh].primitives[0].attributes.POSITION];
  const railZCenter = (railAcc.min[2] + railAcc.max[2]) / 2;
  assert.ok(railZCenter < 0, `backrest z center should be negative, got ${railZCenter}`);
  const dock = byName('dock');
  assert.ok(Math.abs(dock.size[0] - 6.0) < 0.05 && Math.abs(dock.size[2] - 5.9) < 0.1, `dock ${dock.size}`);
  const stone = byName('sinkStone');
  assert.ok(stone.size[0] < 0.6 && Math.abs(stone.min[1]) < 0.02, `stone grounded ${stone.size}`);
  const link = byName('chainLink');
  assert.ok(link.min.every((v, i) => Math.abs(v + link.max[i]) < 1e-4), `link centered at origin ${link.min}`);
  assert.ok(Math.abs(link.size[1] - 0.126) < 0.004 && Math.abs(link.size[0] - 0.11) < 0.004, `link long axis is Y ${link.size}`);
  const firepit = byName('firepit');
  assert.ok(firepit.size[0] > 1.7 && firepit.size[0] < 2.2 && Math.abs(firepit.min[1]) < 0.02, `firepit ${firepit.size} y${firepit.min[1]}`);
});

check('manifest: 相对P0快照只追加且旧记录不变', () => {
  const key = a => `${a.path}|${a.sha256}|${a.bytes}`;
  const oldSet = new Set(preSnapshot.assets.map(key));
  const nowSet = new Set(manifest.assets.map(key));
  for (const k of oldSet) assert.ok(nowSet.has(k), `lost record ${k}`);
  const added = manifest.assets.filter(a => !oldSet.has(key(a)));
  assert.equal(added.length, 1, `exactly one new asset, got ${added.length}`);
  assert.equal(added[0].path, `assets/${immersion.sha256}.glb`);
  assert.equal(immersion.pack_id, 'eys-immersion-props-v1');
  assert.ok(!JSON.stringify(immersion).includes('172.72'), 'no private hosts in public json');
  assert.ok(!JSON.stringify(immersion).includes('.blend'), 'no blend path in public json');
});

const report = {schema: 1, generated_at: new Date().toISOString(), pack: immersion.pack_id, glb: immersion.url,
  bytes: buffer.length, passed: 0, failed: 0, checks};
report.passed = checks.filter(c => c.result === 'passed').length;
report.failed = checks.filter(c => c.result === 'failed').length;
const {writeFileSync, mkdirSync} = await import('node:fs');
mkdirSync(new URL('../../reports/immersion/', import.meta.url), {recursive: true});
writeFileSync(new URL('../../reports/immersion/props-check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(`immersion P0A props check: ${report.passed} passed, ${report.failed} failed`);
for (const c of checks) if (c.result !== 'passed') console.log(`[FAILED] ${c.name} — ${c.error}`);
if (report.failed > 0) process.exit(1);
