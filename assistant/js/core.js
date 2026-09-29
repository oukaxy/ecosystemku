/*!
 * js/core.js — konfigurasi, data ekosistem, referensi DOM & state global
 * Isi: config, ecosystem-context, state.
 * Dimuat sebagai <script> biasa (berbagi scope global); urutan muat penting — lihat index.html.
 */


/* ════════════════════════════════════════════════════════════════
   config — Konfigurasi, registry karakter, loader character.json
   ════════════════════════════════════════════════════════════════ */
/* ── Config ─────────────────────────────────────────────────── */
const CHAT_API   = '/api/chat';
const DEBUG      = false;

/* ── Character registry ──────────────────────────────────────── */
// Rem adalah satu-satunya karakter yang tersedia.
const CHARACTERS = ['rem'];

// Cache config per karakter
const charConfigCache = {};

async function loadCharConfig(id) {
  if (charConfigCache[id]) return charConfigCache[id];
  try {
    const res = await fetch(`./characters/${id}/character.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const cfg = await res.json();
    charConfigCache[id] = cfg;
    return cfg;
  } catch (err) {
    console.error(`[Char] Gagal load config ${id}:`, err);
    return null;
  }
}

// Karakter aktif saat ini
let currentCharId = 'rem';
localStorage.setItem('assistant_char', 'rem');
let currentChar   = null;   // config object yang sudah di-load

/* ════════════════════════════════════════════════════════════════
   ecosystem-context — Pembaca data ekosistem (habit, todo, ide, keuangan, jurnal)
   ════════════════════════════════════════════════════════════════ */
/* ── Ecosystem context loader ────────────────────────────────── */
let _ecoCache   = null;
let _ecoCacheAt = 0;
const ECO_TTL   = 60_000;

async function loadEcosystemContext() {
  if (_ecoCache && (Date.now() - _ecoCacheAt) < ECO_TTL) return _ecoCache;
  if (typeof EcosystemDB === 'undefined') {
    console.warn('[Context] ecosystem-db.js belum dimuat, skip.');
    return null;
  }

  const safe = (fn) => {
    try { return fn(); } catch (e) { console.warn('[Context] safe() error:', e); return Promise.resolve(null); }
  };

  const [nameRes, habitsRes, todosRes, ideasRes, financesRes, journalRes] =
    await Promise.allSettled([
      safe(() => EcosystemDB.kv?.get?.('profile_name')),
      safe(() => EcosystemDB.habits?.getAll?.()),
      safe(() => EcosystemDB.todos?.getAll?.()),
      safe(() => EcosystemDB.ideas?.getAll?.()),
      safe(() => EcosystemDB.kv?.finances?.get?.('db')),
      safe(() => EcosystemDB.journal?.getAll?.()),
    ]);

  const val = (res) => res.status === 'fulfilled' ? res.value : null;

  const userName = val(nameRes) || null;
  const habits   = val(habitsRes) || [];
  const todos    = val(todosRes) || [];
  const ideas    = val(ideasRes) || [];
  const finances = val(financesRes) || null;
  const journals = val(journalRes) || [];

  const lines = [];

  /* ── Profil ───────────────────────────────────────────── */
  if (userName) lines.push(`Nama pengguna: ${userName}`);

  /* ── Habits ───────────────────────────────────────────── */
  const activeHabits = habits.filter(h => !h.archived && !h.deleted);
  if (activeHabits.length) {
    const list = activeHabits.slice(0, 10).map(h => h.name || h.title || '?').join(', ');
    lines.push(`Habit aktif (${activeHabits.length}): ${list}`);
  }

  /* ── Todos ────────────────────────────────────────────── */
  const openTodos = todos.filter(t => !t.done && !t.completed && !t.deleted);
  if (openTodos.length) {
    const list = openTodos.slice(0, 8).map(t => t.text || t.title || '?').join(', ');
    lines.push(`Todo belum selesai (${openTodos.length}): ${list}`);
  }

  /* ── Ide & Wishlist ───────────────────────────────────── */
  const allIdeas    = ideas.filter(i => i.type === 'Idea' || (!i.type && i.status));
  const allWishlist = ideas.filter(i => i.type === 'Wishlist');

  if (allIdeas.length) {
    const belum   = allIdeas.filter(i => i.status === 'Belum').length;
    const proses  = allIdeas.filter(i => i.status === 'Proses').length;
    const selesai = allIdeas.filter(i => i.status === 'Selesai').length;
    const activeList = allIdeas.filter(i => i.status === 'Proses').slice(0, 5)
      .map(i => `"${i.title || i.name || '?'}"`).join(', ');
    let ideaLine = `Ide (total ${allIdeas.length}): ${belum} belum, ${proses} proses, ${selesai} selesai`;
    if (activeList) ideaLine += ` — sedang dikerjakan: ${activeList}`;
    lines.push(ideaLine);
  }

  if (allWishlist.length) {
    const belum   = allWishlist.filter(i => i.status === 'Belum').length;
    const proses  = allWishlist.filter(i => i.status === 'Proses').length;
    const selesai = allWishlist.filter(i => i.status === 'Selesai').length;
    const wishList = allWishlist.filter(i => i.status !== 'Selesai').slice(0, 10)
      .map(i => {
        const price  = i.price ? ` Rp ${Number(i.price).toLocaleString('id-ID')}` : '';
        const status = i.status ? ` [${i.status}]` : '';
        return `"${i.title || i.name || '?'}"${price}${status}`;
      }).join(', ');
    let wishLine = `Wishlist (total ${allWishlist.length}): ${belum} belum, ${proses} proses, ${selesai} selesai`;
    if (wishList) wishLine += ` — daftar: ${wishList}`;
    lines.push(wishLine);
  }

  /* ═══════════════════════════════════════════════════════════
     FINANCE — FIXED
     ─────────────────────────────────────────────────────────
     Bug sebelumnya:
       1. Transfer pair (2 record per transfer) ikut dihitung
          sebagai income DAN expense → double count.
       2. Fallback `t.amount > 0` bikin expense kehitung income
          (CuciMoney+ selalu simpan amount POSITIF).
       3. `new Date("YYYY-MM-DD")` di-parse UTC → geser 1 hari
          di WIB, transaksi tanggal 1 bisa bocor ke bulan lalu.
     Solusi:
       • Skip semua record dengan `transferPair`.
       • Deteksi income/expense EKSKLUSIF dari field `direction`.
       • Parse tanggal sebagai LOCAL date (split manual).
  ═══════════════════════════════════════════════════════════ */
  if (finances) {
    try {
      const fmt = (n) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

      // Normalisasi struktur — finances bisa berupa:
      //   • array transaksi langsung
      //   • { transactions, accounts, ... }
      //   • { db: { transactions, accounts, ... } }
      const fin = finances;
      const rawTx = Array.isArray(fin)
        ? fin
        : Array.isArray(fin?.transactions)
          ? fin.transactions
          : Array.isArray(fin?.db?.transactions)
            ? fin.db.transactions
            : null;

      const rawAcc = Array.isArray(fin?.accounts)
        ? fin.accounts
        : Array.isArray(fin?.db?.accounts)
          ? fin.db.accounts
          : null;

      /* ── Helper: parse tanggal aman (local date) ── */
      const parseLocalDate = (t) => {
        const raw = t?.date || t?.tanggal || t?.createdAt || t?.timestamp || null;
        if (!raw) return null;
        // String "YYYY-MM-DD" → parse sebagai local date biar tidak geser timezone
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
          const [y, m, d] = raw.slice(0, 10).split('-').map(Number);
          if (!y || !m || !d) return null;
          return new Date(y, m - 1, d);
        }
        const dt = new Date(raw);
        return isNaN(dt.getTime()) ? null : dt;
      };

      /* ── Klasifikasi eksklusif ── */
      const isTransfer = (t) => !!t.transferPair;
      const isIncome   = (t) => t.direction === 'in';
      const isExpense  = (t) => t.direction === 'out';

      const rawBooks = Array.isArray(fin?.books)
        ? fin.books
        : Array.isArray(fin?.db?.books)
          ? fin.db.books
          : [];

      if (rawTx && rawTx.length) {
        const nonTransfer = rawTx.filter(t => !isTransfer(t));
        const now = new Date();
        const month = now.getMonth();
        const year = now.getFullYear();

        const summarizeBook = (book, txs) => {
          const thisMo = txs.filter(t => {
            const d = parseLocalDate(t);
            return d && d.getMonth() === month && d.getFullYear() === year;
          });
          const sum = (items, predicate) => items.filter(predicate)
            .reduce((total, t) => total + Math.abs(Number(t.amount) || 0), 0);
          return {
            moIncome: sum(thisMo, isIncome),
            moExpense: sum(thisMo, isExpense),
            allIncome: sum(txs, isIncome),
            allExpense: sum(txs, isExpense),
            txCount: thisMo.length,
            transferCount: Math.round(rawTx.filter(t =>
              String(t.bookId) === String(book.id) && isTransfer(t) && (() => {
                const d = parseLocalDate(t);
                return d && d.getMonth() === month && d.getFullYear() === year;
              })()
            ).length / 2)
          };
        };

        if (rawBooks.length) {
          // Ringkasan selalu dipisahkan berdasarkan bookId; jangan agregasikan antar-buku.
          rawBooks.forEach(book => {
            const bookTx = nonTransfer.filter(t => String(t.bookId) === String(book.id));
            const m = summarizeBook(book, bookTx);
            lines.push(
              `KEUANGAN BUKU "${book.name || `Buku ${book.id}`}" (bookId=${book.id}): ` +
              `bulan ini pemasukan ${fmt(m.moIncome)}, pengeluaran ${fmt(m.moExpense)} ` +
              `(${m.txCount} transaksi); sepanjang waktu pemasukan ${fmt(m.allIncome)}, ` +
              `pengeluaran ${fmt(m.allExpense)}.`
            );
            if (m.transferCount > 0) {
              lines.push(`Catatan buku "${book.name || book.id}": ${m.transferCount} transfer antar akun bulan ini tidak dihitung sebagai pemasukan/pengeluaran.`);
            }
          });
        } else {
          // Data lama tanpa daftar buku: tampilkan total hanya jika memang tidak ada bookId.
          const legacyTx = nonTransfer.filter(t => t.bookId == null);
          if (legacyTx.length) {
            const m = summarizeBook({ id: 'legacy' }, legacyTx);
            lines.push(`Keuangan (data lama tanpa buku): bulan ini pemasukan ${fmt(m.moIncome)}, pengeluaran ${fmt(m.moExpense)}; all-time pemasukan ${fmt(m.allIncome)}, pengeluaran ${fmt(m.allExpense)}.`);
          }
        }
      }

      /* ── Akun & aset per buku ── */
      if (rawAcc && rawAcc.length) {
        const rawBooksForAccounts = Array.isArray(fin?.books)
          ? fin.books
          : Array.isArray(fin?.db?.books) ? fin.db.books : [];
        if (rawBooksForAccounts.length) {
          rawBooksForAccounts.forEach(book => {
            const accountIds = Array.isArray(book.accountIds) ? book.accountIds : [];
            const aktif = rawAcc.filter(a => accountIds.some(id => String(id) === String(a.id)) && !a.deleted && !a.archived);
            if (!aktif.length) return;
            const isDebt = a => a.type === 'debt' || a.type === 'hutang' || a.type === 'credit';
            const assets = aktif.filter(a => !isDebt(a));
            const debts = aktif.filter(isDebt);
            const totalAset = assets.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
            const totalHutang = debts.reduce((sum, a) => sum + Math.abs(Number(a.balance) || 0), 0);
            const names = assets.map(a => `${a.name || a.title || '?'} ${fmt(a.balance || 0)}`).join(', ');
            lines.push(`Akun buku "${book.name || book.id}": ${names || 'tidak ada aset'}; aset bersih ${fmt(totalAset - totalHutang)}${totalHutang > 0 ? ` (aset ${fmt(totalAset)}, hutang ${fmt(totalHutang)})` : ''}.`);
          });
        }
      }
    } catch (err) {
      console.warn('[Context] finance parse error:', err);
    }
  }

  /* ── Journal ──────────────────────────────────────────── */
  if (journals.length) {
    const sorted = [...journals].sort((a, b) =>
      (b.date || b.id || 0) > (a.date || a.id || 0) ? 1 : -1
    );
    const list = sorted.slice(0, 3).map(j => {
      const date    = j.date
        ? new Date(j.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
        : '?';
      const snippet = (j.content || j.text || '').slice(0, 60).replace(/\n/g, ' ');
      return `[${date}] "${snippet}${snippet.length >= 60 ? '…' : ''}"`;
    }).join(' | ');
    lines.push(`Jurnal terbaru: ${list}`);
  }

  if (!lines.length) {
    _ecoCache   = null;
    _ecoCacheAt = Date.now();
    return null;
  }

  _ecoCache   = { userName, summary: lines.join('\n') };
  _ecoCacheAt = Date.now();
  return _ecoCache;
}

/* ════════════════════════════════════════════════════════════════
   state — Referensi DOM & state global
   ════════════════════════════════════════════════════════════════ */
/* ── DOM refs ───────────────────────────────────────────────── */
const canvas        = document.getElementById('live2d-canvas');
const loadingEl     = document.getElementById('loading-overlay');
const loadingText   = document.getElementById('loading-text');
const errorEl       = document.getElementById('error-overlay');
const errorDetail   = document.getElementById('error-detail');
const modelFade     = document.getElementById('model-fade');
const statusEl      = document.querySelector('#model-tag .status');
const modelNameEl   = document.querySelector('#model-tag .name');
const subtitleEl    = document.getElementById('chat-subtitle');
const exprToggle    = document.getElementById('expr-toggle');
const exprBar       = document.getElementById('expression-bar');
const debugPanel    = document.getElementById('debug-panel');
const dbgFps        = document.getElementById('dbg-fps');
const dbgChar       = document.getElementById('dbg-char');
const dbgExpr       = document.getElementById('dbg-expr');
const dbgCursor     = document.getElementById('dbg-cursor');
const dbgBlink      = document.getElementById('dbg-blink');
const messagesEl    = document.getElementById('messages');
const msgInput      = document.getElementById('msg-input');
const sendBtn       = document.getElementById('send-btn');
const muteBtn       = document.getElementById('mute-btn');
const chatToast     = document.getElementById('chat-toast');
const confirmModal  = document.getElementById('confirm-modal');
const modalIcon     = document.getElementById('modal-icon');
const modalTitle    = document.getElementById('modal-title');
const modalDesc     = document.getElementById('modal-desc');
const modalCancel   = document.getElementById('modal-cancel');
const modalConfirm  = document.getElementById('modal-confirm');

if (DEBUG) debugPanel.classList.add('show');

/* ── State ──────────────────────────────────────────────────── */
let model        = null;
let currentExpr  = 'none';
let blinkTimer   = 0;
let blinkState   = 'open';
let blinkT       = 0;
let idleBreath   = 0;
let idleHead     = 0;
let cursorX      = 0.5;
let cursorY      = 0.5;
let smoothCX     = 0.5;
let smoothCY     = 0.5;
let frameCount   = 0;
let lastFpsTime  = performance.now();
let fps          = 60;

let petActive    = false;
let petIntensity = 0;
let petHairT     = 0;
let idleAngleZ   = 0;

// Parameter mapping per karakter (default: Liro style)
let P = {
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

// Expression params untuk Liro (smooth fade system)
let exprParams = {
  ParamBlush:    { current: 0, target: 0, fadeIn: 0.04, fadeOut: 0.025 },
  ParamBrowLink: { current: 0, target: 0, fadeIn: 0.04, fadeOut: 0.025 },
  ParamCool:     { current: 0, target: 0, fadeIn: 0.04, fadeOut: 0.025 },
  ParamBrowForm: { current: 0, target: 0, fadeIn: 0.06, fadeOut: 0.025 },
};

let chatHistory  = [];
let isThinking   = false;

let audioCtx      = null;
let analyser      = null;
let fftBuf        = null;
let isSpeaking    = false;
const MUTE_STORAGE_KEY = 'rem_muted';
// Migrasi preferensi mute lama agar pengaturan pengguna tetap terjaga.
const savedMute = localStorage.getItem(MUTE_STORAGE_KEY) ?? localStorage.getItem('liro_muted');
let isMuted       = savedMute === 'true';
let currentSource = null;
let ttsSources    = [];   // semua source TTS yang sedang dijadwalkan/diputar
let ttsGen        = 0;    // token untuk membatalkan playback lama
