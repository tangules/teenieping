// ---- 한글 자모(자음·모음) 도구 : 2단계 "자음·모음 순서대로 맞추기"용 ----
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

// 오답 보기로 쓸 기본 자음·모음 (처음 배우는 아이 기준)
const BASIC_CONSONANTS = ['ㄱ','ㄴ','ㄷ','ㄹ','ㅁ','ㅂ','ㅅ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const BASIC_VOWELS = ['ㅏ','ㅑ','ㅓ','ㅕ','ㅗ','ㅛ','ㅜ','ㅠ','ㅡ','ㅣ'];

// 자음은 글자 이름, 모음은 소리로 읽기 (audio/jamo/*.mp3 와 같은 내용, 파일이 없을 때 대신 읽기용)
const JAMO_SPOKEN = {
  'ㄱ':'기역','ㄲ':'쌍기역','ㄴ':'니은','ㄷ':'디귿','ㄸ':'쌍디귿','ㄹ':'리을','ㅁ':'미음','ㅂ':'비읍','ㅃ':'쌍비읍',
  'ㅅ':'시옷','ㅆ':'쌍시옷','ㅇ':'이응','ㅈ':'지읒','ㅉ':'쌍지읒','ㅊ':'치읓','ㅋ':'키읔','ㅌ':'티읕','ㅍ':'피읖','ㅎ':'히읗',
  'ㅏ':'아','ㅐ':'애','ㅑ':'야','ㅒ':'얘','ㅓ':'어','ㅔ':'에','ㅕ':'여','ㅖ':'예','ㅗ':'오','ㅘ':'와','ㅙ':'왜','ㅚ':'외',
  'ㅛ':'요','ㅜ':'우','ㅝ':'워','ㅞ':'웨','ㅟ':'위','ㅠ':'유','ㅡ':'으','ㅢ':'의','ㅣ':'이'
};

// '하' → ['ㅎ','ㅏ'], '빙' → ['ㅂ','ㅣ','ㅇ'] (받침이 있으면 3개)
function decomposeHangul(ch) {
  const code = ch.charCodeAt(0) - 0xAC00;
  if (code < 0 || code >= 11172) return [ch];
  const jong = JONG[code % 28];
  return [CHO[Math.floor(code / 588)], JUNG[Math.floor((code % 588) / 28)], ...(jong ? [jong] : [])];
}

function isVowel(j) {
  return JUNG.includes(j);
}

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

// 캐치 조건: 이름은 한 번에 맞히고, 자음·모음 맞추기는 실수 2번까지 봐줌
const CATCH_MAX_NAME_MISTAKES = 0;
const CATCH_MAX_LETTER_MISTAKES = 2;   // 자모는 누르는 횟수가 많아서 2번까지 봐줌
const WRONG_LOCK_MS = 2000;    // 1단계 이름 틀렸을 때 잠금 시간
const CARD_LOCK_MS = 1200;     // 2단계 자모 카드 틀렸을 때 잠금 시간
const JAMO_CHOICES = 4;        // 2단계 보기 개수
const AUTO_NEXT_SEC = 6;

// 2단계 글자 맞추기 퍼즐 상태
let puzzleSlots = [];       // [{ char: '하', jamo: ['ㅎ','ㅏ'], done: false }, ..., { char: '핑', fixed: true, done: true }]
let puzzleTargetIndex = 0;  // 지금 만들고 있는 글자(음절) 위치
let jamoIndex = 0;          // 그 글자 안에서 지금 찾을 자모 위치

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
  jamo: j => ({ path: `audio/jamo/${encodeURIComponent(j)}.mp3`, text: JAMO_SPOKEN[j] || j }),
  caught: () => ({ path: 'audio/common/catch.mp3', text: '와! 한 번에 맞혔어요! 티니핑 캐치!' }),
  almost: () => ({ path: 'audio/common/almost.mp3', text: '잘했어요! 다음엔 한 번에 캐치해 보자!' })
};

function speakName(name, force = false) { playVoiceSequence([V.name(name)], force); }
function speakChar(ch, force = false) { playVoiceSequence([V.char(ch)], force); }
function speakJamo(j, force = false) { playVoiceSequence([V.jamo(j)], force); }
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
  document.getElementById('collection-reset-btn').disabled = caughtNames.size === 0;
  showScreen('collection-screen');
  document.getElementById('collection-screen').scrollTop = 0;
}

