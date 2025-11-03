let board = [];
let rows = 8;
let columns = 8;

let minesCount = 10;
let minesLocation = [];

let tilesClicked = 0;
let flagEnabled = false;
let gameOver = false;

const MAX_HINTS = 3;
let hintsLeft = MAX_HINTS;

// difficulty levels
const levels = {
  easy:   { mines: 10 },
  medium: { mines: 18 },
  hard:   { mines: 26 },
};
const levelOrder = ['easy', 'medium', 'hard'];
let currentLevel = 'easy';

// daily challenge state
let dailyMode = false;
let dailySeed = '';
let lastGameWasDaily = false; // was this run a daily challenge?

// daily cooldown: one run, then wait until next 1:00 AM local time
const dailyLastKey = 'minesweeper:dailyLastPlayed';
let dailyCountdownId = null;

function getLastDailyPlayedMs() {
  const raw = localStorage.getItem(dailyLastKey);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function getNextResetTimeMs(lastMs) {
  // next 1:00 AM after the time you played
  const last = new Date(lastMs);
  const reset = new Date(last);
  reset.setHours(1, 0, 0, 0);        // same day, 1:00 AM local

  if (reset <= last) {
    // if we played after today's 1am, next reset is tomorrow 1am
    reset.setDate(reset.getDate() + 1);
  }

  return reset.getTime();
}

function clearDailyCountdown() {
  if (dailyCountdownId !== null) {
    clearInterval(dailyCountdownId);
    dailyCountdownId = null;
  }
}

// start a countdown on the Daily button
function startDailyCountdown(lastMs) {
  clearDailyCountdown();
  const btn = document.getElementById('daily-button');
  if (!btn) return;

  function tick() {
    const now = Date.now();
    const target = getNextResetTimeMs(lastMs);
    const diff = target - now;

    if (diff <= 0) {
      // cooldown over, daily available again
      clearDailyCountdown();
      localStorage.removeItem(dailyLastKey);
      btn.disabled = false;
      btn.style.opacity = '1';
      btn.textContent = 'Daily Challenge';
      return;
    }

    const totalSec = Math.floor(diff / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');

    btn.disabled = true;
    btn.style.opacity = '0.7';
    btn.textContent = `Next in ${h}:${m}:${s}`;
  }

  tick();
  dailyCountdownId = setInterval(tick, 1000);
}

// called on load and after a daily game ends
function updateDailyButtonState() {
  const btn = document.getElementById('daily-button');
  if (!btn) return;

  const lastMs = getLastDailyPlayedMs();
  if (!lastMs) {
    // never played daily (or cooldown passed)
    clearDailyCountdown();
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = 'Daily Challenge';
    return;
  }

  const now = Date.now();
  const target = getNextResetTimeMs(lastMs);

  if (now >= target) {
    // cooldown passed, clear storage and reset button
    clearDailyCountdown();
    localStorage.removeItem(dailyLastKey);
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.textContent = 'Daily Challenge';
  } else {
    // still on cooldown, show countdown
    startDailyCountdown(lastMs);
  }
}

// mark that we just finished today's daily run
function markDailyPlayed() {
  const nowMs = Date.now();
  localStorage.setItem(dailyLastKey, String(nowMs));
  startDailyCountdown(nowMs);
}

// timer state
let timerId = null;
let timerRunning = false;
let startTs = 0;
let lastElapsedMs = 0;

// best time storage
const bestKey = 'minesweeper:bestTimeMs';

// popup refs
let goOverlay, goTitle, goTimeText;

// time helpers
function formatTime(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return mm + ':' + ss;
}

function renderTimer(ms) {
  const el = document.getElementById('timer');
  if (el) el.textContent = formatTime(ms);
}

function loadBest() {
  const v = Number(localStorage.getItem(bestKey) || 0);
  const el = document.getElementById('best');
  if (!el) return;
  if (v > 0) el.textContent = formatTime(v);
  else el.textContent = '--:--';
}

function updateBestIfLower(ms) {
  const prev = Number(localStorage.getItem(bestKey) || 0);
  if (prev === 0 || ms < prev) {
    localStorage.setItem(bestKey, String(ms));
    const el = document.getElementById('best');
    if (el) el.textContent = formatTime(ms);
  }
}

async function fetchDailyBest() {
  const label = document.getElementById('daily-best');
  if (!label) return;

  try {
    const res = await fetch('/api/daily/best', { cache: 'no-store' });
    if (!res.ok) {
      label.textContent = 'No winners yet 👀';
      return;
    }

    const data = await res.json();
    if (!data.best) {
      label.textContent = 'No winners yet 👀';
      return;
    }

    const best = data.best;
    const username = best.username || 'player';
    const timeMs = Number(best.timeMs || 0);

    label.textContent = `🏆 Best Today: @${username} – ${formatTime(timeMs)}`;
  } catch (e) {
    console.error('fetchDailyBest error', e);
    const labelSafe = document.getElementById('daily-best');
    if (labelSafe) {
      labelSafe.textContent = 'No winners yet 👀';
    }
  }
}

function startTimer() {
  if (timerRunning) return;
  timerRunning = true;
  startTs = Date.now();
  timerId = setInterval(() => {
    lastElapsedMs = Date.now() - startTs;
    renderTimer(lastElapsedMs);
  }, 200);
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  timerRunning = false;
  lastElapsedMs = Date.now() - startTs;
  renderTimer(lastElapsedMs);
}

// level apply
function applyLevelSettings() {
  minesCount = levels[currentLevel].mines;

  const label = document.getElementById('level-label');
  if (label) label.textContent = currentLevel;

  const minesEl = document.getElementById('mines-count');
  if (minesEl) minesEl.textContent = minesCount;
}

// seed helpers for daily mode
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  return function () {
    h = Math.imul(h ^ h >>> 16, 2246822507);
    h = Math.imul(h ^ h >>> 13, 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function getDailySeedString() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  // seed is date plus current level so each level has its own daily board
  return y + '-' + m + '-' + d + '-' + currentLevel;
}

// auto-pick today's level from the date digits (same for everyone)
function pickDailyLevelForToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  // e.g. "2025", "11", "03" -> "20251103"
  const ds = y.toString() + m + d;

  let sum = 0;
  for (let i = 0; i < ds.length; i++) {
    const ch = ds[i];
    if (ch >= '0' && ch <= '9') {
      sum += Number(ch);
    }
  }

  const idx = sum % levelOrder.length; // levelOrder = ['easy','medium','hard']
  return levelOrder[idx];
}

// hint UI
function updateHintUI() {
  const btn = document.getElementById('hint');
  if (!btn) return;

  // 💡 emoji + remaining hints
  btn.textContent = `💡${hintsLeft}`;

  // dim when out or game over
  if (hintsLeft <= 0 || gameOver) {
    btn.disabled = true;
    btn.style.opacity = '0.5';
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

function useHint() {
  if (gameOver || hintsLeft <= 0) return;

  // if timer not started yet, start it (hint counts as a move)
  if (!timerRunning) {
    startTimer();
  }

  // collect all safe, unrevealed, unflagged tiles
  const candidates = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const tile = board[r][c];
      const id = tile.id;
      if (
        !tile.classList.contains('tile-clicked') &&
        tile.innerText !== '🚩' &&
        !minesLocation.includes(id)
      ) {
        candidates.push(tile);
      }
    }
  }

  if (candidates.length === 0) {
    return; // nothing to hint
  }

  // pick a random safe tile and reveal it
  const tile = candidates[Math.floor(Math.random() * candidates.length)];
  const coords = tile.id.split('-');
  const r = parseInt(coords[0]);
  const c = parseInt(coords[1]);

  playClick();
  checkMine(r, c);

  hintsLeft -= 1;
  if (hintsLeft < 0) hintsLeft = 0;
  updateHintUI();
}

// sounds
const sndClick = new Audio('./click.mp3');
const sndBomb  = new Audio('./over.mp3');
sndClick.volume = 0.6;
sndBomb.volume  = 0.8;
let muted = false;

function playClick() {
  if (!muted) {
    try {
      sndClick.currentTime = 0;
      sndClick.play();
    } catch {}
  }
}
function playBomb() {
  if (!muted) {
    try {
      sndBomb.currentTime = 0;
      sndBomb.play();
    } catch {}
  }
}

// game over popup helper
function showGameOverPopup(kind) {
  if (!goOverlay || !goTitle || !goTimeText) return;

  const shareBtn  = document.getElementById('go-share');
  const replayBtn = document.getElementById('go-replay');

  goOverlay.style.display = 'block';
  goTitle.textContent = kind === 'win' ? 'Congrats 🎉' : 'Game Over';
  goTimeText.textContent = formatTime(lastElapsedMs);

  // share only on win
  if (shareBtn) {
    shareBtn.style.display = kind === 'win' ? 'block' : 'none';
  }

  // replay hidden for daily games, visible for normal games
  if (replayBtn) {
    if (lastGameWasDaily) {
      replayBtn.style.display = 'none';
    } else {
      replayBtn.style.display = 'inline-block';
    }
  }
}

// main setup
window.onload = function () {
  // popup elements
  goOverlay  = document.getElementById('gameover-overlay');
  goTitle    = document.getElementById('go-title');
  goTimeText = document.getElementById('go-time');
  const goHome   = document.getElementById('go-home');
  const goReplay = document.getElementById('go-replay');
  const goShare  = document.getElementById('go-share');

  // best and level
  loadBest();
  applyLevelSettings();

  // level button on home
  const levelBtn = document.getElementById('level-button');
  if (levelBtn) {
    levelBtn.addEventListener('click', () => {
      const idx = levelOrder.indexOf(currentLevel);
      const next = levelOrder[(idx + 1) % levelOrder.length];
      currentLevel = next;
      levelBtn.textContent = 'Level: ' + currentLevel;
      applyLevelSettings();
    });
  }

  // start button normal mode
  const startBtn = document.getElementById('start-button');
  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const home = document.getElementById('home-screen');
      const game = document.getElementById('game-screen');
      dailyMode = false;
      dailySeed = '';
      if (home && game) {
        home.style.display = 'none';
        game.style.display = 'flex';
      }
      startGame();
    });
  }

  // daily challenge button
  const dailyBtn = document.getElementById('daily-button');
  if (dailyBtn) {
    dailyBtn.addEventListener('click', () => {
      // if countdown is running, button is disabled -> do nothing
      if (dailyBtn.disabled) return;

      // pick today's level from the date (same for everyone)
      const todaysLevel = pickDailyLevelForToday();
      currentLevel = todaysLevel;

      // update the level button text on home
      if (levelBtn) {
        levelBtn.textContent = 'Level: ' + currentLevel;
      }

      // apply mines & label for this level
      applyLevelSettings();

      const home = document.getElementById('home-screen');
      const game = document.getElementById('game-screen');

      dailyMode = true;
      dailySeed = getDailySeedString(); // date + current level

      if (home && game) {
        home.style.display = 'none';
        game.style.display = 'flex';
      }

      startGame();
    });
  }

  // hint button
  const hintBtn = document.getElementById('hint');
  if (hintBtn) {
    hintBtn.addEventListener('click', () => {
      useHint();
    });
  }

  // mute button
  const muteBtn = document.getElementById('mute');
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      muted = !muted;
      [sndClick, sndBomb].forEach(s => s.muted = muted);
      muteBtn.textContent = muted ? '🔇' : '🔊';
    });
  }

  // share button in game
  const shareBtn = document.getElementById('share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      try {
        await sdk.actions.composeCast({
          text: 'cleared Minesweeper in ' + document.getElementById('best').textContent + ' - beat me',
          embeds: [{ url: location.origin }]
        });
      } catch {}
    });
  }

  // popup home
  if (goHome) {
    goHome.addEventListener('click', () => {
      if (goOverlay) goOverlay.style.display = 'none';
      const home = document.getElementById('home-screen');
      const game = document.getElementById('game-screen');
      if (home && game) {
        home.style.display = 'flex';
        game.style.display = 'none';
      }
      dailyMode = false;
      dailySeed = '';
      stopTimer();
      lastElapsedMs = 0;
      renderTimer(0);
    });
  }

  // popup replay
  if (goReplay) {
    goReplay.addEventListener('click', () => {
      if (goOverlay) goOverlay.style.display = 'none';
      const home = document.getElementById('home-screen');
      const game = document.getElementById('game-screen');
      if (home && game) {
        home.style.display = 'none';
        game.style.display = 'flex';
      }
      startGame();
    });
  }

  // popup share
  if (goShare) {
    goShare.addEventListener('click', async () => {
      try {
        const level = currentLevel;
        const time = formatTime(lastElapsedMs);
        await sdk.actions.composeCast({
          text: '🧩 cleared Minesweeper (' + level + ') in ' + time + '!',
          embeds: [{ url: location.origin }]
        });
      } catch {}
    });
  }

  // set the correct daily button look on startup
  updateDailyButtonState();

    // load today's best daily time
  fetchDailyBest();
};

