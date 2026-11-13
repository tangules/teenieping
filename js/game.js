// 전체 티니핑 이름에서 추출한 고유 한글 음절 목록 ('핑' 제외, 글자 카드 오답 보기용)
const ALL_SYLLABLES = Array.from(
  new Set(
    TEENIEPINGS.flatMap(item => Array.from(item.name)).filter(ch => ch.trim() !== '' && ch !== '핑')
  )
);

let selectedLimit = 10;
let ttsEnabled = true;
let currentSeasonMode = 'all';
let pool = [];
let questions = [];
let currentIndex = 0;
let score = 0;
let answeredCurrent = false;
let selectedChoiceName = null;
let learnedList = [];
let autoNextTimer = null;
let countdownInterval = null;
let celebrateTimer = null;

// 2단계 글자 맞추기 퍼즐 상태
let puzzleSlots = [];       // [{ char: '꼼', fixed: false, filled: false }, { char: '딱', ... }, { char: '핑', fixed: true, filled: true }]
let puzzleTargetIndex = 0;  // 현재 맞춰야 할 슬롯 인덱스

function clearAutoNextTimers() {
  if (autoNextTimer) {
    clearTimeout(autoNextTimer);
    autoNextTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
  if (celebrateTimer) {
    clearTimeout(celebrateTimer);
    celebrateTimer = null;
  }
}

function initDecor() {
  const decor = document.getElementById('bg-decor');
  const icons = ['💖', '⭐', '🌸', '✨', '🎀', '💎', '👑'];
  for (let i = 0; i < 14; i++) {
    const span = document.createElement('span');
    span.className = 'floating-icon';
    span.textContent = icons[i % icons.length];
    span.style.left = (Math.random() * 96) + 'vw';
    span.style.animationDuration = (9 + Math.random() * 8) + 's';
    span.style.animationDelay = (-Math.random() * 12) + 's';
    decor.appendChild(span);
  }
}
initDecor();

const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function playSound(type) {
  try {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    if (type === 'correct') {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        gain.gain.setValueAtTime(0.22, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.28);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.28);
      });
    } else if (type === 'pop') {
      // 글자 카드가 빈칸에 쏙 들어갈 때의 경쾌한 퐁! 효과음
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.14);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } else if (type === 'wrong') {
      // 글자 카드가 틀려서 진동하며 튕겨나갈 때의 통통 부저 효과음
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.linearRampToValueAtTime(140, now + 0.22);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'fanfare') {
      const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
      notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0.22, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.35);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.35);
      });
    }
  } catch (e) {}
}

let currentAudio = null;

function stopCurrentVoice() {
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch (e) {}
    currentAudio = null;
  }
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
}

function fallbackSpeak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 1.05;
    utter.pitch = 1.65;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function playVoiceFile(relPath, fallbackText, force = false) {
  if (!ttsEnabled && !force) return;
  stopCurrentVoice();
  try {
    const audio = new Audio(relPath);
    currentAudio = audio;
    audio.onerror = () => fallbackSpeak(fallbackText);
    audio.play().catch(() => fallbackSpeak(fallbackText));
  } catch (e) {
    fallbackSpeak(fallbackText);
  }
}

function speakName(name, force = false) {
  playVoiceFile(`audio/names/${encodeURIComponent(name)}.mp3`, name, force);
}

function speakCorrect(name, force = false) {
  playVoiceFile(`audio/correct/${encodeURIComponent(name)}.mp3`, `${name} 정답이에요`, force);
}

function speakWrong(force = false) {
  playVoiceFile(`audio/common/wrong.mp3`, `틀렸습니다!`, force);
}

function speakChar(ch, force = false) {
  playVoiceFile(`audio/chars/${encodeURIComponent(ch)}.mp3`, ch, force);
}

function speakHint(name, keyword, force = false) {
  playVoiceFile(`audio/hints/${encodeURIComponent(name)}.mp3`, `힌트! ${keyword}의 티니핑이에요.`, force);
}

