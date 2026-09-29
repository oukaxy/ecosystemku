/*!
 * js/character.js — karakter Live2D: model, gelembung ucapan, animasi
 * Isi: live2d, bubbles, animation.
 * Dimuat sebagai <script> biasa (berbagi scope global); urutan muat penting — lihat index.html.
 */


/* ════════════════════════════════════════════════════════════════
   live2d — PixiJS, param mapping, loadModel, pemilih karakter
   ════════════════════════════════════════════════════════════════ */
/* ── PixiJS App ─────────────────────────────────────────────── */
const panel = document.getElementById('model-panel');

const app = new PIXI.Application({
  view: canvas,
  width:  panel.clientWidth,
  height: panel.clientHeight,
  backgroundColor: 0x0d1420,
  backgroundAlpha: 1,
  antialias: true,
  resolution: window.devicePixelRatio || 1,
  autoDensity: true,
  powerPreference: 'default',
  sharedTicker: false,
});

app.renderer.gl.pixelStorei(app.renderer.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
app.ticker.maxFPS = 60;
app.ticker.minFPS = 30;

function resizeApp() {
  const w = panel.clientWidth;
  const h = panel.clientHeight;
  app.renderer.resize(w, h);
  if (model) positionModel(model, w, h);
}
window.addEventListener('resize', resizeApp);

/* ================================================================
   PARAMETER MAPPING — update P berdasarkan config karakter
================================================================ */
function applyParamMapping(charCfg) {
  if (!charCfg.params) {
    // Default Liro-style (Param* camelCase)
    P = {
      eyeL:    'ParamEyeLOpen',
      eyeR:    'ParamEyeROpen',
      mouthY:  'ParamMouthOpenY',
      mouthF:  'ParamMouthForm',
      angleX:  'ParamAngleX',
      angleY:  'ParamAngleY',
      angleZ:  'ParamAngleZ',
      bodyX:   'ParamBodyAngleX',
      eyeX:    'ParamEyeBallX',
      eyeY:    'ParamEyeBallY',
      breath:  'ParamBreath',
      eyeLSmile: 'ParamEyeLSmile',
      eyeRSmile: 'ParamEyeRSmile',
      blush:   'ParamBlush',
      hairFL1: 'ParamHairFrontL1',
      hairFL2: 'ParamHairFrontL2',
      hairFR1: 'ParamHairFrontR1',
      hairFR2: 'ParamHairFrontR2',
      hairSL1: 'ParamHairSideL1',
      hairSR1: 'ParamHairSideR1',
    };
  } else {
    // Rem-style (PARAM_* uppercase) — map dari character.json
    const cp = charCfg.params;
    P = {
      eyeL:    cp.eyeL    || 'PARAM_EYE_L_OPEN',
      eyeR:    cp.eyeR    || 'PARAM_EYE_R_OPEN',
      mouthY:  cp.mouthY  || 'PARAM_MOUTH_OPEN_Y',
      mouthF:  cp.mouthF  || 'PARAM_MOUTH_FORM',
      angleX:  cp.angleX  || 'PARAM_ANGLE_X',
      angleY:  cp.angleY  || 'PARAM_ANGLE_Y',
      angleZ:  cp.angleZ  || 'PARAM_ANGLE_Z',
      bodyX:   cp.bodyX   || 'PARAM_BODY_ANGLE_X',
      eyeX:    cp.eyeBallX || 'PARAM_EYE_BALL_X',
      eyeY:    cp.eyeBallY || 'PARAM_EYE_BALL_Y',
      breath:  cp.breath  || 'PARAM_BREATH',
      // Param di bawah mungkin tidak ada di model Rem — setCoreParam akan skip kalau tidak ketemu
      eyeLSmile: 'PARAM_EYE_L_SMILE',
      eyeRSmile: 'PARAM_EYE_R_SMILE',
      blush:   'PARAM_CHEEK',
      hairFL1: 'PARAM_HAIR_FRONT',
      hairFL2: 'PARAM_HAIR_FRONT',
      hairFR1: 'PARAM_HAIR_FRONT',
      hairFR2: 'PARAM_HAIR_FRONT',
      hairSL1: 'PARAM_HAIR_SIDE',
      hairSR1: 'PARAM_HAIR_SIDE',
    };
  }
}

/* ================================================================
   LOAD MODEL — bisa dipanggil ulang saat switch karakter
================================================================ */
async function loadModel(charCfg, isSwitch = false) {
  if (isSwitch) {
    // Fade out dulu
    modelFade.classList.add('fade-in');
    await new Promise(r => setTimeout(r, 420));
  }

  // Unload model lama
  if (model) {
    app.ticker.remove(onTick);
    app.ticker.remove(tickRemHand);
    app.stage.removeChild(model);
    model.destroy();
    model = null;
  }

  // Reset expression params
  for (const key of Object.keys(exprParams)) {
    exprParams[key].current = 0;
    exprParams[key].target  = 0;
  }
  for (const key of Object.keys(remFaceParams)) {
    remFaceParams[key].current = 0;
    remFaceParams[key].target  = 0;
  }
  currentExpr = 'none';

  // Apply param mapping untuk karakter baru
  applyParamMapping(charCfg);

  // Tampilkan loading
  loadingText.textContent = `Loading ${charCfg.name}…`;
  loadingEl.classList.remove('hidden');
  errorEl.classList.remove('show');

  try {
    const { Live2DModel } = PIXI.live2d;

    model = await Live2DModel.from('./' + charCfg.modelPath, {
      autoInteract: false,
    });

    model.alpha = 1;
    app.stage.addChild(model);

    loadingEl.classList.add('hidden');
    setTimeout(() => { try { loadingEl.style.display = 'none'; } catch(_){} }, 700);

    requestAnimationFrame(() => resizeApp());

    app.ticker.add(onTick, null, -50); // LOW priority — jalan setelah motion engine
    app.ticker.add(tickRemHand, null, -100); // LOWEST — jalan paling akhir, override motion engine

    // Update nama di tag
    modelNameEl.textContent = charCfg.name;
    statusEl.textContent = '· idle';
    if (DEBUG) dbgChar.textContent = charCfg.id;

    // Rem — inisialisasi hand state ke idle[0] sebagai default
    if (charCfg.id === 'rem') {
      remCurrentHandMap  = REM_HAND_MAP['idle']?.[0] ?? {};
      remCurrentArmOrder = REM_ARM_ORDER_MAP['idle']?.[0] ?? {r:1, l:1};
    }

    // Render expression bar sesuai karakter
    renderExprBar(charCfg.id);

    // Update placeholder input
    msgInput.placeholder = `Ngobrol sama ${charCfg.name}…`;

    // Fade in model
    if (isSwitch) {
      modelFade.classList.remove('fade-in');
      modelFade.classList.add('fade-out');
      setTimeout(() => modelFade.classList.remove('fade-out'), 450);
    } else {
      modelFade.classList.remove('fade-in', 'fade-out');
    }

    return true;

  } catch (err) {
    console.error('[Live2D] Load error:', err);
    loadingEl.classList.add('hidden');
    errorEl.classList.add('show');
    errorDetail.textContent = err.message || String(err);

    if (isSwitch) {
      modelFade.classList.remove('fade-in');
    }
    return false;
  }
}

/* ================================================================
   CHARACTER SELECTOR
================================================================ */
const charBtns = document.querySelectorAll('.char-btn');

// Update tombol aktif
function updateCharBtns(activeId) {
  charBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.char === activeId);
  });
}

