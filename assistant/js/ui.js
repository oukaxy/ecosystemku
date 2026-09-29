/*!
 * js/ui.js — antarmuka: panel aplikasi, resizer, chat, TTS, bootstrap
 * Isi: apps-panel, resizer, chat-ui, tts-player, main (bootstrap — harus paling akhir).
 * Dimuat sebagai <script> biasa (berbagi scope global); urutan muat penting — lihat index.html.
 */


/* ════════════════════════════════════════════════════════════════
   apps-panel — Panel aplikasi + parser tag [OPEN]/[EXPR]
   ════════════════════════════════════════════════════════════════ */
/* ================================================================
   APPS PANEL
================================================================ */
const PWA_URLS = {
  'dailyos':   'https://ecosystemku.vercel.app/daily-os/',
  'daily-os':  'https://ecosystemku.vercel.app/daily-os/',
  'ideku':     'https://ecosystemku.vercel.app/ide-ku/',
  'ide-ku':    'https://ecosystemku.vercel.app/ide-ku/',
  'cucimoney': 'https://ecosystemku.vercel.app/cucimoney/',
  'kronik':    'https://ecosystemku.vercel.app/kronik/',
  'linkku':    'https://ecosystemku.vercel.app/linkku/',
  'vault':     'https://ecosystemku.vercel.app/vault/',
  'dashboard': 'https://ecosystemku.vercel.app/',
};

const appsBtn   = document.getElementById('apps-btn');
const appsPanel = document.getElementById('apps-panel');

appsBtn.addEventListener('click', () => {
  const isOpen = appsPanel.classList.toggle('show');
  appsBtn.classList.toggle('active', isOpen);
});

document.addEventListener('click', (e) => {
  if (!appsPanel.contains(e.target) && e.target !== appsBtn) {
    appsPanel.classList.remove('show');
    appsBtn.classList.remove('active');
  }
});

function parseOpenTag(text) {
  const match = text.match(/\[OPEN:([a-z0-9-]+)\]/i);
  if (!match) return { cleanText: text, openUrl: null };
  const key     = match[1].toLowerCase();
  const openUrl = PWA_URLS[key] || null;
  const cleanText = text.replace(match[0], '').trim();
  return { cleanText, openUrl };
}

function parseExprTag(text) {
  const match = text.match(/\[EXPR:([a-z]+)\]/i);
  if (!match) return { cleanText: text };
  const expr = match[1].toLowerCase();
  const cleanText = text.replace(match[0], '').trim();

  // Normalisasi nama ekspresi
  const VALID_EXPRS = ['blush','worried','cool','browlink','none',
    'happy','sad','cry','angry','surprise','shame','upset','serious',
    'proud','doubt','puzzle','appeal','navi','wait','bound','smile'];
  if (!VALID_EXPRS.includes(expr)) return { cleanText: text };
  const exprName = expr === 'browlink' ? 'browLink' : expr;

  setExpression(exprName);
  if (exprName !== 'none') {
    setTimeout(() => {
      if (currentExpr === exprName) setExpression('none');
    }, 6000);
  }
  return { cleanText };
}

/* ════════════════════════════════════════════════════════════════
   resizer — Resizer panel model/chat
   ════════════════════════════════════════════════════════════════ */