// ---- 설정 저장 (문제 수 / 목소리 켜짐) : 다음에 열어도 그대로 유지 ----
const SETTINGS_KEY = 'teenieping-settings';

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ limit: selectedLimit, tts: ttsEnabled }));
  } catch (e) {}
}

function renderSettings() {
  document.querySelectorAll('.settings-bar [data-count]').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.count) === selectedLimit);
  });
  const btn = document.getElementById('tts-toggle-btn');
  btn.classList.toggle('active', ttsEnabled);
  btn.textContent = ttsEnabled ? '하츄핑 목소리 켜짐 🔊' : '하츄핑 목소리 꺼짐 🔇';
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved) {
      if ([10, 20, 999].includes(saved.limit)) selectedLimit = saved.limit;
      if (typeof saved.tts === 'boolean') ttsEnabled = saved.tts;
    }
  } catch (e) {}
  renderSettings();
}

function setQuestionCount(count) {
  selectedLimit = count;
  renderSettings();
  saveSettings();
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  renderSettings();
  saveSettings();
  if (ttsEnabled) {
    playVoiceFile('audio/common/tts_on.mp3', '하츄핑 목소리가 켜졌어요, 츄!', true);
  } else {
    stopCurrentVoice();
  }
}

// ---- 홈 화면 시즌별 마리 수를 데이터에서 자동 계산 (데이터를 고쳐도 숫자가 맞게) ----
function renderSeasonCounts() {
  for (let s = 1; s <= 6; s++) {
    const el = document.querySelector(`.season-${s} .season-count`);
    if (el) el.textContent = `${TEENIEPINGS.filter(t => t.season === s).length}마리`;
  }
  const totalEl = document.getElementById('total-count');
  if (totalEl) totalEl.textContent = TEENIEPINGS.length;
}

// ---- 다음 문제 그림·이름 음성을 미리 받아두기 (넘어갈 때 그림이 늦게 뜨는 현상 방지) ----
const preloaded = new Set();
function preloadQuestion(q) {
  if (!q || preloaded.has(q.name)) return;
  preloaded.add(q.name);
  const img = new Image();
  img.src = q.img;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = `audio/names/${encodeURIComponent(q.name)}.mp3`;
}

loadSettings();
renderSeasonCounts();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function startGame(seasonMode) {
  clearAutoNextTimers();
  currentSeasonMode = seasonMode;
  if (seasonMode === 'all') {
    pool = [...TEENIEPINGS];
  } else {
    pool = TEENIEPINGS.filter(item => item.season === seasonMode);
  }

  const shuffled = shuffle(pool);
  const count = Math.min(selectedLimit, shuffled.length);
  questions = shuffled.slice(0, count);
  currentIndex = 0;
  score = 0;
  learnedList = [];

  showScreen('quiz-screen');
  renderQuestion();
}

function restartSameMode() {
  startGame(currentSeasonMode);
}

function goHome() {
  clearAutoNextTimers();
  stopCurrentVoice();
  showScreen('home-screen');
}

