import { drawScene, catSVG } from './art.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));
let state = { game: null, connection: { configured: false, model: 'jev-latest' } };
let busy = false;
let soundOn = true;
let selectedMode = 'practice';
let toastTimer;
let roundTimer;
let renderedSceneRound = null;
let audioContext;

const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const roleLabel = (role) => role === 'evader' ? '你来躲' : '你来抓';

function toast(message, error = false) {
  clearTimeout(toastTimer);
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast${error ? ' error' : ''}`;
  element.hidden = false;
  toastTimer = setTimeout(() => { element.hidden = true; }, error ? 9000 : 3800);
}

async function api(path, body) {
  let response;
  try {
    response = await fetch(`/api/${path}`, body === undefined ? undefined : {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('本地服务未连接，请启动服务后重试。');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('服务返回格式无效。'); }
  if (!response.ok) throw new Error(data.error || '操作失败，请重试。');
  return data;
}

function setBusy(value) {
  busy = value;
  document.body.classList.toggle('busy', value);
}

async function perform(operation) {
  if (busy) return;
  setBusy(true);
  try { await operation(); } catch (error) { toast(error.message, true); } finally { setBusy(false); render(); }
}

function haptic(pattern) {
  if (!isReduced() && typeof navigator.vibrate === 'function') navigator.vibrate(pattern);
}

function tone(context, frequency, duration, start, type = 'sine', volume = 0.035) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.015);
}

function playSound(kind) {
  if (!soundOn) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') void audioContext.resume();
    const start = audioContext.currentTime + 0.005;
    const patterns = {
      tap: [[310, 0.07, 'sine', 0.024]],
      ready: [[460, 0.08, 'sine', 0.028], [680, 0.11, 'sine', 0.022]],
      win: [[520, 0.11, 'sine', 0.035], [660, 0.13, 'sine', 0.038], [820, 0.2, 'triangle', 0.032]],
      shock: [[1160, 0.045, 'square', 0.04], [180, 0.08, 'sawtooth', 0.032], [980, 0.045, 'square', 0.036], [150, 0.2, 'triangle', 0.024]],
    };
    let offset = 0;
    for (const [frequency, duration, type, volume] of patterns[kind] || patterns.tap) {
      tone(audioContext, frequency, duration, start + offset, type, volume);
      offset += duration * 0.72;
    }
  } catch { /* audio is optional */ }
}

function tapFeedback(choice) {
  const button = document.querySelector(`[data-choice="${choice}"]`);
  button?.classList.remove('tap');
  if (button) { void button.offsetWidth; button.classList.add('tap'); setTimeout(() => button.classList.remove('tap'), 260); }
  playSound('tap');
  haptic(8);
}

function drawConfetti() {
  const box = $('#confetti');
  if (!box) return;
  box.innerHTML = Array.from({ length: 23 }, (_, i) => `<i style="--x:${8 + Math.random() * 84}%;--c:${['#96ae72', '#d7a271', '#b796c4', '#e2c77b'][i % 4]};--delay:${Math.random() * .28}s"></i>`).join('');
  setTimeout(() => { box.innerHTML = ''; }, 1900);
}

function sceneColors(scene) {
  const stage = $('#scene-stage');
  drawScene(scene, stage);
  $('#scene-card').classList.remove('switching');
  void $('#scene-card').offsetWidth;
  $('#scene-card').classList.add('switching');
}

function updateScene(game) {
  const scene = game.scene;
  if (!scene) return;
  sceneColors(scene);
  $('#scene-en').textContent = scene.en || game.scenes.find((item) => item.id === scene.id)?.en || 'NEXT SCENE';
  $('#scene-name').textContent = scene.name;
  $('#scene-role').textContent = roleLabel(game.role);
  $('#scene-count').textContent = `${String(game.round + 1).padStart(2, '0')} / ∞`;
  $('#left-label').textContent = scene.left;
  $('#right-label').textContent = scene.right;
  $('#left-choice-label').textContent = scene.left;
  $('#right-choice-label').textContent = scene.right;
  $('#scene-hint').textContent = scene.hint;
  $('#context-round');
  $('#cat-art').innerHTML = catSVG(game.role === 'catcher');
  $('#stage-message').className = 'stage-message';
  $('#stage-message').innerHTML = `<strong>${game.role === 'evader' ? '选一边躲起来' : '猜猜 Jev 藏在哪'}</strong><span>${game.role === 'evader' ? '对手正在找你。' : '这一次，轮到你来抓。'}</span>`;
}

function updateWaiting(game) {
  const waiting = $('#waiting');
  const retry = $('#retry-button');
  waiting.className = 'waiting';
  retry.hidden = true;
  if (game.phase === 'preparing') {
    // Between rounds, keep the controls calm and visible instead of showing a
    // blocking spinner for model latency. The initial load may still spin.
    if (game.history.length) {
      waiting.classList.add('between-rounds');
      $('#waiting-text').textContent = '下一回合马上开始…';
    } else {
      waiting.classList.add('loading');
      $('#waiting-text').textContent = game.mode === 'jev' ? 'Jev 正在锁定方向…' : '本地机器人正在锁定方向…';
    }
  } else if (game.phase === 'ready') {
    waiting.classList.add('ready');
    $('#waiting-text').textContent = game.role === 'evader' ? '对手已经锁定，选一边躲开。' : 'Jev 已经藏好，猜猜在哪一边。';
  } else if (game.phase === 'error') {
    waiting.classList.add('error');
    $('#waiting-text').textContent = game.error || '对手决策失败。';
    retry.hidden = false;
  } else if (game.phase === 'finished') {
    $('#waiting-text').textContent = '继续追逐，连胜还在。';
  } else {
    $('#waiting-text').textContent = '正在准备对手的选择…';
  }
}

function updateScores(game) {
  $('#player-score').textContent = String(game.playerScore).padStart(3, '0');
  $('#rival-score').textContent = String(game.rivalScore).padStart(3, '0');
  const roundLabel = String(game.round + 1).padStart(2, '0');
  $('#score-round').textContent = `#${roundLabel}`;
  $('#nav-round').textContent = `回合 ${roundLabel}`;
  $('#rival-name').textContent = game.mode === 'jev' ? 'JEV / AI' : '本地机器人 / LOCAL';
  $('#connection-dot').classList.toggle('on', state.connection.configured);
  $('#connection-label').textContent = state.connection.configured ? 'Jev 已配置' : '连接 Jev';
  const trail = game.history.slice(-9);
  $('#dots').innerHTML = [...trail.map((row) => `<i class="${row.playerWon ? 'win' : 'loss'}"></i>`), '<i class="current"></i>'].join('');
}

