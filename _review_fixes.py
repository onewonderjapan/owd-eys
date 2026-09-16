# Review fixes for the overnight branch (2026-09-16 morning review).
# P1-2 photo x bell gap, P1-3 secure-context guard, P2 batch.
import io

def sub(p, pairs):
    src = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        assert src.count(old) == 1, (p, old[:60], src.count(old))
        src = src.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='\n').write(src)
    print('patched', p)

sub('src/map-walk.js', [
 (""" function beginImmersion(){
  if(!director||director.busy||!walker)return;
  clearInput();view.unlock();""",
  """ function beginImmersion(){
  if(!director||director.busy||!walker)return;
  exitPhoto(); // #immersion-ui is outside #walk-hud; a session must never start inside photo mode
  clearInput();view.unlock();"""),
 ("""  for(const el of document.querySelectorAll('.walk-pad,.walk-bottom,.walk-actions,.walk-status,#walk-prompt'))el.hidden=busy;""",
  """  for(const el of document.querySelectorAll('.walk-pad,.walk-bottom,.walk-actions,.walk-status,#walk-prompt,#walk-photo-bar'))el.hidden=busy;"""),
 (""" function enterPhoto(){
  if(!active||photoMode||(director&&director.busy))return;
  clearInput();photoMode=true;
  hud.classList.add('photo');host.classList.add('photo-frame');
  $('#walk-photo-bar').hidden=false;
  host.focus({preventScroll:true});
 }""",
  """ function enterPhoto(){
  if(!active||photoMode||(director&&director.busy))return;
  clearInput();info.hidden=true;$('#walk-help').hidden=true; // canLook() keys off these
  photoMode=true;
  hud.classList.add('photo');host.classList.add('photo-frame');
  $('#walk-photo-bar').hidden=false;
  syncPhotoButton();
  host.focus({preventScroll:true});
 }"""),
 ("""  hud.classList.remove('photo');host.classList.remove('photo-frame');
  $('#walk-photo-bar').hidden=true;
  host.focus({preventScroll:true});
 }""",
  """  hud.classList.remove('photo');host.classList.remove('photo-frame');
  $('#walk-photo-bar').hidden=true;
  syncPhotoButton();
  host.focus({preventScroll:true});
 }
 function syncPhotoButton(){const b=$('#walk-photo');if(b)b.setAttribute('aria-pressed',String(photoMode));}"""),
 (""" import {createNavigation,createWalker} from './map-walk-simulation.js';
 import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';
 import {createWalkView} from './map-walk-view.js';
 import {createPropLibrary} from './immersion-props.js';
 import {IMMERSION_CONFIG} from './immersion-config.js';
 import {createImmersionDirector} from './immersion-director.js';
 import {createWalkAudio} from './walk-audio.js';""",
  """import {createNavigation,createWalker} from './map-walk-simulation.js';
import {loadWalkingAvatar,disposeWalkingAvatar} from './map-walk-avatar.js';
import {createWalkView} from './map-walk-view.js';
import {createPropLibrary} from './immersion-props.js';
import {IMMERSION_CONFIG} from './immersion-config.js';
import {createImmersionDirector} from './immersion-director.js';
import {createWalkAudio} from './walk-audio.js';"""),
 ("""immersion:director?director.state():null,nearBell:nearBellPoint(),props:propsLibrary.state(),audio:walkAudio.state(),photo:photoMode,dusk});""",
  """immersion:director?director.state():null,nearBell:nearBellPoint(),props:propsLibrary.state(),audio:walkAudio.state(),photo:photoMode,dusk,duskBg:scene.background&&scene.background.isColor?scene.background.getHexString():null});"""),
])

sub('src/immersion-props.js', [
 ("""    const url = new URL(config.url, document.baseURI).href;
    const bytes = await (await fetch(url)).arrayBuffer();""",
  """    const url = new URL(config.url, document.baseURI).href;
    const glbResponse = await fetch(url);
    if (!glbResponse.ok) throw Error('道具包下载失败（' + glbResponse.status + '），请刷新重试');
    const bytes = await glbResponse.arrayBuffer();"""),
 ("""    if (config.sha256) {
     const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
     if (digest !== config.sha256)
      throw Error('道具包校验失败（sha256 不匹配），请刷新重试');
    }""",
  """    if (config.sha256 && crypto?.subtle) {
     const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
      .map(b => b.toString(16).padStart(2, '0')).join('');
     if (digest !== config.sha256)
      throw Error('道具包校验失败（sha256 不匹配），请刷新重试');
    } else if (config.sha256) {
     // insecure context (plain http on a LAN IP): crypto.subtle is unavailable;
     // the byte-count gate still runs, skip the digest instead of crashing
     console.warn('immersion props: 非安全上下文，跳过 sha256 校验（仍校验字节数）');
    }"""),
])

