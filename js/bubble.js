(function () {
  'use strict';

  // Apply shared settings (theme, font size) from the typing test
  try {
    const s = (window.TypingStorage && window.TypingStorage.loadSettings) ? window.TypingStorage.loadSettings() : null;
    if (s) {
      document.documentElement.setAttribute('data-theme', s.theme || 'dark');
      document.documentElement.style.setProperty('--word-font-size', (s.fontSize || 1.6) + 'rem');
    }
  } catch (e) {}

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  const MODE_KEY = 'bubble.mode.v1';
  let gameMode = localStorage.getItem(MODE_KEY) || 'words';
  const DUR_KEY = 'bubble.duration.v1';
  let gameDuration = parseInt(localStorage.getItem(DUR_KEY) || '60', 10);
  const DIFF_KEY = 'bubble.difficulty.v1';
  let gameDifficulty = localStorage.getItem(DIFF_KEY) || 'hard';
  const LIVES_KEY = 'bubble.lives.v1';
  let gameLives = localStorage.getItem(LIVES_KEY) || 'auto';

  function diffParams() {
    if (gameDifficulty === 'easy') return { speedMul: 0.7, spawnMul: 1.4, lives: 5 };
    if (gameDifficulty === 'pro') return { speedMul: 1.4, spawnMul: 0.7, lives: 1 };
    return { speedMul: 1.0, spawnMul: 1.0, lives: 3 };
  }
  function resolveLives() {
    if (gameLives === 'auto') return diffParams().lives;
    const n = parseInt(gameLives, 10);
    if (isNaN(n)) return diffParams().lives;
    return n; // 0 = unlimited
  }

  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const levelEl = document.getElementById('level');
  const timeLeftEl = document.getElementById('timeLeft');
  const highEl = document.getElementById('highscore');
  const inputEl = document.getElementById('inputDisplay');
  const startScreen = document.getElementById('startScreen');
  const gameOverScreen = document.getElementById('gameOverScreen');
  const finalScoreEl = document.getElementById('finalScore');

  const HS_KEY = 'bubble.highscore.v1';
  let highScore = parseInt(localStorage.getItem(HS_KEY) || '0', 10) || 0;
  highEl.textContent = highScore;

  // Word pool
  let wordPool = ['type', 'code', 'play', 'game', 'fast', 'word', 'bubble', 'burst'];
  async function loadWords() {
    if (location.protocol === 'file:') return; // avoid CORS errors when opened directly
    try {
      const res = await fetch('sentences.txt', { cache: 'no-cache' });
      if (res.ok) {
        const text = await res.text();
        const words = text.split(/\s+/).map(function (w) { return w.replace(/[^a-zA-Z]/g, ''); }).filter(function (w) { return w.length >= 3 && w.length <= 9; });
        const unique = Array.from(new Set(words.map(function (w) { return w.toLowerCase(); })));
        if (unique.length > 20) wordPool = unique;
      }
    } catch (e) {}
  }

  // Game state
  let bubbles = [];
  let particles = [];
  let input = '';
  let active = null;
  let score = 0;
  let lives = 3;
  let level = 1;
  let running = false;
  let spawnTimer = 0;
  let spawnInterval = 1800; // ms
  let speedBase = 0.6;
  let lastTime = 0;
  let rafId = null;
  let timeLeft = 0;
  let timerHandle = null;

  const colors = ['#f7c5cc', '#c9e4de', '#f9e79f', '#d5e8f7', '#e8d5f7', '#fce4d6', '#d6f0e0', '#fde2e4', '#e2f0cb', '#d9e2f3', '#f3e5f5', '#e0f7fa', '#fff3e0', '#f1f8e9', '#fce4ec'];

  const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');
  function randWord() {
    if (gameMode === 'letters') {
      return LETTERS[Math.floor(Math.random() * LETTERS.length)];
    }
    if (gameMode === 'mixed') {
      if (Math.random() < 0.4) {
        return LETTERS[Math.floor(Math.random() * LETTERS.length)];
      }
      return wordPool[Math.floor(Math.random() * wordPool.length)];
    }
    return wordPool[Math.floor(Math.random() * wordPool.length)];
  }

  function spawnBubble() {
    const word = randWord();
    const radius = word.length <= 1 ? 24 : 28 + word.length * 4;
    const x = radius + Math.random() * (W - radius * 2);
    const speed = speedBase + Math.random() * 0.4 + (level - 1) * 0.15;
    bubbles.push({
      x: x, y: H + radius,
      word: word, typed: '',
      radius: radius, speed: speed,
      color: colors[Math.floor(Math.random() * colors.length)],
      wobble: Math.random() * Math.PI * 2,
      wobbleSpeed: 0.01 + Math.random() * 0.02,
      bursting: false, burstT: 0
    });
  }

  function burstBubble(b, success) {
    b.bursting = true;
    b.burstT = 0;
    if (success) {
      score += b.word.length * 10;
      // particles
      for (let i = 0; i < 16; i++) {
        const ang = (Math.PI * 2 * i) / 16;
        particles.push({
          x: b.x, y: b.y,
          vx: Math.cos(ang) * (2 + Math.random() * 3),
          vy: Math.sin(ang) * (2 + Math.random() * 3),
          life: 1, color: b.color, size: 3 + Math.random() * 3
        });
      }
      if (score > highScore) { highScore = score; localStorage.setItem(HS_KEY, highScore); highEl.textContent = highScore; }
    }
    updateHUD();
  }

  function updateHUD() {
    scoreEl.textContent = score;
    livesEl.textContent = (lives === Infinity) ? '∞' : lives;
    levelEl.textContent = level;
  }

  function findTarget(char) {
    // prefer active bubble if still valid
    if (active && active.word.startsWith(input + char) && !active.bursting) {
      return active;
    }
    // find bubbles (not bursting) whose word starts with char, pick nearest to top (most urgent)
    let candidates = bubbles.filter(function (b) { return !b.bursting && b.word.startsWith(char); });
    if (!candidates.length) return null;
    // sort by y ascending (top first)
    candidates.sort(function (a, b) { return a.y - b.y; });
    return candidates[0];
  }

  function handleChar(ch) {
    if (!running) return;
    if (!/^[a-zA-Z]$/.test(ch)) return;
    ch = ch.toLowerCase();
    // try to extend active
    if (active && !active.bursting && active.word.startsWith(input + ch)) {
      input += ch;
    } else {
      const t = findTarget(ch);
      if (t) {
        active = t;
        input = ch;
      } else {
        // no match; reset
        input = '';
        active = null;
        return;
      }
    }
    inputEl.textContent = input;
    // check burst
    if (active && input === active.word) {
      burstBubble(active, true);
      bubbles = bubbles.filter(function (b) { return b !== active; });
      input = '';
      active = null;
      inputEl.textContent = '';
    }
  }

  function handleBackspace() {
    if (!running) return;
    if (input.length > 0) {
      input = input.slice(0, -1);
      if (input === '') { active = null; }
      inputEl.textContent = input;
    }
  }

  function update(dt) {
    if (!running) return;
    // spawn
    spawnTimer += dt;
    if (spawnTimer >= spawnInterval) {
      spawnTimer = 0;
      spawnBubble();
    }
    // difficulty ramp
    const targetLevel = 1 + Math.floor(score / 300);
    if (targetLevel > level) {
      level = targetLevel;
      const dp = diffParams();
      spawnInterval = Math.max(300, Math.round((1200 - (level - 1) * 150) * dp.spawnMul));
      speedBase = Math.min(2.5 * dp.speedMul, (0.7 + (level - 1) * 0.1) * dp.speedMul);
      updateHUD();
    }

    // update bubbles
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (b.bursting) {
        b.burstT += dt / 300;
        if (b.burstT >= 1) bubbles.splice(i, 1);
        continue;
      }
      b.y -= b.speed * (dt / 16);
      b.wobble += b.wobbleSpeed * (dt / 16);
      b.x += Math.sin(b.wobble) * 0.3;
      // escape top
      if (b.y + b.radius < 0) {
        bubbles.splice(i, 1);
        if (b === active) { active = null; input = ''; inputEl.textContent = ''; }
        if (lives !== Infinity) {
          lives--;
          updateHUD();
          if (lives <= 0) endGame();
        }
      }
    }
    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.1;
      p.life -= dt / 600;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // background gradient-ish
    // bubbles
    for (const b of bubbles) {
      if (b.bursting) {
        const s = 1 + b.burstT * 1.5;
        ctx.globalAlpha = 1 - b.burstT;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius * s, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      // bubble body
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(b.x - b.radius * 0.3, b.y - b.radius * 0.3, 2, b.x, b.y, b.radius);
      grad.addColorStop(0, 'rgba(255,255,255,0.35)');
      grad.addColorStop(1, b.color);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.2)';
      ctx.lineWidth = 2;
      ctx.stroke();
      // word
      const word = b.word;
      ctx.fillStyle = '#1a1a1a';
      ctx.font = 'bold ' + (word.length <= 1 ? 22 : 16) + 'px "Roboto Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // highlight typed prefix
      const typed = (b === active) ? input : '';
      if (typed && word.startsWith(typed)) {
        const prefix = typed;
        const rest = word.slice(typed.length);
        const prefixW = ctx.measureText(prefix).width;
        const restW = ctx.measureText(rest).width;
        const totalW = prefixW + restW;
        let x = b.x - totalW / 2;
        ctx.fillStyle = '#1a1a1a';
        ctx.globalAlpha = 0.4;
        ctx.fillText(prefix, x + prefixW / 2, b.y);
        ctx.globalAlpha = 1;
        ctx.fillText(rest, x + prefixW + restW / 2, b.y);
      } else {
        ctx.fillStyle = '#1a1a1a';
        ctx.fillText(word, b.x, b.y);
      }
    }
    // particles
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function loop(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min(40, ts - lastTime);
    lastTime = ts;
    update(dt);
    draw();
    if (running) rafId = requestAnimationFrame(loop);
  }

  function startGame() {
    bubbles = [];
    particles = [];
    input = '';
    active = null;
    score = 0;
    const dp = diffParams();
    const rl = resolveLives();
    lives = (rl === 0) ? Infinity : rl;
    level = 1;
    spawnTimer = 0;
    spawnInterval = Math.round(1200 * dp.spawnMul);
    speedBase = 0.7 * dp.speedMul;
    lastTime = 0;
    running = true;
    timeLeft = gameDuration;
    if (timerHandle) clearInterval(timerHandle);
    if (gameDuration > 0) {
      timeLeftEl.textContent = gameDuration;
      timerHandle = setInterval(function () {
        if (!running) return;
        timeLeft--;
        if (timeLeft <= 0) {
          timeLeft = 0;
          timeLeftEl.textContent = 0;
          endGame();
        } else {
          timeLeftEl.textContent = timeLeft;
        }
      }, 1000);
    } else {
      timeLeftEl.textContent = '∞';
    }
    inputEl.textContent = '';
    // spawn a few immediately for playability
    spawnBubble();
    spawnBubble();
    spawnBubble();
    spawnBubble();
    spawnBubble();
    startScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    updateHUD();
    rafId = requestAnimationFrame(loop);
  }

  function endGame() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    finalScoreEl.textContent = 'score: ' + score + (score >= highScore && score > 0 ? ' (new best!)' : '');
    gameOverScreen.classList.remove('hidden');
  }

  // Input
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (running) { running = false; if (rafId) cancelAnimationFrame(rafId); location.href = 'index.html'; }
      return;
    }
    if (!running) {
      if (e.key === 'Enter') {
        if (!gameOverScreen.classList.contains('hidden') || !startScreen.classList.contains('hidden')) {
          startGame();
        }
      }
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      handleBackspace();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      return;
    }
    if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      handleChar(e.key);
    }
  });

  const modeSelect = document.getElementById('modeSelect');
  if (modeSelect) {
    modeSelect.value = gameMode;
    modeSelect.addEventListener('change', function (e) {
      e.stopPropagation();
      gameMode = modeSelect.value;
      localStorage.setItem(MODE_KEY, gameMode);
      if (running) startGame();
    });
    modeSelect.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  const durationSelect = document.getElementById('durationSelect');
  if (durationSelect) {
    durationSelect.value = String(gameDuration);
    durationSelect.addEventListener('change', function (e) {
      e.stopPropagation();
      gameDuration = parseInt(durationSelect.value, 10) || 0;
      localStorage.setItem(DUR_KEY, gameDuration);
      if (running) startGame();
    });
    durationSelect.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  const difficultySelect = document.getElementById('difficultySelect');
  if (difficultySelect) {
    difficultySelect.value = gameDifficulty;
    difficultySelect.addEventListener('change', function (e) {
      e.stopPropagation();
      gameDifficulty = difficultySelect.value;
      localStorage.setItem(DIFF_KEY, gameDifficulty);
      if (running) startGame();
    });
    difficultySelect.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  const livesSelect = document.getElementById('livesSelect');
  if (livesSelect) {
    livesSelect.value = gameLives;
    livesSelect.addEventListener('change', function (e) {
      e.stopPropagation();
      gameLives = livesSelect.value;
      localStorage.setItem(LIVES_KEY, gameLives);
      if (running) startGame();
    });
    livesSelect.addEventListener('click', function (e) { e.stopPropagation(); });
  }
  document.getElementById('startBtn').addEventListener('click', function (e) { e.stopPropagation(); startGame(); });
  document.getElementById('restartBtn').addEventListener('click', function (e) { e.stopPropagation(); startGame(); });
  startScreen.addEventListener('click', startGame);
  gameOverScreen.addEventListener('click', function (e) { if (e.target === gameOverScreen) startGame(); });

  // init
  loadWords().then(function () {
    // ready
  });
  window.startBubble = startGame;
})();