// Konfirmasi switch
let _pendingCharId = null;

charBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.dataset.char;
    if (targetId === currentCharId) return;

    _pendingCharId = targetId;
    const targetName = btn.dataset.name;

    // Isi modal
    modalIcon.textContent  = targetId === 'rem' ? '💙' : '💛';
    modalTitle.textContent = `Ganti ke ${targetName}?`;
    modalDesc.innerHTML    = `Chat history akan direset dan <strong>${targetName}</strong> akan menyapamu.`;

    confirmModal.classList.add('show');
  });
});

modalCancel.addEventListener('click', () => {
  confirmModal.classList.remove('show');
  _pendingCharId = null;
});

modalConfirm.addEventListener('click', async () => {
  confirmModal.classList.remove('show');
  if (!_pendingCharId) return;

  const newId = _pendingCharId;
  _pendingCharId = null;

  await switchCharacter(newId);
});

// Tutup modal kalau klik backdrop
confirmModal.addEventListener('click', (e) => {
  if (e.target === confirmModal) {
    confirmModal.classList.remove('show');
    _pendingCharId = null;
  }
});

async function switchCharacter(newId) {
  // Stop audio yang sedang main
  stopAllTTS();
  if (currentSource) {
    try { currentSource.stop(); } catch (_) {}
    currentSource = null;
  }
  isSpeaking = false;
  smoothMouth = 0;

  // Reset chat
  chatHistory = [];
  messagesEl.innerHTML = '';
  hideIdleBubble();

  // Load config baru
  const cfg = await loadCharConfig(newId);
  if (!cfg) {
    showToast(`Gagal load config karakter ${newId}`);
    return;
  }

  currentCharId = newId;
  currentChar   = cfg;
  localStorage.setItem('assistant_char', newId);

  // Update UI selector
  updateCharBtns(newId);

  // Load model baru (dengan animasi)
  const ok = await loadModel(cfg, true);
  if (!ok) return;

  // Invalidate eco cache biar prompt segar
  _ecoCache   = null;
  _ecoCacheAt = 0;

  // Reset idle timer
  resetIdleTimer();

  // Sapaan karakter baru
  initChat(true);
}

/* ════════════════════════════════════════════════════════════════
   bubbles — Sistem gelembung ucapan (idle/sentuh) + klip suara
   ════════════════════════════════════════════════════════════════ */
/* ================================================================
   IDLE BUBBLE SYSTEM
================================================================ */
const idleBubbleEl    = document.getElementById('idle-bubble');
const idleBubbleInner = idleBubbleEl.querySelector('.idle-bubble-inner');

const AUDIO_BASE_DEFAULT = './characters/rem/audio/';

// Bubble texts per zona — Liro
const BUBBLE_IDLE_LIRO = [
  { text: '💭 Hmm… kamu lagi ngapain ya?',        audio: 'idle_1.mp3'  },
  { text: '💭 Aku di sini kalau butuh apa-apa~',  audio: 'idle_2.mp3'  },
  { text: '💭 Sudah minum air hari ini?',          audio: 'idle_3.mp3'  },
  { text: '💭 Jangan lupa istirahat ya…',          audio: 'idle_4.mp3'  },
  { text: '💭 Ada yang ingin kamu ceritain?',      audio: 'idle_5.mp3'  },
  { text: '💭 Hari ini produktif gak?',            audio: 'idle_6.mp3'  },
  { text: '💭 Mau ngobrol atau butuh bantuan?',    audio: 'idle_7.mp3'  },
  { text: '💭 Kalau bosen, ajak aku ngobrol aja~', audio: 'idle_8.mp3'  },
  { text: '💭 Kamu baik-baik aja kan?',            audio: 'idle_9.mp3'  },
  { text: '💭 Lagi fokus ya? Aku tunggu deh.',     audio: 'idle_10.mp3' },
];

const BUBBLE_HEAD_LIRO = [
  { text: '💭 A-apa… jangan usil~',           audio: 'head_1.mp3' },
  { text: '💭 Hei, rambutku berantakan tau!',  audio: 'head_2.mp3' },
  { text: '💭 Eh, geli tau… hehe',             audio: 'head_3.mp3' },
  { text: '💭 Apaan sih kamu ini… hmp!',       audio: 'head_4.mp3' },
  { text: '💭 S-stop, aku malu…',              audio: 'head_5.mp3' },
];

const BUBBLE_PET_LIRO = [
  { text: '💭 Hehe~',                              audio: 'pet_1.mp3' },
  { text: '💭 Nn… enak juga sih…',                 audio: 'pet_2.mp3' },
  { text: '💭 E-eh, terus aja boleh kok… >///<',   audio: 'pet_3.mp3' },
  { text: '💭 Fufu~ senang dielus~',               audio: 'pet_4.mp3' },
  { text: '💭 A… jangan berhenti…',                audio: 'pet_5.mp3' },
  { text: '💭 Kamu baik banget sih… hehe',         audio: 'pet_6.mp3' },
  { text: '💭 Muu~ kamu usil deh~',                audio: 'pet_7.mp3' },
  { text: '💭 Eh, aku senang tau dielus gini~',    audio: 'pet_8.mp3' },
];

const BUBBLE_BODY_LIRO = [
  { text: '💭 Hei, jangan colek-colek dong!',   audio: 'body_1.mp3' },
  { text: '💭 Eh, ada apa?',                     audio: 'body_2.mp3' },
  { text: '💭 Kaget tau tiba-tiba!',             audio: 'body_3.mp3' },
  { text: '💭 Mau ngomong sesuatu?',             audio: 'body_4.mp3' },
  { text: '💭 Hmm? Ada yang bisa aku bantu?',    audio: 'body_5.mp3' },
];

