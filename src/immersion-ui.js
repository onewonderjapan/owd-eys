// Runtime UI for the immersion session. Creates the #immersion-ui subtree once per page,
// tolerates old HTML without any immersion nodes, and renders purely from state snapshots.
// Vote counting and phase timing stay in the state machine; this module only displays.
import {IMMERSION_CONFIG} from './immersion-config.js';

export function ensureImmersionUi(host) {
 const existing = document.getElementById('immersion-ui');
 if (existing) {
  if (!existing.__immersionUi) throw new Error('immersion-ui 节点存在但未初始化（旧版 HTML?），无法安全复用');
  return existing.__immersionUi;
 }
 if (!document.getElementById('immersion-css')) {
  const link = document.createElement('link');
  link.id = 'immersion-css';
  link.rel = 'stylesheet';
  link.href = new URL('immersion.css', import.meta.url).href;
  document.head.appendChild(link);
 }

 const root = document.createElement('div');
 root.id = 'immersion-ui';
 const made = {};
 // render() runs at ~20Hz; skip identical writes so layout doesn't churn
 const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
 const div = id => {
  const node = document.createElement('div');
  node.id = 'immersion-' + id;
  root.appendChild(node);
  made[id] = node;
  return node;
 };
 const buttonOf = (parent, id, text) => {
  const node = document.createElement('button');
  node.id = 'immersion-' + id;
  node.type = 'button';
  node.textContent = text;
  parent.appendChild(node);
  made[id] = node;
  return node;
 };

 // Bell prompt (roam, near the courthouse bell).
 const prompt = div('prompt');
 prompt.setAttribute('data-pointer', '');
 const promptLabel = document.createElement('span');
 promptLabel.id = 'immersion-prompt-label';
 made['prompt-label'] = promptLabel;
 const kbd = document.createElement('kbd');
 kbd.textContent = 'E';
 promptLabel.append(kbd, document.createTextNode(' 按铃开会'));
 buttonOf(prompt, 'prompt-bell', '按铃');

 // Meeting chrome.
 const topbar = div('topbar');
 const modeTag = document.createElement('span');
 modeTag.id = 'immersion-mode-tag';
 modeTag.textContent = '体验模式 · NPC 演出';
 topbar.appendChild(modeTag);
 // 1.7.0: one line naming who was found dead this round (hidden when nobody died).
 const foundTag = document.createElement('span');
 foundTag.id = 'immersion-found-tag';
 topbar.appendChild(foundTag);
 made['found-tag'] = foundTag;
 buttonOf(topbar, 'mute', '静音');
 buttonOf(topbar, 'skip', '跳过');
 buttonOf(topbar, 'leave', '退出会议');

 const stylePicker = div('style-picker');
 const styleLabel = document.createElement('span');
 styleLabel.textContent = '出局演出';
 stylePicker.appendChild(styleLabel);
 for (const style of IMMERSION_CONFIG.styles) {
  buttonOf(stylePicker, 'style-' + style, (IMMERSION_CONFIG.styleLabels || {})[style] || style).setAttribute('aria-pressed', 'false');
 }

 div('caption').setAttribute('role', 'status');

 // Voting bar.
 const voting = div('voting');
 const voteHint = document.createElement('div');
 voteHint.className = 'immersion-vote-hint';
 voteHint.id = 'immersion-vote-hint';
 made['vote-hint'] = voteHint;
 voting.appendChild(voteHint);
 const avatars = div('avatars');
 voting.appendChild(avatars);
 avatars.setAttribute('role', 'group');
 avatars.setAttribute('aria-label', '选择被投出的NPC');
 const actions = document.createElement('div');
 actions.className = 'immersion-vote-actions';
 voting.appendChild(actions);
 buttonOf(actions, 'self-demo', '体验自己被投出');
 buttonOf(actions, 'confirm', '确认投票').disabled = true;

 div('banner').setAttribute('role', 'status');

 const preparing = div('preparing');
 preparing.className = 'immersion-center';
 const preparingText = document.createElement('h2');
 preparingText.id = 'immersion-preparing-text';
 made['preparing-text'] = preparingText;
 preparing.appendChild(preparingText);
 buttonOf(preparing, 'preparing-cancel', '取消');

 const errorPanel = div('error-panel');
 errorPanel.className = 'immersion-center';
 const errorTitle = document.createElement('h2');
 errorTitle.textContent = '会议准备失败，可重试';
 errorPanel.appendChild(errorTitle);
 const errorText = document.createElement('p');
 errorText.id = 'immersion-error-text';
 made['error-text'] = errorText;
 errorPanel.appendChild(errorText);
 const errorRow = document.createElement('div');
 errorRow.className = 'immersion-row';
 errorPanel.appendChild(errorRow);
 buttonOf(errorRow, 'retry', '重试');
 buttonOf(errorRow, 'error-cancel', '返回漫游');

 const finished = div('finished');
 finished.className = 'immersion-center';
 const finishedTitle = document.createElement('h2');
 finishedTitle.textContent = '本次演出结束';
 finished.appendChild(finishedTitle);
 const finishedRow = document.createElement('div');
 finishedRow.className = 'immersion-row';
 finished.appendChild(finishedRow);
 buttonOf(finishedRow, 'replay', '重播本段');
 buttonOf(finishedRow, 'return', '返回小镇');

 div('fade');
 // 1.7.0 discovery vignette: a fullscreen inset-shadow overlay above everything.
 const vignette = div('vignette');
 vignette.setAttribute('aria-hidden', 'true');

 host.appendChild(root);

 const callbacks = {}; // wired by the director: select, selfDemo, confirm, skip, muteToggle, ...
 const bind = (id, handler) => {
  made[id].addEventListener('click', e => {
   e.stopPropagation();
   handler(e);
  });
 };

 const ui = {
  root,
  on: callbacks,
  hideAll() {
   for (const id of ['prompt', 'topbar', 'style-picker', 'caption', 'voting', 'banner', 'preparing', 'error-panel', 'finished'])
    made[id].hidden = true;
   made['fade'].classList.remove('on');
   made['vignette'].classList.remove('play', 'hold');
  },
  // 1.7.0 discovery vignette: 'play' runs the one-shot pulse, 'hold' pins the
  // reduced-motion pale edge, null clears both.
  vignette(mode) {
   const v = made['vignette'];
   v.classList.remove('play', 'hold');
   if (mode === 'play') { void v.offsetWidth; v.classList.add('play'); }
   else if (mode === 'hold') v.classList.add('hold');
  },
  render(state, extras = {}) {
   const {phase} = state;
   const show = (id, visible) => { made[id].hidden = !visible; };
   const propsError = Boolean(extras.propsError);
   const triggerLabel = extras.nearBell || null; // '按铃' | '按下按钮' | null
   // 1.7.0: the report prompt outranks the meeting triggers (design: 报警 > 开会).
   const reportNear = Boolean(extras.reportNear);
   const promptVisible = phase === 'roam' && (reportNear || Boolean(triggerLabel) || propsError) && extras.propsReady !== false;
   show('prompt', promptVisible);
   if (promptVisible) {
    const actionText = propsError ? '会议道具加载失败' : (reportNear ? ' 报警' : (triggerLabel === '按下按钮' ? ' 按下按钮开会' : ' 按铃开会'));
    made['prompt-label'].childNodes.forEach(node => { if (node.nodeType === 3 && node.textContent !== actionText) node.textContent = actionText; });
    const kbd = made['prompt-label'].querySelector('kbd');
    if (kbd) { kbd.hidden = propsError; kbd.textContent = 'E'; }
    setText(made['prompt-bell'], propsError ? '重试' : (reportNear ? '报警' : (triggerLabel || '按铃')));
   }
   show('preparing', phase === 'preparing');
   if (phase === 'preparing')
    setText(made['preparing-text'], extras.progress
     ? `正在准备会议 ${extras.progress.done}/${extras.progress.total}`
     : '正在准备会议…');
   show('error-panel', phase === 'error');
   if (phase === 'error') setText(made['error-text'], state.error || '未知错误');
   const showChrome = state.busy && phase !== 'preparing' && phase !== 'error';
   show('topbar', showChrome);
   if (showChrome) {
    show('skip', ['ringing', 'reporting', 'seating', 'discussion', 'result', 'ejection'].includes(phase));
    setText(made['mute'], extras.muted ? '取消静音' : '静音');
    // 1.7.0: name the found dead once the meeting knows them (roam hides it).
    const deadId = state.absent?.dead?.[0];
    const foundVisible = Boolean(deadId) && phase !== 'roam';
    made['found-tag'].hidden = !foundVisible;
    if (foundVisible) {
     const dead = (extras.describeActor(deadId) || {}).label || deadId;
     setText(made['found-tag'], `本轮发现：${dead}`);
    }
   }
   const styleVisible = phase === 'discussion' || phase === 'voting';
   show('style-picker', styleVisible);
   if (styleVisible) {
    for (const style of IMMERSION_CONFIG.styles) {
     const b = made['style-' + style];
     if (b) b.setAttribute('aria-pressed', String(state.style === style));
    }
   }
   show('voting', phase === 'voting');
   if (phase === 'voting') {
    setText(made['vote-hint'], state.selfDemo
     ? '演示：全部NPC将投给你，确认后生效'
     : state.selectedId
      ? `将投出：${(extras.describeActor(state.selectedId) || {}).label || state.selectedId}`
      : '选择一位NPC，或体验自己被投出');
    made['confirm'].disabled = !state.selectedId;
   }
   const show_text = (id, text) => setText(made[id], text);
   // 1.7.0: the discovery banner reuses the result banner slot.
   const deadLabel = id => (extras.describeActor(id) || {}).label || id;
   if (phase === 'reporting') {
    show('banner', true);
    show_text('banner', '发现尸体！');
   } else {
    show('banner', phase === 'result');
   }
   if (phase === 'result') {
    if (state.targetId && !made['avatars'].querySelector(`[data-actor="${CSS.escape(state.targetId)}"]`)?.classList.contains('dropped')) {
     const card = made['avatars'].querySelector(`[data-actor="${CSS.escape(state.targetId)}"]`);
     if (card) card.classList.add('dropped'); // v4.01-style body-drop nod
    }
    const target = extras.describeActor(state.targetId) || {};
    const votesForTarget = state.votes ? Object.values(state.votes).filter(v => v === state.targetId).length : 0;
    show_text('banner', state.selfDemo
     ? `全场投给了你（${votesForTarget} 票）`
     : `「${target.label || state.targetId}」被投出（${votesForTarget} 票）`);
   }
   show('caption', phase === 'discussion');
   if (phase === 'discussion') {
    // 1.7.0: speakers are the present members — dead seats stay silent.
    const speakers = state.present?.length ? state.present : state.actorIds;
    const speaker = extras.describeActor(speakers[state.speakerIndex]) || {};
    setText(made['caption'], `${speaker.label || '有人'}：${extras.speeches?.[state.speakerIndex] || ''}`);
   }
   show('finished', phase === 'finished');
   made['fade'].classList.toggle('on', Boolean(extras.fade));
  },
  setAvatars(actorIds, selectedId, describeActor, disabled, absent = {dead: [], eliminated: []}) {
   const box = made['avatars'];
   const wanted = new Set(actorIds);
   const deadSet = new Set(absent.dead || []), elimSet = new Set(absent.eliminated || []);
   for (const child of [...box.children]) if (!wanted.has(child.dataset.actor)) child.remove();
   for (const id of actorIds) {
    let node = box.querySelector(`[data-actor="${CSS.escape(id)}"]`);
    if (!node) {
     node = document.createElement('button');
     node.type = 'button';
     node.dataset.actor = id;
     const image = document.createElement('img');
     image.alt = '';
     image.loading = 'lazy';
     image.width = 56;
     image.height = 56;
     const label = document.createElement('span');
     node.append(image, label);
     node.addEventListener('click', e => {
      e.stopPropagation();
      if (callbacks.select) callbacks.select(id);
     });
     box.appendChild(node);
    }
    const described = describeActor(id) || {};
    node.querySelector('img').src = described.thumbnail || '';
    node.querySelector('span').textContent = described.label || id;
    node.setAttribute('aria-pressed', String(selectedId === id));
    // 1.7.0: dead seats show a red cross and cannot be voted; ejected ones grey out.
    const isDead = deadSet.has(id), isEliminated = !isDead && elimSet.has(id);
    if (isDead) node.setAttribute('data-dead', '');
    else node.removeAttribute('data-dead');
    if (isEliminated) node.setAttribute('data-eliminated', '');
    else node.removeAttribute('data-eliminated');
    node.disabled = Boolean(disabled) || isDead || isEliminated;
    const base = described.label || id;
    node.setAttribute('aria-label', isDead ? `${base}（已死亡，不可选）` : isEliminated ? `${base}（已出局，不可选）` : base);
   }
  },
 };

 bind('prompt-bell', () => callbacks.bell && callbacks.bell());
 bind('preparing-cancel', () => callbacks.cancel && callbacks.cancel());
 bind('retry', () => callbacks.retry && callbacks.retry());
 bind('error-cancel', () => callbacks.cancel && callbacks.cancel());
 bind('mute', () => callbacks.muteToggle && callbacks.muteToggle());
 bind('skip', () => callbacks.skip && callbacks.skip());
 bind('leave', () => callbacks.cancel && callbacks.cancel());
 for (const style of IMMERSION_CONFIG.styles) bind('style-' + style, () => callbacks.setStyle && callbacks.setStyle(style));
 bind('self-demo', () => callbacks.selfDemo && callbacks.selfDemo());
 bind('confirm', () => callbacks.confirm && callbacks.confirm());
 bind('replay', () => callbacks.replay && callbacks.replay());
 bind('return', () => callbacks.return && callbacks.return());

 root.__immersionUi = ui;
 return ui;
}

