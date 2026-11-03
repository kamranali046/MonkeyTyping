(function () {
  'use strict';

  const S = window.TypingStorage;
  const settings = S.loadSettings();

  const DEFAULT_SENTENCES = [
    "The quick brown fox jumps over the lazy dog.",
    "Pack my box with five dozen liquor jugs.",
    "How vexingly quick daft zebras jump.",
    "The five boxing wizards jump quickly.",
    "Practice makes perfect, but nobody is perfect, so why practice.",
    "The only way to do great work is to love what you do."
  ];

  function getSentences() {
    return (state.sentences && state.sentences.length) ? state.sentences : DEFAULT_SENTENCES;
  }

  async function fetchSentences() {
    if (location.protocol === 'file:') return; // avoid CORS errors when opened directly
    try {
      const res = await fetch('sentences.txt', { cache: 'no-cache' });
      if (res.ok) {
        const text = await res.text();
        const lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
        if (lines.length) {
          state.sentences = lines;
          state.sentencesLoaded = true;
          return;
        }
      }
    } catch (e) {}
    state.sentences = DEFAULT_SENTENCES.slice();
    state.sentencesLoaded = true;
  }

  // ---------- State ----------
  const state = {
    mode: settings.mode || 'time',
    timeLimit: settings.timeLimit || 30,
    wordCount: settings.wordCount || 25,
    punctuation: settings.punctuation !== false,
    numbers: !!settings.numbers,
    sentences: [],
    sentencesLoaded: false,
    words: [],
    typed: [],
    wordIndex: 0,
    started: false,
    finished: false,
    startTime: 0,
    timerHandle: null,
    historyHandle: null,
    timeLeft: 0,
    wpmHistory: [],
    modalOpen: false
  };

  // ---------- DOM refs ----------
  const wordsEl = document.getElementById('words');
  const wrapperEl = document.getElementById('wordsWrapper');
  const wpmEl = document.getElementById('wpm');
  const accEl = document.getElementById('acc');
  const timerEl = document.getElementById('timer');
  const timerLabelEl = document.getElementById('timerLabel');

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function stripPunct(w) {
    return w.replace(/[.,!?;:'"()\-]/g, '');
  }

  function buildWordPool() {
    const sentences = getSentences();
    const pool = [];
    for (const s of sentences) {
      const ws = s.split(/\s+/).filter(Boolean);
      for (const w of ws) {
        let x = w;
        if (!state.punctuation) x = stripPunct(x);
        if (!x) continue;
        pool.push(x);
      }
    }
    if (state.numbers) {
      for (let i = 0; i < 20; i++) pool.push(String(Math.floor(Math.random() * 1000)));
    }
    return pool;
  }

  function pickSentence() {
    const sentences = getSentences();
    if (!sentences.length) return 'The quick brown fox jumps over the lazy dog.';
    let s = sentences[Math.floor(Math.random() * sentences.length)];
    if (!state.punctuation) {
      s = s.replace(/[.,!?;:'"()\-]/g, '');
    }
    return s;
  }

  function generateTest() {
    const words = [];
    if (state.mode === 'sentence') {
      words.push(...pickSentence().split(/\s+/).filter(Boolean));
    } else {
      const target = state.mode === 'words' ? state.wordCount : 220;
      const sentences = getSentences();
      let attempts = 0;
      while (words.length < target && attempts < 2000) {
        attempts++;
        const s = sentences[Math.floor(Math.random() * sentences.length)] || '';
        let sentence = s;
        if (!state.punctuation) sentence = sentence.replace(/[.,!?;:'"()\-]/g, '');
        const ws = sentence.split(/\s+/).filter(Boolean);
        for (const w of ws) {
          if (words.length < target) words.push(w);
        }
        if (state.numbers && Math.random() < 0.08) {
          words.push(String(Math.floor(Math.random() * 1000)));
        }
      }
      if (state.mode === 'words') words.splice(state.wordCount);
    }
    if (!words.length) words.push('hello', 'world');
    state.words = words;
    state.typed = words.map(() => '');
    state.wordIndex = 0;
    state.started = false;
    state.finished = false;
    state.timeLeft = state.timeLimit;
    state.wpmHistory = [];
    if (state.timerHandle) clearInterval(state.timerHandle);
    if (state.historyHandle) clearInterval(state.historyHandle);
    render();
    updateLiveStats();
  }

  // ---------- Rendering ----------
  function render() {
    let html = '';
    for (let i = 0; i < state.words.length; i++) {
      const target = state.words[i];
      const typed = state.typed[i] || '';
      const isCurrent = i === state.wordIndex;
      const maxLen = Math.max(target.length, typed.length);
      let wordHtml = `<span class="word${isCurrent ? ' current-word' : ''}">`;
      for (let j = 0; j < maxLen; j++) {
        const tChar = j < target.length ? target[j] : '';
        const uChar = j < typed.length ? typed[j] : '';
        let cls = 'char';
        if (j < typed.length) {
          if (j < target.length) {
            cls += (uChar === tChar) ? ' correct' : ' incorrect';
          } else {
            cls += ' extra';
          }
        } else if (isCurrent && j === typed.length) {
          cls += ' current';
        }
        const displayChar = (j < typed.length) ? uChar : tChar;
        wordHtml += `<span class="${cls}">${escapeHtml(displayChar)}</span>`;
      }
      if (isCurrent && typed.length >= target.length) {
        wordHtml += `<span class="char current caret-end"></span>`;
      }
      wordHtml += '</span>';
      if (i < state.words.length - 1) wordHtml += '<span class="space"> </span>';
      html += wordHtml;
    }
    wordsEl.innerHTML = html;

    // scroll
    const curWord = wordsEl.querySelector('.word.current-word');
    if (curWord) {
      wordsEl.style.transform = `translateY(-${curWord.offsetTop}px)`;
    }
  }

  // ---------- Stats ----------
  function elapsedSeconds() {
    if (!state.started) return 0;
    if (state.finished) {
      // use stored? recompute from start to now capped
      return (performance.now() - state.startTime) / 1000;
    }
    if (state.mode === 'time') {
      return state.timeLimit - state.timeLeft;
    }
    return (performance.now() - state.startTime) / 1000;
  }

  function liveStats() {
    let correctChars = 0, incorrect = 0, extra = 0;
    const limit = Math.min(state.wordIndex + 1, state.words.length);
    for (let i = 0; i < limit; i++) {
      const t = state.words[i];
      const u = state.typed[i] || '';
      for (let j = 0; j < u.length; j++) {
        if (j < t.length) {
          if (u[j] === t[j]) correctChars++; else incorrect++;
        } else {
          extra++;
        }
      }
    }
    const elapsed = Math.max(0.001, elapsedSeconds());
    const minutes = elapsed / 60;
    const wpm = Math.round((correctChars / 5) / minutes);
    const total = correctChars + incorrect + extra;
    const acc = total > 0 ? Math.round((correctChars / total) * 100) : 100;
    return { wpm: isFinite(wpm) ? wpm : 0, acc };
  }

  function updateLiveStats() {
    const ls = liveStats();
    wpmEl.textContent = ls.wpm;
    accEl.textContent = ls.acc + '%';
    if (state.mode === 'time') {
      timerEl.textContent = Math.ceil(Math.max(0, state.timeLeft));
      timerLabelEl.textContent = 'time';
    } else if (state.mode === 'words') {
      timerEl.textContent = Math.max(0, state.words.length - state.wordIndex);
      timerLabelEl.textContent = 'words';
    } else {
      timerEl.textContent = Math.max(0, state.words.length - state.wordIndex);
      timerLabelEl.textContent = 'words';
    }
  }

  function computeFinalStats() {
    let correctChars = 0, incorrectChars = 0, extraChars = 0, missedChars = 0, correctWords = 0;
    const completedCount = state.finished ? state.words.length : state.wordIndex + 1;
    for (let i = 0; i < state.words.length; i++) {
      const target = state.words[i];
      const typed = state.typed[i] || '';
      const isCompleted = i < state.wordIndex || (i === state.wordIndex && state.finished);
      for (let j = 0; j < typed.length; j++) {
        if (j < target.length) {
          if (typed[j] === target[j]) correctChars++; else incorrectChars++;
        } else {
          extraChars++;
        }
      }
      if (isCompleted && typed.length < target.length) {
        missedChars += target.length - typed.length;
      }
      if (typed.length > 0 && typed === target) correctWords++;
    }
    const elapsed = Math.max(0.001, elapsedSeconds());
    const minutes = elapsed / 60;
    const wpm = Math.round((correctChars / 5) / minutes);
    const rawWpm = Math.round(((correctChars + incorrectChars + extraChars) / 5) / minutes);
    const total = correctChars + incorrectChars + extraChars + missedChars;
    const acc = total > 0 ? Math.round((correctChars / total) * 100) : 100;
    return {
      wpm: isFinite(wpm) ? wpm : 0,
      rawWpm: isFinite(rawWpm) ? rawWpm : 0,
      acc,
      correctChars, incorrectChars, extraChars, missedChars,
      correctWords,
      elapsed: Math.round(elapsed * 100) / 100,
      history: state.wpmHistory.slice()
    };
  }

  // ---------- Test flow ----------
  function startTest() {
    if (state.started || state.finished) return;
    state.started = true;
    state.startTime = performance.now();
    state.timeLeft = state.timeLimit;
    if (state.mode === 'time') {
      state.timerHandle = setInterval(function () {
        const now = performance.now();
        state.timeLeft = state.timeLimit - (now - state.startTime) / 1000;
        if (state.timeLeft <= 0) {
          state.timeLeft = 0;
          finishTest();
        }
        updateLiveStats();
      }, 100);
    } else {
      state.timerHandle = setInterval(updateLiveStats, 200);
    }
    state.historyHandle = setInterval(function () {
      if (state.finished) return;
      const ls = liveStats();
      state.wpmHistory.push(ls.wpm);
    }, 1000);
  }

  function finishTest() {
    if (state.finished) return;
    state.finished = true;
    if (state.timerHandle) { clearInterval(state.timerHandle); state.timerHandle = null; }
    if (state.historyHandle) { clearInterval(state.historyHandle); state.historyHandle = null; }
    render();
    updateLiveStats();
    showResults(computeFinalStats());
  }

  function restart() {
    closeResults();
    generateTest();
  }

  // ---------- Input handlers ----------
  function handleChar(ch) {
    if (state.modalOpen) return;
    if (state.finished) return;
    if (!state.started) startTest();
    const i = state.wordIndex;
    if (i >= state.words.length) return;
    state.typed[i] = (state.typed[i] || '') + ch;
    render();
    updateLiveStats();
    playClick();
    // auto-finish last word in words/sentence mode if fully & correctly typed? require space; do nothing
  }

  function handleSpace() {
    if (state.modalOpen) return;
    if (state.finished) return;
    if (!state.started) startTest();
    const i = state.wordIndex;
    if (i >= state.words.length) return;
    if (i + 1 < state.words.length) {
      state.wordIndex = i + 1;
      render();
      updateLiveStats();
    } else {
      finishTest();
    }
  }

  function handleBackspace() {
    if (state.modalOpen) return;
    if (state.finished) return;
    if (!state.started) return;
    const i = state.wordIndex;
    if ((state.typed[i] || '').length > 0) {
      state.typed[i] = state.typed[i].slice(0, -1);
    } else if (i > 0) {
      state.wordIndex = i - 1;
      const p = state.wordIndex;
      if ((state.typed[p] || '').length > 0) {
        state.typed[p] = state.typed[p].slice(0, -1);
      }
    }
    render();
    updateLiveStats();
  }

  document.addEventListener('keydown', function (e) {
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (state.modalOpen) {
      if (e.key === 'Escape') closeTopModal();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      restart();
      return;
    }
    if (e.key === 'Escape') {
      // open settings? no, just blur
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      handleBackspace();
      return;
    }
    if (e.key === ' ') {
      e.preventDefault();
      handleSpace();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      return;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      handleChar(e.key);
    }
  });

  // ---------- Modals ----------
  function openModal(id) {
    state.modalOpen = true;
    document.getElementById(id).classList.add('open');
    document.getElementById(id).parentElement.classList.add('open');
  }
  function closeModal(id) {
    state.modalOpen = false;
    document.getElementById(id).parentElement.classList.remove('open');
  }
  function closeTopModal() {
    const open = document.querySelector('.modal-overlay.open');
    if (open) {
      open.classList.remove('open');
      state.modalOpen = false;
    }
  }
  window.closeSettingsModal = function () { closeModal('settingsModal'); };
  window.closeResultsModal = function () { closeResults(); };

  // settings modal wiring
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsOverlay = document.getElementById('settingsOverlay');
  settingsBtn.addEventListener('click', function () {
    syncSettingsUI();
    openModal('settingsModal');
  });
  settingsOverlay.addEventListener('click', function (e) {
    if (e.target === settingsOverlay) closeModal('settingsModal');
  });

  function syncSettingsUI() {
    document.getElementById('themeSelect').value = settings.theme;
    document.getElementById('fontSizeRange').value = settings.fontSize;
    document.getElementById('fontSizeVal').textContent = settings.fontSize.toFixed(1);
    document.getElementById('soundToggle').checked = settings.sound;
    document.getElementById('punctToggle').checked = state.punctuation;
    document.getElementById('numbersToggle').checked = state.numbers;
    document.getElementById('modeSelect').value = state.mode;
    document.getElementById('timeSelect').value = state.timeLimit;
    document.getElementById('wordsSelect').value = state.wordCount;
    toggleModeOptions();
  }

  function toggleModeOptions() {
    const m = document.getElementById('modeSelect').value;
    document.getElementById('timeOptionsModal').style.display = m === 'time' ? '' : 'none';
    document.getElementById('wordsOptionsModal').style.display = m === 'words' ? '' : 'none';
  }
  document.getElementById('modeSelect').addEventListener('change', toggleModeOptions);

  document.getElementById('fontSizeRange').addEventListener('input', function (e) {
    document.getElementById('fontSizeVal').textContent = parseFloat(e.target.value).toFixed(1);
  });

  document.getElementById('applySettings').addEventListener('click', function () {
    settings.theme = document.getElementById('themeSelect').value;
    settings.fontSize = parseFloat(document.getElementById('fontSizeRange').value);
    settings.sound = document.getElementById('soundToggle').checked;
    state.punctuation = document.getElementById('punctToggle').checked;
    state.numbers = document.getElementById('numbersToggle').checked;
    state.mode = document.getElementById('modeSelect').value;
    state.timeLimit = parseInt(document.getElementById('timeSelect').value, 10);
    state.wordCount = parseInt(document.getElementById('wordsSelect').value, 10);
    settings.punctuation = state.punctuation;
    settings.numbers = state.numbers;
    settings.mode = state.mode;
    settings.timeLimit = state.timeLimit;
    settings.wordCount = state.wordCount;
    S.saveSettings(settings);
    applySettings();
    // sync top bar
    const pt = document.getElementById('punctToggleTop');
    const nt = document.getElementById('numbersToggleTop');
    if (pt) pt.checked = state.punctuation;
    if (nt) nt.checked = state.numbers;
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-mode') === state.mode);
    });
    document.querySelectorAll('[data-time]').forEach(function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-time'),10) === state.timeLimit);
    });
    document.querySelectorAll('[data-words]').forEach(function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-words'),10) === state.wordCount);
    });
    const to = document.getElementById('timeOptions'); const wo = document.getElementById('wordsOptions');
    if (to) to.style.display = state.mode === 'time' ? '' : 'none';
    if (wo) wo.style.display = state.mode === 'words' ? '' : 'none';
    closeModal('settingsModal');
    generateTest();
  });

  function applySettings() {
    document.documentElement.setAttribute('data-theme', settings.theme);
    document.documentElement.style.setProperty('--word-font-size', settings.fontSize + 'rem');
  }

  // ---------- Results ----------
  const resultsOverlay = document.getElementById('resultsOverlay');
  function showResults(stats) {
    document.getElementById('resWpm').textContent = stats.wpm;
    document.getElementById('resRaw').textContent = stats.rawWpm;
    document.getElementById('resAcc').textContent = stats.acc + '%';
    document.getElementById('resCorrect').textContent = stats.correctChars;
    document.getElementById('resIncorrect').textContent = stats.incorrectChars;
    document.getElementById('resExtra').textContent = stats.extraChars;
    document.getElementById('resMissed').textContent = stats.missedChars;
    document.getElementById('resTime').textContent = stats.elapsed + 's';
    drawChart(stats.history);
    openModal('resultsModal');
  }
  function closeResults() {
    const ov = document.getElementById('resultsOverlay');
    if (ov.classList.contains('open')) {
      ov.classList.remove('open');
      state.modalOpen = false;
    }
  }
  document.getElementById('resultsOverlay').addEventListener('click', function (e) {
    if (e.target === resultsOverlay) closeResults();
  });
  document.getElementById('restartBtn').addEventListener('click', function () {
    closeResults();
    restart();
  });

  function drawChart(history) {
    const canvas = document.getElementById('resultsChart');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);
    if (!history || !history.length) return;
    const max = Math.max(10, ...history);
    const pad = 20;
    // axes
    ctx.strokeStyle = 'rgba(128,128,128,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, pad); ctx.lineTo(pad, H - pad); ctx.lineTo(W - pad, H - pad);
    ctx.stroke();
    // line
    const mainColor = getComputedStyle(document.documentElement).getPropertyValue('--main').trim() || '#e2b714';
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    history.forEach((v, i) => {
      const x = pad + (i / Math.max(1, history.length - 1)) * (W - pad * 2);
      const y = H - pad - (v / max) * (H - pad * 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // dots
    ctx.fillStyle = mainColor;
    history.forEach((v, i) => {
      const x = pad + (i / Math.max(1, history.length - 1)) * (W - pad * 2);
      const y = H - pad - (v / max) * (H - pad * 2);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // ---------- Sound ----------
  let audioCtx = null;
  function playClick() {
    if (!settings.sound) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'square';
      o.frequency.value = 600;
      g.gain.value = 0.03;
      o.connect(g); g.connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + 0.03);
    } catch (e) {}
  }

  // ---------- Init ----------
  fetchSentences().then(function () {
    applySettings();
    generateTest();
  });

  // focus hint
  wordsEl.addEventListener('click', function () {
    // ensure no input focused
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });

  // expose restart for debugging
  window.restartTest = restart;
})();