// set mines, daily or random
function setMines() {
  minesLocation = [];
  let minesLeft = minesCount;

  let rand = Math.random;
  if (dailyMode) {
    if (!dailySeed) {
      dailySeed = getDailySeedString();
    }
    const seedFn = xmur3(dailySeed);
    const seed = seedFn();
    rand = mulberry32(seed);
  }

  while (minesLeft > 0) {
    const r = Math.floor(rand() * rows);
    const c = Math.floor(rand() * columns);
    const id = r.toString() + '-' + c.toString();
    if (!minesLocation.includes(id)) {
      minesLocation.push(id);
      minesLeft -= 1;
    }
  }
}

function startGame() {
  // remember what type this game is
  lastGameWasDaily = dailyMode;

  // reset state
  board = [];
  minesLocation = [];
  tilesClicked = 0;
  flagEnabled = false;
  gameOver = false;

  hintsLeft = MAX_HINTS;
  stopTimer();
  lastElapsedMs = 0;
  renderTimer(0);
  applyLevelSettings();
  updateHintUI();

  const boardEl = document.getElementById('board');
  if (boardEl) boardEl.innerHTML = '';

  setMines();

  // build tiles
  for (let r = 0; r < rows; r++) {
    let row = [];
    for (let c = 0; c < columns; c++) {
      let tile = document.createElement('div');
      tile.id = r.toString() + '-' + c.toString();
      tile.addEventListener('click', clickTile);
      boardEl.append(tile);
      row.push(tile);
    }
    board.push(row);
  }

  const flagBtn = document.getElementById('flag-button');
  if (flagBtn && !flagBtn._wired) {
    flagBtn.addEventListener('click', setFlag);
    flagBtn._wired = true;
  }
}