function updateButtons(game) {
  const enabled = !busy && game.phase === 'ready';
  $$('[data-choice]').forEach((button) => { button.disabled = !enabled; });
  $('#choice-title').textContent = roleLabel(game.role);
  $('#choice-note').textContent = enabled ? (game.role === 'evader' ? '躲开对手的预测' : '和对手同一边就抓到') : '等对手先锁定选择';
}

function renderHistory(game) {
  $('#history-total').textContent = `${game.round} 回合`;
  const streakLabel = $('#streak-label');
  streakLabel.textContent = game.streak ? `连胜 · ${game.streak}　最佳 · ${game.bestStreak}` : `最佳连续 · ${game.bestStreak}`;
  streakLabel.classList.toggle('streak-hot', game.streak >= 2);
  const recent = game.history.slice(-10);
  $('#history-grid').innerHTML = recent.length ? recent.map((row) => `
    <button class="history-cell ${row.playerWon ? 'win' : 'loss'}" data-history="${row.round}" aria-label="第 ${row.round} 回合，${row.playerWon ? '你得分' : '对手得分'}">
      <small>${String(row.round).padStart(2, '0')}</small><strong>${row.playerWon ? '✓' : '×'}</strong><span>${row.playerWon ? '+100' : '0'}</span>
    </button>`).join('') : '<div class="empty-history"><span>✦</span><p>你的选择会在这里留下轨迹。</p></div>';
  $$('.history-cell').forEach((button) => button.addEventListener('click', () => showHistory(Number(button.dataset.history))));
}

