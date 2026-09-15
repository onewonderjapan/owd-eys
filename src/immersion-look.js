// Drag-to-look control for the temporary immersion camera. The stage owns a base
// orientation (baseYaw/basePitch, driven by its trajectory); user drags accumulate as
// deltas on top of it and are never zeroed per frame. Pointer capture only, no lock.
export function createImmersionLook({canvas, host}) {
 let enabled = false;
 let baseYaw = 0, basePitch = 0;
 let userYaw = 0, userPitch = 0;
 let minPitch = -0.70, maxPitch = 0.55;
 let drag = null;

 function clampDeltas() {
  userPitch = Math.min(maxPitch - basePitch, Math.max(minPitch - basePitch, userPitch));
 }

 canvas.addEventListener('pointerdown', e => {
  if (!enabled || e.button !== 0) return;
  host.focus({preventScroll: true});
  drag = {id: e.pointerId, x: e.clientX, y: e.clientY};
  canvas.setPointerCapture(e.pointerId);
 });
 canvas.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  userYaw -= (e.clientX - drag.x) * 0.0032;
  userPitch -= (e.clientY - drag.y) * 0.0032;
  drag.x = e.clientX; drag.y = e.clientY;
  clampDeltas();
 });
 const release = e => {
  if (!drag || drag.id !== e.pointerId) return;
  drag = null;
  if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
 };
 for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(event, release);

 return {
  enable(defaults = {}) {
   enabled = true;
   baseYaw = defaults.yaw ?? 0;
   basePitch = defaults.pitch ?? 0;
   if (defaults.minPitch !== undefined) minPitch = defaults.minPitch;
   if (defaults.maxPitch !== undefined) maxPitch = defaults.maxPitch;
   userYaw = 0; userPitch = 0;
   clampDeltas();
  },
  disable() {
   enabled = false;
   drag = null;
  },
  // Stage trajectory calls this every frame; user deltas survive the update.
  setBase(yaw, pitch) {
   baseYaw = yaw; basePitch = pitch;
   clampDeltas();
  },
  // Re-clamp without touching the base or the user's accumulated observation.
  setLimits(min, max) {
   minPitch = min; maxPitch = max;
   clampDeltas();
  },
  isDragging() { return Boolean(drag); },
  apply(camera, yaw = baseYaw, pitch = basePitch) {
   if (!enabled) return;
   if (yaw !== baseYaw || pitch !== basePitch) this.setBase(yaw, pitch);
   camera.rotation.set(basePitch + userPitch, baseYaw + userYaw, 0, 'YXZ');
  },
  state() {
   return {
    enabled, dragging: Boolean(drag),
    yaw: baseYaw + userYaw, pitch: basePitch + userPitch,
    userYaw, userPitch, baseYaw, basePitch,
   };
  },
  dispose() {
   enabled = false;
   if (drag) {
    if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
   }
  },
 };
}
