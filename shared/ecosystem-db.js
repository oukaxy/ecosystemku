/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║              ECOSYSTEM DB — Shared Database Module           ║
 * ║                                                              ║
 * ║  Single IndexedDB untuk semua apps:                          ║
 * ║    • IdeKu        → domain: ideas                           ║
 * ║    • Daily OS     → domain: habits, todos                    ║
 * ║    • Kronik       → domain: journal_entries, kv              ║
 * ║    • CuciMoney+   → domain: finances (kv-based)              ║
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

        /* ── kv (Kronik misc + CuciMoney+ finances) ────────────── */
        // Dibagi per-namespace via prefix key:
        //   kronik:*        → Kronik RPG profile cache, dll
        //   finances:*      → CuciMoney+ db, budgets, masterBudgets
        if (!d.objectStoreNames.contains('kv')) {
          d.createObjectStore('kv');
        }
      };

      req.onsuccess  = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror    = (e) => reject(e.target.error);
      req.onblocked  = ()  => reject(new Error('ecosystem_db blocked — tutup tab lain dulu'));
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
    }));
  }

  /** Get satu record by keyPath */
  function get(storeName, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = (e) => resolve(e.target.result ?? null);
      req.onerror   = (e) => reject(e.target.error);
    }));
  }

  /** Put (upsert) satu record */
  function put(storeName, record, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = key !== undefined
        ? tx.objectStore(storeName).put(record, key)   // kv store pakai explicit key
        : tx.objectStore(storeName).put(record);       // inline keyPath
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    }));
  }

  /** Delete satu record */
  function remove(storeName, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(storeName, 'readwrite');
      const req = tx.objectStore(storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = (e) => reject(e.target.error);
    }));
  }

  /** Clear seluruh object store */
  function clear(storeName) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = (e) => reject(e.target.error);
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
    putAll:   (arr, clear)  => putAll('journal_entries', arr, clear),
  };

  /* ═══════════════════════════════════════════════════════════════
     DOMAIN: KV STORE  (Kronik misc + CuciMoney+)
     Semua key diberi namespace prefix agar tidak bentrok:
       kronik:{key}     → pakai kv.kronik.get/set
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
     * Namespace Kronik → prefix 'kronik:'
     * Contoh: kv.kronik.get('rpg_profile') membaca key 'kronik:rpg_profile'
     */
    kronik: {
      get:    (key)        => get('kv', `kronik:${key}`).then(r => r ?? null),
      set:    (key, value) => put('kv', value, `kronik:${key}`),
      delete: (key)        => remove('kv', `kronik:${key}`),
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
   * (Pengganti Kronik → readDailyOsData() yang buka dailyos_db manual)
   */
  async function getDailyOsData(helpers = {}) {
    const { getActiveHabits, getActiveTodos } = helpers;

    const habitsArr = await habits.getAll();
    const todosArr  = await todos.getAll();

    const activeHabits = getActiveHabits ? getActiveHabits({ habits: habitsArr }) : habitsArr;
    const activeTodos  = getActiveTodos  ? getActiveTodos({ todos: todosArr })   : todosArr;

    const totalPoints = activeHabits.reduce((sum, h) => {
      const history = h.history || {};
      return sum + Object.values(history).reduce((s, v) =>
        s + (Array.isArray(v) ? v.length : (v ? 1 : 0)), 0);
    }, 0) * 10;

    return {
      habits:     activeHabits,
      todos:      activeTodos,
      totalPoints,
      exportedAt: new Date().toISOString(),
    };
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

    /* Cross-app helpers */
    getIdeasInProgress,
    getDailyOsData,

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