function showHistory(round) {
  const row = state.game?.history.find((item) => item.round === round);
  if (!row) return;
  const roleText = row.role === 'evader' ? '你来躲' : '你来抓';
  toast(`第 ${round} 回合 · ${roleText} · 你${row.playerWon ? '成功' : '失手'} · 你选 ${row.playerChoice === 'left' ? '左' : '右'}，对手选 ${row.rivalChoice === 'left' ? '左' : '右'}`);
}

function renderResult(game) {
  const panel = $('#result-panel');
  if (!game || game.phase !== 'finished') { panel.hidden = true; return; }
  panel.hidden = false;
  const playerWon = game.playerScore > game.rivalScore;
  const tie = game.playerScore === game.rivalScore;
  panel.innerHTML = `<div><span class="eyebrow">LEGACY ROUND / CONTINUE</span><h2>${tie ? '势均力敌。' : playerWon ? '这次，Jev 抓不到你。' : 'Jev 读懂了你的规律。'}</h2><div class="result-score">${String(game.playerScore).padStart(3, '0')} <span>—</span> ${String(game.rivalScore).padStart(3, '0')}</div><p>无限模式已更新，点击继续追逐即可开始新的连续记录。</p><p>最佳连续：${game.bestStreak} 回合 · 每次得分规则完全相同。</p></div><div class="result-actions"><button class="primary" id="share-button">保存战绩卡 ↗</button><button class="secondary" id="again-button">继续追逐 ↻</button></div>`;
  $('#share-button').addEventListener('click', saveCard);
  $('#again-button').addEventListener('click', () => void newGame(selectedMode));
}

function render() {
  const game = state.game;
  if (!game) return;
  updateScores(game);
  if (game.scene && game.round !== renderedSceneRound) { updateScene(game); renderedSceneRound = game.round; }
  updateWaiting(game);
  updateButtons(game);
  renderHistory(game);
  renderResult(game);
  $$('[data-mode]').forEach((button) => { button.setAttribute('aria-pressed', String(selectedMode === button.dataset.mode)); button.disabled = busy; });
  if (game.scene) {
    const runner = $('#runner');
    if (game.phase !== 'preparing' || renderedSceneRound !== game.round) { runner.classList.remove('to-left', 'to-right', 'caught', 'escaped', 'shocked'); $('#catcher-marker').hidden = true; $('#catcher-marker').className = 'catcher-marker'; }
  }
}

function reveal(result) {
  const game = state.game;
  const resultRole = result.role;
  const runner = $('#runner');
  const marker = $('#catcher-marker');
  runner.classList.remove('to-left', 'to-right', 'caught', 'escaped', 'shocked');
  runner.classList.add(result.playerChoice === 'left' ? 'to-left' : 'to-right', result.playerWon ? 'escaped' : 'caught');
  if (!result.playerWon) runner.classList.add('shocked');
  if (resultRole === 'evader') {
    marker.hidden = false; marker.className = `catcher-marker ${result.rivalChoice === 'right' ? 'right' : ''}`;
  } else {
    marker.hidden = false; marker.className = `catcher-marker human ${result.playerChoice === 'right' ? 'right' : ''}`;
  }
  const message = $('#stage-message');
  message.className = `stage-message reveal ${result.playerWon ? 'win' : 'loss'}`;
  const streak = state.game?.streak || 0;
  message.innerHTML = `<strong>${result.playerWon ? (resultRole === 'evader' ? '躲开了！' : '抓到了！') : (resultRole === 'evader' ? '被抓住了。' : '扑空了。')}</strong><span>${result.playerWon ? `+100 分${streak >= 2 ? ` · ${streak} 连胜` : ''} · 下一回合马上出现` : '小猫被电到了 · 下一回合继续'}</span>`;
  const card = $('#scene-card');
  card.classList.remove('impact-win', 'impact-loss');
  void card.offsetWidth;
  card.classList.add(result.playerWon ? 'impact-win' : 'impact-loss');
  const scoreElement = $(result.playerWon ? '#player-score' : '#rival-score');
  scoreElement.classList.remove('score-pop');
  void scoreElement.offsetWidth;
  scoreElement.classList.add('score-pop');
  playSound(result.playerWon ? 'win' : 'shock');
  haptic(result.playerWon ? [14, 28, 18] : [18, 22, 42]);
  if (result.playerWon) drawConfetti();
  return new Promise((resolve) => setTimeout(() => {
    resolve();
  }, isReduced() ? 0 : 780));
}