// ---- 확인 창: 실수로 누르지 않도록 한 번 더 물어봄 ("아니요"가 크고 먼저 보이게) ----
function showConfirm({ title, text, okLabel, onOk }) {
  const modal = document.getElementById('confirm-modal');
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-text').textContent = text;
  const okBtn = document.getElementById('confirm-ok');
  const cancelBtn = document.getElementById('confirm-cancel');
  okBtn.textContent = okLabel;

  const close = () => {
    modal.classList.remove('show');
    okBtn.onclick = null;
    cancelBtn.onclick = null;
    modal.onclick = null;
  };
  cancelBtn.onclick = close;
  modal.onclick = e => { if (e.target === modal) close(); }; // 바깥을 눌러도 취소
  okBtn.onclick = () => { close(); onOk(); };

  // 확인 버튼은 0.8초 뒤에야 눌리게 → 창이 뜨자마자 연달아 눌러서 지워지는 것 방지
  okBtn.disabled = true;
  setTimeout(() => { okBtn.disabled = false; }, 800);
  modal.classList.add('show');
}

function askResetCollection() {
  if (caughtNames.size === 0) return;
  showConfirm({
    title: '도감을 처음부터 다시 시작할까요?',
    text: `지금까지 캐치한 티니핑 ${caughtNames.size}마리가 모두 사라지고, 되돌릴 수 없어요.`,
    okLabel: '네, 모두 지울게요',
    onOk: () => {
      caughtNames = new Set();
      saveCaught();
      renderCollectionCount();
      openCollection();
    }
  });
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
  grid.classList.remove('syllable-mode', 'jamo-mode');
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
    startSyllablePuzzle(correctOpt, [V.name(correctOpt.name)]);  // 이름을 읽어준 뒤 자모 맞추기 시작
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

// ==================== 2단계: 자음·모음을 순서대로 눌러 이름 만들기 ====================
// 그림과 정답 이름을 크게 보여준 채로, 지금 글자(예: '하')를 이루는 자모를 순서대로 찾습니다. ('ㅎ' → 'ㅏ')
// 마지막 '핑'은 고정으로 채워둡니다.
function startSyllablePuzzle(correctOpt, voicePrefix = []) {
  document.getElementById('hint-box').classList.remove('show');
  document.getElementById('image-stage').classList.add('puzzle-mode');

  const chars = Array.from(correctOpt.name);
  puzzleSlots = chars.map((ch, idx) => {
    if (ch === ' ') {
      return { char: ' ', isSpace: true, fixed: true, done: true, jamo: [] };
    }
    const isLastPing = (idx === chars.length - 1 && ch === '핑');
    return {
      char: ch,
      isSpace: false,
      fixed: isLastPing,
      done: isLastPing,
      justFilled: false,
      jamo: isLastPing ? [] : decomposeHangul(ch)
    };
  });

  const learnBox = document.getElementById('syllable-learn-box');
  learnBox.classList.remove('completed');
  learnBox.classList.add('show');

  puzzleTargetIndex = puzzleSlots.findIndex(s => !s.done);
  jamoIndex = 0;

  if (puzzleTargetIndex === -1) {
    finishSyllablePuzzle(correctOpt, voicePrefix);
  } else {
    renderPuzzleSlots();
    renderJamoChoices(correctOpt, voicePrefix);
  }
}

function renderPuzzleSlots() {
  // 위쪽: 정답 이름을 글자 칸으로 크게 표시 (완성한 글자 / 지금 글자 / 남은 글자)
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
    el.textContent = slot.char;
    el.onclick = () => speakChar(slot.char, true); // 글자를 누르면 그 글자 소리

    if (slot.fixed) {
      el.classList.add('fixed-ping');
    } else if (slot.done) {
      el.classList.add('filled');
      if (slot.justFilled) {
        el.classList.add('just-filled');
        slot.justFilled = false;
      }
    } else if (idx === puzzleTargetIndex) {
      el.classList.add('active-target', 'show-char');
    } else {
      el.classList.add('upcoming');
    }

    blocksWrap.appendChild(el);
  });

  // 아래쪽: 지금 글자의 자모 칸 (예: '하' → [ㅎ][?])
  const row = document.getElementById('jamo-row');
  row.innerHTML = '';
  const target = puzzleSlots[puzzleTargetIndex];
  if (!target) return;

  const label = document.createElement('div');
  label.className = 'jamo-target-char';
  label.textContent = target.char;
  label.onclick = () => speakChar(target.char, true);
  row.appendChild(label);

  const eq = document.createElement('div');
  eq.className = 'jamo-eq';
  eq.textContent = '=';
  row.appendChild(eq);

  target.jamo.forEach((j, i) => {
    if (i > 0) {
      const plus = document.createElement('div');
      plus.className = 'jamo-eq';
      plus.textContent = '+';
      row.appendChild(plus);
    }
    const cell = document.createElement('div');
    cell.className = 'jamo-slot';
    if (i < jamoIndex) {
      cell.classList.add('filled', isVowel(j) ? 'vowel' : 'consonant');
      cell.textContent = j;
      cell.onclick = () => speakJamo(j, true);
    } else {
      if (i === jamoIndex) cell.classList.add('active');
      cell.textContent = '?';
    }
    row.appendChild(cell);
  });
}

