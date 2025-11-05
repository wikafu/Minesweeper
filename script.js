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
let dailyGlobalBestMs = 0;   // today's best daily time from the server
let dailyFillEl = null;  // yellow charge bar inside Daily button
let dailyLabelEl = null;  // text inside the Daily button


// ---- Daily visual theme (home + game) ----
const THEMES = ['neon', 'desert', 'frost', 'swamp', 'inferno'];
const THEME_KEY = 'minesweeper:theme';  // remember user choice
let currentTheme = null;

function pickTodayTheme() {
  const now = new Date();
  const key =
    now.getUTCFullYear() +
    '-' +
    (now.getUTCMonth() + 1) +
    '-' +
    now.getUTCDate();

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % THEMES.length;
  return THEMES[idx];
}

function applyTheme(theme) {
  const body = document.body;
  THEMES.forEach((t) => body.classList.remove('theme-' + t));
  body.classList.add('theme-' + theme);

  // play theme music
  playThemeLoop(theme);
}

// set + remember theme
function setTheme(theme) {
  currentTheme = theme;
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

// icon for the theme button
function themeIcon(theme) {
  switch (theme) {
    case 'neon':    return '💜';
    case 'desert':  return '🏜️';
    case 'frost':   return '❄️';
    case 'swamp':   return '🌿';
    case 'inferno': return '🔥';
    default:        return '🎨';
  }
}



// ---- THEME MUSIC SYSTEM ----
let currentMusic = null;

function playThemeLoop(theme) {
  // stop old music if playing
  if (currentMusic) {
    try {
      currentMusic.pause();
      currentMusic.currentTime = 0;
    } catch {}
  }

  const path = `/media/theme-${theme}.mp3`;
  const audio = new Audio(path);
  audio.loop = true;

  // use same base + volumeSteps as SFX
  const v = volumeSteps[volumeStepIndex];      // 0, 0.33, 0.66, 1
  audio.volume = BASE_MUSIC_VOL * v;
  audio.muted  = (v === 0) || musicMuted;      // muted if global volume is 0 OR musicMuted is on

  const playPromise = audio.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      console.log('User interaction needed before audio can autoplay');
    });
  }

  currentMusic = audio;
}


// --- background music mute state ---
let musicMuted = false;  // separate from SFX 'muted'

function applyMusicMute() {
  // mute / unmute the current theme music loop
  if (currentMusic) {
    currentMusic.muted = musicMuted;
  }

  // update the home-screen button
  const btn = document.getElementById('music-toggle');
  if (btn) {
    btn.classList.toggle('muted', musicMuted);
    btn.textContent = musicMuted ? '🔇' : '🎵';
  }
}

// ---- Farcaster user (for leaderboard) ----
let currentFid = null;
let currentUsername = null;
let currentPfpUrl = null;   // 👈 new

function updateFidLabel() {
  const el = document.getElementById('player-fid');
  if (!el) return;

  // clear any old content
  el.innerHTML = '';

  // choose username text
  const nameText = currentUsername ? '@' + currentUsername
                    : currentFid != null ? 'FID: ' + currentFid
                    : 'guest';

  // create the avatar circle
const img = document.createElement('img');
img.className = 'fid-avatar';

if (currentPfpUrl) {
  img.src = currentPfpUrl;          // ✅ real avatar from SDK
} else {
  img.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjEyIiByPSI4IiBmaWxsPSIjZmZmIi8+PGNpcmNsZSBjeD0iMTYiIGN5PSIxNiIgcj0iMTUiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLW9wYWNpdHk9IjAuMiIgZmlsbD0iI2ZmZiIgZmlsbC1vcGFjaXR5PSIwLjEiLz48L3N2Zz4='; // simple white circle placeholder
}


  // username text element
  const span = document.createElement('span');
  span.textContent = nameText;

  el.appendChild(img);
  el.appendChild(span);
}