/* ================================================================
   RESIZER
================================================================ */
(() => {
  const resizer    = document.getElementById('resizer');
  const chatPanel  = document.getElementById('chat-panel');
  const modelPanel = document.getElementById('model-panel');

  const STORAGE_KEY = 'assistant_panel_size';
  const isMobile    = () => window.innerWidth <= 700;

  const DESKTOP_MIN = 220;
  const DESKTOP_MAX = () => window.innerWidth * 0.65;
  const MOBILE_MIN  = () => Math.round(window.innerHeight * 0.35);
  const MOBILE_MAX  = () => Math.round(window.innerHeight * 0.72);

  function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }

  function loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      if (isMobile() && saved.modelH) {
        modelPanel.style.height = clamp(saved.modelH, MOBILE_MIN(), MOBILE_MAX()) + 'px';
      } else if (!isMobile() && saved.chatW) {
        chatPanel.style.width = clamp(saved.chatW, DESKTOP_MIN, DESKTOP_MAX()) + 'px';
      }
    } catch (_) {}
  }

  function saveSize(key, val) {
    try {
      const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, [key]: val }));
    } catch (_) {}
  }

  loadSaved();
  requestAnimationFrame(() => { if (typeof resizeApp === 'function') resizeApp(); });
  window.addEventListener('resize', loadSaved);

  let dragging = false, startPos = 0, startSize = 0;

  function onDragStart(e) {
    dragging = true;
    resizer.classList.add('dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor     = isMobile() ? 'row-resize' : 'col-resize';
    if (isMobile()) {
      startPos  = e.touches ? e.touches[0].clientY : e.clientY;
      startSize = modelPanel.getBoundingClientRect().height;
    } else {
      startPos  = e.touches ? e.touches[0].clientX : e.clientX;
      startSize = chatPanel.getBoundingClientRect().width;
    }
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!dragging) return;
    const pos = e.touches ? e.touches[0].clientY || e.touches[0].clientX : (isMobile() ? e.clientY : e.clientX);
    if (isMobile()) {
      const newH = clamp(startSize + (pos - startPos), MOBILE_MIN(), MOBILE_MAX());
      modelPanel.style.height = newH + 'px';
      modelPanel.style.flex   = 'none';
    } else {
      const newW = clamp(startSize + (pos - startPos), DESKTOP_MIN, DESKTOP_MAX());
      chatPanel.style.width = newW + 'px';
    }
  }

  function onDragEnd() {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove('dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor     = '';
    if (isMobile()) saveSize('modelH', parseFloat(modelPanel.style.height));
    else saveSize('chatW', parseFloat(chatPanel.style.width));
    if (typeof resizeApp === 'function') resizeApp();
  }

  resizer.addEventListener('mousedown',  onDragStart);
  window.addEventListener('mousemove',   onDragMove);
  window.addEventListener('mouseup',     onDragEnd);
  resizer.addEventListener('touchstart',  onDragStart, { passive: false });
  window.addEventListener('touchmove',    onDragMove,  { passive: true });
  window.addEventListener('touchend',     onDragEnd);

  let lastTap = 0;
  resizer.addEventListener('touchend', () => {
    const now = Date.now();
    if (now - lastTap < 300) {
      if (isMobile()) { modelPanel.style.height = ''; modelPanel.style.flex = ''; saveSize('modelH', null); }
      else { chatPanel.style.width = '360px'; saveSize('chatW', 360); }
      if (typeof resizeApp === 'function') resizeApp();
    }
    lastTap = now;
  });
})();

/* ════════════════════════════════════════════════════════════════
   chat-ui — UI chat, router tool, kirim ke LLM
   ════════════════════════════════════════════════════════════════ */
/* ================================================================
   CHAT SYSTEM
================================================================ */
function initChat(isSwitch = false) {
  subtitleEl.textContent = 'online · siap ngobrol';
  renderWelcome(isSwitch);
  if (!isSwitch) setupInputHandlers();
}

async function renderWelcome(isSwitch = false) {
  let name = null;
  try {
    if (typeof EcosystemDB !== 'undefined') {
      name = await EcosystemDB.kv?.get?.('profile_name');
    }
  } catch (_) {}

  const charName = currentChar?.name || 'Asisten';

  // Rem greeting motion
  if (currentCharId === 'rem') {
    setTimeout(() => playRemMotion('appeal'), 500);
  }

  let greeting;
  if (currentCharId === 'rem') {
    greeting = name
      ? `Selamat datang, Tuan ${name}. Rem siap melayani Tuan kapan saja. 💙`
      : `Selamat datang. Rem adalah pelayan Tuan. Ada yang bisa Rem bantu? 💙`;
  } else {
    greeting = name
      ? `Hei, ${name}! Aku ${charName}. Ada yang bisa aku bantu hari ini? 😊`
      : `Hei! Aku ${charName}. Ada yang bisa aku bantu hari ini? 😊`;
  }

  appendMessage('assistant', greeting);
}

