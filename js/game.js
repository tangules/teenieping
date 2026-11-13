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
let lockTimer = null;          // 틀린 뒤 잠깐 버튼을 못 누르게 하는 타이머 (막 누르기 방지)
let readAloudHelp = false;     // true면 예전 방식: 버튼 한 번 누르면 읽어주고, 두 번 누르면 제출
let mistakes = { name: 0, letters: 0 }; // 이번 문제에서 틀린 횟수 (캐치 여부 판단)

// 캐치 조건: 이름은 한 번에 맞히고, 글자 퍼즐은 실수 1번까지 봐줌
const CATCH_MAX_NAME_MISTAKES = 0;
const CATCH_MAX_LETTER_MISTAKES = 1;
const WRONG_LOCK_MS = 2000;    // 1단계 이름 틀렸을 때 잠금 시간
const CARD_LOCK_MS = 1200;     // 2단계 글자 카드 틀렸을 때 잠금 시간
const AUTO_NEXT_SEC = 6;

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
  unlockInput();
}

// ---- 틀린 뒤 잠깐 잠그기: 아무 버튼이나 연달아 누르는 것을 막고, 안내 음성을 끝까지 듣게 함 ----
function lockInput(ms) {
  unlockInput();
  document.getElementById('choices-grid').classList.add('locked');
  lockTimer = setTimeout(unlockInput, ms);
}

function unlockInput() {
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }
  const grid = document.getElementById('choices-grid');
  if (grid) grid.classList.remove('locked');
}

