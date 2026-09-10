import * as THREE from 'three';

// Camera and look input stay separate from the collision/movement simulation.
export function createWalkView({overview, host, canvas, getAvatar, getWalker, isActive, canLook, clearInput}) {
 const first = new THREE.PerspectiveCamera(78, 1, .035, 180);
 const toggle = document.querySelector('#walk-view-toggle');
 const hint = document.querySelector('.walk-key-hint');
 const reticle = document.querySelector('#walk-reticle');
 let mode = 'overview', yaw = 0, pitch = 0, drag = null, lastUnlock = -Infinity;
 const locked = () => document.pointerLockElement === canvas;
 function unlock() { if (locked()) document.exitPointerLock(); drag = null; }
 function sync() {
  const fp = mode === 'first-person' && isActive();
  document.body.classList.toggle('first-person', fp);
  if(toggle) toggle.textContent = mode === 'first-person' ? '视角：第一人称' : '视角：俯视';
  toggle?.setAttribute('aria-pressed', String(mode === 'first-person'));
  hint.textContent = fp ? 'WASD 移动 · 拖动 / 点击画面环顾 · V 切换视角' : 'WASD / 方向键移动 · E 查看 · V 切换视角';
  if(reticle) reticle.hidden = !fp;
  const avatar = getAvatar();
  if (avatar) avatar.player.visible = isActive() && !fp;
  const directions = fp ? ['前进', '向左平移', '后退', '向右平移'] : ['向北走', '向西走', '向南走', '向东走'];
  document.querySelectorAll('[data-move]').forEach((b, i) => b.setAttribute('aria-label', directions[i]));
 }
 function projection() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  first.aspect = w / h; first.updateProjectionMatrix();
 }
 function change() {
  if (!isActive()) return;
  clearInput(); unlock();
  mode = mode === 'overview' ? 'first-person' : 'overview';
  if (mode === 'first-person') {
   const s=getWalker().state;
   // At the initial spawn, face the open harbor entrance instead of the nearby wall.
   if (s.distance<.01) s.heading=Math.PI/2;
   yaw=(s.heading+Math.PI)%(Math.PI*2);pitch=0;
  }
  sync(); projection(); host.focus({preventScroll: true});
 }
 function look(dx, dy) {
  if (mode !== 'first-person' || !canLook()) return;
  yaw -= dx * .0032;
  pitch = THREE.MathUtils.clamp(pitch - dy * .0032, -1.12, 1.12);
 }
 canvas.addEventListener('pointerdown', e => {
  if (mode !== 'first-person' || !canLook() || e.button !== 0) return;
  host.focus({preventScroll: true});
  if (!locked()) { drag = {id: e.pointerId, x: e.clientX, y: e.clientY, distance: 0, type: e.pointerType}; canvas.setPointerCapture(e.pointerId); }
 });
 canvas.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId || locked()) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.distance += Math.hypot(dx, dy); drag.x = e.clientX; drag.y = e.clientY; look(dx, dy);
 });
 canvas.addEventListener('pointerup', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const click = drag.distance < 4 && drag.type === 'mouse'; drag = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  if (click && mode === 'first-person' && canLook() && canvas.requestPointerLock) {
   // A denied lock retains the already-working drag control.
   try { canvas.requestPointerLock()?.catch(() => {}); } catch {}
  }
 });
 for (const event of ['pointercancel', 'lostpointercapture']) canvas.addEventListener(event, () => { drag = null; });
 document.addEventListener('mousemove', e => { if (locked()) look(e.movementX, e.movementY); });
 document.addEventListener('pointerlockchange', () => { if (!locked()) { lastUnlock = performance.now(); clearInput(); } });
 if(toggle) toggle.onclick = change;
 return {
  change, sync, projection, unlock,
  escape: () => { if (locked()) { unlock(); return true; } return performance.now() - lastUnlock < 350; },
  input(x, z) { return mode === 'first-person' ? [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)] : [x, z]; },
  update(position, floor) {
   const avatar = getAvatar();
   const eye = .28 * (2.70 + (avatar?.model.position.y || 0));
   first.position.set(position[0], floor + eye, position[1]);
   first.rotation.set(pitch, yaw, 0, 'YXZ');
  },
  get camera() { return isActive() && mode === 'first-person' ? first : overview; },
  state: () => ({mode, yaw, pitch, pointerLocked: locked(), position: first.position.toArray(), aspect: first.aspect, dragging: Boolean(drag)}),
 };
}