function setupInputHandlers() {
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 110) + 'px';
  });

  msgInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  sendBtn.addEventListener('click', handleSend);

  muteBtn.textContent = isMuted ? '🔇' : '🔊';
  muteBtn.classList.toggle('muted', isMuted);
  muteBtn.title = isMuted ? 'Suara mati — tap untuk nyalakan' : 'Mute suara';

  muteBtn.addEventListener('click', () => {
    isMuted = !isMuted;
    localStorage.setItem(MUTE_STORAGE_KEY, isMuted);
    muteBtn.textContent = isMuted ? '🔇' : '🔊';
    muteBtn.classList.toggle('muted', isMuted);
    muteBtn.title = isMuted ? 'Suara mati — tap untuk nyalakan' : 'Mute suara';

    if (isMuted && (currentSource || ttsSources.length)) {
      stopAllTTS();
      try { currentSource.stop(); } catch (_) {}
      currentSource = null;
      isSpeaking    = false;
      smoothMouth   = 0;
      setCoreParam(P.mouthY, 0);
      setCoreParam(P.mouthF, 0);
      document.getElementById('model-tag').classList.remove('speaking');
      statusEl.textContent = '· idle';
    }
  });
}

// Tools deterministik (tanpa LLM). Tool baru: buat js/tools.js lalu daftarkan di sini.
const tools = ToolRegistry.create();
tools.register(FinanceTool.create({
  appendMessage,
  EcosystemDB,
  playVoice: (file) => {
    if (isMuted) return;
    if (isSpeaking && _bubbleSource) {          // potong klip bubble yang sedang jalan
      try { _bubbleSource.mediaElement.pause(); _bubbleSource.disconnect(); } catch (_) {}
      _bubbleSource = null;
      isSpeaking = false;
    }
    playBubbleAudio(file);
  },
}));

async function handleSend() {
  const text = msgInput.value.trim();
  if (!text || isThinking) return;
  hideIdleBubble();
  msgInput.value = '';
  msgInput.style.height = 'auto';
  appendMessage('user', text);
  chatHistory.push({ role: 'user', content: text });
  if (await tools.handle(text)) { chatHistory.pop(); return; }
  await sendToAPI();
}