function isInputLocked() {
  return lockTimer !== null;
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

// ---- 음성 재생 ----
// 하나의 오디오 플레이어를 계속 재사용합니다.
//  - 음성이 겹치거나 메아리처럼 두 번 나오지 않게 하고,
//  - 아이폰에서 처음 한 번 터치로 허용된 플레이어를 이후 자동 음성에도 쓸 수 있게 합니다.
// voiceToken: 새 음성을 틀 때마다 1씩 올라가며, 이미 끊긴 이전 음성의 뒤늦은 실패 알림을 무시하는 데 씁니다.
// 여러 음성을 차례로 이어서 틀 수도 있습니다 (예: "이건" → "토이핑" → "하츄핑을 찾아봐!").
const voicePlayer = new Audio();
voicePlayer.preload = 'auto';
let voiceToken = 0;
let voiceRequest = null; // { token, fallbackText, fellBack, rest: [다음에 이어서 틀 음성들] }

voicePlayer.addEventListener('error', () => {
  // 파일을 실제로 못 불러온 경우(파일 없음·네트워크 끊김)에만 브라우저 기본 음성으로 대신 읽기
  const req = voiceRequest;
  if (!req || req.token !== voiceToken || req.fellBack) return;
  req.fellBack = true;
  fallbackSpeak(req.fallbackText, () => playNextInSequence(req));
});

voicePlayer.addEventListener('ended', () => {
  const req = voiceRequest;
  if (req && req.token === voiceToken) playNextInSequence(req);
});

function playNextInSequence(req) {
  if (req.token !== voiceToken || !req.rest || req.rest.length === 0) return;
  const [next, ...rest] = req.rest;
  voiceToken++;
  startVoiceItem(next, rest);
}

function stopCurrentVoice() {
  voiceToken++;
  voiceRequest = null;
  try { voicePlayer.pause(); } catch (e) {}
  if ('speechSynthesis' in window) {
    try { window.speechSynthesis.cancel(); } catch (e) {}
  }
}

function fallbackSpeak(text, onEnd) {
  if (!('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.rate = 1.05;
    utter.pitch = 1.65;
    if (onEnd) utter.onend = onEnd;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}

function startVoiceItem(item, rest) {
  const req = { token: voiceToken, fallbackText: item.text, fellBack: false, rest };
  voiceRequest = req;
  const fallBack = () => {
    if (req.fellBack) return;
    req.fellBack = true;
    fallbackSpeak(item.text, () => playNextInSequence(req));
  };
  try {
    voicePlayer.src = item.path;
    voicePlayer.play().catch(err => {
      // AbortError: 다음 음성이 앞 음성을 끊은 것(정상) → 아무것도 안 함 (예전엔 여기서 가는 목소리로 한 번 더 읽음)
      // NotAllowedError: 브라우저가 자동재생을 막은 것 → 다른 목소리로 대신 읽지 않음
      if (req.token !== voiceToken) return;
      if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
      fallBack();
    });
  } catch (e) {
    fallBack();
  }
}

// items: [{ path, text }, ...] 차례로 재생. force=true면 목소리 꺼짐이어도 재생(🔊 버튼을 직접 누른 경우)
function playVoiceSequence(items, force = false) {
  if (!ttsEnabled && !force) return;
  if (!items || items.length === 0) return;
  stopCurrentVoice();
  const [first, ...rest] = items;
  startVoiceItem(first, rest);
}

function playVoiceFile(relPath, fallbackText, force = false) {
  playVoiceSequence([{ path: relPath, text: fallbackText }], force);
}

// 음성 조각 만들기
const V = {
  name: n => ({ path: `audio/names/${encodeURIComponent(n)}.mp3`, text: n }),
  prompt: n => ({ path: `audio/prompts/${encodeURIComponent(n)}.mp3`, text: `${n}을 찾아봐!` }),
  correct: n => ({ path: `audio/correct/${encodeURIComponent(n)}.mp3`, text: `${n}! 정답이에요!` }),
  char: c => ({ path: `audio/chars/${encodeURIComponent(c)}.mp3`, text: c }),
  hint: (n, kw) => ({ path: `audio/hints/${encodeURIComponent(n)}.mp3`, text: `힌트! ${kw}의 티니핑이에요.` }),
  thisIs: () => ({ path: 'audio/common/this_is.mp3', text: '이건' }),
  findChar: () => ({ path: 'audio/common/find_char.mp3', text: '찾는 글자는' }),
  caught: () => ({ path: 'audio/common/catch.mp3', text: '와! 한 번에 맞혔어요! 티니핑 캐치!' }),
  almost: () => ({ path: 'audio/common/almost.mp3', text: '잘했어요! 다음엔 한 번에 캐치해 보자!' })
};

function speakName(name, force = false) { playVoiceSequence([V.name(name)], force); }
function speakChar(ch, force = false) { playVoiceSequence([V.char(ch)], force); }
function speakHint(name, keyword, force = false) { playVoiceSequence([V.hint(name, keyword)], force); }

// ---- 설정 저장 (문제 수 / 목소리 켜짐) : 다음에 열어도 그대로 유지 ----
const SETTINGS_KEY = 'teenieping-settings';

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ limit: selectedLimit, tts: ttsEnabled, readAloud: readAloudHelp }));
  } catch (e) {}
}