function setFlag() {
  const flagBtn = document.getElementById('flag-button');
  flagEnabled = !flagEnabled;
  if (flagBtn) {
    flagBtn.classList.toggle('active', flagEnabled);
  }
}

function clickTile() {
  if (gameOver || this.classList.contains('tile-clicked')) return;

  let tile = this;

  // flag mode
  if (flagEnabled) {
    if (tile.innerText == '') {
      tile.innerText = '🚩';
    } else if (tile.innerText == '🚩') {
      tile.innerText = '';
    }
    return;
  }

  // start timer on first safe tap
  if (!timerRunning && !minesLocation.includes(tile.id)) {
    startTimer();
  }

  // mine hit
  if (minesLocation.includes(tile.id)) {
    playBomb();
    stopTimer();
    gameOver = true;
    revealMines();
    updateHintUI();

    // if this was the daily run, mark today's chance as used
    if (dailyMode) {
      markDailyPlayed();
      updateDailyButtonState();
      dailyMode = false;
    }

    showGameOverPopup('lose');
    return;
  }

  // safe click
  let coords = tile.id.split('-');
  let r = parseInt(coords[0]);
  let c = parseInt(coords[1]);
  playClick();
  checkMine(r, c);
}

function revealMines() {
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      let tile = board[r][c];
      if (minesLocation.includes(tile.id)) {
        tile.innerText = '💣';
        tile.style.backgroundColor = 'red';
      }
    }
  }
}
async function submitDailyResult(timeMs) {
  // for now we send dummy "player" name and no real fid.
  // later we can plug real Farcaster identity here.
  const fid = 0;
  const username = 'player';

  try {
    await fetch('/api/daily/best', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fid, username, timeMs }),
    });

    // refresh the label after submitting
    fetchDailyBest();
  } catch (e) {
    console.error('submitDailyResult error', e);
  }
}

