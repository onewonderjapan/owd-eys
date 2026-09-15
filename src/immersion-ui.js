// Runtime UI for the immersion session. Creates the #immersion-ui subtree once per page,
// tolerates old HTML without any immersion nodes, and renders purely from state snapshots.
// Vote counting and phase timing stay in the state machine; this module only displays.
export function ensureImmersionUi(host) {
 const existing = document.getElementById('immersion-ui');
 if (existing) return existing.__immersionUi || null;
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
 buttonOf(topbar, 'mute', '静音');
 buttonOf(topbar, 'skip', '跳过');
 buttonOf(topbar, 'leave', '退出会议');

 const stylePicker = div('style-picker');
 const styleLabel = document.createElement('span');
 styleLabel.textContent = '出局演出';
 stylePicker.appendChild(styleLabel);
 for (const [id, text] of [['style-water', '沉水'], ['style-fire', '火堆']]) {
  buttonOf(stylePicker, id, text).setAttribute('aria-pressed', 'false');
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
  },
  render(state, extras = {}) {
   const {phase} = state;
   const show = (id, visible) => { made[id].hidden = !visible; };
   const propsError = Boolean(extras.propsError);
   const promptVisible = phase === 'roam' && (Boolean(extras.nearBell) || propsError) && extras.propsReady !== false;
   show('prompt', promptVisible);
   if (promptVisible) {
    made['prompt-label'].childNodes.forEach(node => { if (node.nodeType === 3) node.textContent = propsError ? '会议道具加载失败' : ' 按铃开会'; });
    const kbd = made['prompt-label'].querySelector('kbd');
    if (kbd) kbd.hidden = propsError;
    made['prompt-bell'].textContent = propsError ? '重试' : '按铃';
   }
   show('preparing', phase === 'preparing');
   if (phase === 'preparing')
    made['preparing-text'].textContent = extras.progress
     ? `正在准备会议 ${extras.progress.done}/${extras.progress.total}`
     : '正在准备会议…';
   show('error-panel', phase === 'error');
   if (phase === 'error') made['error-text'].textContent = state.error || '未知错误';
   const showChrome = state.busy && phase !== 'preparing' && phase !== 'error';
   show('topbar', showChrome);
   if (showChrome) {
    show('skip', ['ringing', 'seating', 'discussion', 'result', 'ejection'].includes(phase));
    made['mute'].textContent = extras.muted ? '取消静音' : '静音';
   }
   const styleVisible = phase === 'discussion' || phase === 'voting';
   show('style-picker', styleVisible);
   if (styleVisible) {
    made['style-water'].setAttribute('aria-pressed', String(state.style === 'water'));
    made['style-fire'].setAttribute('aria-pressed', String(state.style === 'fire'));
   }
   show('voting', phase === 'voting');
   if (phase === 'voting') {
    made['vote-hint'].textContent = state.selfDemo
     ? '演示：全部NPC将投给你，确认后生效'
     : state.selectedId
      ? `将投出：${(extras.describeActor(state.selectedId) || {}).label || state.selectedId}`
      : '选择一位NPC，或体验自己被投出';
    made['confirm'].disabled = !state.selectedId;
   }
   show('banner', phase === 'result');
   if (phase === 'result') {
    const target = extras.describeActor(state.targetId) || {};
    const votesForTarget = state.votes ? Object.values(state.votes).filter(v => v === state.targetId).length : 0;
    made['banner'].textContent = state.selfDemo
     ? `全场投给了你（${votesForTarget} 票）`
     : `「${target.label || state.targetId}」被投出（${votesForTarget} 票）`;
   }
   show('caption', phase === 'discussion');
   if (phase === 'discussion') {
    const speaker = extras.describeActor(state.actorIds[state.speakerIndex]) || {};
    made['caption'].textContent = `${speaker.label || '有人'}：${IMMERSION_SPEECHES[state.speakerIndex] || ''}`;
   }
   show('finished', phase === 'finished');
   made['fade'].classList.toggle('on', Boolean(extras.fade));
  },
  setAvatars(actorIds, selectedId, describeActor, disabled) {
   const box = made['avatars'];
   const wanted = new Set(actorIds);
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
     image.width = 52;
     image.height = 48;
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
    node.disabled = Boolean(disabled);
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
 bind('style-water', () => callbacks.setStyle && callbacks.setStyle('water'));
 bind('style-fire', () => callbacks.setStyle && callbacks.setStyle('fire'));
 bind('self-demo', () => callbacks.selfDemo && callbacks.selfDemo());
 bind('confirm', () => callbacks.confirm && callbacks.confirm());
 bind('replay', () => callbacks.replay && callbacks.replay());
 bind('return', () => callbacks.return && callbacks.return());

 root.__immersionUi = ui;
 return ui;
}

const IMMERSION_SPEECHES = ['我刚才在码头。', '先听听大家怎么说。', '那我们投票吧。'];