async function pollReady(gameId, round) {
  clearInterval(roundTimer);
  roundTimer = setInterval(async () => {
    try {
      const next = await api('state');
      if (next.game?.id !== gameId || next.game.round !== round) { clearInterval(roundTimer); state = next; render(); return; }
      const previousPhase = state.game?.phase;
      state = next; render();
      if (next.game.phase === 'ready' && previousPhase !== 'ready') { playSound('ready'); haptic(10); }
      if (next.game.phase === 'ready' || next.game.phase === 'error') clearInterval(roundTimer);
    } catch (error) { clearInterval(roundTimer); toast(error.message, true); }
  }, 450);
}

async function newGame(mode = selectedMode) {
  selectedMode = mode;
  await perform(async () => {
    state = await api('game', { mode });
    render();
    pollReady(state.game.id, state.game.round);
    toast(mode === 'jev' ? '对战开始。Jev 正在锁定第一回合。' : '练习开始。本地机器人正在锁定第一回合。');
  });
}

function requestNewGame(mode = selectedMode) {
  if (busy) return;
  selectedMode = mode;
  if (state.game?.history.length && state.game.phase !== 'finished') { $('#restart-dialog').showModal(); return; }
  if (mode === 'jev' && !state.connection.configured) { openConnection(); toast('先连接 Jev API，再开启真人模型对战。'); return; }
  void newGame(mode);
}

async function choose(choice) {
  const game = state.game;
  if (!game || busy || game.phase !== 'ready') return;
  tapFeedback(choice);
  setBusy(true);
  try {
    const result = await api('choice', { gameId: game.id, round: game.round, choice, commitment: game.commitment });
    state = result;
    // Keep the current scene in place while the result reveals, but update the
    // score and trail immediately so the tap has visible feedback.
    updateScores(state.game);
    updateWaiting(state.game);
    updateButtons(state.game);
    renderHistory(state.game);
    await reveal(result.result);
    setBusy(false);
    render();
    if (state.game.phase !== 'finished') pollReady(state.game.id, state.game.round);
  } catch (error) {
    setBusy(false);
    toast(error.message, true);
    render();
  }
}

function openConnection() {
  $('#api-key').value = '';
  $('#api-key').placeholder = state.connection.configured ? '已保存，留空继续使用' : '填入 API Key';
  $('#model-name').value = state.connection.model || 'jev-latest';
  $('#connection-result').textContent = state.connection.configured ? '连接已保存。可以测试当前配置。' : 'Key 只保存在本机服务的会话内存中。';
  $('#connection-dialog').showModal();
}

