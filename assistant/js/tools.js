/*!
 * js/tools.js — router tool + semua tool deterministik (tanpa LLM)
 * Isi: tool-registry (router) dan tool-finance (catat transaksi).
 * Tool baru: tambahkan modulnya di file ini (atau file tool-xxx.js baru), lalu
 * daftarkan di chat-ui bagian ui.js dengan tools.register(...).
 * Dimuat sebagai <script> biasa (berbagi scope global); urutan muat penting — lihat index.html.
 */


/* ════════════════════════════════════════════════════════════════
   tool-registry — router tool (match → handle, tanpa LLM)
   ════════════════════════════════════════════════════════════════ */
/*!
 * tool-registry.js — router "tool" untuk chat Rem (semua deterministik, TANPA LLM)
 *
 * Sebuah tool adalah objek:
 *   name        string     nama tool
 *   match(text) boolean    true kalau pesan ini PERINTAH BARU untuk tool ini
 *   handle(text) Promise<boolean>   proses pesan (perintah baru ATAU jawaban lanjutan);
 *                                   true = sudah ditangani, false = teruskan ke LLM
 *   isPending() boolean    (opsional) true kalau tool sedang menunggu jawaban user
 *   reset()                (opsional) batalkan alur yang sedang menunggu
 *
 * Urutan kerja router:
 *   1. Ada tool yang match → tool itu mengambil alih, tool lain yang menunggu dibatalkan.
 *   2. Kalau tidak, dan ada tool yang sedang menunggu jawaban → pesan diberikan ke tool itu.
 *   3. Selain itu → false (pesan lanjut ke LLM).
 *
 * Pakai:
 *   const tools = ToolRegistry.create();
 *   tools.register(FinanceTool.create({ ... }));
 *   if (await tools.handle(text)) return;
 */
(function (global) {
  'use strict';

  function create() {
    const tools = [];

    function register(tool) {
      if (!tool || typeof tool.name !== 'string' || typeof tool.match !== 'function' || typeof tool.handle !== 'function') {
        throw new Error('Tool tidak valid: butuh name, match(), dan handle()');
      }
      if (tools.some(t => t.name === tool.name)) throw new Error(`Tool "${tool.name}" sudah terdaftar`);
      tools.push(tool);
      return api;
    }

    const resetAll = (except = null) => tools.forEach(t => { if (t !== except) { try { t.reset?.(); } catch (_) {} } });

    async function handle(text) {
      try {
        for (const t of tools) {
          let hit = false;
          try { hit = !!t.match(text); } catch (err) { console.warn(`[tools] ${t.name}.match error:`, err); }
          if (!hit) continue;
          resetAll(t);
          return !!(await t.handle(text));
        }
        for (const t of tools) {
          if (t.isPending?.()) return !!(await t.handle(text));
        }
        return false;
      } catch (err) {
        console.error('[tools] error tak terduga:', err);
        resetAll();
        return false;
      }
    }

    const api = { register, handle, list: () => tools.map(t => t.name) };
    return api;
  }

  global.ToolRegistry = { create };
})(window);

/* ════════════════════════════════════════════════════════════════
   tool-finance — tool pencatatan transaksi CuciMoney+
   ════════════════════════════════════════════════════════════════ */
/*!
 * tool-finance.js — tool pencatatan transaksi CuciMoney+ lewat chat Rem (tanpa LLM)
 * Bahasa natural + tanya balik untuk field yang kurang + konfirmasi nama mirip.
 *
 * Didaftarkan ke ToolRegistry (lihat registry.js):
 *   tools.register(FinanceTool.create({ appendMessage, playVoice, EcosystemDB }));
 */