// wait a bit for the sdk to appear (mini app host may inject it late)
async function waitForSdk(maxMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (typeof sdk !== 'undefined' && sdk) {
      return sdk;
    }
    // wait 100ms, then check again
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function initMiniAppUser() {
  const sdkRef = await waitForSdk();

  if (!sdkRef) {
    console.log('Mini App SDK not found after waiting – maybe normal browser');
    // label already says "guest"
    return;
  }

  try {
    // some hosts expose isInMiniApp, some don’t. if missing, just assume true.
    let inMiniApp = true;
    if (typeof sdkRef.isInMiniApp === 'function') {
      inMiniApp = await sdkRef.isInMiniApp();
    }
    console.log('isInMiniApp:', inMiniApp);

    if (!inMiniApp) {
      console.log('Not inside a Mini App, keeping guest FID');
      updateFidLabel();
      return;
    }

    const ctx = await sdkRef.context;
    console.log('Mini App context:', ctx);

if (ctx && ctx.user) {
  currentFid = ctx.user.fid ?? null;
  currentUsername = ctx.user.username ?? null;
  currentPfpUrl = ctx.user.pfpUrl || null;   // 👈 use sdk’s avatar url if present
  console.log('Mini App user:', currentFid, currentUsername, currentPfpUrl);
} else {
  console.log('No user in Mini App context');
}
  } catch (e) {
    console.error('initMiniAppUser error', e);
  }

  // after we tried to load user (success or fail), update the label
  updateFidLabel();
}



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

  const target = getNextResetTimeMs(lastMs);     // when it unlocks
  const totalMs = target - lastMs;              // full cooldown length

  // make sure we're in cooldown visual state
  btn.classList.remove('ready');
  btn.classList.add('cooldown');

  function tick() {
    const now = Date.now();
    const diff = target - now;

if (diff <= 0) {
  clearDailyCountdown();
  localStorage.removeItem(dailyLastKey);

  btn.disabled = false;
  btn.style.opacity = '1';
  if (dailyLabelEl) dailyLabelEl.textContent = 'Daily Challenge';
  btn.classList.remove('cooldown');
  btn.classList.add('ready');

  if (dailyFillEl) {
    dailyFillEl.style.width = '0%';
    dailyFillEl.style.opacity = '0';
  }
  return;
}


    const totalSec = Math.floor(diff / 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');

    // numeric label
btn.disabled = true;
btn.style.opacity = '0.9';
if (dailyLabelEl) {
  dailyLabelEl.textContent = `Next in ${h}:${m}:${s}`;
}


    // how much of the cooldown is done? (0 → 100)
const elapsedMs = totalMs - diff;
const pct = Math.max(0, Math.min(100, Math.round((elapsedMs / totalMs) * 100)));

// make the yellow glass overlay grow
if (dailyFillEl) {
  dailyFillEl.style.width = pct + '%';
}

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
    // never played daily (or cooldown already over)
    clearDailyCountdown();
    btn.disabled = false;
    btn.style.opacity = '1';

    // put the text inside the label span instead of wiping the button
    if (dailyLabelEl) {
      dailyLabelEl.textContent = 'Daily Challenge';
    }

    btn.classList.remove('cooldown');
    btn.classList.add('ready');           // glow when available

        if (dailyFillEl) {
      dailyFillEl.style.width = '0%';
      dailyFillEl.style.opacity = '0';
    }
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

    if (dailyLabelEl) {
      dailyLabelEl.textContent = 'Daily Challenge';
    }

    btn.classList.remove('cooldown');
    btn.classList.add('ready');

  } else {
    // still on cooldown → start countdown & charging bar
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

// best time storage (per difficulty)
const bestKeyPrefix = 'minesweeper:bestTimeMs:';

function getBestKeyForLevel(level) {
  return bestKeyPrefix + level;       // e.g. "minesweeper:bestTimeMs:easy"
}

function getCurrentLevelBestMs() {
  const key = getBestKeyForLevel(currentLevel);
  return Number(localStorage.getItem(key) || 0);
}

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
  const el = document.getElementById('best');
  if (!el) return;

  const v = getCurrentLevelBestMs();
  if (v > 0) {
    el.textContent = formatTime(v);
  } else {
    el.textContent = '--:--';
  }
}

function updateBestIfLower(ms) {
  const key = getBestKeyForLevel(currentLevel);
  const prev = Number(localStorage.getItem(key) || 0);

  if (prev === 0 || ms < prev) {
    localStorage.setItem(key, String(ms));
    const el = document.getElementById('best');
    if (el) el.textContent = formatTime(ms);
  }
}


// ---- personal daily best (local only) ----
const dailyLocalBestPrefix = 'minesweeper:dailyBestLocal:';
const dailyLostKey = 'minesweeper:dailyLostToday'; // mark if user lost today's challenge

function getTodayLocalDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`; // e.g. "2025-11-03"
}

function getTodayLocalBestKey() {
  return dailyLocalBestPrefix + getTodayLocalDateString();
}

function loadYourDailyBest() {
  const el = document.getElementById('daily-your');
  if (!el) return;

  const lost = localStorage.getItem(dailyLostKey) === getTodayLocalDateString();
  const raw = localStorage.getItem(getTodayLocalBestKey());
  const ms = Number(raw || 0);

  if (lost) {
    el.textContent = 'Your best today: LOST';
  } else if (!Number.isFinite(ms) || ms <= 0) {
    el.textContent = 'Your best today: --:--';
  } else {
    el.textContent = 'Your best today: ' + formatTime(ms);
  }
}


function maybeUpdateYourDailyBest(ms) {
  const key = getTodayLocalBestKey();
  const prevRaw = localStorage.getItem(key);
  const prev = Number(prevRaw || 0);

  if (prev === 0 || ms < prev) {
    localStorage.setItem(key, String(ms));
  }
  loadYourDailyBest();
}

async function fetchDailyBest() {
  const label = document.getElementById('daily-best');
  if (!label) return;

  try {
    const res = await fetch('/api/daily-best', { cache: 'no-store' });
    if (!res.ok) {
      label.textContent = 'No one cleared today. Be the first. 👀';
      dailyGlobalBestMs = 0;
      return;
    }

    const data = await res.json();
    if (!data.best) {
      label.textContent = 'No one cleared today. Be the first. 👀';
      dailyGlobalBestMs = 0;
      return;
    }

    const best = data.best;
    const username = best.username || 'player';
    const timeMs = Number(best.timeMs || 0);

    dailyGlobalBestMs = timeMs; // 👈 remember today’s winner time

    // text on home screen
    label.textContent = `🏆 Best Today: @${username} – ${formatTime(timeMs)}`;

    // if we are currently in daily mode, also update the header BEST
    if (dailyMode || lastGameWasDaily) {
      const bestSpan = document.getElementById('best');
      if (bestSpan) {
        if (dailyGlobalBestMs > 0) {
          bestSpan.textContent = formatTime(dailyGlobalBestMs);
        } else {
          bestSpan.textContent = '--:--';
        }
      }
    }
  } catch (e) {
    console.error('fetchDailyBest error', e);
    const labelSafe = document.getElementById('daily-best');
    if (labelSafe) {
      labelSafe.textContent = 'No one cleared today. Be the first. 👀';
    }
    dailyGlobalBestMs = 0;
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

function updateHudTheme() {
  const hud = document.getElementById('game-hud');
  if (!hud) return;

  hud.classList.remove('hud-normal', 'hud-daily', 'hud-hard');

  // daily mode = blue glow
  if (dailyMode || lastGameWasDaily) {
    hud.classList.add('hud-daily');
  }
  // hard level (non-daily) = red glow
  else if (currentLevel === 'hard') {
    hud.classList.add('hud-hard');
  }
  // everything else = purple glow
  else {
    hud.classList.add('hud-normal');
  }
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

  // update the tiny daily progress bar
function updateDailyProgress() {
  const wrap  = document.getElementById('daily-progress-wrap');
  const label = document.getElementById('daily-progress-label');
  const bar   = document.getElementById('daily-progress-bar');
  if (!wrap || !label || !bar) return;

  // only show in daily games
  if (!dailyMode && !lastGameWasDaily) {
    wrap.style.display = 'none';
    return;
  }

  const totalSafe = rows * columns - minesCount; // tiles that are not mines
  if (totalSafe <= 0) {
    wrap.style.display = 'none';
    return;
  }

  const pct = Math.min(
    100,
    Math.max(0, Math.round((tilesClicked / totalSafe) * 100))
  );

  wrap.style.display = 'flex';
  label.textContent = 'Daily Progress: ' + pct + '%';
  bar.style.width = pct + '%';
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
const sndWin   = new Audio('./win.mp3');

// base volumes for sfx
const BASE_CLICK_VOL = 0.6;
const BASE_BOMB_VOL  = 0.5;
const BASE_WIN_VOL   = 0.5;
const BASE_MUSIC_VOL = 0.4;   // matches your theme music loop volume

sndClick.volume = BASE_CLICK_VOL;
sndBomb.volume  = BASE_BOMB_VOL;
sndWin.volume   = BASE_WIN_VOL;

// master volume steps (0 = mute, 1 = full)
let volumeStepIndex = 3;                // start at max
const volumeSteps = [0, 0.33, 0.66, 1]; // 🔇, 🔈, 🔉, 🔊


function playClick() {
  try {
    sndClick.currentTime = 0;
    sndClick.play();
  } catch {}
}

function playBomb() {
  try {
    sndBomb.currentTime = 0;
    sndBomb.play();
  } catch {}
}

function playWin() {
  try {
    sndWin.currentTime = 0;
    sndWin.play();
  } catch {}
}

function getVolumeIcon(level) {
  if (level === 0) return '🔇';
  if (level < 0.5) return '🔈';
  if (level < 0.9) return '🔉';
  return '🔊';
}

function applyVolume() {
  const v = volumeSteps[volumeStepIndex];

  // update sfx volumes
  sndClick.volume = BASE_CLICK_VOL * v;
  sndBomb.volume  = BASE_BOMB_VOL  * v;
  sndWin.volume   = BASE_WIN_VOL   * v;

  const muteAll = v === 0;
  sndClick.muted = muteAll;
  sndBomb.muted  = muteAll;
  sndWin.muted   = muteAll;

  // also update theme music if it exists
  if (typeof currentMusic !== 'undefined' && currentMusic) {
    currentMusic.volume = BASE_MUSIC_VOL * v;
    // music is muted if global volume is 0 OR user muted music on home
    currentMusic.muted  = muteAll || musicMuted;
  }


  // update button icon
  const muteBtn = document.getElementById('mute');
  if (muteBtn) {
    muteBtn.textContent = getVolumeIcon(v);
  }
}

// game over popup helper
function showGameOverPopup(kind) {
  if (!goOverlay || !goTitle || !goTimeText) return;

  const shareBtn  = document.getElementById('go-share');
  const replayBtn = document.getElementById('go-replay');

  // random fun messages
  const winMessages = [
    "you cleared the minefield 🧠",
    "flawless victory 😮‍💨",
    "that was clean 🔥",
    "brains > bombs 🧠💣",
    "no mines, no problems 😎",
    "speed and precision 💨",
    "easy clap 🫡",
    "the board never stood a chance 💪",
    "defused like a pro 👏",
    "W run ✅",
    "textbook sweep 📘",
    "zero casualties 👀",
    "surgical with it 🧤",
    "iq over 9000 🧠",
    "one tap master 🎯",
    "clean sheet, no sweat 🧽",
    "that minefield never saw it coming 🚀",
    "another day, another W 💜",
    "silent but deadly… but you were deadlier 😏",
    "efficiency level: god tier ⚡"
  ];

  const loseMessages = [
    "boom… try again 💣",
    "that mine came outta nowhere 😭",
    "kaboom. instant regret 💀",
    "you blinked… and it was over 💣",
    "sneaky little bomb 👀",
    "close one… but no cigar 💨",
    "one tile away from glory 😩",
    "the mine said *hi* first 💥",
    "back to bootcamp, soldier 🪖",
    "💣 game over, commander",
    "your luck ran out faster than the timer ⏱️",
    "mines: 1, you: 0 🧨",
    "tactical fail 😬",
    "almost genius… almost 😔",
    "don’t step there next time 🤦‍♂️",
    "unlucky spawn 😪",
    "who planted that one 😭",
    "that was a setup 💀",
    "friendly fire? nope 💣",
    "rng wasn’t on your side 🎲"
  ];

  const randomLine =
    kind === "win"
      ? winMessages[Math.floor(Math.random() * winMessages.length)]
      : loseMessages[Math.floor(Math.random() * loseMessages.length)];

  // show popup
  goOverlay.style.display = 'block';
  goTitle.textContent = randomLine;
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

window.onload = function () {

  // pick theme: saved one if exists, otherwise today's random
  let savedTheme = null;
  try {
    savedTheme = localStorage.getItem(THEME_KEY);
  } catch {}

  const initialTheme = (savedTheme && THEMES.includes(savedTheme))
    ? savedTheme
    : pickTodayTheme();

  setTheme(initialTheme);

  // popup elements
  goOverlay  = document.getElementById('gameover-overlay');
  goTitle    = document.getElementById('go-title');
  goTimeText = document.getElementById('go-time');
  const goHome   = document.getElementById('go-home');
  const goReplay = document.getElementById('go-replay');
  const goShare  = document.getElementById('go-share');

    // show guest FID by default
  updateFidLabel();

    // try to load Farcaster user info for leaderboard
  initMiniAppUser();

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
      updateHudTheme();   // 👈 new
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
      lastGameWasDaily = false;

// BEST = your local best for this level (normal mode)
const bestSpan = document.getElementById('best');
if (bestSpan) {
  const v = getCurrentLevelBestMs();
  bestSpan.textContent = v > 0 ? formatTime(v) : '--:--';
}

updateHudTheme();   // 👈 add this

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
        // grab the label span
    dailyLabelEl = document.getElementById('daily-label');

    // create the inner fill bar once
    dailyFillEl = document.createElement('div');
    dailyFillEl.id = 'daily-fill';
    dailyBtn.appendChild(dailyFillEl);

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

      // BEST = today's winner time from server (or --:--)
      const bestSpan = document.getElementById('best');
      if (bestSpan) {
        if (dailyGlobalBestMs > 0) {
          bestSpan.textContent = formatTime(dailyGlobalBestMs);
        } else {
          bestSpan.textContent = '--:--';
        }
      }

      updateHudTheme();

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

// volume button (cycles 🔊 → 🔉 → 🔈 → 🔇)
const muteBtn = document.getElementById('mute');
if (muteBtn) {
  muteBtn.addEventListener('click', () => {
    volumeStepIndex = (volumeStepIndex + 1) % volumeSteps.length;
    applyVolume();
  });

  // set initial icon & volume
  applyVolume();
}

  // 🎨 theme button on home: cycles between themes
  const themeBtn = document.getElementById('theme-button');
  if (themeBtn) {
    // set initial icon
    themeBtn.textContent = themeIcon(initialTheme);

    themeBtn.addEventListener('click', () => {
      // move to next theme in the list
      let idx = THEMES.indexOf(currentTheme);
      if (idx === -1) idx = 0;
      const next = THEMES[(idx + 1) % THEMES.length];

      setTheme(next);
      themeBtn.textContent = themeIcon(next);
    });
  }


// share button in game
const shareBtn = document.getElementById('share');
if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    try {
      await sdk.actions.composeCast({
        text: `💣 cleared Minesweeper in ${document.getElementById('best').textContent}! Play here: https://farcaster.xyz/miniapps/0fX1N8Evb5Lg/minesweeper`,
        embeds: [{ url: 'https://farcaster.xyz/miniapps/0fX1N8Evb5Lg/minesweeper' }]
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
      lastGameWasDaily = false;
      stopTimer();
      lastElapsedMs = 0;
      renderTimer(0);
      updateDailyProgress();
      updateHudTheme();   // 👈 add this
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
        text: `🧩 cleared Minesweeper (${level}) in ${time}! Play here: https://farcaster.xyz/miniapps/0fX1N8Evb5Lg/minesweeper`,
        embeds: [{ url: 'https://farcaster.xyz/miniapps/0fX1N8Evb5Lg/minesweeper' }]
      });
    } catch {}
  });
}

  // set the correct daily button look on startup
  updateDailyButtonState();

    // 🎵 Music button click handler
  const musicBtn = document.getElementById('music-toggle');
  if (musicBtn) {
    musicBtn.addEventListener('click', () => {
      musicMuted = !musicMuted;
      applyMusicMute();
    });
    applyMusicMute();
  }

    // load today's best daily time
  fetchDailyBest();

    // load your personal daily best (local)
  loadYourDailyBest();
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
  updateDailyProgress();
  updateHudTheme();   // 👈 add this

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
      localStorage.setItem(dailyLostKey, getTodayLocalDateString());
      markDailyPlayed();
      updateDailyButtonState();
      dailyMode = false;
    }

    pulseBoard('lose');          // 👈 NEW
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

function pulseBoard(kind) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  // remove old class so animation can retrigger
  boardEl.classList.remove('board-pulse-win', 'board-pulse-lose');

  // force reflow so CSS animation restarts
  void boardEl.offsetWidth;

  if (kind === 'win') {
    boardEl.classList.add('board-pulse-win');
  } else if (kind === 'lose') {
    boardEl.classList.add('board-pulse-lose');
  }
}

async function submitDailyResult(timeMs) {
  // use real Farcaster user if we have it, otherwise fall back
  const fid = currentFid != null ? currentFid : 0;
  const username = currentUsername || 'player';

  try {
    await fetch('/api/daily-best', {
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

  updateDailyProgress();

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
      submitDailyResult(lastElapsedMs);
      localStorage.removeItem(dailyLostKey); // 👈 clear loss record
      maybeUpdateYourDailyBest(lastElapsedMs);
      dailyMode = false;
    }


    updateHintUI();
    pulseBoard('win');           // 👈 NEW
    playWin();
    showGameOverPopup('win');
  }
}

function checkTile(r, c) {
  if (r < 0 || r >= rows || c < 0 || c >= columns) return 0;
  if (minesLocation.includes(r.toString() + '-' + c.toString())) return 1;
  return 0;
}