function renderQuestion() {
  clearAutoNextTimers();
  answeredCurrent = false;
  selectedChoiceName = null;
  const q = questions[currentIndex];

  document.getElementById('progress-pill').textContent = `${currentIndex + 1}/${questions.length}`;
  document.getElementById('score-pill').textContent = `💖${score}`;
  const pct = ((currentIndex) / questions.length) * 100;
  document.getElementById('progress-fill').style.width = `${pct}%`;

  document.getElementById('char-season-badge').textContent = `${q.season}기·${q.grade}`;

  const stageEl = document.getElementById('image-stage');
  stageEl.classList.remove('puzzle-mode');

  const imgEl = document.getElementById('quiz-image');
  imgEl.src = q.img;
  imgEl.alt = q.name;
  preloadQuestion(questions[currentIndex + 1]);

  const hintBox = document.getElementById('hint-box');
  hintBox.classList.remove('show');
  hintBox.innerHTML = `<strong>✨ ${q.keyword}</strong> — ${q.desc}`;

  const learnBox = document.getElementById('syllable-learn-box');
  learnBox.classList.remove('show', 'completed');

  document.getElementById('feedback-msg').textContent = '한 번 누르면 읽어주고, 두 번 누르면 정답 선택!';
  document.getElementById('next-btn').classList.remove('show');

  const otherCandidates = pool.filter(item => item.name !== q.name);
  const uniqueNamesMap = new Map();
  shuffle(otherCandidates).forEach(item => {
    if (!uniqueNamesMap.has(item.name)) {
      uniqueNamesMap.set(item.name, item);
    }
  });
  const distractors = Array.from(uniqueNamesMap.values()).slice(0, 3);
  const options = shuffle([q, ...distractors]);

  const grid = document.getElementById('choices-grid');
  grid.classList.remove('syllable-mode');
  grid.innerHTML = '';

  options.forEach((opt, idx) => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.innerHTML = `
      <span class="choice-num">${idx + 1}</span>
      <span class="choice-text">${opt.name}</span>
    `;
    btn.onclick = () => handleChoice(btn, opt, q);
    grid.appendChild(btn);
  });
}

function speakCurrentAnswer() {
  const q = questions[currentIndex];
  speakName(q.name, true);
}

function toggleHint() {
  const hintBox = document.getElementById('hint-box');
  hintBox.classList.toggle('show');
  const q = questions[currentIndex];
  if (hintBox.classList.contains('show')) {
    speakHint(q.name, q.keyword, true);
  } else {
    stopCurrentVoice();
  }
}

function handleChoice(btnEl, selectedOpt, correctOpt) {
  if (answeredCurrent) return;

  // 1번째 터치: 소리만 읽어주고 선택 대기 상태로 표시
  if (selectedChoiceName !== selectedOpt.name) {
    selectedChoiceName = selectedOpt.name;
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    speakName(selectedOpt.name);
    document.getElementById('feedback-msg').innerHTML =
      `🔊 <strong>"${selectedOpt.name}"</strong> — 맞으면 한 번 더 눌러주세요!`;
    return;
  }

  // 2번째 연속 터치: 정답 제출로 인식!
  btnEl.classList.remove('selected');
  selectedChoiceName = null;

  if (selectedOpt.name === correctOpt.name) {
    answeredCurrent = true;
    btnEl.classList.add('correct');
    playSound('correct');
    speakName(correctOpt.name);

    // 1단계 정답 맞힘 -> 2단계 한글 글자 카드 순서대로 맞추기 시작!
    startSyllablePuzzle(correctOpt);
  } else {
    btnEl.classList.add('wrong');
    btnEl.disabled = true;
    playSound('wrong');
    speakWrong();
    document.getElementById('feedback-msg').innerHTML =
      `❌ <strong>틀렸습니다!</strong> 다른 버튼을 눌러보세요 💕`;
  }
}

// ==================== 2단계: 한글 글자 카드 순서대로 맞추기 퍼즐 ====================
function startSyllablePuzzle(correctOpt) {
  document.getElementById('hint-box').classList.remove('show');
  document.getElementById('image-stage').classList.add('puzzle-mode');

  const chars = Array.from(correctOpt.name);
  puzzleSlots = chars.map((ch, idx) => {
    if (ch === ' ') {
      return { char: ' ', isSpace: true, fixed: true, filled: true };
    }
    // 맨 마지막 '핑' 글자는 문제로 내지 않고 고정으로 넣어둠!
    const isLastPing = (idx === chars.length - 1 && ch === '핑');
    return {
      char: ch,
      isSpace: false,
      fixed: isLastPing,
      filled: isLastPing,
      justFilled: false
    };
  });

  const learnBox = document.getElementById('syllable-learn-box');
  learnBox.classList.remove('completed');
  learnBox.classList.add('show');

  // 첫 번째로 맞춰야 할 빈칸 찾기
  puzzleTargetIndex = puzzleSlots.findIndex(s => !s.filled);

  if (puzzleTargetIndex === -1) {
    // 만약 맞춰야 할 글자가 없다면 바로 완료 처리
    finishSyllablePuzzle(correctOpt);
  } else {
    renderPuzzleSlots();
    renderSyllableChoices(correctOpt);
  }
}