function renderJamoChoices(correctOpt, voice = []) {
  const target = puzzleSlots[puzzleTargetIndex];
  const targetJamo = target.jamo[jamoIndex];
  const kind = isVowel(targetJamo) ? '모음' : '자음';
  document.getElementById('feedback-msg').innerHTML =
    `🔤 <strong>'${target.char}'</strong>의 ${jamoIndex + 1}번째 <strong>${kind}</strong>을 찾아요!`;
  if (voice.length) playVoiceSequence(voice);

  // 정답 1개 + 같은 종류(자음이면 자음, 모음이면 모음) 오답 3개
  const basePool = isVowel(targetJamo) ? BASIC_VOWELS : BASIC_CONSONANTS;
  const distractors = shuffle(basePool.filter(j => j !== targetJamo)).slice(0, JAMO_CHOICES - 1);
  const cards = shuffle([targetJamo, ...distractors]);

  const grid = document.getElementById('choices-grid');
  grid.classList.add('syllable-mode', 'jamo-mode');
  grid.innerHTML = '';

  cards.forEach(j => {
    const btn = document.createElement('button');
    btn.className = 'syllable-card-btn jamo-card ' + (isVowel(j) ? 'vowel' : 'consonant');
    btn.textContent = j;
    btn.onclick = () => handleJamoCardClick(btn, j, correctOpt);
    grid.appendChild(btn);
  });
}

function handleJamoCardClick(btnEl, clickedJamo, correctOpt) {
  if (puzzleTargetIndex === -1 || isInputLocked()) return;
  const target = puzzleSlots[puzzleTargetIndex];
  const expected = target.jamo[jamoIndex];

  if (clickedJamo === expected) {
    playSound('pop');
    jamoIndex++;

    if (jamoIndex >= target.jamo.length) {
      // 한 글자 완성: "아" → "하!" 처럼 자모 소리 뒤에 완성된 글자 소리
      target.done = true;
      target.justFilled = true;
      const voice = [V.jamo(clickedJamo), V.char(target.char)];
      puzzleTargetIndex = puzzleSlots.findIndex(s => !s.done);
      jamoIndex = 0;
      renderPuzzleSlots();
      if (puzzleTargetIndex === -1) {
        finishSyllablePuzzle(correctOpt, voice);
      } else {
        renderJamoChoices(correctOpt, voice);
      }
    } else {
      renderPuzzleSlots();
      renderJamoChoices(correctOpt, [V.jamo(clickedJamo)]);
    }
  } else {
    // 틀렸을 때: 카드가 부르르 떨고, 누른 자모 이름을 알려준 뒤 잠깐 잠금
    mistakes.letters++;
    playSound('wrong');
    btnEl.classList.remove('reject-shake');
    void btnEl.offsetWidth;
    btnEl.classList.add('reject-shake');
    playVoiceSequence([V.thisIs(), V.jamo(clickedJamo)]);
    lockInput(CARD_LOCK_MS);
    document.getElementById('feedback-msg').innerHTML =
      `🙅 이건 <strong>'${clickedJamo}'</strong> ${JAMO_SPOKEN[clickedJamo] || ''}! <strong>'${target.char}'</strong> 글자를 잘 보고 찾아봐요!`;
  }
}

function finishSyllablePuzzle(correctOpt, voicePrefix = []) {
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

  // 마지막 자모·글자 소리를 먼저 들려준 뒤 축하 (음성 플레이어를 재사용하므로 아이폰에서도 이어서 재생됨)
  playVoiceSequence([
    ...voicePrefix,
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