const BUBBLE_LEG_LIRO = [
  { text: '💭 Eh, kenapa lihat ke bawah?',      audio: 'leg_1.mp3' },
  { text: '💭 H-hei, jangan lihat kaki aku!',   audio: 'leg_2.mp3' },
  { text: '💭 Aku tau rokku lucu~ hehe',         audio: 'leg_3.mp3' },
  { text: '💭 Ada yang aneh di bawah sini?',     audio: 'leg_4.mp3' },
  { text: '💭 Jangan ngintip ya!',               audio: 'leg_5.mp3' },
];

// Bubble texts — Rem
const BUBBLE_IDLE_REM = [
  { text: '💙 Tuan sedang apa?',                          audio: 'idle_1.mp3' },
  { text: '💙 Rem di sini, Tuan.',                        audio: 'idle_2.mp3' },
  { text: '💙 Sudah makan belum, Tuan?',                  audio: 'idle_3.mp3' },
  { text: '💙 Kalau perlu sesuatu, bilang Rem saja.',     audio: 'idle_4.mp3' },
  { text: '💙 Tuan tidak kelelahan?',                     audio: 'idle_5.mp3' },
  { text: '💙 Rem senang bisa menemani Tuan.',            audio: 'idle_6.mp3' },
  { text: '💙 Tuan tampak sibuk… ada yang bisa Rem bantu?', audio: 'idle_7.mp3' },
];

const BUBBLE_HEAD_REM = [
  { text: '💙 T-Tuan…?!',                        audio: 'head_1.mp3' },
  { text: '💙 Rem jadi salah tingkah…',           audio: 'head_2.mp3' },
  { text: '💙 A… apa yang Tuan lakukan…',         audio: 'head_3.mp3' },
  { text: '💙 T-Tuan, ini tidak pantas…!',        audio: 'head_4.mp3' },
  { text: '💙 Rem… tidak keberatan, tapi…',       audio: 'head_5.mp3' },
];

const BUBBLE_PET_REM = [
  { text: '💙 T-Tuan…',                          audio: 'pet_1.mp3' },
  { text: '💙 Rem… tidak keberatan.',             audio: 'pet_2.mp3' },
  { text: '💙 Ini membuat Rem bahagia.',          audio: 'pet_3.mp3' },
  { text: '💙 Tuan sangat baik…',                audio: 'pet_4.mp3' },
  { text: '💙 Rem tersenyum tanpa sadar.',        audio: 'pet_5.mp3' },
];

const BUBBLE_BODY_REM = [
  { text: '💙 Ada yang bisa Rem bantu?',                      audio: 'body_1.mp3' },
  { text: '💙 Rem siap, Tuan.',                               audio: 'body_2.mp3' },
  { text: '💙 Tuan mencari Rem?',                             audio: 'body_3.mp3' },
  { text: '💙 Ada sesuatu yang ingin Tuan sampaikan?',        audio: 'body_4.mp3' },
];

const BUBBLE_LEG_REM = [
  { text: '💙 T-Tuan… ke mana Tuan melihat?',        audio: 'leg_1.mp3' },
  { text: '💙 Rem harap Tuan menjaga pandangan.',     audio: 'leg_2.mp3' },
  { text: '💙 Rem… jadi malu.',                       audio: 'leg_3.mp3' },
];

// Getter bubble berdasarkan karakter aktif
function getBubbles(zone) {
  const isRem = currentCharId === 'rem';
  switch(zone) {
    case 'idle': return isRem ? BUBBLE_IDLE_REM : BUBBLE_IDLE_LIRO;
    case 'head': return isRem ? BUBBLE_HEAD_REM : BUBBLE_HEAD_LIRO;
    case 'pet':  return isRem ? BUBBLE_PET_REM  : BUBBLE_PET_LIRO;
    case 'body': return isRem ? BUBBLE_BODY_REM : BUBBLE_BODY_LIRO;
    case 'leg':  return isRem ? BUBBLE_LEG_REM  : BUBBLE_LEG_LIRO;
    default: return [];
  }
}

let _bubbleSource   = null;
let bubbleHideTimer = null;
let idleTimer       = null;
let petBubbleTimer  = null;
let petBubbleShown  = false;
let lastInteractAt  = Date.now();
const IDLE_DELAY    = 30_000;
let _bubbleCooldown = 0;
const BUBBLE_COOLDOWN_MS = 4000;

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function playBubbleAudio(filename) {
  if (isSpeaking || !filename) return;
  const audioBase = currentChar?.audioBase ? './' + currentChar.audioBase : AUDIO_BASE_DEFAULT;

  ensureAudioCtx();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  if (_bubbleSource) {
    try { _bubbleSource.mediaElement.pause(); _bubbleSource.disconnect(); } catch (_) {}
    _bubbleSource = null;
  }

  const audio = new Audio(audioBase + filename);
  audio.volume = 0.85;
  audio.crossOrigin = 'anonymous';

  try {
    const src = audioCtx.createMediaElementSource(audio);
    src.connect(analyser);
    _bubbleSource = src;

    isSpeaking = true;
    document.getElementById('model-tag').classList.add('speaking');
    statusEl.textContent = '· berbicara…';

    audio.play().catch(() => {
      isSpeaking = false;
      document.getElementById('model-tag').classList.remove('speaking');
      statusEl.textContent = `· idle`;
    });

    audio.onended = () => {
      isSpeaking    = false;
      smoothMouth   = 0;
      setCoreParam(P.mouthY, 0);
      setCoreParam(P.mouthF, 0);
      document.getElementById('model-tag').classList.remove('speaking');
      statusEl.textContent = `· idle`;
      _bubbleSource = null;
    };
  } catch (_) {
    audio.play().catch(() => {});
  }
}

function showIdleBubble(item, duration = 4000) {
  const text  = typeof item === 'string' ? item : item.text;
  const audio = typeof item === 'object' ? item.audio : null;

  if (isThinking || isSpeaking) return;
  if (audio) playBubbleAudio(audio);

  clearTimeout(bubbleHideTimer);
  idleBubbleInner.textContent = text;

  idleBubbleEl.classList.remove('show', 'hide');
  void idleBubbleEl.offsetWidth;
  idleBubbleEl.classList.add('show');

  bubbleHideTimer = setTimeout(() => {
    idleBubbleEl.classList.remove('show');
    idleBubbleEl.classList.add('hide');
    setTimeout(() => idleBubbleEl.classList.remove('hide'), 350);
  }, duration);
}

