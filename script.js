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

const MAX_POWER_CHARGES = 2;   // how many uses per round
let powerCharges = 0;          // how many left this round
let powerUnlocked = false;     // becomes true after tx
let powerArmed = false;        // true = next tap uses power

// Base wallet state (for sending tips)
let baseProvider = null;
let currentWalletAddress = null;

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
  body.classList.remove('theme-daily');      // remove daily overlay if any
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

function ensureThemeMusic() {
  if (!currentTheme) return;

  // if no music yet or it is paused, start the current theme loop
  if (!currentMusic || currentMusic.paused) {
    playThemeLoop(currentTheme);
  }
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
span.className = 'fid-name';   // 👈 add a class

// hard cap overlong labels
let labelText = nameText;
const MAX_LABEL_LEN = 14; // you can drop this to 10 if you want it tighter
if (labelText.length > MAX_LABEL_LEN) {
  labelText = labelText.slice(0, MAX_LABEL_LEN - 1) + '…';
}

span.textContent = labelText;

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
  easy:   { mines: 8 },   // relaxing, usually beatable  
  medium: { mines: 14 },  // tension but fair  
  hard:   { mines: 20 },  // real challenge — ~30% clear rate  
  insane: { mines: 28 }
};

const levelOrder = ['easy', 'medium', 'hard', 'insane'];