function renderSettings() {
  document.querySelectorAll('.settings-bar [data-count]').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.count) === selectedLimit);
  });
  const btn = document.getElementById('tts-toggle-btn');
  btn.classList.toggle('active', ttsEnabled);
  btn.textContent = ttsEnabled ? '하츄핑 목소리 켜짐 🔊' : '하츄핑 목소리 꺼짐 🔇';
  const readBtn = document.getElementById('read-aloud-btn');
  readBtn.classList.toggle('active', readAloudHelp);
  readBtn.textContent = readAloudHelp ? '버튼 읽어주기 켜짐 🗣️' : '버튼 읽어주기 꺼짐 🔤';
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved) {
      if ([10, 20, 999].includes(saved.limit)) selectedLimit = saved.limit;
      if (typeof saved.tts === 'boolean') ttsEnabled = saved.tts;
      if (typeof saved.readAloud === 'boolean') readAloudHelp = saved.readAloud;
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

// 버튼 읽어주기 도움: 글자를 아직 거의 못 읽을 때만 켜는 쉬운 모드 (켜면 예전처럼 한 번 누르면 읽어줌)
function toggleReadAloud() {
  readAloudHelp = !readAloudHelp;
  renderSettings();
  saveSettings();
}

// ---- 내 도감: 한 번에 맞혀서 "캐치"한 티니핑 모음 (이 기기에 저장) ----
const CAUGHT_KEY = 'teenieping-caught';
let caughtNames = new Set();

function loadCaught() {
  try {
    const saved = JSON.parse(localStorage.getItem(CAUGHT_KEY) || '[]');
    if (Array.isArray(saved)) caughtNames = new Set(saved);
  } catch (e) {}
  renderCollectionCount();
}

function saveCaught() {
  try {
    localStorage.setItem(CAUGHT_KEY, JSON.stringify([...caughtNames]));
  } catch (e) {}
}

function renderCollectionCount() {
  const el = document.getElementById('collection-count');
  if (el) el.textContent = `${caughtNames.size}/${TEENIEPINGS.length}`;
}

function openCollection() {
  clearAutoNextTimers();
  stopCurrentVoice();
  const wrap = document.getElementById('collection-list');
  wrap.innerHTML = '';
  document.getElementById('collection-summary').textContent =
    `${caughtNames.size}마리 캐치! (전체 ${TEENIEPINGS.length}마리)`;

  for (let s = 1; s <= 6; s++) {
    const members = TEENIEPINGS.filter(t => t.season === s);
    if (members.length === 0) continue;
    const got = members.filter(t => caughtNames.has(t.name)).length;

    const title = document.createElement('div');
    title.className = 'collection-season-title';
    title.textContent = `${members[0].seasonTitle} · ${got}/${members.length}`;
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'collection-grid';
    members.forEach(t => {
      const caught = caughtNames.has(t.name);
      const cell = document.createElement('button');
      cell.className = 'collection-cell' + (caught ? ' caught' : '');
      cell.innerHTML = `<img src="${t.img}" alt="" loading="lazy" /><span>${caught ? t.name : '???'}</span>`;
      cell.onclick = () => {
        if (caught) {
          speakName(t.name, true);
        } else {
          cell.classList.remove('reject-shake');
          void cell.offsetWidth;
          cell.classList.add('reject-shake');
        }
      };
      grid.appendChild(cell);
    });
    wrap.appendChild(grid);
  }
  showScreen('collection-screen');
  document.getElementById('collection-screen').scrollTop = 0;
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
  audio.src = `audio/prompts/${encodeURIComponent(q.name)}.mp3`;
}

loadSettings();
loadCaught();
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
  renderCollectionCount();
  showScreen('home-screen');
}

function renderQuestion() {
  clearAutoNextTimers();
  answeredCurrent = false;
  selectedChoiceName = null;
  mistakes = { name: 0, letters: 0 };
  const q = questions[currentIndex];

  document.getElementById('progress-pill').textContent = `${currentIndex + 1}/${questions.length}`;
  document.getElementById('score-pill').textContent = `⭐${score}`;
  document.getElementById('catch-stamp').className = 'catch-stamp';
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

  document.getElementById('feedback-msg').innerHTML = readAloudHelp
    ? '한 번 누르면 읽어주고, 두 번 누르면 정답 선택!'
    : `🔊 <strong>소리를 잘 듣고</strong> 이름을 찾아 눌러요!`;
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

  // 문제를 소리로 내기: "○○핑을 찾아봐!" → 아이는 글자를 보고 찾아야 함
  playVoiceSequence([V.prompt(q.name)]);
}

