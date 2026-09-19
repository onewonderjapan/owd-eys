import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import assert from 'node:assert/strict';

// Site and bucket identifiers come from the environment (see .env.example) so no
// account-specific value is committed; a missing one is a clear error, not a guess.
function required(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in; see docs/DEPLOYMENT.md.`);
  return value;
}
const url = new URL(process.argv[2] || `https://${required('EYS_SITE_DOMAIN')}/`);
const build = JSON.parse(await fs.readFile('reports/build.json', 'utf8'));
const scene = JSON.parse(await fs.readFile('dist/map-scene.json', 'utf8'));
const manifest = JSON.parse(await fs.readFile('dist/assets/manifest.json', 'utf8'));
const byPath = new Map(build.files.map(f => [f.path, f]));
const checks = [];
for (const path of ['index.html', 'assets/manifest.json', 'map-scene.json', scene.glb, 'map-walk-view.js', build.release_path + '/main.js', build.release_path + '/assets/manifest.json', manifest.modules.find(a=>a.id==='flower.crown').url, manifest.presets['cast.10'].thumbnail]) {
  const response = await fetch(new URL(path, url));
  const data = Buffer.from(await response.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  assert.equal(response.status, 200, path);
  assert.equal(sha256, byPath.get(path).sha256, path);
  const cacheControl = response.headers.get('cache-control');
  if (path.startsWith(build.release_path + '/')) assert(cacheControl?.includes('immutable'), path);
  if (path === 'index.html') assert(cacheControl?.includes('no-cache'), path);
  checks.push({path, status: response.status, bytes: data.length, sha256, cacheControl});
}
const root = await fetch(url);
const html = await root.text();
assert(html.includes('非官方二次创作'));
assert(html.includes('不用于商业用途'));
assert(html.includes('src="' + build.release_path + '/main.js"'));
const redirect = await fetch(new URL('http://' + url.host + '/'), {redirect: 'manual'});
assert([301, 302, 307, 308].includes(redirect.status));
assert.equal(redirect.headers.get('location'), url.href);
const bucketRegion = (process.env.EYS_S3_REGION || 'ap-northeast-1').trim();
const privateOrigin = `https://${required('EYS_S3_BUCKET')}.s3.${bucketRegion}.amazonaws.com/out/index.html`;
const anonymous = await fetch(privateOrigin);
assert.equal(anonymous.status, 403, 'S3 must require CloudFront OAC');
const report = {
  passed: true,
  version: build.version,
  release_path: build.release_path,
  build_sha256: crypto.createHash('sha256').update(await fs.readFile('reports/build.json')).digest('hex'),
  checked_at: new Date().toISOString(),
  url: url.href,
  addresses: await dns.resolve4(url.hostname),
  https: {status: root.status, hsts: root.headers.get('strict-transport-security'), csp: root.headers.get('content-security-policy')},
  redirect: {status: redirect.status, location: redirect.headers.get('location')},
  anonymous_s3: {status: anonymous.status},
  checks,
};
await fs.writeFile('reports/remote-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log('EYS_REMOTE_PASS', url.href, checks.length, 'S3 anonymous denied');