// short descriptions shown under the Level button
const levelTaglines = {
  easy:   'Warm-up board. Breathe.',
  medium: 'Real game starts here.',
  hard:   'Only about 1 in 3 make it.',
  insane: 'You asked for pain. Good luck.'
};

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
  if (dailyLabelEl) dailyLabelEl.textContent = '📅⚡ Daily Challenge';
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
btn.style.opacity = '0.6';
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
      dailyLabelEl.textContent = '📅⚡ Daily Challenge';
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
      dailyLabelEl.textContent = '📅⚡ Daily Challenge';
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

  // make sure base banner class is present
  label.classList.add('daily-best-banner');

  try {
    const res = await fetch('/api/daily-best', { cache: 'no-store' });
    if (!res.ok) {
label.classList.remove('gold');
label.classList.add('silver');

// new funny & competitive lines
const emptyLines = [
  "No survivors yet. You volunteering? 😏",
  "The board’s undefeated today. Change that. 💣",
  "Zero clears. Infinite shame. Fix it. 😤",
  "No one brave enough… yet. 💀",
  "Leaderboard still empty. Go write your name on it. 🏆",
  "Everyone’s scared of today’s board. Are you? 😈",
  "No clears, no glory. Step up. ⚔️",
  "The mines are bored. Give them a reason to explode. 💥"
];

// pick one based on today's date (so everyone sees the same line)
const dayIndex = new Date().getUTCDate() % emptyLines.length;
label.textContent = emptyLines[dayIndex];

dailyGlobalBestMs = 0;
return;
    }

    const data = await res.json();
    if (!data.best) {
label.classList.remove('gold');
label.classList.add('silver');

// new funny & competitive lines
const emptyLines = [
  "No survivors yet. You volunteering? 😏",
  "The board’s undefeated today. Change that. 💣",
  "Zero clears. Infinite shame. Fix it. 😤",
  "No one brave enough… yet. 💀",
  "Leaderboard still empty. Go write your name on it. 🏆",
  "Everyone’s scared of today’s board. Are you? 😈",
  "No clears, no glory. Step up. ⚔️",
  "The mines are bored. Give them a reason to explode. 💥"
];

// pick one based on today's date (so everyone sees the same line)
const dayIndex = new Date().getUTCDate() % emptyLines.length;
label.textContent = emptyLines[dayIndex];

dailyGlobalBestMs = 0;
return;

    }

    const best = data.best;
    const username = best.username || 'player';
    const timeMs = Number(best.timeMs || 0);

    dailyGlobalBestMs = timeMs;

    // winner state: gold glow
    label.classList.remove('silver');
    label.classList.add('gold');
const lines = [
  `🏁 Fastest clear: @${username} — ${formatTime(timeMs)}`,
  `🔥 Top run today — @${username} in ${formatTime(timeMs)}`,
  `⚡ @${username} leads with ${formatTime(timeMs)}`,
  `🥇 ${formatTime(timeMs)} — @${username} holds the crown`,
  `💣 @${username} defused it in ${formatTime(timeMs)} — beat that`,
  `🚀 @${username} is on top — ${formatTime(timeMs)} flat`,
  `🏆 Today’s #1: @${username} — ${formatTime(timeMs)}`,
  `⚔️ ${formatTime(timeMs)} by @${username} — reigning champ`
];

// pick one based on today’s date (so everyone sees the same for the day)
const dayIndex = new Date().getUTCDate() % lines.length;
label.textContent = lines[dayIndex];

    // also update in game BEST when you are in daily mode
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
label.classList.remove('gold');
label.classList.add('silver');

// new funny & competitive lines
const emptyLines = [
  "No survivors yet. You volunteering? 😏",
  "The board’s undefeated today. Change that. 💣",
  "Zero clears. Infinite shame. Fix it. 😤",
  "No one brave enough… yet. 💀",
  "Leaderboard still empty. Go write your name on it. 🏆",
  "Everyone’s scared of today’s board. Are you? 😈",
  "No clears, no glory. Step up. ⚔️",
  "The mines are bored. Give them a reason to explode. 💥"
];

// pick one based on today's date (so everyone sees the same line)
const dayIndex = new Date().getUTCDate() % emptyLines.length;
label.textContent = emptyLines[dayIndex];

dailyGlobalBestMs = 0;
return;
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

  // in-game HUD label
  const label = document.getElementById('level-label');
  if (label) label.textContent = currentLevel;

  // mines left display
  const minesEl = document.getElementById('mines-count');
  if (minesEl) minesEl.textContent = minesCount;

  // home-screen tagline under Level button
  const tag = document.getElementById('level-tagline');
  if (tag && levelTaglines[currentLevel]) {
    tag.textContent = levelTaglines[currentLevel];
  }
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
else if (currentLevel === 'insane') {
  hud.classList.add('hud-insane');
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

// Power UI
function updatePowerUI() {
  const btn = document.getElementById('power');
  if (!btn) return;

  // reset state classes
  btn.classList.remove('power-armed', 'power-empty', 'power-locked');

  // 🔒 LOCKED (no tx done yet)
  if (!powerUnlocked) {
    btn.textContent = '🔒';
    btn.disabled = false;      // can still be clicked to trigger tx later
    btn.style.opacity = '1';
    btn.classList.add('power-locked');
    return;
  }

  // 📡0 → no charges left
  if (powerCharges <= 0) {
    btn.textContent = '📡0';
    btn.disabled = true;
    btn.style.opacity = '0.5'; // same "faded" effect as Hint
    btn.classList.add('power-empty');
    return;
  }

  // 📡1 / 📡2 → ready
  btn.disabled = false;
  btn.style.opacity = '1';
  btn.textContent = '📡' + powerCharges;

  // when "armed", just glow blue (no emoji change)
  if (powerArmed) {
    btn.classList.add('power-armed');
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

// ---- Base tip helper (mandatory before starting a run) ----
const TIP_ADDRESS = "0xcA1e6B80c545ee50A2941a5f062Be6956D3CeD6E"; // your Base address

async function requireBaseTip(actionLabel, buttonEl, overrideValueHex) {
  // must be inside Farcaster mini app with wallet support
  if (!window.sdk || !window.sdk.wallet) {
    alert("Open in Farcaster Mini App to play (wallet required).");
    return false;
  }

  // 🔹 IMPORTANT: snapshot the REAL markup + disabled state
  const originalHTML = buttonEl.innerHTML;
  const originalDisabled = buttonEl.disabled;

  // show "waiting for tx..." state without destroying layout forever
  buttonEl.disabled = true;
  buttonEl.innerHTML = '<span class="tx-wait">Waiting for tx...</span>';

  try {
    const provider = await window.sdk.wallet.getEthereumProvider();
    if (!provider) {
      alert("No wallet provider found.");
      return false;
    }

    // ensure we have an account
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    if (!accounts || accounts.length === 0) {
      // user closed / refused account selection
      return false;
    }

    const from = accounts[0];

    // default: 0.00001 ETH unless override is passed
    const valueHex = overrideValueHex || "0x9184e72a000";

    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: TIP_ADDRESS,
          value: valueHex,
          chainId: "0x2105"       // Base mainnet
        }
      ]
    });

    console.log("Tip tx result for", actionLabel, txHash);

    if (!txHash) {
      console.warn("No tx hash returned, treating as cancelled.");
      return false;
    }

    // ✅ real hash → user confirmed
    return true;
  } catch (err) {
    console.error("Tip tx error:", err);

    if (err && (err.code === 4001 || err.code === "ACTION_REJECTED")) {
      // user rejected in wallet
      return false;
    }

    alert("Transaction failed. Please try again.");
    return false;
  } finally {
    // 🔹 ALWAYS restore original button (cancel OR confirm)
    buttonEl.disabled = originalDisabled;
    buttonEl.innerHTML = originalHTML;
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

        // skull emoji only for insane
  if (currentLevel === 'insane') {
    levelBtn.textContent = 'Level: 💀 insane';
  } else {
    levelBtn.textContent = 'Level: ' + currentLevel;
  }

      applyLevelSettings();
      updateHudTheme();   // 👈 new
    });
  }