function hideIdleBubble() {
  clearTimeout(bubbleHideTimer);
  idleBubbleEl.classList.remove('show');
  idleBubbleEl.classList.add('hide');
  setTimeout(() => idleBubbleEl.classList.remove('hide'), 350);
}

function resetIdleTimer() {
  lastInteractAt = Date.now();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    showIdleBubble(pickRandom(getBubbles('idle')), 5000);
    if (currentCharId === 'rem') playRemMotion('idle');
    scheduleIdleBubble();
  }, IDLE_DELAY);
}

function scheduleIdleBubble() {
  clearTimeout(idleTimer);
  const next = 25_000 + Math.random() * 15_000;
  idleTimer = setTimeout(() => {
    if (Date.now() - lastInteractAt >= 25_000) {
      showIdleBubble(pickRandom(getBubbles('idle')), 5000);
    }
    scheduleIdleBubble();
  }, next);
}

['click', 'keydown', 'touchstart'].forEach(ev => {
  window.addEventListener(ev, resetIdleTimer, { passive: true });
});

/* ════════════════════════════════════════════════════════════════
   animation — Animasi: kedip, idle, kursor, lip-sync, ekspresi, sentuhan
   ════════════════════════════════════════════════════════════════ */
/* ── Zone definitions ────────────────────────────────────── */
function isHeadZone(relY, relX) { return relY < 0.48 && relX > 0.12 && relX < 0.88; }
function isBodyZone(relY, relX) { return relY >= 0.48 && relY < 0.75 && relX > 0.15 && relX < 0.85; }
function isLegZone(relY, relX)  { return relY >= 0.75 && relY < 0.95 && relX > 0.20 && relX < 0.80; }

function triggerNudge() {
  if (model) {
    setCoreParam(P.angleY, -10);
    setTimeout(() => setCoreParam(P.angleY, 0), 280);
  }
}

/* ── Position model ─────────────────────────────────────────── */
function positionModel(m, W, H) {
  const isMobile = W < 700;
  const isRem    = currentCharId === 'rem';
  const modelH   = m.internalModel?.height || 800;

  const fitRatio = isRem
    ? (isMobile ? 1.40 : 1.40)
    : (isMobile ? 1.20 : 1.10);
  const scale    = (H * fitRatio) / modelH;

  m.scale.set(scale);
  m.anchor.set(0.5, 1);
  m.x = W * 0.5;

  // Rem full body — geser ke bawah supaya kaki tidak kelihatan,
  // hanya bagian atas (torso) yang tampil seperti Liro
  m.y = isRem
    ? H * (isMobile ? 1.45 : 1.38)
    : H * 0.97;
}

/* ── Cursor tracking ─────────────────────────────────────────── */
function updateCursor(clientX, clientY) {
  const rect = panel.getBoundingClientRect();
  cursorX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  cursorY = Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height));
  if (DEBUG) dbgCursor.textContent = `${cursorX.toFixed(2)}, ${cursorY.toFixed(2)}`;
}

window.addEventListener('mousemove', e => updateCursor(e.clientX, e.clientY));
window.addEventListener('touchmove', e => {
  const t = e.touches[0];
  updateCursor(t.clientX, t.clientY);
}, { passive: true });

/* ── Auto eye blink ─────────────────────────────────────────── */
function scheduleNextBlink() {
  blinkTimer = 2.5 + Math.random() * 3.5;
  blinkState = 'open';
  blinkT     = 0;
}
scheduleNextBlink();

function tickBlink(delta) {
  const dt = delta / 60;
  blinkTimer -= dt;

  if (blinkState === 'open' && blinkTimer <= 0) { blinkState = 'closing'; blinkT = 0; }

  let eyeVal = 1;
  if (blinkState === 'closing') {
    blinkT += dt / 0.08; eyeVal = Math.max(0, 1 - blinkT);
    if (blinkT >= 1) { blinkState = 'closed'; blinkT = 0; }
  } else if (blinkState === 'closed') {
    blinkT += dt / 0.05; eyeVal = 0;
    if (blinkT >= 1) { blinkState = 'opening'; blinkT = 0; }
  } else if (blinkState === 'opening') {
    blinkT += dt / 0.10; eyeVal = Math.min(1, blinkT);
    if (blinkT >= 1) { scheduleNextBlink(); eyeVal = 1; }
  }

  if (model) {
    setCoreParam(P.eyeR, eyeVal);
    setCoreParam(P.eyeL, eyeVal);
  }
  if (DEBUG) dbgBlink.textContent = blinkState;
}

/* ── Idle animation ─────────────────────────────────────────── */
function tickIdle(delta) {
  const dt = delta / 60;
  idleBreath += dt;
  idleHead   += dt;
  if (!model) return;
  const breathVal = Math.sin(idleBreath * (Math.PI * 2 / 4)) * 0.4;
  setCoreParam(P.breath, breathVal);
  idleAngleZ = Math.sin(idleHead * (Math.PI * 2 / 7)) * 4;
  setCoreParam(P.angleZ, idleAngleZ);
}

/* ── Cursor follow ───────────────────────────────────────────── */
function tickFollow(delta) {
  if (!model) return;
  const dt = delta / 60;
  const lerpSpeed = 3.5 * dt;
  smoothCX += (cursorX - smoothCX) * lerpSpeed;
  smoothCY += (cursorY - smoothCY) * lerpSpeed;
  const angleX = (smoothCX - 0.5) * 2 * 20;
  const angleY = (0.5 - smoothCY) * 2 * 15;
  const eyeX   = (smoothCX - 0.5) * 2 * 1;
  const eyeY   = (0.5 - smoothCY) * 2 * 0.6;
  const bodyX  = angleX * 0.12;
  setCoreParam(P.angleX, angleX);
  setCoreParam(P.angleY, angleY);
  setCoreParam(P.eyeX,   eyeX);
  setCoreParam(P.eyeY,   eyeY);
  setCoreParam(P.bodyX,  bodyX);
}

/* ── Lip sync ────────────────────────────────────────────────── */
let smoothMouth = 0;