// 🔊 다시듣기: 지금 단계에 맞는 문제 소리를 다시 들려줌
function speakCurrentAnswer() {
  const q = questions[currentIndex];
  if (answeredCurrent && puzzleTargetIndex !== -1 && puzzleSlots[puzzleTargetIndex]) {
    speakChar(puzzleSlots[puzzleTargetIndex].char, true);
  } else {
    playVoiceSequence([V.prompt(q.name)], true);
  }
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
  if (answeredCurrent || isInputLocked()) return;

  // (버튼 읽어주기 도움이 켜졌을 때만) 1번째 터치: 소리만 읽어주고 선택 대기 상태로 표시
  if (readAloudHelp && selectedChoiceName !== selectedOpt.name) {
    selectedChoiceName = selectedOpt.name;
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    btnEl.classList.add('selected');
    speakName(selectedOpt.name);
    document.getElementById('feedback-msg').innerHTML =
      `🔊 <strong>"${selectedOpt.name}"</strong> — 맞으면 한 번 더 눌러주세요!`;
    return;
  }

  // 제출 (읽어주기 도움이 꺼져 있으면 한 번 누르면 바로 제출)
  btnEl.classList.remove('selected');
  selectedChoiceName = null;

  if (selectedOpt.name === correctOpt.name) {
    answeredCurrent = true;
    btnEl.classList.add('correct');
    playSound('correct');

    // 1단계 정답 맞힘 -> 2단계 한글 글자 카드 순서대로 맞추기 시작! (이름을 읽어준 뒤 첫 글자 소리)
    startSyllablePuzzle(correctOpt, [V.name(correctOpt.name)]);
  } else {
    // 틀렸을 때: 누른 것과 정답을 비교해서 들려주고, 잠깐 쉬었다가 다시 고르게 함
    mistakes.name++;
    btnEl.classList.add('wrong');
    btnEl.disabled = true;
    playSound('wrong');
    playVoiceSequence([V.thisIs(), V.name(selectedOpt.name), V.prompt(correctOpt.name)]);
    lockInput(WRONG_LOCK_MS);
    document.getElementById('feedback-msg').innerHTML =
      `🙅 이건 <strong>${selectedOpt.name}</strong>이에요. 다시 듣고 찾아봐요!`;
  }
}

// ==================== 2단계: 한글 글자 카드 순서대로 맞추기 퍼즐 ====================
function startSyllablePuzzle(correctOpt, voicePrefix = []) {
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
    renderSyllableChoices(correctOpt, voicePrefix);
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
      el.onclick = () => speakChar(slot.char, true); // ? 칸을 누르면 찾을 글자 소리를 다시 들려줌
    } else {
      el.textContent = '?';
    }

    blocksWrap.appendChild(el);
  });
}

function renderSyllableChoices(correctOpt, voicePrefix = []) {
  const targetChar = puzzleSlots[puzzleTargetIndex].char;
  // 찾을 글자를 화면에 써 주지 않고 소리로만 알려줌 (글자 모양만 보고 똑같은 걸 고르지 않도록)
  document.getElementById('feedback-msg').innerHTML =
    `🧩 소리를 듣고 <strong>빈칸 글자</strong>를 찾아요! (<strong>?</strong> 칸을 누르면 다시 들려줘요)`;
  playVoiceSequence([...voicePrefix, V.char(targetChar)]);

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
  if (puzzleTargetIndex === -1 || isInputLocked()) return;
  const targetSlot = puzzleSlots[puzzleTargetIndex];

  if (clickedChar === targetSlot.char) {
    // 맞았을 때: 경쾌한 효과음 + 빈칸에 쏙 들어감! (글자 소리는 아래에서 다음 글자 소리와 이어서 재생)
    playSound('pop');

    targetSlot.filled = true;
    targetSlot.justFilled = true;

    // 다음 빈칸 찾기
    puzzleTargetIndex = puzzleSlots.findIndex(s => !s.filled);
    renderPuzzleSlots();

    if (puzzleTargetIndex === -1) {
      // 모든 글자 카드를 순서대로 다 맞췄을 때!
      finishSyllablePuzzle(correctOpt);
    } else {
      // 다음 글자 맞추기 카드 6개 새로 띄우기 ("빙" 하고 읽어준 뒤 다음 찾을 글자 "글")
      renderSyllableChoices(correctOpt, [V.char(clickedChar)]);
    }
  } else {
    // 틀렸을 때: 카드가 부르르 떨고, 누른 글자 소리 → 찾을 글자 소리를 비교해서 들려줌
    mistakes.letters++;
    playSound('wrong');
    btnEl.classList.remove('reject-shake');
    void btnEl.offsetWidth; // 리플로우로 애니메이션 재실행 보장
    btnEl.classList.add('reject-shake');
    playVoiceSequence([V.thisIs(), V.char(clickedChar), V.findChar(), V.char(targetSlot.char)]);
    lockInput(CARD_LOCK_MS);
    document.getElementById('feedback-msg').innerHTML =
      `🙅 이건 <strong>'${clickedChar}'</strong> 글자예요. 소리를 다시 듣고 찾아봐요!`;
  }
}