function saveCard() {
  const game = state.game; if (!game) return;
  const title = game.playerScore > game.rivalScore ? 'Beat Jev · 打败 Jev' : game.playerScore < game.rivalScore ? '这次被 Jev 读懂了' : '势均力敌的一局';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#f5f2e9"/><circle cx="910" cy="180" r="320" fill="#e1ebc9"/><g font-family="Arial,PingFang SC,Microsoft YaHei,sans-serif"><text x="80" y="104" font-size="22" fill="#617359" letter-spacing="6">JEV / QUICK DECISION GAME</text><text x="80" y="270" font-size="68" fill="#293e35">${title}</text><text x="80" y="330" font-size="26" fill="#7a8275">无限回合 · 人类与 Jev 的选择对抗</text><line x1="80" x2="1000" y1="395" y2="395" stroke="#d5dbc8"/><text x="80" y="520" font-size="25" fill="#718765">HUMAN / 你</text><text x="80" y="625" font-size="100" fill="#293e35">${String(game.playerScore).padStart(3, '0')}</text><text x="80" y="720" font-size="25" fill="#967f9d">JEV / 对手</text><text x="80" y="825" font-size="100" fill="#796a84">${String(game.rivalScore).padStart(3, '0')}</text><line x1="80" x2="1000" y1="916" y2="916" stroke="#d5dbc8"/><text x="80" y="1005" font-size="28" fill="#617359">最佳连续 ${game.bestStreak} 回合</text><text x="80" y="1080" font-size="24" fill="#7a8275">${game.mode === 'jev' ? `模型：${escapeHTML(state.connection.model)}` : '本地习惯机器人 · 练习模式'}</text><text x="80" y="1190" font-size="22" fill="#a2a593">每回合 100 分 · 不代表任何真实能力</text></g></svg>`;
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `Beat-Jev-${game.playerScore}-${game.rivalScore}.svg`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('战绩卡已保存为 SVG 图片。');
}

$('#connection-button').addEventListener('click', openConnection);
$('#rules-button').addEventListener('click', () => $('#rules-dialog').showModal());
$('#new-game-button').addEventListener('click', () => requestNewGame(selectedMode));
$('#sound-button').addEventListener('click', () => { soundOn = !soundOn; $('#sound-button').setAttribute('aria-pressed', String(soundOn)); $('#sound-button').textContent = soundOn ? '音效 开' : '音效 关'; if (soundOn) { playSound('ready'); haptic(10); } });
$('#export-button').addEventListener('click', saveCard);
$('#retry-button').addEventListener('click', () => { if (state.game) { state.game.phase = 'preparing'; state.game.error = null; render(); void api('prepare', { gameId: state.game.id, round: state.game.round }).then(next => { state = next; render(); pollReady(state.game.id, state.game.round); }).catch(error => toast(error.message, true)); } });
$$('[data-choice]').forEach((button) => button.addEventListener('click', () => void choose(button.dataset.choice)));
$$('[data-mode]').forEach((button) => button.addEventListener('click', () => { const mode = button.dataset.mode; if (mode !== selectedMode) requestNewGame(mode); }));
$$('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
$('#confirm-restart').addEventListener('click', () => { $('#restart-dialog').close(); void newGame(selectedMode); });
$('#connection-form').addEventListener('submit', (event) => { event.preventDefault(); void perform(async () => { state = await api('connection', { key: $('#api-key').value || undefined, model: $('#model-name').value }); $('#connection-dialog').close(); toast('Jev 连接已保存。'); }); });
$('#test-connection').addEventListener('click', () => void perform(async () => { $('#connection-result').textContent = '正在测试连接…'; const result = await api('connection/test', { key: $('#api-key').value || undefined, model: $('#model-name').value }); $('#connection-result').textContent = `连接成功 · ${result.model} · ${result.elapsedMs} ms。点击保存连接后开启对战。`; }));
$('#disconnect').addEventListener('click', () => void perform(async () => { state = await api('connection', { clear: true }); $('#connection-result').textContent = '已清除本机服务会话中的 Key。'; toast('Jev 连接已清除。'); }));

try {
  state = await api('state');
  if (!state.game) state = await api('game', { mode: 'practice' });
  selectedMode = state.game.mode;
  render();
  pollReady(state.game.id, state.game.round);
} catch (error) { toast(error.message, true); $('#waiting-text').textContent = '无法加载对局，请启动本地服务。'; $('#waiting').classList.add('error'); }