function tickLipSync() {
  if (!model) return;
  let targetMouth = 0;
  if (isSpeaking && analyser && fftBuf) {
    analyser.getByteFrequencyData(fftBuf);
    const start = 2, end = Math.min(18, fftBuf.length - 1);
    let sum = 0;
    for (let i = start; i <= end; i++) sum += fftBuf[i];
    targetMouth = Math.min(1, (sum / (end - start + 1) / 255) * 2.2);
  }
  const speed = targetMouth > smoothMouth ? 0.35 : 0.12;
  smoothMouth += (targetMouth - smoothMouth) * speed;
  setCoreParam(P.mouthY, smoothMouth);
  setCoreParam(P.mouthF, isSpeaking ? 0.3 : 0);
}

/* ── Tick expression ─────────────────────────────────────────── */

// Rem face params — smooth fade seperti Liro tapi pakai param Rem
let remFaceParams = {
  PARAM_MOUTH_FORM_01:  { current: 0, target: 0, fadeIn: 0.06, fadeOut: 0.04 },
  PARAM_BROW_R_FORM:    { current: 0, target: 0, fadeIn: 0.06, fadeOut: 0.04 },
  PARAM_BROW_L_FORM:    { current: 0, target: 0, fadeIn: 0.06, fadeOut: 0.04 },
  PARAM_EYE_R_SMILE:    { current: 0, target: 0, fadeIn: 0.05, fadeOut: 0.04 },
  PARAM_EYE_L_SMILE:    { current: 0, target: 0, fadeIn: 0.05, fadeOut: 0.04 },
  PARAM_EYE_FORM:       { current: 0, target: 0, fadeIn: 0.05, fadeOut: 0.04 },
  PARAM_CHEEK_01:       { current: 0, target: 0, fadeIn: 0.04, fadeOut: 0.03 },
  PARAM_TEAR_01:        { current: 0, target: 0, fadeIn: 0.03, fadeOut: 0.02 },
};