sub('src/walk-audio.js', [
 (""" let muted = false, running = false, steps = 0;
 let stride = 0;""",
  """ let muted = false, running = false, steps = 0;
 let stride = 0, suspendedForPause = false;"""),
 ("""  pause() {
   if (context && context.state === 'running') context.suspend().catch(() => {});
  },
  resume() {
   if (context && context.state === 'suspended' && running) context.resume().catch(() => {});
  },""",
  """  pause() {
   suspendedForPause = true;
   if (context && context.state === 'running') context.suspend().catch(() => {});
  },
  resume() {
   suspendedForPause = false;
   if (context && context.state === 'suspended' && running) context.resume().catch(() => {});
  },"""),
 ("""    if (running && context) {
     if (muted) stopAmbience();
     else {
      if (context.state === 'suspended') context.resume().catch(() => {});
      startAmbience();
     }
    }""",
  """    if (running && context && !suspendedForPause) {
     if (muted) stopAmbience();
     else {
      if (context.state === 'suspended') context.resume().catch(() => {});
      startAmbience();
     }
    }"""),
])

sub('scripts/smoke-immersion.mjs', [
 ("""  // Dusk mood (B3): toggles lights/background, exposes state, and reverts.
  const bgBefore = await page.evaluate(() => document.querySelector('#viewport canvas') !== null);
  await page.click('#walk-dusk');
  const duskOn = await page.evaluate(() => window.eys.state().walk.dusk);
  const duskPressed = await page.locator('#walk-dusk').getAttribute('aria-pressed');
  check('dusk: 切换到黄昏', duskOn === true && duskPressed === 'true', `dusk=${duskOn} pressed=${duskPressed}`);
  await page.click('#walk-dusk');
  const duskOff = await page.evaluate(() => window.eys.state().walk.dusk);
  check('dusk: 切回原光照', duskOff === false, `dusk=${duskOff}`);
  void bgBefore;""",
  """  // Dusk mood (B3): the applied background color must actually change and restore.
  const bgBefore = await page.evaluate(() => window.eys.state().walk.duskBg);
  await page.click('#walk-dusk');
  const duskOn = await page.evaluate(() => window.eys.state().walk);
  const duskPressed = await page.locator('#walk-dusk').getAttribute('aria-pressed');
  check('dusk: 切换到黄昏', duskOn.dusk === true && duskPressed === 'true' && duskOn.duskBg !== bgBefore && duskOn.duskBg === '3d3654', `dusk=${duskOn.dusk} bg ${bgBefore}->${duskOn.duskBg}`);
  await page.click('#walk-dusk');
  const duskOff = await page.evaluate(() => window.eys.state().walk);
  check('dusk: 切回原光照', duskOff.dusk === false && duskOff.duskBg === bgBefore, `dusk=${duskOff.dusk} bg=${duskOff.duskBg} want=${bgBefore}`);"""),
 ("""    const errPhase = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'error', {timeout: 40000}).then(() => true).catch(() => false);""",
  """    const errPhase = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'error', null, {timeout: 40000}).then(() => true).catch(() => false);"""),
 ("""    const ringed = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', {timeout: 60000}).then(() => true).catch(() => false);""",
  """    const ringed = await page.waitForFunction(() => window.eys?.state?.().walk?.immersion?.phase === 'ringing', null, {timeout: 60000}).then(() => true).catch(() => false);"""),
])

sub('src/map-walk.css', [
 ("#walk-hud.photo>.walk-status,#walk-hud.photo>.walk-actions,#walk-hud.photo>.walk-bottom,#walk-hud.photo>.walk-pad,#walk-hud.photo>#walk-prompt,#walk-hud.photo>#walk-reticle,#walk-hud.photo>#walk-help,#walk-hud.photo>#walk-info{display:none!important}",
  "#walk-hud.photo>.walk-status,#walk-hud.photo>.walk-actions,#walk-hud.photo>.walk-bottom,#walk-hud.photo>.walk-pad,#walk-hud.photo>#walk-prompt,#walk-hud.photo>#walk-reticle,#walk-hud.photo>#walk-help,#walk-hud.photo>#walk-info,#walk-hud.photo>#walk-paused{display:none!important}\n#viewport.photo-frame #immersion-ui{display:none}"),
])

sub('docs/immersion/design-ambience.md', [
 ("- **脚步声**:frameLoop 每帧调用 `frame(dt, moving)`;内部按累计移动距离每 0.62 单位\n  (与视觉 bob 的 `s.distance*15` 同源节奏)触发一次短促带通噪声(约 90ms,\n  700→250Hz 下扫,峰值 ≈0.12,随机 ±8% 音高/音量防机关枪效应)。不移动不累计。",
  "- **脚步声**:frameLoop 每帧调用 `frame(dt, moving, distance)`;内部按累计移动距离每\n  0.62 单位触发一次短促带通噪声(约 90ms,700→250Hz 下扫,峰值 ≈0.12,随机 ±10%\n  音量抖动防机关枪效应;步距 0.62 为听感独立取值,不与视觉 bob 的 0.42 单位周期锁定)。不移动不累计。"),
])

print('ALL REVIEW FIXES APPLIED')
