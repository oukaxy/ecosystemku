/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              ECOSYSTEM DB — Shared Database Module           ║
 * ║                                                              ║
 * ║  Single IndexedDB untuk semua apps:                          ║
 * ║    • IdeKu        → domain: ideas                           ║
 * ║    • Daily OS     → domain: habits, todos                    ║
 * ║    • CuciMoney+   → domain: finances (kv-based), savings     ║
 * ║    • Kronik       → domain: journal (journal_entries)        ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CARA PAKAI:
 *   <script src="/shared/ecosystem-db.js"></script>
 *   const db = await EcosystemDB.open();
 *
 * Semua method tersedia di window.EcosystemDB
 */

const EcosystemDB = (() => {

  /* ── Config ─────────────────────────────────────────────────── */
  const DB_NAME    = 'ecosystem_db';
  const DB_VERSION = 1;

  /* ── Internal state ─────────────────────────────────────────── */
  let _db = null;

  /* ═══════════════════════════════════════════════════════════════
     CORE — open / upgrade
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Buka (atau buat) ecosystem_db.
   * Panggil sekali di awal app, lalu reuse instance.
   * @returns {Promise<IDBDatabase>}
   */
  function open() {
    if (_db) return Promise.resolve(_db);

    // Minta persistent storage agar browser tidak menghapus data sembarangan.
    // Dipanggil sekali saja; tidak memblok buka DB.
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist();
    }

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const d = e.target.result;

        /* ── ideas (IdeKu) ─────────────────────────────────────── */
        if (!d.objectStoreNames.contains('ideas')) {
          d.createObjectStore('ideas', { keyPath: 'id' });
        }

        /* ── habits (Daily OS) ─────────────────────────────────── */
        if (!d.objectStoreNames.contains('habits')) {
          d.createObjectStore('habits', { keyPath: '_key' });
        }

        /* ── todos (Daily OS) ──────────────────────────────────── */
        if (!d.objectStoreNames.contains('todos')) {
          d.createObjectStore('todos', { keyPath: '_key' });
        }

        /* ── journal_entries (Kronik) ──────────────────────────── */
        if (!d.objectStoreNames.contains('journal_entries')) {
          const store = d.createObjectStore('journal_entries', { keyPath: 'id' });
          store.createIndex('order', 'order', { unique: false });
        }

        /* ── kv (CuciMoney+ finances) ────────────────────────────── */
        // Dibagi per-namespace via prefix key:
        //   finances:*      → CuciMoney+ db, budgets, masterBudgets
        if (!d.objectStoreNames.contains('kv')) {
          d.createObjectStore('kv');
        }
      };

      req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror    = (e) => reject(e.target.error);
      req.onblocked  = ()  => reject(new Error('ecosystem_db blocked — tutup tab lain dulu'));

      // Kalau tab lain meminta upgrade versi, lepas koneksi ini agar tidak blocked
      req.onversionchange = (e) => {
        _db = null;
        e.target.close();
      };
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     GENERIC HELPERS
  ═══════════════════════════════════════════════════════════════ */

  /** Get all records dari sebuah object store */
  function getAll(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = (e) => resolve(e.target.result || []);
      req.onerror   = (e) => reject(e.target.error);
      tx.onerror    = (e) => reject(e.target.error);
      tx.onabort    = (e) => reject(e.target.error);
    }));
  }

  /** Get satu record by keyPath */
  function get(storeName, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror   = (e) => reject(e.target.error);
      tx.onerror    = (e) => reject(e.target.error);
      tx.onabort    = (e) => reject(e.target.error);
    }));
  }

  /** Put (upsert) satu record */
  function put(storeName, record, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = key !== undefined
        ? tx.objectStore(storeName).put(record, key)   // kv store pakai explicit key
        : tx.objectStore(storeName).put(record);       // inline keyPath
      req.onerror   = (e) => reject(e.target.error);
      tx.oncomplete = () => resolve();   // tunggu transaction benar-benar commit
      tx.onerror    = (e) => reject(e.target.error);
      tx.onabort    = (e) => reject(e.target.error);
    }));
  }

  /** Delete satu record */
  function remove(storeName, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onerror   = (e) => reject(e.target.error);
      tx.oncomplete = () => resolve();   // tunggu transaction benar-benar commit
      tx.onerror    = (e) => reject(e.target.error);
      tx.onabort    = (e) => reject(e.target.error);
    }));
  }

  /** Clear seluruh object store */
  function clear(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).clear();
      req.onerror   = (e) => reject(e.target.error);
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e.target.error);
      tx.onabort    = (e) => reject(e.target.error);
    }));
  }

  /** Put banyak record sekaligus dalam satu transaction */
  function putAll(storeName, records, clearFirst = false) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      if (clearFirst) store.clear();
      records.forEach(r => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e.target.error);
    }));
  }

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN: IDEAS  (IdeKu)
  ═══════════════════════════════════════════════════════════════ */
  const ideas = {
    getAll:  ()       => getAll('ideas'),
    put:     (idea)   => put('ideas', idea),
    delete:  (id)     => remove('ideas', id),

    /** Wishlist = ideas dengan type 'Wishlist' (dipakai bersama IdeKu & CuciMoney+) */
    getWishlist: () => getAll('ideas').then(all => all.filter(i => i && i.type === 'Wishlist')),
  };

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN: HABITS + TODOS  (Daily OS)
     Daily OS menyimpan dengan pola: { _key, data }
     Habits  → _key: 'dailyos_habits', data: [...array habits...]
     Todos   → _key: 'dailyos_todos',  data: [...array todos...]
  ═══════════════════════════════════════════════════════════════ */
  const habits = {
    /** Ambil array habits langsung (unwrap dari wrapper {_key, data}) */
    getAll: () => get('habits', 'dailyos_habits').then(r => r?.data ?? []),

    /** Simpan array habits */
    save: (arr) => put('habits', { _key: 'dailyos_habits', data: arr }),

    /** Raw get/put untuk kompatibilitas Daily OS idbGet/idbSet */
    rawGet: (key) => get('habits', key).then(r => r?.data ?? null),
    rawSet: (key, value) => put('habits', { _key: key, data: value }),
    rawDelete: (key)     => remove('habits', key),
  };

  const todos = {
    getAll: () => get('todos', 'dailyos_todos').then(r => r?.data ?? []),
    save:   (arr) => put('todos', { _key: 'dailyos_todos', data: arr }),

    rawGet:    (key)        => get('todos', key).then(r => r?.data ?? null),
    rawSet:    (key, value) => put('todos', { _key: key, data: value }),
    rawDelete: (key)        => remove('todos', key),
  };

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN: JOURNAL ENTRIES  (Kronik)
  ═══════════════════════════════════════════════════════════════ */
  const journal = {
    getAll:   ()            => getAll('journal_entries'),
    put:      (entry)       => put('journal_entries', entry),
    delete:   (id)          => remove('journal_entries', id),
    putAll:   (arr, cf)     => putAll('journal_entries', arr, cf),
  };

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN: KV STORE  (CuciMoney+)
     Semua key diberi namespace prefix agar tidak bentrok:
       finances:{key}   → pakai kv.finances.get/set
  ═══════════════════════════════════════════════════════════════ */
  const kv = {
    /**
     * KV tanpa namespace (backward compat)
     */
    get:    (key)         => get('kv', key).then(r => r ?? null),
    set:    (key, value)  => put('kv', value, key),
    delete: (key)         => remove('kv', key),

    /**
     * Namespace Daily OS → prefix 'dailyos:'
     * Contoh: kv.dailyos.get('totalPoints') membaca key 'dailyos:totalPoints'
     */
    dailyos: {
      get:    (key)        => get('kv', `dailyos:${key}`).then(r => r ?? null),
      set:    (key, value) => put('kv', value, `dailyos:${key}`),
      delete: (key)        => remove('kv', `dailyos:${key}`),
    },

    /**
     * Namespace CuciMoney+ → prefix 'finances:'
     * Contoh: kv.finances.get('db'), kv.finances.set('budgets', [...])
     */
    finances: {
      get:    (key)        => get('kv', `finances:${key}`).then(r => r ?? null),
      set:    (key, value) => put('kv', value, `finances:${key}`),
      delete: (key)        => remove('kv', `finances:${key}`),
    },
  };

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN: SAVINGS  (CuciMoney+ Tabungan ↔ IdeKu Wishlist)
     Disimpan di kv 'finances:savings' sebagai:
       { pots: { "<wishlistId>": Pot } }
     Pot = {
       wishId, saved,                      // saved = uang yang sedang tertabung (Rp)
       snap: { title, price, image },      // salinan terakhir data wishlist (untuk wishlist yang terhapus)
       history: [ { id, type:'in'|'out', kind?:'realize'|'cancel', amount, date,
                    accountId, accountName, ts, trxIds:[out,in] } ],
       realizedAt, realizedAmount          // terisi saat tabungan dicairkan karena target tercapai
     }
     Penulis tunggal: CuciMoney+.  IdeKu hanya membaca (untuk progress bar).
  ═══════════════════════════════════════════════════════════════ */
  const savings = {
    getAll: async () => {
      const r = await kv.finances.get('savings');
      return (r && typeof r === 'object' && r.pots) ? r : { pots: {} };
    },
    save: (data) => kv.finances.set('savings', data),
  };

  /* ═══════════════════════════════════════════════════════════════
     SYNC LINTAS TAB / APP  (BroadcastChannel + fallback saat tab kembali aktif)
     IndexedDB tidak punya event antar-tab, jadi tiap app memberi kabar
     lewat sync.notify('ideas' | 'savings') dan mendengarkan lewat sync.on(fn).
  ═══════════════════════════════════════════════════════════════ */
  const sync = (() => {
    const handlers = new Set();
    let ch = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        ch = new BroadcastChannel('ecosystem_sync');
        ch.onmessage = (e) => handlers.forEach(h => { try { h(e.data || {}); } catch (_) {} });
      }
    } catch (_) { ch = null; }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) handlers.forEach(h => { try { h({ topic: 'visible' }); } catch (_) {} });
      });
    }
    return {
      notify: (topic) => { try { ch && ch.postMessage({ topic, at: Date.now() }); } catch (_) {} },
      on: (fn) => { handlers.add(fn); return () => handlers.delete(fn); },
    };
  })();

  /* ═══════════════════════════════════════════════════════════════
     CROSS-APP READ HELPERS
     (Menggantikan hardcoded indexedDB.open('other_db') di setiap app)
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Baca semua ideas berstatus 'Proses' dari ecosystem_db
   * (Pengganti Daily OS → readIdekuIdeas() yang buka ideku_db manual)
   */
  async function getIdeasInProgress() {
    const all = await ideas.getAll();
    return all
      .filter(idea => idea && idea.status === 'Proses')
      .map(idea => ({
        title:    idea.title    || idea.name || '',
        notes:    idea.notes    || idea.description || '',
        category: idea.category || '',
      }))
      .filter(idea => idea.title);
  }

  /**
   * Baca habits + todos aktif dari ecosystem_db
   */
  async function getDailyOsData(helpers = {}) {
    const { getActiveHabits, getActiveTodos } = helpers;

    const habitsArr = await habits.getAll();
    const todosArr  = await todos.getAll();

    const activeHabits = getActiveHabits ? getActiveHabits({ habits: habitsArr }) : habitsArr;
    const activeTodos  = getActiveTodos  ? getActiveTodos({ todos: todosArr })   : todosArr;

    // Baca totalPoints dari kv.dailyos (disimpan oleh Daily OS saat save())
    // Fallback: hitung ulang dari history kalau belum pernah disimpan (user lama)
    let totalPoints = await get('kv', 'dailyos:totalPoints').then(r => r ?? null);
    if (totalPoints === null) {
      totalPoints = activeHabits.reduce((sum, h) => {
        const history = h.history || {};
        return sum + Object.values(history).reduce((s, v) =>
          s + (Array.isArray(v) ? v.length : (v ? 1 : 0)), 0);
      }, 0) * 10;
    }

    return {
      habits:     activeHabits,
      todos:      activeTodos,
      totalPoints,
      exportedAt: new Date().toISOString(),
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     BACKUP / RESTORE LINTAS APP
     Export semua object store sekaligus ke satu objek JSON —
     berguna untuk backup seluruh ekosistem atau pindah perangkat.
  ═══════════════════════════════════════════════════════════════ */

  const ALL_STORES = ['ideas', 'habits', 'todos', 'journal_entries', 'kv'];

  /**
   * Export seluruh isi DB.
   * @returns {Promise<Object>} payload — simpan sebagai JSON untuk backup
   */
  async function exportAll() {
    const payload = { _app: 'ecosystemku', _version: DB_VERSION, _exportedAt: new Date().toISOString() };
    for (const store of ALL_STORES) {
      payload[store] = await getAll(store);
    }
    return payload;
  }

  /**
   * Restore dari payload exportAll().
   * @param {Object} payload  hasil exportAll()
   * @param {boolean} merge   true = gabung dengan data ada, false = bersihkan dulu (default)
   */
  async function importAll(payload, merge = false) {
    if (!payload || payload._app !== 'ecosystemku') {
      throw new Error('Payload backup ecosystemku tidak valid');
    }
    for (const store of ALL_STORES) {
      const records = payload[store];
      if (!Array.isArray(records)) continue;
      await putAll(store, records, !merge);
    }
  }

  /* ── Public API ─────────────────────────────────────────────── */
  return {
    open,

    /* Domain namespaces */
    ideas,
    habits,
    todos,
    journal,
    kv,
    savings,
    sync,

    /* Cross-app helpers */
    getIdeasInProgress,
    getDailyOsData,

    /* Backup / restore lintas app */
    exportAll,
    importAll,

    /* Generic (kalau perlu langsung) */
    getAll,
    get,
    put,
    remove,
    clear,
    putAll,
  };
})();

/* Export untuk module environments (jika pakai bundler) */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = EcosystemDB;
}