async function sendToAPI() {
  isThinking = true;
  setUIThinking(true);
  const typingEl = appendTyping();

  try {
    const ecosystemCtx = await loadEcosystemContext();

    // Ambil system prompt dari character config
    const basePrompt = currentChar?.systemPrompt || `Kamu adalah asisten bernama ${currentChar?.name || 'Asisten'}.`;

    let finalSystemPrompt = basePrompt;
    if (ecosystemCtx?.summary) {
      const greeting = ecosystemCtx.userName ? `Nama pengguna adalah ${ecosystemCtx.userName}.` : '';
      finalSystemPrompt += `\n\n---\nDATA PENGGUNA (dari ekosistem app):\n${greeting ? greeting + '\n' : ''}${ecosystemCtx.summary}\n\nGunakan data ini sebagai konteks percakapan bila relevan. Jangan sebutkan data ini secara eksplisit kecuali pengguna bertanya atau jelas relevan. Angka yang tertera adalah data AKURAT — jangan menghitung ulang atau menambah dari ingatan.\n\nATURAN PENTING KEUANGAN: Jika pengguna meminta ringkasan, total, analisis, atau informasi keuangan tetapi belum menyebut nama buku, tanyakan dulu buku mana yang dimaksud dan jangan berikan angka keuangan apa pun sebelum pengguna memilih. Jika nama buku sudah disebut, gunakan hanya bagian KEUANGAN BUKU dengan nama yang cocok persis; jangan pernah menggabungkan angka antar-buku. Jika nama buku tidak cocok atau ambigu, tanyakan klarifikasi. Jika pengguna sudah menyebut buku dan tujuan dengan jelas, jangan mengulang pertanyaan yang sudah terjawab.`;
    }

    // Trim history — kirim max 10 pesan terakhir biar hemat token
    const trimmedHistory = chatHistory.slice(-10);

    const body = {
      messages: trimmedHistory,
      context: {
        systemPrompt: finalSystemPrompt,
        expression:   currentExpr,
        ...(ecosystemCtx ? {
          userName:  ecosystemCtx.userName,
          ecosystem: ecosystemCtx.summary,
        } : {}),
      },
    };

    const res = await fetch(CHAT_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
    }

    const isSSE = (res.headers.get('content-type') || '').includes('text/event-stream');

    let finalText = '';
    let finalTts  = '';
    let openUrl   = null;
    let hadExprTag = false;

    if (!isSSE) {
      // ── Fallback: server balas JSON biasa (mode non-stream) ──
      const data = await res.json();
      const rawReply = data?.text || data?.message || data?.content || '';
      if (!rawReply) throw new Error('Respons kosong dari server');

      const parsedOpen = parseOpenTag(rawReply);
      openUrl = parsedOpen.openUrl;
      hadExprTag = /\[EXPR:([a-z]+)\]/i.test(parsedOpen.cleanText);
      finalText = parseExprTag(parsedOpen.cleanText).cleanText;
      finalTts  = (data?.tts || '').trim();

      typingEl.remove();
      appendMessage('assistant', finalText);

    } else {
      // ── Mode stream: tampilkan teks bertahap, tag ditahan sampai lengkap ──
      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuf = '';
      let raw    = '';        // semua delta mentah, apa adanya dari LLM
      let shown  = 0;         // berapa karakter dari "visible text" yang sudah dirender
      let bubbleEl = null;
      let streamError = null;

      // Hitung teks yang "aman" ditampilkan: buang tag lengkap ([JA]..[/JA], [EXPR:x], [OPEN:x]),
      // dan tahan kalau ada '[' yang belum ditutup di ujung (supaya tag tidak kelihatan kepotong).
      const visibleTextOf = (s) => {
        let v = s
          .replace(/\[JA\][\s\S]*?\[\/JA\]/gi, '')
          .replace(/\[EXPR:[a-z]+\]/gi, '')
          .replace(/\[OPEN:[a-z0-9-]+\]/gi, '');
        const openBracket = v.lastIndexOf('[');
        if (openBracket !== -1 && !v.slice(openBracket).includes(']')) {
          v = v.slice(0, openBracket);
        }
        return v;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        sseBuf += decoder.decode(value, { stream: true });
        const events = sseBuf.split('\n\n');
        sseBuf = events.pop() ?? '';

        for (const evt of events) {
          const lines = evt.split('\n');
          let eventName = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;

          let payload;
          try { payload = JSON.parse(dataStr); } catch { continue; }

          if (eventName === 'delta') {
            raw += payload.delta || '';
            const visible = visibleTextOf(raw);

            if (visible.length > shown) {
              if (!bubbleEl) {
                typingEl.remove();
                bubbleEl = appendMessage('assistant', '');
              }
              bubbleEl.querySelector('.msg-bubble').textContent = visible;
              shown = visible.length;
              scrollToBottom();
            }
          } else if (eventName === 'done') {
            // payload.text: teks Indonesia final dari server (tag [JA] sudah dibuang server,
            // tapi [EXPR:xxx]/[OPEN:xxx] masih ada, diproses sama seperti mode non-stream).
            const parsedOpen = parseOpenTag(payload.text || visibleTextOf(raw));
            openUrl    = parsedOpen.openUrl;
            hadExprTag = /\[EXPR:([a-z]+)\]/i.test(parsedOpen.cleanText);
            finalText  = parseExprTag(parsedOpen.cleanText).cleanText;
            finalTts   = (payload.tts || '').trim();
          } else if (eventName === 'error') {
            streamError = payload.error || 'Terjadi kesalahan saat streaming';
          }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!finalText) throw new Error('Respons kosong dari server');

      if (!bubbleEl) {
        typingEl.remove();
        bubbleEl = appendMessage('assistant', finalText);
      } else {
        bubbleEl.querySelector('.msg-bubble').textContent = finalText;
      }
    }

    // Kalau LLM tidak menyertakan [EXPR:...], lepas pose "puzzle" (mikir) yang
    // dipasang saat menunggu, supaya Rem tidak nyangkut di ekspresi bingung.
    // (Kalau ada [EXPR:...], parseExprTag di atas sudah memanggil setExpression sendiri.)
    if (!hadExprTag && currentExpr === 'puzzle') setExpression('none');

    chatHistory.push({ role: 'assistant', content: finalText });

    // Kirim voiceId karakter ke TTS
    const voiceId = currentChar?.tts?.voiceId || '';
    playTTS(finalTts || finalText, openUrl ? () => window.open(openUrl, '_blank') : null, voiceId, !!finalTts);

  } catch (err) {
    typingEl.remove();
    showToast(`Gagal menghubungi server: ${err.message}`);
    console.error('[Chat] API error:', err);
  } finally {
    isThinking = false;
    setUIThinking(false);
    _bubbleCooldown = Date.now() + 3000;
  }
}

function setUIThinking(on) {
  sendBtn.disabled  = on;
  msgInput.disabled = on;

  // Animasi menunggu: Rem pasang pose "puzzle" (bingung/mikir) selama LLM memproses.
  // Pakai setExpression() (bukan playRemMotion() langsung) supaya wajah (remFaceParams)
  // ikut ke-set dan currentExpr benar-benar 'puzzle', sehingga reset di sendToAPI
  // (if (!hadExprTag && currentExpr === 'puzzle') ...) beneran ke-trigger.
  // Tidak pakai auto-revert timer di sini karena resetnya sudah ditangani manual
  // begitu jawaban/TTS datang.
  if (on && currentCharId === 'rem') {
    setExpression('puzzle'); // ini juga menimpa statusEl, makanya diset ulang di bawah
  }

  statusEl.textContent = on ? '· mengetik…' : `· idle`;
}

function appendMessage(role, text) {
  const ph = messagesEl.querySelector('.chat-placeholder');
  if (ph) ph.remove();

  const now = new Date();
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const msgDiv = document.createElement('div');
  msgDiv.className = `msg ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.textContent = text;

  const timeDiv = document.createElement('div');
  timeDiv.className = 'msg-time';
  timeDiv.textContent = timeStr;

  msgDiv.appendChild(bubble);
  msgDiv.appendChild(timeDiv);
  messagesEl.appendChild(msgDiv);
  scrollToBottom();
  return msgDiv;
}

function appendTyping() {
  const el = document.createElement('div');
  el.className = 'typing-indicator';
  el.innerHTML = `<div class="typing-dots"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

let toastTimer = null;
function showToast(msg) {
  chatToast.textContent = msg;
  chatToast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => chatToast.classList.remove('show'), 5000);
}

/* ════════════════════════════════════════════════════════════════
   tts-player — TTS (potong per kalimat, putar berurutan)
   ════════════════════════════════════════════════════════════════ */
/* ================================================================
   TTS SYSTEM
================================================================ */
function ensureAudioCtx() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyser         = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  fftBuf           = new Uint8Array(analyser.frequencyBinCount);
  analyser.connect(audioCtx.destination);
}