function checkMine(r, c) {
  if (r < 0 || r >= rows || c < 0 || c >= columns) return;
  if (board[r][c].classList.contains('tile-clicked')) return;

  board[r][c].classList.add('tile-clicked');
  tilesClicked += 1;

  let minesFound = 0;

  minesFound += checkTile(r - 1, c - 1);
  minesFound += checkTile(r - 1, c);
  minesFound += checkTile(r - 1, c + 1);

  minesFound += checkTile(r, c - 1);
  minesFound += checkTile(r, c + 1);

  minesFound += checkTile(r + 1, c - 1);
  minesFound += checkTile(r + 1, c);
  minesFound += checkTile(r + 1, c + 1);

  if (minesFound > 0) {
    board[r][c].innerText = minesFound;
    board[r][c].classList.add('x' + minesFound.toString());
  } else {
    board[r][c].innerText = '';

    checkMine(r - 1, c - 1);
    checkMine(r - 1, c);
    checkMine(r - 1, c + 1);

    checkMine(r, c - 1);
    checkMine(r, c + 1);

    checkMine(r + 1, c - 1);
    checkMine(r + 1, c);
    checkMine(r + 1, c + 1);
  }

  // win
  if (tilesClicked == rows * columns - minesCount) {
    const minesEl = document.getElementById('mines-count');
    if (minesEl) minesEl.textContent = 'Congrats 🎉';
    gameOver = true;
    stopTimer();
    updateBestIfLower(lastElapsedMs);

    // if this was the daily run, mark today's chance as used
    if (dailyMode) {
      markDailyPlayed();
      updateDailyButtonState();
      // send this run to the backend for best-of-today
      submitDailyResult(lastElapsedMs);
      dailyMode = false;
    }

    updateHintUI();
    showGameOverPopup('win');
  }
}

function checkTile(r, c) {
  if (r < 0 || r >= rows || c < 0 || c >= columns) return 0;
  if (minesLocation.includes(r.toString() + '-' + c.toString())) return 1;
  return 0;
}