// Mapping ekspresi → nilai target — dari data motion3.json asli
const REM_FACE_MAP = {
  none:    { PARAM_MOUTH_FORM_01:  0,    PARAM_BROW_R_FORM:  0,    PARAM_BROW_L_FORM:  0,    PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  happy:   { PARAM_MOUTH_FORM_01:  1,    PARAM_BROW_R_FORM:  0,    PARAM_BROW_L_FORM:  0,    PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  smile:   { PARAM_MOUTH_FORM_01:  1,    PARAM_BROW_R_FORM:  1,    PARAM_BROW_L_FORM:  1,    PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  1,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  appeal:  { PARAM_MOUTH_FORM_01:  1,    PARAM_BROW_R_FORM:  0,    PARAM_BROW_L_FORM:  0,    PARAM_EYE_R_SMILE:  1,    PARAM_EYE_L_SMILE:  1,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  proud:   { PARAM_MOUTH_FORM_01:  0,    PARAM_BROW_R_FORM:  0,    PARAM_BROW_L_FORM:  0,    PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  shame:   { PARAM_MOUTH_FORM_01: -0.8,  PARAM_BROW_R_FORM: -0.8,  PARAM_BROW_L_FORM: -0.8,  PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  1,   PARAM_CHEEK_01: 1,   PARAM_TEAR_01: 0 },
  sad:     { PARAM_MOUTH_FORM_01: -0.8,  PARAM_BROW_R_FORM: -0.5,  PARAM_BROW_L_FORM: -0.5,  PARAM_EYE_R_SMILE: -1,    PARAM_EYE_L_SMILE: -1,    PARAM_EYE_FORM:  1,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  cry:     { PARAM_MOUTH_FORM_01: -0.8,  PARAM_BROW_R_FORM: -0.5,  PARAM_BROW_L_FORM: -0.5,  PARAM_EYE_R_SMILE: -1,    PARAM_EYE_L_SMILE: -1,    PARAM_EYE_FORM:  1,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 1 },
  angry:   { PARAM_MOUTH_FORM_01: -1,    PARAM_BROW_R_FORM: -1,    PARAM_BROW_L_FORM: -1,    PARAM_EYE_R_SMILE: -0.7,  PARAM_EYE_L_SMILE: -0.7,  PARAM_EYE_FORM: -0.6, PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  upset:   { PARAM_MOUTH_FORM_01: -2,    PARAM_BROW_R_FORM: -0.8,  PARAM_BROW_L_FORM: -0.8,  PARAM_EYE_R_SMILE: -0.5,  PARAM_EYE_L_SMILE: -0.5,  PARAM_EYE_FORM:  1,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  serious: { PARAM_MOUTH_FORM_01: -0.6,  PARAM_BROW_R_FORM: -0.5,  PARAM_BROW_L_FORM: -0.5,  PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM: -1,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  surprise:{ PARAM_MOUTH_FORM_01: -0.6,  PARAM_BROW_R_FORM: -0.7,  PARAM_BROW_L_FORM: -0.7,  PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  doubt:   { PARAM_MOUTH_FORM_01: -0.8,  PARAM_BROW_R_FORM: -0.5,  PARAM_BROW_L_FORM: -0.5,  PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  puzzle:  { PARAM_MOUTH_FORM_01: -0.5,  PARAM_BROW_R_FORM: -0.6,  PARAM_BROW_L_FORM: -0.6,  PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  1,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  navi:    { PARAM_MOUTH_FORM_01:  1,    PARAM_BROW_R_FORM:  0.8,  PARAM_BROW_L_FORM:  0.8,  PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
  idle:    { PARAM_MOUTH_FORM_01:  0,    PARAM_BROW_R_FORM:  0,    PARAM_BROW_L_FORM:  0,    PARAM_EYE_R_SMILE:  0,    PARAM_EYE_L_SMILE:  0,    PARAM_EYE_FORM:  0,   PARAM_CHEEK_01: 0,   PARAM_TEAR_01: 0 },
};

function setRemFace(exprName) {
  const map = REM_FACE_MAP[exprName] || REM_FACE_MAP['none'];
  // Reset semua ke none dulu biar tidak ketumpuk
  const noneMap = REM_FACE_MAP['none'];
  for (const [param, s] of Object.entries(remFaceParams)) {
    s.target = map[param] !== undefined ? map[param] : (noneMap[param] ?? 0);
  }
}

function tickExpression() {
  if (!model) return;

  // Liro — smooth fade via exprParams
  if (currentCharId !== 'rem') {
    for (const [paramId, s] of Object.entries(exprParams)) {
      if (s.current === s.target) continue;
      const speed = Math.abs(s.target) > Math.abs(s.current) ? s.fadeIn : s.fadeOut;
      s.current += (s.target - s.current) * speed;
      if (Math.abs(s.current - s.target) < 0.001) s.current = s.target;
      setCoreParam(paramId, s.current);
    }
    return;
  }

  // Rem — smooth fade via remFaceParams
  for (const [paramId, s] of Object.entries(remFaceParams)) {
    if (s.current !== s.target) {
      const speed = Math.abs(s.target) > Math.abs(s.current) ? s.fadeIn : s.fadeOut;
      s.current += (s.target - s.current) * speed;
      if (Math.abs(s.current - s.target) < 0.001) s.current = s.target;
    }
    // Re-apply every frame after the motion engine so facial expression owns these params.
    setCoreParam(paramId, s.current);
  }
}

function tickRemHand() {
  if (!model || currentCharId !== 'rem') return;
  // Apply ulang HAND & ARM params tiap frame — cegah motion engine reset ke 0
  ALL_HAND_PARAMS.forEach(p => setCoreParam(p, 0));
  Object.entries(remCurrentHandMap).forEach(([p, v]) => setCoreParam(p, v));
  setCoreParam('PARAM_ARM_R_ORDER', remCurrentArmOrder.r);
  setCoreParam('PARAM_ARM_L_ORDER', remCurrentArmOrder.l);
}

function onTick(delta) {
  tickBlink(delta);
  tickIdle(delta);
  tickFollow(delta);
  tickLipSync();
  tickExpression();
  tickPet(delta);

  if (DEBUG) {
    frameCount++;
    const now = performance.now();
    if (now - lastFpsTime >= 1000) {
      fps = Math.round(frameCount * 1000 / (now - lastFpsTime));
      dbgFps.textContent = fps;
      frameCount  = 0;
      lastFpsTime = now;
    }
  }
}

/* ── Set core parameter helper ───────────────────────────────── */
function setCoreParam(name, value) {
  try {
    const core = model?.internalModel?.coreModel;
    if (!core) return;
    const idx = core.getParameterIndex(name);
    if (idx < 0) return;
    core.setParameterValueByIndex(idx, value, 1.0);
  } catch(_) {}
}

/* ── Expression control ──────────────────────────────────────── */
// Mapping HAND params per motion — diambil langsung dari file .motion3.json
// Hanya param yang bernilai > 0 yang dicantumkan (sisanya = 0)
const REM_HAND_MAP = {
  'happy':    [ // index 0: happy_01, index 1: happy_02
    { PARAM_HAND_R_08: 1, PARAM_HAND_L_01: 1 },
    { PARAM_HAND_R_08: 1, PARAM_HAND_L_08: 1 },
  ],
  'sad':      [
    { PARAM_HAND_R_08: 1, PARAM_HAND_L_08: 1 },
    { PARAM_HAND_R_08: 1, PARAM_HAND_L_08: 1 },
  ],
  'cry':      [ { PARAM_HAND_R_08: 1, PARAM_HAND_L_04: 1 } ],
  'angry':    [ { PARAM_HAND_R_07: 1, PARAM_HAND_L_07: 1 },
                { PARAM_HAND_R_07: 1, PARAM_HAND_L_07: 1 } ],
  'surprise': [ { PARAM_HAND_R_04: 1, PARAM_HAND_L_04: 1 } ],
  'shame':    [ { PARAM_HAND_R_05: 1, PARAM_HAND_L_05: 1 },
                { PARAM_HAND_R_05: 1, PARAM_HAND_L_05: 1 } ],
  'upset':    [ { PARAM_HAND_R_05: 1, PARAM_HAND_L_07: 1 } ],
  'serious':  [ { PARAM_HAND_R_04: 1, PARAM_HAND_L_04: 1 },
                { PARAM_HAND_R_04: 1, PARAM_HAND_L_04: 1 } ],
  'proud':    [ { PARAM_HAND_R_05: 1, PARAM_HAND_L_01: 1 } ],
  'doubt':    [ { PARAM_HAND_R_07: 1, PARAM_HAND_L_07: 1 } ],
  'puzzle':   [ { PARAM_HAND_R_08: 1, PARAM_HAND_L_01: 1 },
                { PARAM_HAND_R_08: 1, PARAM_HAND_L_01: 1 },
                { PARAM_HAND_R_08: 1, PARAM_HAND_L_01: 1 } ],
  'appeal':   [ { PARAM_HAND_R_04: 1, PARAM_HAND_L_04: 1 },
                { PARAM_HAND_R_05: 1, PARAM_HAND_L_05: 1 },
                { PARAM_HAND_R_05: 1, PARAM_HAND_L_05: 1 } ],
  'smile':    [ { PARAM_HAND_R_05: 1, PARAM_HAND_L_07: 1 } ],
  'idle':     [ // index 0: wait_01, index 1: navi_01, index 2-4: bound
    { PARAM_HAND_R_05: 1, PARAM_HAND_L_07: 1 },
    { PARAM_HAND_R_02: 1, PARAM_HAND_L_07: 1 },
    { PARAM_HAND_R_05: 1, PARAM_HAND_L_07: 1 },
    { PARAM_HAND_R_05: 1, PARAM_HAND_L_07: 1 },
    { PARAM_HAND_R_05: 1, PARAM_HAND_L_07: 1 },
  ],
};

// Mapping ARM_ORDER per motion — diambil dari file .motion3.json
const REM_ARM_ORDER_MAP = {
  'happy':    [ {r:1,l:1}, {r:1,l:1} ],
  'sad':      [ {r:1,l:1}, {r:1,l:1} ],
  'cry':      [ {r:1,l:1} ],
  'angry':    [ {r:0,l:0}, {r:0,l:0} ],
  'surprise': [ {r:1,l:1} ],
  'shame':    [ {r:1,l:1}, {r:1,l:1} ],
  'upset':    [ {r:1,l:0} ],
  'serious':  [ {r:1,l:1}, {r:1,l:1} ],
  'proud':    [ {r:1,l:1} ],
  'doubt':    [ {r:1,l:1} ],
  'puzzle':   [ {r:1,l:1}, {r:1,l:1}, {r:1,l:1} ],
  'appeal':   [ {r:1,l:1}, {r:1,l:1}, {r:1,l:1} ],
  'smile':    [ {r:1,l:1} ],
  'idle':     [ {r:1,l:1}, {r:1,l:1}, {r:1,l:1}, {r:1,l:1}, {r:1,l:1} ],
};

// State HAND & ARM params yang sedang aktif — di-apply ulang tiap frame
let remCurrentHandMap = {};
let remCurrentArmOrder = { r: 1, l: 1 };

const ALL_HAND_PARAMS = [
  'PARAM_HAND_R_01','PARAM_HAND_R_02','PARAM_HAND_R_03','PARAM_HAND_R_04',
  'PARAM_HAND_R_05','PARAM_HAND_R_06','PARAM_HAND_R_07','PARAM_HAND_R_08',
  'PARAM_HAND_R_09','PARAM_HAND_R_10','PARAM_HAND_R_11',
  'PARAM_HAND_L_01','PARAM_HAND_L_02','PARAM_HAND_L_03','PARAM_HAND_L_04',
  'PARAM_HAND_L_05','PARAM_HAND_L_06','PARAM_HAND_L_07','PARAM_HAND_L_08',
  'PARAM_HAND_L_09','PARAM_HAND_L_10','PARAM_HAND_L_11',
];

// Rem motion map — group name → jumlah motion (sesuai Character.model3.json)
// playRemMotion akan random index dari 0..(count-1)
const REM_MOTION_MAP = {
  'happy':    2,
  'sad':      2,
  'cry':      1,
  'angry':    2,
  'surprise': 1,
  'shame':    2,
  'upset':    1,
  'serious':  2,
  'proud':    1,
  'doubt':    1,
  'puzzle':   3,
  'appeal':   3,
  'smile':    1,
  'idle':     5,
  'wait':     0,
  'bound':    0,
  'navi':     0,
  'none':     0,
};

// Reset semua HAND params ke 0
function resetRemHandParams() {
  if (!model) return;
  const handParams = [
    'PARAM_HAND_R_01','PARAM_HAND_R_02','PARAM_HAND_R_03','PARAM_HAND_R_04',
    'PARAM_HAND_R_05','PARAM_HAND_R_06','PARAM_HAND_R_07','PARAM_HAND_R_08',
    'PARAM_HAND_R_09','PARAM_HAND_R_10','PARAM_HAND_R_11',
    'PARAM_HAND_L_01','PARAM_HAND_L_02','PARAM_HAND_L_03','PARAM_HAND_L_04',
    'PARAM_HAND_L_05','PARAM_HAND_L_06','PARAM_HAND_L_07','PARAM_HAND_L_08',
    'PARAM_HAND_L_09','PARAM_HAND_L_10','PARAM_HAND_L_11',
    'PARAM_HAND_R_ROTATE','PARAM_HAND_L_ROTATE',
  ];
  handParams.forEach(p => setCoreParam(p, 0));
}

function playRemMotion(name) {
  if (!model || currentCharId !== 'rem') return;
  const count = REM_MOTION_MAP[name];
  if (!count || count === 0) return;
  const index = Math.floor(Math.random() * count);

  // Simpan state untuk di-apply ulang tiap frame (supaya tidak di-reset motion engine)
  remCurrentHandMap = REM_HAND_MAP[name]?.[index] ?? {};
  remCurrentArmOrder = REM_ARM_ORDER_MAP[name]?.[index] ?? {r:1, l:1};

  // Apply sekarang juga
  ALL_HAND_PARAMS.forEach(p => setCoreParam(p, 0));
  Object.entries(remCurrentHandMap).forEach(([p, v]) => setCoreParam(p, v));
  setCoreParam('PARAM_ARM_R_ORDER', remCurrentArmOrder.r);
  setCoreParam('PARAM_ARM_L_ORDER', remCurrentArmOrder.l);

  // Play motion untuk animasi tubuh/wajah (motion engine handle sisanya)
  try {
    model.motion(name, index, 2);
  } catch (_) {
    try {
      model.internalModel.motionManager.startMotion(name, index, 2);
    } catch (_2) {}
  }
}

// Pemicu ekspresi sesaat (tap kepala/badan/kaki, pet, dll).
// Beda dari memanggil playRemMotion() langsung: ini lewat setExpression()
// supaya remFaceParams (termasuk PARAM_CHEEK_01 / blush) ikut diset & di-reset,
// dan ada auto-revert ke 'none' setelah beberapa detik — sama seperti tag [EXPR:...] dari LLM.
function triggerRemExpression(name, revertMs = 4000) {
  if (currentCharId !== 'rem') return;
  setExpression(name);
  setTimeout(() => {
    if (currentExpr === name) setExpression('none');
  }, revertMs);
}

function setExpression(name) {
  if (!model) return;
  currentExpr = name;
  if (DEBUG) dbgExpr.textContent = name;

  // Rem — play motion + set face params
  if (currentCharId === 'rem') {
    // 'none' = kembali ke idle motion
    playRemMotion(name === 'none' ? 'idle' : name);
    setRemFace(name);
    statusEl.textContent = name === 'none' ? '· idle' : `· ${name}`;
    return;
  }

  // Untuk model dengan params (Liro) — smooth fade
  for (const key of Object.keys(exprParams)) {
    exprParams[key].target = 0;
  }

  if (currentChar?.expressions) {
    const exprCfg = currentChar.expressions[name];
    if (exprCfg?.param) {
      if (exprParams[exprCfg.param] !== undefined) {
        exprParams[exprCfg.param].target = exprCfg.value;
      }
    }
  } else {
    // Fallback hardcoded Liro
    switch (name) {
      case 'blush':    exprParams.ParamBlush.target    =  1; break;
      case 'browLink': exprParams.ParamBrowLink.target = -1; break;
      case 'cool':     exprParams.ParamCool.target     =  1; break;
      case 'worried':  exprParams.ParamBrowForm.target =  1; break;
    }
  }

  // Update active pill
  document.querySelectorAll('.expr-pill').forEach(p =>
    p.classList.toggle('active', p.dataset.expr === name)
  );
  statusEl.textContent = name === 'none' ? '· idle' : `· ${name}`;
}

// Config ekspresi per karakter — emoji + label + expr key
const EXPR_CONFIG = {
  liro: [
    { expr: 'none',     emoji: '😐', label: 'Default'  },
    { expr: 'blush',    emoji: '😳', label: 'Blush'    },
    { expr: 'browLink', emoji: '🤨', label: 'BrowLink' },
    { expr: 'cool',     emoji: '😎', label: 'Cool'     },
    { expr: 'worried',  emoji: '😟', label: 'Worried'  },
  ],
  rem: [
    { expr: 'none',     emoji: '😐', label: 'Default'  },
    { expr: 'happy',    emoji: '😊', label: 'Happy'    },
    { expr: 'smile',    emoji: '🙂', label: 'Smile'    },
    { expr: 'shame',    emoji: '😳', label: 'Shame'    },
    { expr: 'sad',      emoji: '😢', label: 'Sad'      },
    { expr: 'cry',      emoji: '😭', label: 'Cry'      },
    { expr: 'angry',    emoji: '😠', label: 'Angry'    },
    { expr: 'surprise', emoji: '😲', label: 'Surprise' },
    { expr: 'serious',  emoji: '😤', label: 'Serious'  },
    { expr: 'proud',    emoji: '😌', label: 'Proud'    },
    { expr: 'doubt',    emoji: '🤔', label: 'Doubt'    },
    { expr: 'puzzle',   emoji: '😕', label: 'Puzzle'   },
    { expr: 'upset',    emoji: '😒', label: 'Upset'    },
  ],
};

function renderExprBar(charId) {
  const pills = EXPR_CONFIG[charId] || EXPR_CONFIG['rem'];
  exprBar.innerHTML = pills.map(p =>
    `<button class="expr-pill${p.expr === 'none' ? ' active' : ''}" data-expr="${p.expr}">${p.emoji} ${p.label}</button>`
  ).join('');
  // Re-attach listeners
  exprBar.querySelectorAll('.expr-pill').forEach(pill => {
    pill.addEventListener('click', () => setExpression(pill.dataset.expr));
  });
  // Reset expr toggle label
  exprToggle.childNodes[0].textContent = '😐 Ekspresi ';
}

/* ── Expression bar toggle ───────────────────────────────────── */
function initExprToggle() {
  exprToggle.style.display = 'flex';
  exprToggle.addEventListener('click', () => {
    const isOpen = exprBar.classList.toggle('open');
    exprToggle.classList.toggle('open', isOpen);
    const activeExpr = document.querySelector('.expr-pill.active');
    exprToggle.childNodes[0].textContent = (activeExpr?.textContent?.trim() || '😐 Ekspresi') + ' ';
  });
}
initExprToggle();

/* ── Tap model → random blink ────────────────────────────────── */
canvas.addEventListener('click', () => {
  if (blinkState === 'open') blinkTimer = 0;
});

/* ── Unified pointer handler ─────────────────────────────── */
let _tapStartX = 0, _tapStartY = 0, _tapMoved = false;

canvas.addEventListener('pointerdown', e => {
  const rect = canvas.getBoundingClientRect();
  const y = (e.clientY - rect.top)  / rect.height;
  const x = (e.clientX - rect.left) / rect.width;
  if (isHeadZone(y, x)) petActive = true;
  _tapStartX = e.clientX;
  _tapStartY = e.clientY;
  _tapMoved  = false;
}, { passive: true });

canvas.addEventListener('pointermove', e => {
  if (Math.abs(e.clientX - _tapStartX) > 10 || Math.abs(e.clientY - _tapStartY) > 10) {
    _tapMoved = true;
  }
}, { passive: true });

canvas.addEventListener('pointerup', e => {
  petActive = false;
  if (_tapMoved || isThinking || isSpeaking) return;
  if (Date.now() < _bubbleCooldown) return;

  const rect = canvas.getBoundingClientRect();
  const y = (e.clientY - rect.top)  / rect.height;
  const x = (e.clientX - rect.left) / rect.width;

  if (isHeadZone(y, x)) {
    showIdleBubble(pickRandom(getBubbles('head')), 3500);
    triggerRemExpression('shame');
    _bubbleCooldown = Date.now() + BUBBLE_COOLDOWN_MS;
  } else if (isBodyZone(y, x)) {
    showIdleBubble(pickRandom(getBubbles('body')), 3000);
    triggerNudge();
    triggerRemExpression('surprise');
    _bubbleCooldown = Date.now() + BUBBLE_COOLDOWN_MS;
  } else if (isLegZone(y, x)) {
    showIdleBubble(pickRandom(getBubbles('leg')), 3000);
    triggerRemExpression('appeal');
    _bubbleCooldown = Date.now() + BUBBLE_COOLDOWN_MS;
  }
}, { passive: true });

canvas.addEventListener('pointerleave',  () => { petActive = false; });
canvas.addEventListener('pointercancel', () => { petActive = false; });

function tickPet(delta) {
  if (!model) return;
  const dt = delta / 60;
  const targetI = petActive ? 1 : 0;
  petIntensity += (targetI - petIntensity) * (petActive ? 4 * dt : 2 * dt);

  if (petIntensity < 0.001) {
    if (petIntensity > 0) {
      petIntensity   = 0;
      petBubbleShown = false;
      setCoreParam(P.eyeLSmile, 0);
      setCoreParam(P.eyeRSmile, 0);
      setCoreParam(P.hairFL1, 0); setCoreParam(P.hairFL2, 0);
      setCoreParam(P.hairFR1, 0); setCoreParam(P.hairFR2, 0);
      setCoreParam(P.hairSL1, 0); setCoreParam(P.hairSR1, 0);
      if (exprParams.ParamBlush) exprParams.ParamBlush.target = currentExpr === 'blush' ? 1 : 0;
    }
    return;
  }

  if (petActive) petHairT += delta / 60;
  const t = petHairT;
  const i = petIntensity;

  if (petActive && !petBubbleShown && petHairT > 1.5) {
    petBubbleShown = true;
    showIdleBubble(pickRandom(getBubbles('pet')), 3000);
    triggerRemExpression('happy');
  }

  if (exprParams.ParamBlush) exprParams.ParamBlush.target = Math.max(currentExpr === 'blush' ? 1 : 0, i);

  setCoreParam(P.eyeLSmile, i * 0.9);
  setCoreParam(P.eyeRSmile, i * 0.9);
  if (!isSpeaking) setCoreParam(P.mouthF, i * 0.5);
  setCoreParam(P.angleZ, idleAngleZ + i * (4 + Math.sin(t * 1.3) * 1.8));

  const ha = i * 0.5;
  setCoreParam(P.hairFL1, Math.sin(t * 3.1)       * ha);
  setCoreParam(P.hairFL2, Math.sin(t * 3.1 + 0.9) * ha);
  setCoreParam(P.hairFR1, Math.sin(t * 2.9 + 0.5) * ha);
  setCoreParam(P.hairFR2, Math.sin(t * 2.9 + 1.4) * ha);
  const sa = i * 0.35;
  setCoreParam(P.hairSL1, Math.sin(t * 2.3 + 0.3) * sa);
  setCoreParam(P.hairSR1, Math.sin(t * 2.1 + 0.7) * sa);
}

/* ── Keyboard shortcut ────────────────────────────────────────── */
window.addEventListener('keydown', e => {
  if (e.key === 'd' || e.key === 'D') debugPanel.classList.toggle('show');
});