function finishSyllablePuzzle(correctOpt) {
  unlockInput();
  // 캐치 판정: 이름을 한 번에 맞히고 글자 퍼즐 실수가 적을 때만 도감에 등록
  const caught = mistakes.name <= CATCH_MAX_NAME_MISTAKES && mistakes.letters <= CATCH_MAX_LETTER_MISTAKES;
  const isNew = caught && !caughtNames.has(correctOpt.name);
  if (caught) {
    score++;
    caughtNames.add(correctOpt.name);
    saveCaught();
  }
  learnedList.push({ ...correctOpt, caught, isNew });
  document.getElementById('score-pill').textContent = `⭐${score}`;
  document.getElementById('progress-fill').style.width = `${((currentIndex + 1) / questions.length) * 100}%`;

  document.getElementById('syllable-learn-box').classList.add('completed');

  // 하단 카드 버튼 비활성화 및 정답 축하 표시
  document.querySelectorAll('.syllable-card-btn').forEach(b => {
    b.disabled = true;
    b.style.opacity = '0.5';
  });

  // 마지막 글자 소리를 먼저 들려준 뒤 축하 (음성 플레이어를 재사용하므로 아이폰에서도 이어서 재생됨)
  const lastChar = puzzleSlots.filter(s => !s.fixed && !s.isSpace).pop();
  playVoiceSequence([
    ...(lastChar ? [V.char(lastChar.char)] : []),
    V.correct(correctOpt.name),
    caught ? V.caught() : V.almost()
  ]);

  celebrateTimer = setTimeout(() => {
    celebrateTimer = null;
    playSound('correct');
    fireConfetti(caught ? 70 : 30);
    if (caught) {
      document.getElementById('catch-stamp').className = 'catch-stamp show' + (isNew ? ' new' : '');
    }
  }, 280);

  // 몇 초 카운트다운 후 자동으로 다음 문제로 이동
  let remainSec = AUTO_NEXT_SEC;
  const feedbackEl = document.getElementById('feedback-msg');
  const nextBtn = document.getElementById('next-btn');
  nextBtn.classList.add('show');
  const message = () => caught
    ? `⭐ <strong>${correctOpt.name} 캐치!</strong>${isNew ? ' 새 친구!' : ''} (${remainSec}초)`
    : `👏 <strong>${correctOpt.name} 완성!</strong> 다음엔 캐치! (${remainSec}초)`;
  feedbackEl.innerHTML = message();

  countdownInterval = setInterval(() => {
    remainSec -= 1;
    if (remainSec > 0) feedbackEl.innerHTML = message();
  }, 1000);

  autoNextTimer = setTimeout(() => {
    nextQuestion();
  }, AUTO_NEXT_SEC * 1000);
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

  const newCount = learnedList.filter(i => i.isNew).length;
  document.getElementById('result-score-text').innerHTML =
    `<strong>${questions.length}</strong>문제 중 <strong>⭐ ${score}마리</strong>를 한 번에 캐치했어요!` +
    (newCount ? `<br>📖 도감에 새 친구 <strong>${newCount}마리</strong> 등록!` : '');

  const grid = document.getElementById('learned-grid');
  grid.innerHTML = '';
  learnedList.forEach(item => {
    const chip = document.createElement('div');
    chip.className = 'learned-chip' + (item.caught ? ' caught' : '');
    chip.innerHTML = `<img src="${item.img}" alt="${item.name}" /> <span>${item.caught ? '⭐' : '💪'} ${item.name} 🔊</span>`;
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