(function (global) {
  'use strict';

  function create(deps) {
    const { appendMessage, playVoice, EcosystemDB } = deps;

    // ══════════════════════════════════════════════════════════════════
    let financePending = null;
    const FIN_TTL = 5 * 60 * 1000;
    const FIN_FILL = 'di|dengan|pada|pakai|menggunakan|ke|dari|untuk|nama|bernama|yaitu|yang|dan|ya|dong|deh|nih|tolong|aja|saja';

    const finNorm = (v) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

    function finSim(a, b) {
      if (a === b) return 1;
      if (!a.length || !b.length) return 0;
      let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
      for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) {
          cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        prev = cur;
      }
      return 1 - prev[b.length] / Math.max(a.length, b.length);
    }

    function finClean(v) {
      let s = String(v || ''), p;
      const lead = new RegExp('^(' + FIN_FILL + ')\\s+', 'i');
      const trail = new RegExp('\\s+(' + FIN_FILL + ')$', 'i');
      do {
        p = s;
        s = s.replace(/^[\s:=,;.|"'“”]+/, '').replace(lead, '')
             .replace(/[\s,;.|:"'“”!?]+$/, '').replace(trail, '');
      } while (s !== p);
      return s;
    }

    function finAmount(str) {
      const m = String(str).match(/(?:rp\.?\s*)?(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)*)(?:\s*(rb|ribu|k|jt|juta))?(?![\p{L}\p{N}])/iu);
      if (!m) return null;
      let num = m[1];
      if (/^\d{1,3}(\.\d{3})+$/.test(num)) num = num.replace(/\./g, '');
      else if (/^\d{1,3}(,\d{3})+$/.test(num)) num = num.replace(/,/g, '');
      else num = num.replace(',', '.');
      let val = Number(num);
      const unit = (m[2] || '').toLowerCase();
      if (unit === 'rb' || unit === 'ribu' || unit === 'k') val *= 1000;
      else if (unit === 'jt' || unit === 'juta') val *= 1000000;
      return Number.isFinite(val) && val > 0 ? { value: Math.round(val), matched: m[0] } : null;
    }

    function finLocalDate(offset = 0) {
      const d = new Date();
      d.setDate(d.getDate() + offset);
      return d.toLocaleDateString('en-CA');
    }

    function finParse(text) {
      const verbRe = /\b(catat|catatkan|catet|tambah|tambahkan|input|masukkan|masukan|simpan|tulis|record)\b/i;
      const dirRe  = /\b(pemasukan|pendapatan|income|pengeluaran|expense)\b/i;
      const vm = text.match(verbRe), dm = text.match(dirRe);
      if (!vm || !dm) return null;
      const direction = /^(pemasukan|pendapatan|income)$/i.test(dm[1]) ? 'in' : 'out';
      let rest = text;

      // Tanggal
      let date = null;
      let d;
      if ((d = rest.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) {
        date = d[0]; rest = rest.replace(d[0], ' ');
      } else if ((d = rest.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/))) {
        date = `${d[3]}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`; rest = rest.replace(d[0], ' ');
      } else if (/\bkemarin lusa\b/i.test(rest)) {
        date = finLocalDate(-2); rest = rest.replace(/\bkemarin lusa\b/i, ' ');
      } else if (/\bkemarin\b/i.test(rest)) {
        date = finLocalDate(-1); rest = rest.replace(/\bkemarin\b/i, ' ');
      } else if (/\bhari ini\b/i.test(rest)) {
        date = finLocalDate(0); rest = rest.replace(/\bhari ini\b/i, ' ');
      }
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date + 'T00:00:00')))) date = null;

      rest = rest.replace(verbRe, ' ').replace(dirRe, ' ').replace(/\btanggal\b\s*[:=]?/gi, ' ');

      // Nominal
      let amount = null;
      const am = finAmount(rest);
      if (am) { amount = am.value; rest = rest.replace(am.matched, ' '); }

      // Bukan perintah kalau tanpa nominal dan kelihatan seperti pertanyaan
      if (!amount && (/[?]/.test(text) || /\b(cara|gimana|bagaimana|kenapa|mengapa)\b/i.test(text))) return null;
      if (!amount && !/\b(catat|catatkan|catet)\b/i.test(text)) return null;

      // Catatan: ambil sampai akhir / sampai tanda '|'
      const raw = {};
      const nm = rest.match(/\b(catatan|keterangan)\b\s*[:=]?/i);
      if (nm) {
        const after = rest.slice(nm.index + nm[0].length);
        const bar = after.indexOf('|');
        const note = finClean(bar === -1 ? after : after.slice(0, bar));
        if (note) raw.note = note;
        rest = rest.slice(0, nm.index) + ' ' + (bar === -1 ? '' : ' | ' + after.slice(bar + 1));
      }

      // Marker kategori / buku / akun
      const marks = [...rest.matchAll(/\b(kategori|buku|akun)\b\s*[:=]?/gi)];
      marks.forEach((m, i) => {
        const start = m.index + m[0].length;
        const end = i + 1 < marks.length ? marks[i + 1].index : rest.length;
        const v = finClean(rest.slice(start, end));
        const slot = { kategori: 'category', buku: 'book', akun: 'account' }[m[1].toLowerCase()];
        if (v && !raw[slot]) raw[slot] = v;
      });
      const pre = marks.length ? rest.slice(0, marks[0].index) : rest;

      return { direction, amount, date, raw, rest: finNorm(pre) };
    }

    function finResolve(input, options) {
      const n = finNorm(input);
      if (!n) return { status: 'none' };
      const nn = n.replace(/ /g, '');
      const scored = [];
      for (const o of options) {
        const on = finNorm(o.name);
        if (!on) continue;
        const onn = on.replace(/ /g, '');
        let score = 0;
        if (onn === nn) score = 1;
        else if (nn.length >= 2 && (onn.includes(nn) || (onn.length >= 3 && nn.includes(onn)))) score = 0.9;
        else { const sim = finSim(nn, onn); if (sim >= 0.7) score = sim; }
        if (!score) {
          const ot = on.split(' ');
          if (n.split(' ').some(t => t.length >= 3 && ot.includes(t))) score = 0.6;
        }
        if (score) scored.push({ o, score });
      }
      if (!scored.length) return { status: 'none' };
      scored.sort((a, b) => b.score - a.score);
      const exact = scored.filter(x => x.score === 1);
      if (exact.length === 1) return { status: 'exact', item: exact[0].o };
      if (exact.length > 1) return { status: 'ambiguous', items: exact.map(x => x.o).slice(0, 6) };
      if (scored.length === 1 || scored[0].score - scored[1].score >= 0.15) return { status: 'suggest', item: scored[0].o };
      return { status: 'ambiguous', items: scored.slice(0, 6).map(x => x.o) };
    }

    function finScan(restNorm, options) {
      if (!restNorm) return null;
      const padded = ' ' + restNorm + ' ';
      const hits = options
        .map(o => ({ o, n: finNorm(o.name) }))
        .filter(x => x.n && padded.includes(' ' + x.n + ' '))
        .sort((a, b) => b.n.length - a.n.length);
      return hits.length ? hits[0].o : null;
    }

    const finTypeOf = (c) => {
      const t = finNorm(c.type ?? c.kind ?? c.direction);
      if (['income', 'in', 'pemasukan', 'masuk'].includes(t)) return 'income';
      if (['expense', 'out', 'pengeluaran', 'keluar'].includes(t)) return 'expense';
      if (['both', 'all', 'semua', ''].includes(t)) return 'both';
      return t;
    };

    // Suara Rem untuk pertanyaan/balasan tetap (file fin_*.mp3). Gagal diam-diam kalau file belum ada.
    function finVoice(file) {
      if (!file) return;
      try { playVoice(file); } catch (_) {}
    }
    const finSay = (t, voice) => { appendMessage('assistant', t); finVoice(voice); return true; };
    const finList = (opts) => opts.slice(0, 10).map((o, i) => `${i + 1}. ${o.name}`).join('\n');

    async function finLoad() {
      await EcosystemDB.open();
      const data = await EcosystemDB.kv.finances.get('db');
      if (!data || !Array.isArray(data.transactions)) throw new Error('Data CuciMoney+ belum ditemukan di database bersama.');
      return data;
    }

    // Jalankan alur: cari field yang masih kurang → tanya, atau simpan kalau sudah lengkap.
    // Return false HANYA kalau pencatatan dibatalkan otomatis dan pesan sebaiknya diteruskan ke chat biasa.
    async function finAdvance() {
      const st = financePending;
      const data = await finLoad();
      const tipe = st.direction === 'in' ? 'pemasukan' : 'pengeluaran';
      st.tries = st.tries || {};
      st.sel = st.sel || {};
      st.noScan = st.noScan || {};

      // Tanya ulang; kalau sudah 2x gagal di field yang sama → batalkan
      const askUser = (slot, msg, ask, fail = false, voice = null) => {
        if (fail && st.answered === slot) st.tries[slot] = (st.tries[slot] || 0) + 1;
        else if (!fail) st.tries[slot] = 0;
        st.answered = null;
        if ((st.tries[slot] || 0) >= 2) {
          financePending = null;
          finSay('Aku belum nangkep maksudnya, jadi pencatatan transaksi kubatalkan dulu. Coba lagi ya, contoh: catat ' + tipe + ' 5000 kategori Minuman buku Personal akun Dana Cash', 'fin_bingung.mp3');
          return false;
        }
        st.ask = ask;
        return finSay(msg, voice);
      };

      if (!(st.amount > 0)) {
        return askUser('amount', 'Berapa nominalnya?', { slot: 'amount', type: 'value' }, false, 'fin_nominal.mp3');
      }

      const slots = [
        { key: 'book', label: 'buku', q: 'Di buku mana?',
          options: () => data.books || [] },
        { key: 'account', label: 'akun', q: 'Pakai akun apa?',
          options: () => {
            const book = (data.books || []).find(b => String(b.id) === String(st.sel.book?.id));
            return (data.accounts || []).filter(a => (book?.accountIds || []).some(id => String(id) === String(a.id)));
          } },
        { key: 'category', label: 'kategori ' + tipe, q: 'Kategori ' + tipe + ' apa?',
          options: () => (data.categories || []).filter(c => { const t = finTypeOf(c); return t === 'both' || t === (st.direction === 'in' ? 'income' : 'expense'); }) },
      ];

      for (const s of slots) {
        const options = s.options();
        if (!options.length) throw new Error(`Belum ada ${s.label} yang tersedia${s.key === 'account' ? ' di buku ini' : ''}.`);

        if (st.sel[s.key]) {
          if (options.some(o => String(o.id) === String(st.sel[s.key].id))) continue;
          st.sel[s.key] = null;
        }

        const rawVal = st.raw[s.key];
        if (!rawVal) {
          if (!st.noScan[s.key]) {
            const hit = finScan(st.rest, options);
            if (hit) { st.sel[s.key] = { id: hit.id, name: hit.name }; continue; }
            if (options.length === 1) { st.sel[s.key] = { id: options[0].id, name: options[0].name }; continue; }
          }
          return askUser(s.key, `${s.q}\n${finList(options)}`, { slot: s.key, type: 'value', options }, false,
            { book: 'fin_buku.mp3', account: 'fin_akun.mp3', category: 'fin_kategori.mp3' }[s.key]);
        }

        const r = finResolve(rawVal, options);
        if (r.status === 'exact') { st.sel[s.key] = { id: r.item.id, name: r.item.name }; continue; }
        if (r.status === 'suggest') {
          return askUser(s.key, `Maksudmu ${s.label} “${r.item.name}”? (ya / bukan)`,
            { slot: s.key, type: 'confirm', candidate: r.item, options }, false, 'fin_maksud.mp3');
        }
        if (r.status === 'ambiguous') {
          return askUser(s.key, `Ada beberapa ${s.label} yang mirip dengan “${rawVal}”:\n${finList(r.items)}\nYang mana? (ketik nomor atau namanya)`,
            { slot: s.key, type: 'value', options: r.items }, false, 'fin_ambigu.mp3');
        }
        return askUser(s.key, `${s.label[0].toUpperCase() + s.label.slice(1)} “${rawVal}” tidak ditemukan. Pilihan yang ada:\n${finList(options)}\nYang mana?`,
          { slot: s.key, type: 'value', options }, true, 'fin_tidak_ketemu.mp3');
      }

      // Semua lengkap → konfirmasi lalu simpan
      const book = data.books.find(b => String(b.id) === String(st.sel.book.id));
      const account = data.accounts.find(a => String(a.id) === String(st.sel.account.id));
      const category = data.categories.find(c => String(c.id) === String(st.sel.category.id));
      const direction = st.direction, amount = st.amount;
      const date = st.date || finLocalDate(0);
      const title = st.raw.note || category.name;
      const pretty = amount.toLocaleString('id-ID');
      const label = direction === 'in' ? 'Pemasukan' : 'Pengeluaran';
      const confirmText = `Simpan transaksi ini ke CuciMoney+?\n\n${label}: Rp ${pretty}\nBuku: ${book.name}\nAkun: ${account.name}\nKategori: ${category.name}\nCatatan: ${title}\nTanggal: ${date}`;
      financePending = null;
      finVoice('fin_konfirmasi.mp3');
      if (!window.confirm(confirmText)) {
        return finSay('Oke, transaksi dibatalkan. Belum ada perubahan di CuciMoney+.', 'fin_batal.mp3');
      }
      const trx = { id: Date.now() * 1000 + Math.floor(Math.random() * 1000), bookId: book.id, title, amount, direction, category_id: category.id, account_id: account.id, date, member_id: data.members?.[0]?.id || 'm1', createdAt: Date.now() };
      data.transactions.unshift(trx);
      account.balance = Number(account.balance || 0) + (direction === 'in' ? amount : -amount);
      await EcosystemDB.kv.finances.set('db', data);
      return finSay(`Transaksi tersimpan di CuciMoney+ ✓\n${label} Rp ${pretty} · ${title}\n${book.name} / ${account.name} · ${date}`, 'fin_sukses.mp3');
    }

    async function finHandleAnswer(text) {
      const st = financePending;
      const n = finNorm(text);
      if (/\b(batal|batalkan|cancel)\b/.test(n) || /\b(gak|ga|nggak|ngga|tidak|enggak) jadi\b/.test(n)) {
        financePending = null;
        return finSay('Oke, pencatatan dibatalkan.', 'fin_batal.mp3');
      }
      const ask = st.ask;
      if (!ask) { financePending = null; return false; }
      st.ts = Date.now();
      st.answered = ask.slot;

      if (ask.slot === 'amount') {
        const a = finAmount(text);
        if (a) st.amount = a.value;
        else {
          st.tries = st.tries || {};
          st.tries.amount = (st.tries.amount || 0) + 1;
          if (st.tries.amount >= 2) { financePending = null; finSay('Nominalnya belum kebaca, pencatatan kubatalkan dulu.', 'fin_bingung.mp3'); return false; }
          return finSay('Nominalnya belum kebaca. Contoh: 5000, 5rb, atau 1,5 juta.', 'fin_nominal.mp3');
        }
        st.answered = null;
      } else if (ask.type === 'confirm') {
        if (/^(ya|iya|iy|y|yes|yap|yup|betul|benar|bener|ok|oke|okay|sip|lanjut|itu|boleh)( |$)/.test(n)) {
          st.sel[ask.slot] = { id: ask.candidate.id, name: ask.candidate.name };
          st.answered = null;
        } else if (/^(bukan|tidak|nggak|ngga|enggak|gak|ga|no|nope|salah)( |$)/.test(n)) {
          st.raw[ask.slot] = null;
          st.noScan[ask.slot] = true;
        } else {
          st.raw[ask.slot] = finClean(text);
        }
      } else {
        const pick = /^\d{1,2}$/.test(n) && ask.options ? ask.options[Number(n) - 1] : null;
        if (pick) { st.sel[ask.slot] = { id: pick.id, name: pick.name }; st.answered = null; }
        else st.raw[ask.slot] = finClean(text);
      }
      return await finAdvance();
    }

    async function handleFinanceCommand(text) {
      try {
        if (financePending && Date.now() - financePending.ts > FIN_TTL) financePending = null;
        const intent = finParse(text);
        if (intent) {
          financePending = { ...intent, sel: {}, noScan: {}, tries: {}, ask: null, answered: null, ts: Date.now() };
          return await finAdvance();
        }
        if (!financePending) return false;
        return await finHandleAnswer(text);
      } catch (err) {
        financePending = null;
        appendMessage('assistant', `Belum bisa menyimpan transaksi: ${err.message || 'terjadi kesalahan'}`);
        return true;
      }
    }


    return {
      name: 'finance',
      match: (text) => finParse(text) !== null,
      isPending: () => {
        if (financePending && Date.now() - financePending.ts > FIN_TTL) financePending = null;
        return !!financePending;
      },
      reset: () => { financePending = null; },
      handle: handleFinanceCommand,
    };
  }

  global.FinanceTool = { create };
})(window);