function renderPuzzleSlots() {
  const blocksWrap = document.getElementById('syllable-blocks');
  blocksWrap.innerHTML = '';

  const nonSpaceCount = puzzleSlots.filter(s => !s.isSpace).length;
  blocksWrap.classList.remove('len-medium', 'len-long');
  if (nonSpaceCount >= 6) {
    blocksWrap.classList.add('len-long');
  } else if (nonSpaceCount >= 4) {
    blocksWrap.classList.add('len-medium');
  }

  puzzleSlots.forEach((slot, idx) => {
    if (slot.isSpace) {
      const sp = document.createElement('div');
      sp.style.width = '8px';
      blocksWrap.appendChild(sp);
      return;
    }

    const el = document.createElement('div');
    el.className = 'syllable-slot';

    if (slot.fixed) {
      el.classList.add('fixed-ping');
      el.textContent = slot.char;
      el.onclick = () => speakChar(slot.char, true);
    } else if (slot.filled) {
      el.classList.add('filled');
      if (slot.justFilled) {
        el.classList.add('just-filled');
        slot.justFilled = false;
      }
      el.textContent = slot.char;
      el.onclick = () => speakChar(slot.char, true);
    } else if (idx === puzzleTargetIndex) {
      el.classList.add('active-target');
      el.textContent = '?';
    } else {
      el.textContent = '?';
    }

    blocksWrap.appendChild(el);
  });
}

function renderSyllableChoices(correctOpt) {
  const targetChar = puzzleSlots[puzzleTargetIndex].char;
  document.getElementById('feedback-msg').innerHTML =
    `🧩 빈칸에 들어갈 <strong>"${targetChar}"</strong> 글자 카드를 찾아 눌러보세요!`;

  // 임의의 다른 한글 음절 5개 + 정답 음절 1개 = 총 6개 카드 구성
  const distractorPool = ALL_SYLLABLES.filter(ch => ch !== targetChar && ch !== '핑');
  const distractors = shuffle(distractorPool).slice(0, 5);
  const cardChars = shuffle([targetChar, ...distractors]);

  const grid = document.getElementById('choices-grid');
  grid.classList.add('syllable-mode');
  grid.innerHTML = '';

  cardChars.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'syllable-card-btn';
    btn.textContent = ch;
    btn.onclick = () => handleSyllableCardClick(btn, ch, correctOpt);
    grid.appendChild(btn);
  });
}

function handleSyllableCardClick(btnEl, clickedChar, correctOpt) {
  if (puzzleTargetIndex === -1) return;
  const targetSlot = puzzleSlots[puzzleTargetIndex];

  if (clickedChar === targetSlot.char) {
    // 맞았을 때: 경쾌한 효과음 + 글자 음성 + 빈칸에 쏙 들어감!
    playSound('pop');
    speakChar(clickedChar);

    targetSlot.filled = true;
    targetSlot.justFilled = true;

    // 다음 빈칸 찾기
    puzzleTargetIndex = puzzleSlots.findIndex(s => !s.filled);
    renderPuzzleSlots();

    if (puzzleTargetIndex === -1) {
      // 모든 글자 카드를 순서대로 다 맞췄을 때!
      finishSyllablePuzzle(correctOpt);
    } else {
      // 다음 글자 맞추기 카드 6개 새로 띄우기
      renderSyllableChoices(correctOpt);
    }
  } else {
    // 틀렸을 때: 효과음과 함께 글자 카드가 부르르 진동하면서 안 들어가는 모션!
    playSound('wrong');
    btnEl.classList.remove('reject-shake');
    void btnEl.offsetWidth; // 리플로우로 애니메이션 재실행 보장
    btnEl.classList.add('reject-shake');
  }
}