/* ── TTS: potong per kalimat, fetch paralel, putar berurutan ── */
function stopAllTTS() {
  ttsGen++;
  ttsSources.forEach(src => { try { src.stop(); } catch (_) {} });
  ttsSources = [];
}

function splitForTTS(text, minLen = 12, maxChunks = 4) {
  const parts = text.match(/[^。！？!?.]+[。！？!?.]*/g) || [text];
  const chunks = [];
  let buf = '';
  for (const part of parts) {
    buf += part;
    if (buf.trim().length >= minLen) { chunks.push(buf.trim()); buf = ''; }
  }
  if (buf.trim()) {
    if (chunks.length) chunks[chunks.length - 1] += ' ' + buf.trim();
    else chunks.push(buf.trim());
  }
  while (chunks.length > maxChunks) {
    const last = chunks.pop();
    chunks[chunks.length - 1] += ' ' + last;
  }
  return chunks;
}

async function playTTS(text, onComplete = null, voiceId = '', isJapanese = false) {
  if (!text) { onComplete?.(); return; }
  if (isMuted) {
    const delay = Math.min(Math.max(text.length * 35, 800), 3500);
    setTimeout(() => onComplete?.(), delay);
    return;
  }

  ensureAudioCtx();
  stopAllTTS();
  if (currentSource) {
    try { currentSource.stop(); } catch (_) {}
    currentSource = null;
  }

  const myGen = ttsGen;
  const chunks = splitForTTS(text.slice(0, 500));

  const finish = () => {
    if (myGen !== ttsGen) return;
    isSpeaking    = false;
    currentSource = null;
    ttsSources    = [];
    smoothMouth   = 0;
    setCoreParam(P.mouthY, 0);
    setCoreParam(P.mouthF, 0);
    document.getElementById('model-tag').classList.remove('speaking');
    statusEl.textContent = '· idle';
    onComplete?.();
  };

  try {
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    statusEl.textContent = '· berbicara…';

    // Kirim SEMUA potongan sekaligus (paralel)
    const fetches = chunks.map(chunk =>
      fetch('/api/tts', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: chunk, voiceId: voiceId || undefined, translated: isJapanese }),
      }).then(r => {
        if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
        return r.arrayBuffer();
      }).then(buf => audioCtx.decodeAudioData(buf))
        .catch(err => { console.warn('[TTS] chunk gagal:', err); return null; })
    );

    let nextTime = 0;
    let lastSource = null;

    // Putar berurutan, tanpa jeda antar potongan
    for (const p of fetches) {
      const audioBuf = await p;
      if (myGen !== ttsGen) return;     // dibatalkan
      if (!audioBuf) continue;

      const source = audioCtx.createBufferSource();
      source.buffer = audioBuf;
      source.connect(analyser);

      const startAt = Math.max(audioCtx.currentTime + 0.02, nextTime);
      source.start(startAt);
      nextTime = startAt + audioBuf.duration;

      ttsSources.push(source);
      lastSource    = source;
      currentSource = source;
      if (!isSpeaking) {
        isSpeaking = true;
        document.getElementById('model-tag').classList.add('speaking');
      }
    }

    if (!lastSource) throw new Error('Semua potongan TTS gagal');
    if (audioCtx.currentTime >= nextTime) finish();   // sudah selesai sebelum handler terpasang
    else lastSource.onended = finish;

  } catch (err) {
    if (myGen !== ttsGen) return;
    isSpeaking = false;
    console.warn('[TTS] Error:', err);
    statusEl.textContent = '· idle';
    setTimeout(() => onComplete?.(), 500);
  }
}

/* ════════════════════════════════════════════════════════════════
   main — bootstrap: muat config karakter, lalu model Live2D.
   ════════════════════════════════════════════════════════════════ */
/* ================================================================
   INIT — Load karakter pertama kali
================================================================ */

(async () => {
  currentChar = await loadCharConfig(currentCharId);
  if (!currentChar) {
    // Rem adalah satu-satunya karakter assistant
    currentCharId = 'rem';
    currentChar   = await loadCharConfig('rem');
  }

  updateCharBtns(currentCharId);

  const loadOk = await loadModel(currentChar, false);
  if (loadOk) {
    resetIdleTimer();
    initChat(false);
  }
})();