// start button normal mode
const startBtn = document.getElementById('start-button');
if (startBtn) {
  startBtn.addEventListener('click', async () => {
    // 1) require tx first
    const ok = await requireBaseTip('start-normal', startBtn);
    if (!ok) {
      // user rejected / wallet error → do nothing
      return;
    }

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

    updateHudTheme();

    if (home && game) {
      home.style.display = 'none';
      game.style.display = 'flex';
    }

    ensureThemeMusic();
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

dailyBtn.addEventListener('click', async () => {
  // if countdown is running, button is disabled -> do nothing
  if (dailyBtn.disabled) return;

  // 1) require tx first
  const ok = await requireBaseTip('daily-challenge', dailyBtn);
  if (!ok) {
    // user cancelled / failed tx → no daily run
    return;
  }

  // tiny launch pop animation
  dailyBtn.classList.add('daily-launch');
  setTimeout(() => dailyBtn.classList.remove('daily-launch'), 260);

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

  // power button (paid super-hint)
  const powerBtn = document.getElementById('power');
  if (powerBtn) {
    powerBtn.addEventListener('click', async () => {
      // if never unlocked → ask for tx
      if (!powerUnlocked) {
        const ok = await requireBaseTip('power-boost', powerBtn);
        if (!ok) {
          // user cancelled / failed tx → no power
          return;
        }

        // tx ok → grant charges and arm it
        powerUnlocked = true;
        powerCharges = MAX_POWER_CHARGES;
        powerArmed = false;
        updatePowerUI();
        return;
      }

      // already unlocked: toggle armed state (if we still have charges)
      if (powerCharges > 0) {
        powerArmed = !powerArmed;
        updatePowerUI();
      }
    });

    // set initial look
    updatePowerUI();
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

    // leave daily visual mode
    document.body.classList.remove('theme-daily');
    applyTheme(currentTheme);   // restore the users chosen theme

    dailyMode = false;
    dailySeed = '';
    lastGameWasDaily = false;
    stopTimer();
    lastElapsedMs = 0;
    renderTimer(0);
    updateDailyProgress();
    updateHudTheme();
  });
}


// popup replay
if (goReplay) {
  goReplay.addEventListener('click', async () => {
    // 1) require tx first
    const ok = await requireBaseTip('replay', goReplay);
    if (!ok) {
      // cancelled → stay on popup
      return;
    }

    if (goOverlay) goOverlay.style.display = 'none';
    const home = document.getElementById('home-screen');
    const game = document.getElementById('game-screen');
    if (home && game) {
      home.style.display = 'none';
      game.style.display = 'flex';
    }

    ensureThemeMusic();
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
        text: `💣 cleared Minesweeper (${level}) in ${time}! Play here: https://farcaster.xyz/miniapps/0fX1N8Evb5Lg/minesweeper`,
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

    // instructions popup
  const instrBtn = document.getElementById('instructions-button');
  const instrOverlay = document.getElementById('instructions-overlay');
  const instrClose = document.getElementById('instr-close');

  if (instrBtn && instrOverlay) {
    instrBtn.addEventListener('click', () => {
      instrOverlay.style.display = 'flex';
    });
  }

  if (instrClose && instrOverlay) {
    instrClose.addEventListener('click', () => {
      instrOverlay.style.display = 'none';
    });
  }

  // also close instructions if user taps backdrop
  const instrBackdrop = document.querySelector('.instr-backdrop');
  if (instrBackdrop && instrOverlay) {
    instrBackdrop.addEventListener('click', () => {
      instrOverlay.style.display = 'none';
    });
  }

    // load today's best daily time
  fetchDailyBest();

    // load your personal daily best (local)
  loadYourDailyBest();

// ☕ Support Orb – "Buy coffee for dev"
const supportOrb = document.getElementById('support-orb');
if (supportOrb) {
  supportOrb.addEventListener('click', async () => {
    // 0.00075 ETH = 750000000000000 wei = 0x2aa1efb94e000
    const coffeeValueHex = "0x9184e72a000";

    const ok = await requireBaseTip('support-orb', supportOrb, coffeeValueHex);
    if (!ok) return; // cancelled or failed

    // tiny "thanks" feedback
    const textSpan = supportOrb.querySelector('.orb-text');
    const oldText = textSpan ? textSpan.textContent : '';

    supportOrb.classList.add('orb-thanks');
    if (textSpan) textSpan.textContent = 'Thanks for the coffee!';

    setTimeout(() => {
      supportOrb.classList.remove('orb-thanks');
      if (textSpan) textSpan.textContent = oldText || 'Buy coffee for dev';
    }, 1300);
  });
}


// connect wallet button
const walletBtn = document.getElementById('connect-wallet');
const walletAddr = document.getElementById('wallet-address');

if (walletBtn) {
  walletBtn.addEventListener('click', async () => {
    try {
      if (!window.sdk || !window.sdk.wallet) {
        alert('Wallet not available. Try opening in Farcaster Mini App.');
        return;
      }

      // get EIP-1193 provider from Farcaster SDK
      baseProvider = await window.sdk.wallet.getEthereumProvider();
      if (!baseProvider) {
        alert('No wallet provider found.');
        return;
      }

      // ask user to connect
      const accounts = await baseProvider.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) {
        alert('Wallet connection canceled.');
        return;
      }

      const address = accounts[0];
      currentWalletAddress = address; // 👈 remember for later sends

      const short = address.slice(0, 6) + '...' + address.slice(-4);

      walletBtn.textContent = 'Wallet Connected ✅';
      walletAddr.textContent = short;
      walletAddr.style.display = 'block';
      walletBtn.disabled = true;

      console.log('Wallet connected:', address);
    } catch (err) {
      console.error('Wallet connect error:', err);
      alert('Failed to connect wallet.');
    }
  });
}
// load streak value
const streakEl = document.getElementById('daily-streak');
if (streakEl) {
  const streak = Number(localStorage.getItem('minesweeper:dailyStreak') || 0);
  streakEl.textContent = `Streak: 🔥 ${streak}`;
}
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

  // reset power for this round
  powerUnlocked = false;
  powerArmed = false;
  powerCharges = 0;
  updatePowerUI();

  stopTimer();

  lastElapsedMs = 0;
  renderTimer(0);
  applyLevelSettings();
  updateHintUI();
  updateDailyProgress();
  updateHudTheme();   // 👈 add this

  // switch background theme for Daily runs
const body = document.body;
if (lastGameWasDaily) {
  body.classList.add('theme-daily');
} else {
  body.classList.remove('theme-daily');
}

const boardEl = document.getElementById('board');
if (boardEl) {
  boardEl.innerHTML = '';

  // special look when this run is Daily
  boardEl.classList.toggle('board-daily', lastGameWasDaily);
}


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
    // special intro animations for daily games
  if (lastGameWasDaily) {
    const hud = document.getElementById('game-hud');
    const boardEl = document.getElementById('board');

    if (hud) {
      hud.classList.add('hud-daily-intro');
      // remove class after animation so it can play again next time
      setTimeout(() => hud.classList.remove('hud-daily-intro'), 400);
    }

    if (boardEl) {
      boardEl.classList.add('board-daily-intro');
      setTimeout(() => boardEl.classList.remove('board-daily-intro'), 350);
    }
  }
}


function setFlag() {
  const flagBtn = document.getElementById('flag-button');
  flagEnabled = !flagEnabled;
  if (flagBtn) {
    flagBtn.classList.toggle('active', flagEnabled);
  }
}

function usePowerOnTile(tile) {
  // don’t waste a charge on already revealed or flagged tiles
  if (tile.classList.contains('tile-clicked') || tile.innerText === '🚩') {
    return;
  }

  // spend one charge
  powerCharges -= 1;
  if (powerCharges < 0) powerCharges = 0;

  // if this tile is a mine → flag it safely
  if (minesLocation.includes(tile.id)) {
    tile.innerText = '🚩';
  } else {
    // safe tile → reveal like normal
    const coords = tile.id.split('-');
    const r = parseInt(coords[0]);
    const c = parseInt(coords[1]);
    playClick();
    checkMine(r, c);
  }

  // if no charges left, drop out of armed mode
  if (powerCharges <= 0) {
    powerArmed = false;
  }

  updatePowerUI();
}

function clickTile() {
  if (gameOver || this.classList.contains('tile-clicked')) return;

  let tile = this;

  // if power is armed, use it on this tile instead of normal click
  if (powerArmed && powerUnlocked && powerCharges > 0) {
    usePowerOnTile(tile);
    return;
  }

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

// 🔥 Update streak (local only)
const streakKey = 'minesweeper:dailyStreak';
const lastWinKey = 'minesweeper:lastWinDate';
const today = getTodayLocalDateString();

const prevDate = localStorage.getItem(lastWinKey);
let streak = Number(localStorage.getItem(streakKey) || 0);

// if yesterday was last win, continue streak
if (prevDate) {
  const prev = new Date(prevDate);
  const diff = (new Date(today) - prev) / 86400000;
  if (diff === 1) streak += 1;
  else if (diff > 1) streak = 1; // broke streak, restart
} else {
  streak = 1;
}

localStorage.setItem(streakKey, String(streak));
localStorage.setItem(lastWinKey, today);

const streakEl = document.getElementById('daily-streak');
if (streakEl) streakEl.textContent = `Streak: 🔥 ${streak}`;


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