function finishSyllablePuzzle(correctOpt) {
  score++;
  learnedList.push(correctOpt);
  document.getElementById('score-pill').textContent = `💖${score}`;
  document.getElementById('progress-fill').style.width = `${((currentIndex + 1) / questions.length) * 100}%`;

  document.getElementById('syllable-learn-box').classList.add('completed');

  // 하단 카드 버튼 비활성화 및 정답 축하 표시
  document.querySelectorAll('.syllable-card-btn').forEach(b => {
    b.disabled = true;
    b.style.opacity = '0.5';
  });

  celebrateTimer = setTimeout(() => {
    celebrateTimer = null;
    playSound('correct');
    fireConfetti(45);
    speakCorrect(correctOpt.name);
  }, 280);

  // 5초 카운트다운 후 자동으로 다음 문제로 이동
  let remainSec = 5;
  const feedbackEl = document.getElementById('feedback-msg');
  const nextBtn = document.getElementById('next-btn');
  nextBtn.classList.add('show');
  feedbackEl.innerHTML = `🎉 <strong>${correctOpt.name} 완성!</strong> (${remainSec}초 뒤 다음 문제)`;

  countdownInterval = setInterval(() => {
    remainSec -= 1;
    if (remainSec > 0) {
      feedbackEl.innerHTML = `🎉 <strong>${correctOpt.name} 완성!</strong> (${remainSec}초 뒤 다음 문제)`;
    }
  }, 1000);

  autoNextTimer = setTimeout(() => {
    nextQuestion();
  }, 5000);
}

function nextQuestion() {
  clearAutoNextTimers();
  currentIndex++;
  if (currentIndex >= questions.length) {
    showResults();
  } else {
    renderQuestion();
  }
}

function showResults() {
  clearAutoNextTimers();
  showScreen('result-screen');
  playSound('fanfare');
  fireConfetti(80);
  playVoiceFile('audio/common/finish.mp3', '우와! 문제를 모두 풀었어요! 정말 잘했어요, 츄!');

  document.getElementById('result-score-text').innerHTML =
    `총 <strong>${questions.length}</strong>명의 티니핑 친구 이름을 모두 배웠어요! 💖`;

  const grid = document.getElementById('learned-grid');
  grid.innerHTML = '';
  learnedList.forEach(item => {
    const chip = document.createElement('div');
    chip.className = 'learned-chip';
    chip.innerHTML = `<img src="${item.img}" alt="${item.name}" /> <span>${item.name} 🔊</span>`;
    chip.onclick = () => speakName(item.name, true);
    grid.appendChild(chip);
  });
}

const canvas = document.getElementById('confetti-canvas');
const ctx = canvas.getContext('2d');
let particles = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function fireConfetti(count = 40) {
  const colors = ['#ff5c93', '#ffca3a', '#00bbf9', '#9b5de5', '#2ec4b6', '#ff9f1c'];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 160,
      y: window.innerHeight * 0.4,
      vx: (Math.random() - 0.5) * 13,
      vy: -Math.random() * 11 - 4,
      size: 7 + Math.random() * 7,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      vrot: (Math.random() - 0.5) * 12,
      life: 70 + Math.random() * 30
    });
  }
  if (particles.length === count) {
    requestAnimationFrame(updateConfetti);
  }
}

function updateConfetti() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  particles.forEach(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.35;
    p.rot += p.vrot;
    p.life -= 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.65);
    ctx.restore();
  });
  particles = particles.filter(p => p.life > 0);
  if (particles.length > 0) {
    requestAnimationFrame(updateConfetti);
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}
