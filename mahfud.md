# EcosystemKu → Flutter Super App — Rencana Migrasi

> **Untuk agentic worker:** Dokumen ini adalah *master plan*, bukan plan per-task.
> Sebelum mengeksekusi satu fase, buat plan implementasi fokus untuk fase itu di
> `docs/superpowers/plans/YYYY-MM-DD-<fase>.md` dengan langkah TDD (test gagal →
> implementasi → test lulus → commit). Jalankan dengan
> `superpowers:subagent-driven-development` atau `superpowers:executing-plans`.

**Goal:** Mengubah tujuh PWA terpisah di repo ini menjadi satu aplikasi Android
Flutter (super app) dengan tiga tab — Asisten, Apps, Setelan — tanpa kehilangan
data, perilaku, atau kekhasan tiap aplikasi.

**Architecture:** Satu binary Flutter. Shell bertab memakai `StatefulShellRoute`.
Tiap aplikasi lama menjadi modul fitur (`lib/features/<app>`) dengan lapisan
`data → domain → ui`. Seluruh data pindah dari IndexedDB/localStorage ke satu
database Drift/SQLite. Backup tetap berupa ZIP kompatibel dengan versi web.
Avatar Live2D tetap berjalan di WebView lokal, dikendalikan lewat JS bridge.

**Tech Stack:** Flutter stable (Dart 3), Riverpod, go_router, Drift + SQLite,
flutter_inappwebview, flutter_secure_storage, http, archive, file_picker,
share_plus, flutter_local_notifications, fl_chart, cryptography, intl,
url_launcher, flutter_lints. Build APK lewat GitHub Actions.

**Spec:** Dokumen ini + hasil recon repo (referensi file di Bagian 19).
Web lama tetap menjadi acuan perilaku dan tetap hidup selama migrasi.

---

## Global Constraints

- Android only untuk v1. `minSdk 26`, `targetSdk`/`compileSdk` = stable terbaru saat kickoff.
- Semua nominal uang disimpan sebagai **integer rupiah**, bukan `double`.
- ID lama dipertahankan apa adanya sebagai `TEXT`; jangan regenerate saat migrasi.
- Tanggal bisnis (`date`) disimpan `YYYY-MM-DD` waktu lokal; timestamp epoch ms UTC.
- Tidak ada secret di repo. API key hanya di `flutter_secure_storage`; tidak pernah masuk log, backup, atau crash report.
- Backup tidak boleh menghapus data sumber. Import selalu membuat backup otomatis sebelum menulis.
- Web lama tidak boleh diubah selama migrasi kecuali bug blocker yang disepakati.
- Setiap fase harus menghasilkan APK yang bisa dipasang dan lolos `flutter analyze` + `flutter test`.
- Perubahan platform (worker AI, endpoint) harus kompatibel mundur dengan web.
- Format kode: `dart format`; tanpa komentar kecuali `why` yang tidak terbaca dari kode; shortcut nyata ditandai `shortcut: <batas>, <kapan upgrade>`.
- Nama aplikasi/fitur memakai istilah lama: Daily OS, IdeKu, Kronik, CuciMoney+, LinkKu, Asisten/Rem.

## Review Focus

Lima mode kegagalan yang paling mungkin melukai pengguna dan wajib punya test
di task pemiliknya:

1. **Import/restore kehilangan data** — savings, link privat, history habit, archive Kronik, setelan lokal.
2. **Saldo CuciMoney drift** — setelah edit/hapus transfer, hapus akun/kategori/buku, atau import.
3. **Batas tanggal/streak** — habit streak dan budget bulanan bergeser karena timezone/DST.
4. **Live2D gagal di APK** — aset tidak termuat offline, audio tidak sync, ekspresi tidak berubah.
5. **AI putus/kunci bocor** — Origin worker ditolak, key tampil di log/backup, streaming menggantung.

---

## 1. Ringkasan Eksekutif

Repo sekarang berisi satu hub + enam PWA mandiri yang berbagi tampilan, sebagian
data, dan beberapa API. Semua berjalan di browser dengan IndexedDB. Rencana ini
memindahkannya menjadi satu aplikasi Flutter asli dengan database tunggal.

Prinsip eksekusi:

1. **Jangan big-bang.** Fase 0 menyiapkan fondasi dan membuktikan risiko terbesar
   (Live2D). Fase 1 menghasilkan APK yang sudah bisa dipakai. Aplikasi lain
   menyusul satu per satu dari yang paling kecil.
2. **Data lama adalah raja.** Semua data harus bisa diimpor dari ZIP web lama dan
   diekspor kembali dalam format yang masih bisa dibaca web lama.
3. **Paritas perilaku dulu, perbaikan setelahnya.** Bug web yang sudah diketahui
   dicatat, tetapi tidak diperbaiki diam-diam saat porting.
4. **Satu tema, aksen per app.** Shell dan komponen sama; tiap app punya warna
   aksen dan kekhasan tipografi/gambar yang dipertahankan.

Estimasi kasar satu developer: **19–22 minggu** sampai rilis stabil. Angka ini
bukan komitmen; Fase 0 dan 6 adalah yang paling mungkin melar.

---

## 2. Keputusan & Asumsi

Keputusan yang sudah disepakati:

- Super app Flutter, bukan app-in-app/WebView wrapper.
- Bottom tab: **Asisten**, **Apps**, **Setelan**.
- Live2D memakai **opsi (a)**: kanvas avatar tetap WebView; sisa UI Flutter.
- Build APK di **GitHub Actions**, bukan di perangkat/PRoot.
- Migrasi **bertahap**.

Asumsi yang diambil karena belum dijawab (boleh dikoreksi sebelum Fase 1):

| # | Keputusan | Default yang dipakai | Dampak jika diubah |
|---|---|---|---|
| A1 | Cakupan v1 | Bertahap, semua app tetap masuk sebelum rilis 1.0 | Jika semua sekaligus, fase 2–6 digabung dan risiko meledak |
| A2 | API key | Dua mode: **Server** (default, `/api/*` + worker) dan **Personal key** (Sumopod/Groq/Fish langsung) | Jika server saja, fitur AI app butuh worker diubah; jika key saja, pengguna wajib punya key |
| A3 | Cloud backup | Ditunda ke v1.1; v1 hanya ZIP lokal | Menambah `google_sign_in` + Drive API di Fase 1 |
| A4 | Distribusi | GitHub Release + sideload APK; Play Store nanti | Play Store menambah kebijakan data safety, signing, review |
| A5 | Tema | Satu design system, aksen dan "kulit" per app | Jika tiap app tetap sendiri, kerja UI bertambah besar |
| A6 | Bahasa | Indonesia saja (string terpusat, siap dilokalisasi) | Menambah `flutter_localizations` + ARB |
| A7 | Cloud sync | Tidak ada; satu perangkat, backup manual | Sync multi-perangkat adalah proyek terpisah |

Hal yang harus dikonfirmasi (bukan teknis):

- Hak redistribusi model **Rem** (moc3, tekstur, motion, audio) di dalam APK.
- Hak redistribusi **Live2D Cubism Core** di APK. Web sekarang memuatnya dari CDN;
  APK offline mengharuskan bundling atau cache. Jika lisensi tidak memungkinkan,
  fallback: unduh Core saat online dan cache, model tetap lokal.
- Apakah worker AI (`dailyos-ai`, `ideku-proxy`) boleh diubah untuk menerima app
  native, atau kita wajib memakai key pribadi.

---

## 3. Audit Kondisi Saat Ini

| App | Baris | Penyimpanan | API | Backup |
|---|---:|---|---|---|
| Hub `/` | 2.388 | baca semua store + `kv` | — | ZIP v2 + Google Drive |
| Asisten `/assistant/` | ~2.900 JS + 9,6 MB aset | localStorage + baca semua | `/api/chat`, `/api/tts` | Tidak ikut |
| LinkKu `/linkku/` | 1.515 | `linkkuDB/kv` | oEmbed YouTube, allorigins | postMessage |
| Kronik `/kronik/` | 1.681 | `journal_entries` | worker Groq | JSON sendiri |
| IdeKu `/ide-ku/` | 3.446 | `ideas` + localStorage | worker Groq | JSON array |
| Daily OS `/daily-os/` | 4.587 | `habits`, `todos`, `kv` | worker Groq | JSON v3 |
| CuciMoney `/cucimoney/` | 9.495 | `kv.finances:*` | — | JSON + CSV |

Temuan yang wajib ditangani:

- `kv.kronik` dan `kv.gacha` dibaca hub tetapi **tidak didefinisikan** di
  `shared/ecosystem-db.js`; kartu profil/gacha selalu gagal.
- Backup hub **tidak menyertakan** `finances:savings`, dan clear tidak menghapusnya.
  Restore replace juga tidak mengembalikan `savings`.
- Restore Kronik tidak mengembalikan `rpg_profile_cache`; app Kronik sendiri tidak
  punya layar profil/RPG.
- Worker IdeKu membatasi `Origin` ke `https://oukaxy.github.io`; request dari app
  native bisa ditolak.
- Asisten menyimpan history chat hanya di memori; tidak ada cancel streaming.
- LinkKu private mode disimpan plaintext di IndexedDB; enkripsi hanya saat export.
- CuciMoney menyimpan saldo akun secara materialized dan memutasi langsung.
- File audio prompt finance (`fin_*.mp3`) tidak ada; `idle_1.mp3.mp3` salah nama.
- Ekspresi `navi`, `wait`, `bound` divalidasi tetapi tidak ada di peta wajah Rem.

---

## 4. Arsitektur Target

### 4.1 Diagram

```
┌───────────────────────────────────────────────┐
│                Flutter App                    │
│  ┌─────────────────────────────────────────┐  │
│  │ Shell: NavigationBar (3 tab)            │  │
│  │  Asisten │ Apps │ Setelan               │  │
│  └─────────────────────────────────────────┘  │
│        │            │             │           │
│  ┌─────▼─────┐ ┌────▼─────┐ ┌─────▼──────┐   │
│  │ Assistant │ │ App Grid │ │  Settings  │   │
│  │  chat     │ │ + summary│ │ keys/backup│   │
│  │  WebView  │ └────┬─────┘ └─────┬──────┘   │
│  └─────┬─────┘      │             │          │
│        │      ┌─────▼──────────────────────┐  │
│        │      │ Feature modules            │  │
│        │      │ daily_os ideku kronik      │  │
│        │      │ cucimoney linkku           │  │
│        │      └────────────┬───────────────┘  │
│        │                   │                  │
│  ┌─────▼───────────────────▼───────────────┐  │
│  │ Repositories + Drift (SQLite)           │  │
│  │ backup service · AI service · notifier  │  │
│  └─────────────────────────────────────────┘  │
└───────────────────────────────────────────────┘
          │ HTTPS
   ┌──────▼──────────────────────────────┐
   │ Server mode : /api/chat, /api/tts,  │
   │               worker Groq           │
   │ Personal mode: Sumopod, Groq, Fish  │
   └─────────────────────────────────────┘
```

### 4.2 Struktur Folder

```
app/
  pubspec.yaml
  analysis_options.yaml
  android/...
  assets/
    fonts/DMSans-*.ttf
    fonts/DMSerifDisplay-*.ttf
    fonts/Lora-*.ttf                  # opsional, kulit Kronik
    live2d/                           # salinan runtime + model Rem
  lib/
    main.dart
    app.dart
    core/
      theme/tokens.dart
      theme/app_theme.dart
      theme/app_skin.dart
      router/app_router.dart
      db/database.dart
      db/tables/*.dart
      db/daos/*.dart
      backup/backup_service.dart
      backup/backup_model.dart
      ai/ai_client.dart
      ai/provider_config.dart
      notifications/reminder_service.dart
      security/secure_keys.dart
      security/link_crypto.dart
      widgets/*.dart
      utils/date.dart
      utils/money.dart
      utils/ids.dart
    features/
      shell/shell_page.dart
      apps_hub/apps_hub_page.dart
      apps_hub/summary_cards.dart
      settings/settings_page.dart
      settings/profile_section.dart
      settings/ai_keys_section.dart
      settings/backup_section.dart
      settings/data_section.dart
      assistant/assistant_page.dart
      assistant/chat_panel.dart
      assistant/live2d_view.dart
      assistant/tools/*.dart
      assistant/ecosystem_context.dart
      linkku/...
      kronik/...
      ideku/...
      daily_os/...
      cucimoney/...
  test/
    core/...
    features/<app>/...
  integration_test/
    backup_roundtrip_test.dart
scripts/sync-live2d.sh
.github/workflows/android.yml
```

Aturan: file > ~400 baris dipecah per tanggung jawab. Satu folder app berisi
`data/` (DAO/repository), `domain/` (model + aturan murni), `ui/` (halaman/widget).

### 4.3 Dependency & Versi

Gunakan versi stable terbaru saat kickoff, lalu commit `pubspec.lock`.
Dilarang menambah dependency tanpa kebutuhan yang jelas di plan.

| Paket | Fungsi | Alasan |
|---|---|---|
| `flutter_riverpod` | state + DI | state lintas tab/app, mudah dites |
| `go_router` | navigasi | StatefulShellRoute, deep link, back |
| `drift`, `drift_flutter`, `sqlite3_flutter_libs` | database | query/transaksi, migrasi skema |
| `flutter_inappwebview` | Live2D | local server aset + JS bridge + audio |
| `flutter_secure_storage` | API key, PIN material | Android Keystore |
| `http` | API | streaming SSE manual |
| `archive` | ZIP | backup |
| `file_picker`, `share_plus`, `path_provider` | import/export | file Android |
| `flutter_local_notifications`, `timezone` | pengingat | ganti notifikasi service worker |
| `fl_chart` | grafik umum | line/bar/donut standar |
| `cryptography` | AES-GCM, PBKDF2 | kompatibel WebCrypto LinkKu |
| `intl` | tanggal/angka id-ID | format rupiah |
| `html` | parse OG preview | LinkKu |
| `url_launcher` | Hesych eksternal | app grid |
| `flutter_lints` | lint | standar |

Custom painter dipakai hanya jika `fl_chart` tidak bisa meniru tampilan lama
(donut CuciMoney, ring budget, kalender habit).

### 4.4 Lapisan & Aturan

- **UI** tidak menyentuh `http`, `dart:io`, atau Drift langsung.
- **Repository** memiliki operasi tulis dalam satu transaksi DB.
- **Domain** berisi fungsi murni (streak, skor IdeKu, format uang, invariant
  transfer) yang diuji tanpa Flutter.
- **Backup** membaca/menulis lewat repository, bukan SQL mentah.
- Semua tanggal "hari ini" berasal dari satu `Clock` yang bisa diinjeksi di test.

### 4.5 Design System

Token disimpan di `core/theme/tokens.dart`; tema light/dark identik strukturnya.

| Token | Light | Dark |
|---|---|---|
| `bg` | `#F5F4F2` | `#0F0E0C` |
| `surface` | `#FFFFFF` | `#1A1917` |
| `surfaceAlt` | `#EEEDE9` | `#232220` |
| `text` | `#0F0E0C` | `#F0EFE9` |
| `textMuted` | `#6B6A67` | `#9A9994` |
| `border` | `#00000012` | `#FFFFFF0F` |
| `danger` | `#EF4444` | `#F87171` |
| `success` | `#22C55E` | `#4ADE80` |
| `warning` | `#F59E0B` | `#FBBF24` |

Aksen per app: Daily OS `teal #2F8F83`, IdeKu `indigo #6366F1`, Kronik `gold
#C9A84C`, CuciMoney `blue #2F5D8A`, LinkKu `violet #8B5CF6`, Asisten `blue
#5B9CF6`. Aksen hanya untuk tombol/grafik/ikon aktif, bukan latar penuh.

Tipografi: DM Sans (UI/body), DM Serif Display (judul shell & angka besar), Lora
(body jurnal Kronik). Radius 12/16/20; spacing 4/8/12/16/24/32; touch target
minimal 48dp; animasi 150–250 ms; hormati `MediaQuery.disableAnimations`.

Komponen bersama wajib: `EcosystemScaffold`, `EcosystemCard`, `SectionHeader`,
`EmptyState`, `ConfirmSheet`, `AppSnackBar`, `StatTile`, `ProgressRing`,
`FilterChipBar`, `SearchField`, `BottomSheetForm`, `DateField`, `MoneyField`,
`ColorPicker`, `IconPicker`, `SwipeActionTile`, `LoadingSkeleton`.

Aksesibilitas: kontras AA, dukungan text scale sampai 1,3 tanpa overflow,
label semantik untuk grafik dan tombol ikon.

Kulit per app yang dipertahankan:

- Asisten: gelap navy, karakter dominan, chat bawah.
- Kronik: cover buku, kertas parchment, judul Playfair/DM Serif, label emas.
- LinkKu: kartu preview, mode privat ungu.
- CuciMoney: editorial ink/off-white, angka besar.
- Daily OS & IdeKu: bersih, netral, kartu.

### 4.6 Navigasi

- `StatefulShellRoute.indexedStack` untuk tiga tab; state tiap tab dipertahankan.
- Tab Apps membuka app sebagai route penuh di branch-nya sendiri; `NavigationBar`
  disembunyikan saat app terbuka (`parentNavigatorKey` root).
- Back Android: tutup sheet → pop app → kembali ke tab; di tab root, tekan dua
  kali untuk keluar (SnackBar).
- Deep link: `ecosystemku://app/daily-os`, `ecosystemku://assistant`.
- Live2D di-pause saat tab Asisten tidak terlihat; audio berhenti.
- Restorasi state: tab terakhir, filter, dan posisi scroll disimpan ringan di
  `app_meta` (bukan seluruh state).

---

## 5. Model Data (Drift)

### 5.1 Konvensi

- Semua PK/FK `TEXT`, kecuali tabel join.
- Boolean → `BOOL`; JSON kecil → `TEXT` (mis. `activeDays`, `tags`).
- Uang → `INTEGER` rupiah. Jangan pakai `REAL`.
- Urutan → `INTEGER sort`.
- `app_meta(key TEXT PK, value TEXT)` untuk preferensi, XP, view mode, kategori
  IdeKu, dan state kecil lain.
- Migrasi skema Drift memakai `schemaVersion` + `MigrationStrategy`; setiap
  perubahan skema wajib menambah test migrasi dari versi sebelumnya.

### 5.2 Tabel

**Ideas (IdeKu)**

```
ideas(id TEXT PK, title TEXT, notes TEXT, category TEXT, jalur TEXT,
      nextStep TEXT, priority TEXT, status TEXT, type TEXT,
      price INTEGER, image TEXT, createdAt INTEGER, updatedAt INTEGER)
idea_categories(name TEXT PK, sort INTEGER)
```

`priority`: `Penting|Nanti|Kapan-kapan`; `status`: `Belum|Proses|Selesai|Parkir`;
`type`: `Idea|Wishlist`. `category` bebas; warna dihitung hash nama (port fungsi lama).

**Daily OS**

```
habits(id TEXT PK, name TEXT, category TEXT, color TEXT, icon TEXT,
       activeDays TEXT, collapsed BOOL, archived BOOL, createdAt INTEGER)
habit_subtasks(id TEXT PK, habitId TEXT, text TEXT, sort INTEGER)
habit_checks(habitId TEXT, date TEXT, subtaskId TEXT, text TEXT,
             completedAt INTEGER, PRIMARY KEY(habitId,date,subtaskId))
todos(id TEXT PK, title TEXT, priority TEXT, deadline TEXT, done BOOL,
      completedAt INTEGER, sort INTEGER)
todo_subtasks(id TEXT PK, todoId TEXT, text TEXT, done BOOL, sort INTEGER)
```

`history` lama dinormalisasi ke `habit_checks`; entri string lama menjadi
`subtaskId = 'legacy'`, `text` dipertahankan. XP dihitung dari checks
(10 poin per slot selesai) dan disimpan di `app_meta['dailyos.totalPoints']`
hanya sebagai cache.

**Kronik**

```
journal_entries(id TEXT PK, date TEXT, title TEXT, content TEXT,
                orderIndex INTEGER, moodStatus TEXT, moodSvgKey TEXT,
                source TEXT, pinned BOOL, isArchived BOOL,
                createdAt INTEGER, updatedAt INTEGER, archivedAt INTEGER,
                generatedAt INTEGER, completedAt INTEGER)
journal_habit_logs(entryId TEXT, habitName TEXT, category TEXT,
                   completedAt INTEGER, PRIMARY KEY(entryId,habitName,completedAt))
```

`moodStatus`: `Fokus|Lelah|Terinspirasi|Berat|Stabil|Semangat|Kabur`.
`moodSvgKey` mengikuti status. Konten teks polos.

**CuciMoney**

```
books(id TEXT PK, name TEXT)
book_accounts(bookId TEXT, accountId TEXT, sort INTEGER,
              PRIMARY KEY(bookId,accountId))
accounts(id TEXT PK, name TEXT, type TEXT, balance INTEGER,
         openingBalance INTEGER, icon TEXT, notes TEXT,
         useInBook BOOL, includeAsset BOOL, isSavings BOOL)
categories_finance(id TEXT PK, name TEXT, emoji TEXT, type TEXT, sort INTEGER)
transactions(id TEXT PK, bookId TEXT, title TEXT, amount INTEGER,
             direction TEXT, categoryId TEXT, accountId TEXT, date TEXT,
             memberId TEXT, createdAt INTEGER, transferPair TEXT,
             savingsPot TEXT)
members(id TEXT PK, name TEXT, emoji TEXT, sort INTEGER)
master_budgets(id TEXT PK, bookId TEXT, month INTEGER, year INTEGER,
               limitAmount INTEGER, startDate TEXT, endDate TEXT, note TEXT)
budgets_legacy(payload TEXT)          # preservasi data lama, tanpa UI
savings_pots(wishId TEXT PK, saved INTEGER, snapTitle TEXT,
             snapPrice INTEGER, snapImage TEXT, realizedAt INTEGER,
             realizedAmount INTEGER)
savings_events(id TEXT PK, wishId TEXT, type TEXT, kind TEXT,
               amount INTEGER, date TEXT, accountId TEXT, accountName TEXT,
               ts INTEGER, trxIds TEXT)
```

`direction`: `in|out`. `type` akun: `cash|bank|ewallet|digital|credit|investment|saving`.
`openingBalance` = `balance − Σ(in − out)` saat migrasi, agar saldo bisa
dihitung ulang dan dibandingkan. `transferPair` dua arah, amount sama.

**LinkKu**

```
links(id TEXT PK, url TEXT, title TEXT, note TEXT, catId TEXT,
      privateCatId TEXT, tags TEXT, isPrivate BOOL, thumb TEXT,
      ts INTEGER, sort INTEGER)
link_categories(id TEXT PK, name TEXT, isPrivate BOOL, sort INTEGER)
link_tags(name TEXT, mode TEXT, sort INTEGER, PRIMARY KEY(name,mode))
link_security(pinHash TEXT, saltVersion INTEGER, updatedAt INTEGER)
```

Mode `normal|private`. PIN hash SHA-256 hex untuk kompatibilitas; enkripsi export
memakai PBKDF2(pinHash, `linkku-salt-v1`, 100k) + AES-256-GCM, iv 12 byte +
ciphertext, base64.

**Profil & setelan baru**

```
profile(id INTEGER PK CHECK(id=1), name TEXT, avatarPath TEXT)
reminders(id TEXT PK, app TEXT, kind TEXT, time TEXT, enabled BOOL,
          days TEXT, notificationId INTEGER)
app_meta(key TEXT PK, value TEXT)
```

### 5.3 Invariant yang Harus Dijaga

- Transfer: tepat dua baris, `transferPair` sama, amount sama, arah berlawanan,
  akun berbeda. Edit/hapus selalu menyentuh keduanya dalam satu transaksi.
- Saldo akun = `openingBalance + Σ(in − out)` untuk transaksi akun itu; update
  materialized hanya boleh lewat repository, dan ada fungsi rekonsiliasi.
- Savings pot terhubung ke `ideas.id` bertipe Wishlist. Realize menandai ide
  `Selesai`, menambah saldo akun tujuan, dan mencatat `savings_events`.
- Idea dengan kategori yang dihapus dipindah ke kategori default, tidak hilang.
- Journal sort: pinned dulu, lalu `date` desc, lalu `orderIndex`.
- Habit archived tetap dihitung pada statistik historis (paritas web).
- Private link tidak pernah muncul di pencarian/filter saat mode privat terkunci.

### 5.4 Migrasi Skema

- Versi awal DB = 1. Fixture migrasi disimpan di `test/fixtures/db/`.
- Setiap `schemaVersion` naik wajib punya test: buka DB versi lama → jalankan
  migrasi → cek isi.
- Jangan memakai `DROP TABLE` untuk mengubah bentuk; buat tabel baru, salin,
  ganti dalam transaksi.

---

## 6. Backup v3 (Kanonik & Kompatibel)

### 6.1 Struktur ZIP

Nama file: `ecosystemku-backup-YYYY-MM-DD.zip`.

```
manifest.json
daily-os-YYYY-MM-DD.json
ideku-YYYY-MM-DD.json
kronik-YYYY-MM-DD.json
cucimoney-YYYY-MM-DD.json
linkku-YYYY-MM-DD.json
assistant-YYYY-MM-DD.json
```

`manifest.json`:

```json
{
  "schema": 3,
  "app": "ecosystemku-flutter",
  "appVersion": "1.0.0",
  "exportedAt": "2026-11-17T10:00:00.000Z",
  "counts": { "habits": 0, "todos": 0, "ideas": 0, "journals": 0,
              "transactions": 0, "links": 0 },
  "includesSavings": true,
  "includesPrivateLinks": true
}
```

Isi per file mempertahankan bentuk yang dibaca hub lama:

- `daily-os`: `{version:3, habits:[...], todos:[...], gacha?, localStorage?, settings?}`
- `ideku`: `{ideas:[...], categories:[...], localStorage?}`
- `kronik`: `{version:2, entries:[...], profile?:{name,avatar}}`
- `cucimoney`: `{_version:1, _app:'cucimoney', db:{...}, masterBudgets:[...], budgets?:[...], savings:{...}}`
- `linkku`: `{L:[...], C:[...], PC?:[...], ep?:'...', ts, v:5}`
- `assistant`: `{muted, expression, panel, character:'rem'}` (tanpa chat)

Catatan penting:

- `cucimoney` **wajib** menyertakan `savings` — bug hub lama tidak.
- `kronik` hanya menyertakan profil jika fitur profil baru sudah dipakai.
- Link privat diekspor terenkripsi `ep`; jika tidak ada PIN, ekspor ditolak
  dengan opsi "sertakan link privat? atur PIN / lewati".
- Setelan rahasia (API key) **tidak pernah** diekspor.

### 6.2 Import

Urutan: pilih file → deteksi format → baca manifest/legacy → tampilkan ringkasan
(counts, konflik, file rusak) → pilih **Merge** atau **Replace** → backup otomatis
→ tulis dalam satu transaksi per domain → laporkan hasil.

Aturan merge:

- Kunci duplikat: ID. Jika ID sama, pertahankan yang `updatedAt`/`ts` lebih baru;
  jika tidak ada timestamp, data lama menang.
- Kategori/tag digabung by nama/id.
- Link privat: minta PIN; dekripsi `ep`; jika PIN salah, batalkan **hanya** bagian privat.
- Journal `orderIndex` dihitung ulang setelah merge.
- Transaksi keuangan di-merge utuh dengan pasangan transfer; jangan memecah pair.
- Setelah import, jalankan rekonsiliasi saldo dan tampilkan selisih (harus 0).

Deteksi format:

- ZIP v3 (ada `manifest.json`).
- ZIP v2 (nama `*-YYYY-MM-DD.json` tanpa manifest).
- JSON tunggal (Daily OS v3, Kronik v2, IdeKu array/wrapper, CuciMoney `_app`,
  LinkKu v5).
- Backup web lama tanpa `savings`: import tetap jalan; tampilkan peringatan
  "savings tidak ada di backup ini".

### 6.3 Export Kompatibel Web

- Tetap pakai nama file bertanggal seperti hub lama agar bisa diimpor balik ke web.
- Jangan menambahkan field yang membuat parser lama gagal (field tambahan aman).
- `manifest.json` diabaikan web lama; aman.
- Uji round-trip: native → web lama → native.

---

## 7. AI & API

### 7.1 Mode

1. **Server (default)** — memakai endpoint yang ada:
   - Asisten: `/api/chat`, `/api/tts` (Vercel).
   - Daily OS/Kronik/IdeKu: worker Groq.
   - Tidak perlu key dari pengguna.
2. **Personal key** — panggilan langsung dari app:
   - Sumopod `https://ai.sumopod.com/v1/chat/completions`, model `glm-5.3-flash`.
   - Groq `https://api.groq.com/openai/v1/chat/completions`, model
     `llama-3.3-70b-versatile` (untuk fitur app).
   - Fish Audio `https://api.fish.audio/v1/tts`, model `s2.1-pro-free`.
   - Key disimpan di secure storage, diuji lewat tombol "Test koneksi".

Aturan: mode Personal berlaku untuk semua fitur; jika satu key tidak diisi,
fitur terkait memakai server mode dan menampilkan badge kecil "server".

### 7.2 Kontrak yang Dipertahankan

**Chat asisten** `POST /api/chat`:

```json
{
  "messages": [{"role":"user","content":"..."}],
  "context": {"systemPrompt":"...","expression":"none","userName":"...","ecosystem":"..."}
}
```

Respons SSE: `delta {delta}`, `done {text, tts, model}`, `error {error}`.
Batas: 10 pesan, 4.000 karakter/pesan. Client Dart wajib mendukung non-SSE
fallback `{text|message|content}`.

**TTS** `POST /api/tts` `{text, voiceId, translated}`:

- Pecah per kalimat, maksimal 4 chunk berurutan; tiap chunk ≤500 karakter.
- Terima respons biner `audio/mpeg` atau JSON base64 (verifikasi kontrak aktual
  di Fase 0; simpan fixture).
- Voice default `eb79df9571014449b42bcd869f86fe0a` bila `voiceId` kosong.
- `translated=false` memicu auto-translate server.

**Worker Groq**:

- Daily OS: request `{prompt, system, max_tokens}` → `{text}`.
- IdeKu: `{title,notes,category,priority}` atau `{mode:'breakdown',systemPrompt,userPrompt}`
  → `{result}`/`{error:'quota'|'timeout'}`.
- Kronik: `{model, messages}` → teks di `data.text` / `choices[0].message.content` / `content[0].text`.
- Worker IdeKu membatasi Origin; di Fase 0 putuskan: ubah worker (butuh akses
  repo worker) atau wajib personal key untuk IdeKu.

### 7.3 Implementasi

- `AiClient` antarmuka tunggal: `chatStream`, `complete`, `tts`.
- Streaming: `http.Client.send` + `StreamedResponse`, parser baris `data:`,
  dukungan `cancel()` lewat `StreamSubscription`.
- Timeout: chat 20 s first-token/60 s total; TTS 30 s/chunk; Groq 15 s.
- Retry: hanya untuk 429/5xx, maksimal 2, backoff 1 s/2 s.
- Error dipetakan ke pesan Indonesia yang ramah; detail teknis hanya di debug.
- Redaksi: key/Authorization dibuang dari log dan pesan error.
- Simpan fixture request/response nyata untuk test parser (tanpa key asli).

---

## 8. Live2D di Flutter

### 8.1 Pendekatan

- WebView (`flutter_inappwebview`) menampilkan runtime web yang sudah ada:
  `live2dcubismcore.min.js`, `pixi 6.5.10`, `pixi-live2d-display 0.4.0`, model
  `characters/rem`, dan satu halaman HTML adapter.
- Aset disajikan lewat `InAppLocalhostServer` dari folder asset (bukan `file://`)
  agar XHR/fetch model berjalan. MIME type benar untuk `.moc3`, `.motion3.json`,
  `.exp3.json`, `.png`, `.mp3`.
- WebView hanya menempati area karakter; chat dan kontrol di Flutter.
- Jika WebView gagal (memori/lisensi), fallback: avatar statis + chat tetap jalan.

### 8.2 JS Bridge

Flutter → JS:

| Pesan | Payload | Efek |
|---|---|---|
| `init` | `{muted}` | muat model, mulai idle |
| `setExpression` | `{name}` | peta wajah/motion, auto-revert 6 s |
| `setSpeaking` | `{value}` | mulai/hentikan lip-sync |
| `playAudio` | `{base64, mime}` | putar audio via WebAudio, analyser → mulut |
| `stopAudio` | `{}` | hentikan audio |
| `setMuted` | `{value}` | mute/unmute |
| `setPaused` | `{value}` | pause render saat tab tidak aktif |
| `tapZone` | `{zone}` | bubble/ekspresi reaksi |

JS → Flutter:

| Pesan | Payload | Arti |
|---|---|---|
| `ready` | `{}` | model siap |
| `modelError` | `{message}` | gagal muat |
| `audioStarted/audioEnded` | `{}` | status playback |
| `expressionChanged` | `{name}` | sinkron UI ekspresi |

### 8.3 Audio & Lip-sync

Audio TTS diputar **di dalam WebView** agar perilaku analyser/lip-sync lama
dipertahankan. Flutter mengambil bytes TTS, mengirim base64, WebView memutar dan
menggerakkan `PARAM_MOUTH_*`. Mute hanya mematikan output, bukan animasi.

`shortcut: audio dikirim base64 per chunk (~100–300 KB), cukup untuk TTS pendek;
pindah ke file cache + URL lokal jika chunk makin besar.`

### 8.4 Ekspresi

- Peta Rem: 13 ekspresi valid (`happy, smile, shame, sad, cry, angry, surprise,
  serious, proud, doubt, puzzle, upset` + `none`). Hapus `navi/wait/bound` dari
  daftar valid atau tambahkan mapping eksplisit.
- Tag `[EXPR:x]` divalidasi; jika tidak dikenal → `none`.
- Auto-revert 6 detik setelah ekspresi dari chat.
- Bar ekspresi Flutter memakai data yang sama (`EXPR_CONFIG`).

### 8.5 Idle & Interaksi

- Bubble idle 30 detik, audio per zona (head/body/leg/pet), mapping dari
  `character.js`.
- Tap zona memicu reaksi yang sama; haptic ringan opsional.
- Saat tab Asisten tidak terlihat: `setPaused(true)`, hentikan audio; saat kembali:
  `setPaused(false)`.

### 8.6 Sinkronisasi Aset Web ↔ App

- Sumber kebenaran tetap folder web `/assistant/characters/rem`.
- `scripts/sync-live2d.sh` menyalin ke `app/assets/live2d/` dan menulis checksum.
- Test `live2d_assets_test.dart` memverifikasi file wajib ada dan checksum sama.
- Jangan mengedit salinan app secara langsung.

---

## 9. Notifikasi & Pengingat

- Ganti service worker `postMessage` dengan `flutter_local_notifications`.
- Izin: `POST_NOTIFICATIONS` (Android 13+), exact alarm (Android 12+); jika
  ditolak, tampilkan penjelasan dan fallback pengingat in-app.
- Jadwal habit: jam dari setelan Daily OS (`notif_habit_time`), berulang harian
  sesuai `activeDays`.
- Jadwal todo: pengingat harian pada jam setelan, hanya jika ada todo pending.
- Reschedule setelah reboot/timezone change lewat receiver plugin.
- Penyimpanan: `reminders` table; ID notifikasi stabil dan disimpan.
- Uji: perubahan timezone dan reboot (manual QA), plus unit test perhitungan
  jadwal berikutnya.

---

## 10. Keamanan

- Secure storage untuk Sumopod/Groq/Fish key; fallback error jelas jika Keystore
  tidak tersedia.
- Backup tidak memuat key. Clipboard key dinonaktifkan (read-only field + show/hide).
- LinkKu: PIN 4 digit tetap; hash SHA-256 untuk verifikasi; export privat
  terenkripsi kompatibel v1. Auto-lock private mode saat app ke background
  (peningkatan yang disengaja) dan `FLAG_SECURE` opsional.
- `shortcut: link privat tetap plaintext di SQLite lokal seperti web (paritas);
  enkripsi-at-rest ditunda ke v1.1 karena mengubah pencarian/backup.`
- Jangan log isi jurnal, transaksi, URL privat, atau pesan chat.
- File backup ditulis ke cache lalu dibagikan lewat `share_plus`; hapus salinan
  cache setelah share.
- Tidak ada telemetry pihak ketiga di v1.

---

## 11. Detail per Aplikasi

Setiap bagian adalah kontrak untuk fase implementasinya. Paritas web adalah
default; "perbedaan disengaja" harus disetujui sebelum coding.

### 11.1 Shell + Apps (Hub)

**Tujuan:** pengganti `index.html` bagian sapaan, ringkasan, dan grid app.

**Layar:**

- Header: sapaan berdasarkan jam, tanggal, nama profil.
- Snapshot cards: habit selesai/total + streak, todo pending, ide `Proses`,
  saldo total, pengeluaran hari ini, jurnal hari ini/terakhir.
- Grid app: Daily OS, IdeKu, Kronik, CuciMoney+, LinkKu, Asisten, Hesych (eksternal).
- Pull-to-refresh; skeleton saat memuat; kartu error per domain (bukan seluruh layar).

**Data & aturan:**

- Habit: hitung check hari ini / total slot aktif hari ini.
- Streak: jalan mundur maksimal 365 hari, lewati hari tanpa jadwal dan hari ini
  (paritas `index.html:1062-1087`).
- Todo pending: `done = false`; badge jumlah.
- Ide: `status = 'Proses'`.
- Saldo: `Σ accounts.balance` (global, semua buku) sesuai web `:1104-1109`.
- Pengeluaran hari ini: `direction='out'` dengan `date = hari ini`, **kecualikan
  transfer** (`transferPair` kosong) — perbaikan dari web yang ikut menghitung.
- Jurnal: entri non-arsip dengan `date = hari ini`, jika tidak ada tampilkan
  judul terbaru.

**Perbedaan disengaja:** kartu pengeluaran tidak menghitung transfer; kartu
profil memakai tabel `profile` baru, bukan `kv.kronik` yang tidak ada.

**Edge cases:** DB kosong (tampilkan 0, bukan error), tanggal pergantian tengah
malam, app grid saat offline, Hesych tanpa browser.

**Test:** query ringkasan dengan fixture, streak 5 kasus, transfer tidak dihitung,
profil kosong, error satu domain tidak menjatuhkan kartu lain.

**DoD:** semua kartu akurat terhadap web pada data yang sama; navigasi ke tiap app.

---

### 11.2 Asisten (Rem)

**Tujuan:** mempertahankan pengalaman chat + karakter, dengan UI Flutter dan
avatar WebView.

**Layar:**

- Model panel (WebView) ±55–60% tinggi; bisa diperbesar via drag.
- Chat panel: daftar pesan, indikator mengetik, streaming teks, input multiline,
  tombol kirim, mic (v2), mute, tombol apps, bar ekspresi.
- Modal konfirmasi ganti karakter (hanya Rem di v1; siapkan arsitektur multi-karakter).
- Toast, error offline, tombol stop saat streaming.

**Perilaku:**

- Satu karakter `rem`; load `character.json`, model, audio.
- Chat memakai kontrak Bagian 7; history maksimal 10 pesan dikirim; history
  lokal di memori selama sesi (paritas).
- Tag `[OPEN:key]` membuka app (map: daily-os, ideku, cucimoney, kronik, linkku,
  dashboard); tag `[EXPR:name]` mengganti ekspresi lalu auto-revert 6 s; tag
  `[JA]...[/JA]` disembunyikan.
- Parser harus tahan tag terpotong di tengah stream; simpan state "dangling `[`".
- TTS: pecah kalimat, maksimal 4 chunk, putar berurutan; mute menyimpan preferensi.
- Ecosystem context: bangun ringkasan habit/todo/ide/wishlist/keuangan/jurnal,
  60 s cache, lewati transaksi transfer dan buku non-aktif (paritas `core.js:44-293`).
- Tool finance natural language: verb+direction, nominal (`rb/jt`), tanggal,
  slot kategori/buku/akun dengan fuzzy match Levenshtein, tanya slot yang ambigu,
  batal setelah 2 kegagalan, konfirmasi sebelum tulis, TTL state 5 menit.
- Menulis transaksi **harus** lewat repository CuciMoney yang sama, bukan SQL baru.

**Perbedaan disengaja:** history chat tetap memory-only di v1 (tidak ada tabel);
desktop resizer diganti drag tinggi; ekspresi invalid dibersihkan.

**Edge cases:** model gagal dimuat, audio TTS gagal (chat tetap), stream dibatalkan,
tab disembunyikan saat bicara, keyboard menutupi input, respons tanpa SSE, tag
tidak dikenal, tool ambiguity, nominal 0/negatif.

**Test:** parser SSE (fixture delta/done/error/partial), parser tag + dangling,
chunking TTS ≤500/≤4, parser nominal `10rb`, `1,5jt`, `Rp 20.000`, tanggal besok,
fuzzy match, context mengecualikan transfer, ekspresi valid/invalid, bridge
message (unit di sisi Dart), fallback non-SSE.

**DoD:** chat, streaming, stop, TTS, ekspresi, buka app, dan tool finance setara
web; avatar tampil dan beranimasi.

---

### 11.3 LinkKu

**Tujuan:** bookmark manager + preview + private mode dengan PIN.

**Layar:**

- List: semua/recent (20 terbaru), pencarian (judul, URL, catatan, tag), filter
  kategori, sidebar kategori (normal/privat), toggle grid/list.
- Kartu: thumbnail/preview, judul, domain, note expand, tag, aksi copy/buka/edit/hapus.
- Form tambah/edit: URL, judul, note, kategori, tag (picker + tag baru), toggle privat.
- Pengaturan: kelola kategori/tag, atur/ganti PIN, export/import.
- Private mode: gate PIN, tema ungu, filter hanya item privat; auto-lock saat
  background.

**Data & aturan:**

- Mapping `linkkuDB/kv`:
  - `lk_l` → `links`
  - `lk_c` → `link_categories` (`isPrivate=false`)
  - `lk_pc` → `link_categories` (`isPrivate=true`)
  - `lk_pin` → `link_security.pinHash`
  - `lk_tags_normal`/`lk_tags_priv` → `link_tags`
- Field link lama: `{id,url,ti,note,cat,pcat,tags[],p,thumb,ts}` → `title=ti`,
  `isPrivate=p`.
- PIN: SHA-256 hex; validasi 4 digit angka.
- Export privat: `ep` = base64(iv‖AES-256-GCM(JSON({links,cats})), key=PBKDF2(pinHash,
  'linkku-salt-v1', 100000, SHA-256)). Harus cocok dengan WebCrypto lama.
- Preview: YouTube `oembed` + thumbnail; selain itu fetch OG via proxy
  `api.allorigins.win` timeout 6 s; gagal → tile warna domain + huruf awal.
- Copy: clipboard + snackbar; buka via `url_launcher`.
- Duplikat URL diperbolehkan (paritas).

**Perbedaan disengaja:** preview memakai cache 24 jam agar tidak memanggil proxy
berulang; auto-lock privat; fallback preview lebih cepat (3 s) di jaringan buruk.

**Edge cases:** PIN salah/berubah, PIN hilang (jelaskan data privat tak bisa
dipulihkan), import `ep` tanpa PIN, URL tanpa skema (tambah `https://`), halaman
tanpa OG, proxy down/limit, item privat saat locked (tidak boleh muncul di search).

**Test:** hash PIN, vektor enkripsi/dekripsi kompatibel, import v5 (publik + `ep`),
merge/replace, filter search privat, parsing OG, normalisasi URL, cache preview.

**DoD:** CRUD, kategori, tag, PIN, private mode, preview, export/import v5.

---

### 11.4 Kronik

**Tujuan:** jurnal harian bergaya buku dengan mood dan quest log.

**Layar:**

- Cover buku (animasi sederhana; bukan 3D penuh), buka ke daftar isi.
- Daftar isi: entri pinned dulu lalu tanggal desc; badge pin/mood; long-press pin;
  mode pilih + hapus permanen; tombol export/import.
- Editor: judul, tanggal, textarea penuh, mood picker, quest log; autosave 700 ms;
  indikator tersimpan; hapus = **arsip** dengan konfirmasi ganda.
- Mood picker: 7 status (`Fokus, Lelah, Terinspirasi, Berat, Stabil, Semangat,
  Kabur`), clear, deteksi AI.
- Quest log: habit yang selesai pada tanggal entri (dari `journal_habit_logs`
  dan event habit hari ini).

**Data & aturan:**

- ID lama dipertahankan (base36 timestamp + 4 acak); ID baru memakai format sama.
- `orderIndex` dihitung ulang dari posisi setelah setiap perubahan urutan.
- Sort tampil: `pinned desc, date desc, orderIndex asc`.
- Normalisasi saat import **tidak boleh** membuang field yang sudah ada di skema
  baru; hanya isi default untuk yang hilang.
- Konten teks polos; tidak ada markdown/rich text di v1.
- AI deteksi mood: prompt memakai judul+isi (potong 800 karakter); hasil dipetakan
  ke 7 status; gagal → tidak mengubah mood.
- Quest log menambah otomatis saat habit dicentang di Daily OS; dedupe jendela 2 detik.

**Perbedaan disengaja:** entri dihapus dari editor = arsip; hapus permanen hanya
dari mode pilih. Animasi 3D buku disederhanakan (paritas visual, bukan fisik).

**Edge cases:** konten sangat panjang (scroll), ganti tanggal (urutan berubah),
arsip tetap tersimpan tapi tersembunyi, import entri tanpa field baru, timezone
di dekat tengah malam, tag HTML di judul/isi tidak dieksekusi (Flutter text aman).

**Test:** sort pinned/date, regenerasi order, ID unik, import merge/replace +
normalisasi, arsip vs hapus, autosave flush saat pop, deteksi mood fixture,
quest log dedupe.

**DoD:** daftar, editor, mood, quest log, arsip, export/import setara.

---

### 11.5 IdeKu

**Tujuan:** papan ide/wishlist dengan fokus, kategori, jalur, dan progres tabungan.

**Layar:**

- Dashboard: header, statistik Total/Belum/Fokus/Selesai, pencarian, filter
  tipe/status/prioritas, distribusi kategori (bar), chip Jalur, panel Fokus
  maksimal 3 item `Proses` + overflow "parkir".
- Tiga mode tampilan: grup kategori, datar, grid.
- Sheet detail: ubah status/prioritas inline, jalur + next step, aksi AI
  (perkaya, breakdown), edit, hapus.
- Form ide/wishlist: judul, catatan, kategori, prioritas, tipe; wishlist menambah
  harga rupiah + ikon; progres tabungan dari CuciMoney.
- Kelola kategori: tambah, rename, hapus (dilarang jika dipakai).

**Data & aturan:**

- `ideas` mapping langsung; `image` lama bisa base64/URL → konversi ke ikon
  bawaan saat migrasi, simpan nilai asli di catatan bila tidak bisa dipetakan.
- Kategori IdeKu dari localStorage `ideku-categories` → `idea_categories`.
- View mode/collapsed/theme → `app_meta`.
- Warna kategori = hash nama dengan palet lama; port fungsi hash persis.
- Heuristik rekomendasi AI lokal (skor) diport persis, termasuk alasan.
- Progres wishlist: `savings_pots.saved / price`; jika pot tidak ada → 0%.
- AI enrich/breakdown memakai kontrak worker; JSON hasil harus divalidasi;
  kegagalan menampilkan toast, tidak merusak data.
- Item `Proses` > 3: tampilkan 3 teratas + tombol "lihat semua".

**Perbedaan disengaja:** ID baru tetap ms timestamp (string) agar kompatibel;
pencarian menambah FTS lokal untuk daftar besar (opsional, hanya jika performa
terbukti lambat).

**Edge cases:** ID collision (tambah suffix acak), kategori dihapus, wishlist
tanpa harga, gambar legacy, jutaan ide (pagination), import array/wrapper,
prioritas/status tak dikenal → default.

**Test:** skor heuristik golden, hash warna, filter+count, progres tabungan,
migrasi gambar legacy, import dedupe by id, kategori terpakai tidak bisa dihapus.

**DoD:** dashboard, CRUD, wishlist + progres, AI, kategori, view mode setara.

---

### 11.6 Daily OS

**Tujuan:** habit tracker, todo, statistik, dan AI coach.

**Layar (5 tab internal):**

1. Habit: banner XP/level, kartu habit (checklist/subtask, collapse, menu
   edit/hapus/arsip), reorder drag, FAB tambah.
2. To-Do: grup Hari Ini/Minggu Ini/Nanti, section Done collapse, badge deadline,
   subtask, reorder, FAB.
3. Statistik: 4 kartu ringkas, line chart 7/30/90 hari, kalender bulanan dengan
   dot per hari + detail/hapus, statistik todo + bar prioritas.
4. AI: coach briefing harian, parser todo natural language, rekomendasi dengan
   preview editable lalu konfirmasi tambah.
5. Setting: notifikasi, ringkasan markdown mingguan/bulanan, backup JSON,
   import, export CSV, reset.

**Form habit:** nama, kategori (preset + custom), 16 warna, 24 ikon, hari aktif,
checklist subtask. **Form todo:** judul, prioritas (`urgent|soon|normal`),
deadline, subtask.

**Data & aturan:**

- Mapping habits/todos sesuai Bagian 5.2.
- XP = 10 × jumlah slot selesai; disimpan cache, dihitung ulang saat buka.
- Streak: hitung hari berjadwal yang selesai; lewati hari tanpa jadwal; hari ini
  tidak memutus streak (paritas `:3089-3107`). Fungsi murni + test.
- Habit archived tetap muncul di statistik historis.
- Reorder menyimpan `sort` berurutan.
- Delete habit = arsip; delete todo = permanen.
- AI coach memory: JSON diparse aman; jika rusak, mulai baru.
- Parser AI todo: array `{judul,deadline,priority,subtasks[]}`; validasi tiap
  field, default aman, tampilkan preview sebelum simpan.
- Notifikasi: lihat Bagian 9.
- Export JSON v3 dan CSV tetap kompatibel.

**Perbedaan disengaja:** penyimpanan granular (bukan rewrite seluruh array);
notifikasi lokal asli; chart memakai fl_chart dengan data sama.

**Edge cases:** subtask legacy string, habit tanpa jadwal, deadline lewat,
zona waktu, XP negatif setelah edit history, import tanpa todos/XP, todo
selesai lama, 500+ habit.

**Test:** streak (7 kasus termasuk hari ini/libur), XP, reorder, arsip di statistik,
import normalisasi field hilang, parser AI invalid JSON, notification next-run,
CSV escaping.

**DoD:** lima tab berfungsi, data lama utuh, backup/import/CSV setara.

---

### 11.7 CuciMoney+

**Tujuan:** pembukuan multi-buku, dompet, analisis, budget, tabungan.

**Layar:**

- **Buku**: navigator bulan, hero saldo/pemasukan/pengeluaran, ring budget,
  daftar transaksi per tanggal (collapse), pencarian, sheet semua transaksi.
- **Dompet**: net worth, aset/liabilitas, akun per grup, detail akun + line chart
  6 bulan + transaksi bulanan, CRUD akun.
- **Analisis**: periode bulan/tahun/semua, ringkasan + delta, donut
  pengeluaran/pemasukan, bar kategori, cash-flow 6 bulan, tab budget, drill-down
  kategori.
- **Lainnya**: buku, kategori (drag reorder), anggota, export CSV/JSON, import,
  reset, visibilitas saldo.
- **Tabungan**: pot wishlist, setor/tarik/realize, history, terkunci sampai target.
- **Form transaksi**: keyboard aritmatika kustom, tab masuk/keluar/transfer,
  akun/kategori/anggota/tanggal, simpan-lanjut, edit/hapus dengan cascade.

**Data & aturan:**

- Field dan mapping sesuai Bagian 5.2.
- Saldo: `balance` materialized diperbarui dalam transaksi DB; `openingBalance`
  dihitung saat migrasi. Sediakan `recalculateBalances()` dan bandingkan.
- Transfer: dua baris pair; UI menampilkan satu; search/detail akun menampilkan
  keduanya (paritas). Hapus/edit selalu cascade.
- Hapus buku → hapus transaksi + master budget + relasi akun; kategori/anggota
  yang dihapus hanya melepas referensi.
- Budget: satu master per buku/bulan/tahun; `startDate/endDate` opsional; hitung
  pemakaian dengan tanggal lokal; status aman/waspada/lebih.
- Savings: setor = transaksi keluar dengan `savingsPot`; tarik = masuk;
  realize memindahkan dana ke akun, menandai ide `Selesai`, mencatat event.
- Format uang: integer, pemisah id-ID, kompresi 1rb/1jt/1m; parser menghapus
  non-digit (paritas).
- Export/import JSON + CSV; import replace/merge dengan rekonsiliasi.
- Visibilitas saldo (mask) disimpan di `app_meta`.

**Perbedaan disengaja:** saldo dihitung ulang dan diverifikasi, bukan hanya
dimutasi; pagination/list virtualized; chart fl_chart/custom painter; auto-save
per aksi (bukan debounce 3 s).

**Edge cases:** transfer lintas buku/akun, hapus salah satu pair (data lama
rusak) → perbaiki/beri peringatan, edit nominal transfer, akun dengan saldo
negatif, budget melintasi bulan, transaksi bertanggal masa depan, ID lama
numerik/string, import tanpa `savings`, tabungan tanpa ide, wishlist dihapus
(pot orphan), kategori `both`, buku tanpa akun, 10.000+ transaksi.

**Test:** pair invariant + cascade, rekonsiliasi saldo setelah edit/hapus/import,
parse/format uang (tabel kasus), budget batas bulan/tahun, savings setor/tarik/
realize, orphan pot, CSV escaping, import v1/v3, pagination 10k, nominal 0.

**DoD:** lima layar + semua sheet berfungsi, saldo konsisten dengan fixture web,
backup/import/CSV setara dan lebih lengkap (savings ikut).

---

### 11.8 Setelan

**Layar & bagian:**

1. **Profil** — nama, avatar (picker), simpan lokal.
2. **AI & API key** — pilihan mode Server/Personal; field Sumopod, Groq, Fish
   Audio (secure storage); show/hide; test koneksi; status badge.
3. **Backup** — Export sekarang, backup terakhir, Import (file picker),
   Merge/Replace, peringatan link privat, ringkasan hasil. Cloud Drive: placeholder
   "segera hadir" (v1.1).
4. **Notifikasi** — izin, jam habit, jam todo, test notifikasi.
5. **Tampilan** — System/Light/Dark; ukuran teks mengikuti sistem.
6. **Data per app** — hapus Daily OS/IdeKu/Kronik/CuciMoney/LinkKu/Asisten dengan
   konfirmasi ketik nama; hapus semua.
7. **Tentang** — versi, build, commit, lisensi (Cubism, font OFL), repo.

**Aturan:**

- Hapus data per app menghapus domain terkait **dan** data turunannya (mis.
  hapus CuciMoney → savings + referensi wishlist), dengan penjelasan di dialog.
- Export gagal harus memberi alasan (storage penuh, PIN belum diatur untuk privat).
- Import selalu menawarkan backup otomatis sebelum menulis.
- Key tidak pernah ditampilkan penuh setelah disimpan (hanya 4 karakter terakhir).

**Test:** secure storage mock, test koneksi sukses/gagal, export tanpa PIN dengan
link privat, import merge/replace, hapus per app + efek samping, theme switch.

**DoD:** semua bagian berfungsi; tidak ada key di log/backup.

---

## 12. Migrasi Pengguna Lama

Karena IndexedDB browser tidak bisa dibaca langsung dari Flutter:

1. Pengguna membuka web lama → Export ZIP.
2. Buka app baru → onboarding → "Import data dari EcosystemKu web".
3. Pilih ZIP → ringkasan → Merge/Replace → selesai.
4. App menyimpan backup pra-import otomatis dan menampilkan lokasi file.
5. Setelan yang tidak ada di ZIP (tema, notifikasi, panel assistant, beberapa
   preferensi localStorage) diisi default; tampilkan daftar yang perlu diatur ulang.

Perlakuan khusus:

- LinkKu privat: minta PIN; jika `ep` ada dan PIN benar, dekripsi. Jika PIN
  tidak diketahui, tawarkan import publik saja.
- CuciMoney lama tanpa `savings`: impor apa adanya, lalu tawarkan "buat pot dari
  wishlist" jika ada ide Wishlist dengan harga.
- Data gacha/kronik yang tidak ada di skema: simpan mentah di `app_meta`
  (`legacy.kronik.gacha`, `legacy.dailyos.gacha`) agar tidak hilang.
- Duplikat: resolusi by ID; tampilkan jumlah yang dilewati.

Verifikasi migrasi wajib: jumlah record per domain, checksum total nominal,
daftar ID yang hilang = kosong, saldo rekonsiliasi = 0, link privat terdekripsi
sama persis.

---

## 13. Strategi Testing

**Unit (tanpa Flutter):**

- Streak habit, XP, sort Kronik, skor IdeKu, hash warna, parser uang/tanggal.
- Parser SSE, tag assistant, chunking TTS, parser tool finance.
- Invariant transfer, rekonsiliasi saldo, budget periode.
- Crypto LinkKu (vektor kompatibel WebCrypto), hash PIN.
- Backup serializer/deserializer, merge resolver.

**Widget:**

- Komponen design system (light/dark, text scale).
- Form validasi (habit, transaksi, link, ide).
- Empty/error/loading states.

**Integrasi (di CI bila memungkinkan, selain itu manual):**

- Import ZIP v2 → data tampil → export v3 → import ulang → tidak ada duplikat.
- Tambah transaksi transfer → edit → hapus → saldo kembali.
- Backup/restore lintas app.
- Live2D: model termuat, ekspresi berubah, audio diputar (manual di perangkat).

**Fixture:**

- `test/fixtures/web/*.json` dan `*.zip` dibuat dari export web nyata (data
  sintetis, bukan data pribadi).
- `test/fixtures/api/*.txt` berisi respons SSE/TTS/worker yang direkam.
- `test/fixtures/db/*.sqlite` untuk migrasi skema.

**Performance:**

- 10.000 transaksi: buka Buku < 300 ms, scroll 60 fps.
- 1.000 ide/habit: filter < 100 ms.
- APK per ABI < 60 MB; startup < 2 s di perangkat menengah.

**Manual QA checklist per fase:**

- Install APK baru di atas versi lama (data tetap).
- Matikan jaringan: app tetap bisa dibuka, data tampil, error AI ramah.
- Rotasi/background/foreground: Live2D pause/resume, private mode terkunci.
- Export → hapus data → import → verifikasi.
- TalkBack dasar untuk tombol utama.

---

## 14. CI/CD & Rilis

Workflow `.github/workflows/android.yml`:

- Trigger: `push` ke `main` yang menyentuh `app/**` atau workflow; `pull_request`;
  tag `v*`.
- Job: checkout → Java 17 (Temurin) → `subosito/flutter-action` stable + cache →
  `flutter pub get` → `dart format --output=none --set-exit-if-changed .` →
  `flutter analyze` → `flutter test --coverage` → build APK.
- Build: `flutter build apk --release --split-per-abi` (arm64-v8a, armeabi-v7a).
- Signing: decode `ANDROID_KEYSTORE_BASE64` ke file sementara; isi
  `key.properties` dari Secrets (`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
  `ANDROID_KEY_PASSWORD`).
- Artifact: APK per ABI + `mapping.txt`; simpan 30 hari.
- Tag `v*`: buat GitHub Release, unggah APK, catatan rilis dari `CHANGELOG.md`.
- Versi: `versionName` dari `pubspec.yaml`; `versionCode` = `run_number` + offset.
- Cache Gradle dan pub; batas waktu job 45 menit.
- Secret yang dibutuhkan: keystore (4 nilai). Tidak ada API key di CI.

Environment build saat ini (PRoot aarch64) tidak dipakai untuk build; hanya untuk
edit dan test Dart sejauh tooling tersedia. Flutter SDK di CI.

Rilis:

- `v0.1` Fase 0 (internal).
- `v0.2` Fase 1 (APK harian).
- `v0.3`–`v0.7` per app.
- `v1.0` paritas penuh + Live2D + QA.
- Setiap rilis mencantumkan: app yang sudah dimigrasi, data yang belum, dan
  langkah migrasi.

---

## 15. Fase & Task Breakdown

Setiap task = satu unit yang bisa direview dan dites sendiri. Tanda centang
untuk eksekusi; sebelum mulai, buat plan TDD detail untuk fase tersebut.

### Fase 0 — Fondasi & De-risk (1,5–2 minggu)

- [ ] **0.1 Scaffold** `app/` + `pubspec.yaml` + lints + struktur folder + `main.dart` kosong.
  - Test: `flutter analyze` bersih, `flutter test` jalan (satu smoke test).
- [ ] **0.2 CI** workflow Android, build APK unsigned di PR, signed di tag.
  - Test: workflow hijau, artifact APK bisa diinstal.
- [ ] **0.3 Design tokens + 8 komponen inti** (Scaffold, Card, SectionHeader, EmptyState,
  ConfirmSheet, SnackBar, StatTile, SearchField) + halaman contoh light/dark.
  - Test: widget test render di kedua tema + text scale 1.3.
- [ ] **0.4 Skema Drift v1** semua tabel + DAO dasar + test migrasi awal.
  - Test: buat DB, insert/read per domain, invariant transfer.
- [ ] **0.5 Backup service** serializer v3 + parser v2/v3 + merge/replace +
  ringkasan + fixture ZIP.
  - Test: round-trip, merge duplikat, file rusak, savings ikut.
- [ ] **0.6 Live2D spike**: WebView + localhost asset server + model Rem +
  `setExpression` + putar satu audio + pause/resume.
  - Test: APK spike di perangkat; log `ready`; ekspresi berubah; audio sync.
  - Gate: jika gagal karena lisensi/teknis, putuskan fallback sebelum Fase 1.
- [ ] **0.7 Fixture data contoh** (`test/fixtures/web`) dari export web sintetis.
- [ ] **0.8 Keputusan API**: uji worker dari "app native" (tanpa Origin) dan
  kontrak `/api/tts`; catat hasil + pilihan mode.

**Gate Fase 0:** APK berisi halaman contoh, backup round-trip lulus, Live2D
terbukti atau fallback disetujui, CI hijau.

### Fase 1 — Shell, Apps, Setelan, Asisten Chat (2 minggu)

- [ ] **1.1 Shell** 3 tab + router + back handling + theme mode.
- [ ] **1.2 Apps grid** + 6 kartu ringkasan + query + skeleton/error per kartu.
- [ ] **1.3 Setelan** profil, AI key (secure storage + test), backup export/import,
  tema, data per app (placeholder app yang belum ada), tentang.
- [ ] **1.4 Onboarding + import wizard** (baca ZIP, ringkasan, merge/replace).
- [ ] **1.5 Asisten UI** chat, streaming, stop, error, tag parser, apps sheet,
  mute, ekspresi bar (tanpa Live2D dulu: avatar statis).
- [ ] **1.6 AI client** chat + TTS, mode server/personal, chunking, fixture parser.
- [ ] **1.7 TTS playback** via WebView/just_audio sementara; status mute.
- [ ] **1.8 Rilis `v0.2`** APK internal.

**Gate Fase 1:** pengguna bisa import backup, melihat ringkasan, mengobrol, TTS,
mengatur key, dan backup ulang.

### Fase 2 — LinkKu (1 minggu)

- [ ] **2.1 Skema/DAO + migrasi LinkKu.**
- [ ] **2.2 List, search, filter, kategori, kartu + preview.**
- [ ] **2.3 Form CRUD + tag picker + copy/open.**
- [ ] **2.4 PIN + private mode + auto-lock + enkripsi export (kompatibel).**
- [ ] **2.5 Import/export v5 + test vektor crypto.**
- [ ] **2.6 Hapus data LinkKu dari Setelan aktif.**

### Fase 3 — Kronik (1,5 minggu)

- [ ] **3.1 Skema/DAO + migrasi journal + legacy localStorage.**
- [ ] **3.2 Daftar isi + cover + pin + select/hapus.**
- [ ] **3.3 Editor + autosave + arsip + mood picker.**
- [ ] **3.4 AI deteksi mood + worker.**
- [ ] **3.5 Quest log + integrasi event habit.**
- [ ] **3.6 Export/import v2 + test sort/normalisasi.**

### Fase 4 — IdeKu (2 minggu)

- [ ] **4.1 Skema/DAO + migrasi ideas/kategori/localStorage.**
- [ ] **4.2 Dashboard statistik + search + filter + view modes.**
- [ ] **4.3 CRUD ide/wishlist + form + kategori + gambar legacy.**
- [ ] **4.4 Panel Fokus + jalur/next step + overflow parkir.**
- [ ] **4.5 Progres tabungan dari savings + sinkron CuciMoney.**
- [ ] **4.6 AI enrich/breakdown + heuristik rekomendasi.**
- [ ] **4.7 Import/export + test golden skor/hash.**

### Fase 5 — Daily OS (2,5 minggu)

- [ ] **5.1 Skema/DAO + migrasi habit/todo/history/XP.**
- [ ] **5.2 Habit tab + form + checklist + reorder + arsip.**
- [ ] **5.3 Todo tab + grup + deadline + subtask + reorder.**
- [ ] **5.4 Statistik + chart 7/30/90 + kalender.**
- [ ] **5.5 AI coach + parser todo + preview/konfirmasi.**
- [ ] **5.6 Notifikasi lokal + setting waktu.**
- [ ] **5.7 Backup JSON/CSV + reset + test streak.**

### Fase 6 — CuciMoney+ (4–5 minggu)

- [ ] **6.1 Skema/DAO + migrasi finances (db, budgets, master, savings) + openingBalance.**
- [ ] **6.2 Buku + ring budget + daftar transaksi + search.**
- [ ] **6.3 Form transaksi (keyboard, transfer, simpan-lanjut) + detail + cascade.**
- [ ] **6.4 Dompet + akun CRUD + chart akun.**
- [ ] **6.5 Analisis + donut/bar/cashflow + drill-down.**
- [ ] **6.6 Budget + periode + status.**
- [ ] **6.7 Tabungan + setor/tarik/realize + integrasi IdeKu.**
- [ ] **6.8 Lainnya (buku/kategori/anggota/visibility) + export CSV/JSON + import.**
- [ ] **6.9 Rekonsiliasi saldo + alat integritas + test 10k.**

### Fase 7 — Asisten Penuh, Live2D, Polish, Rilis (2,5 minggu)

- [ ] **7.1 Integrasi Live2D penuh (bridge, ekspresi, audio, idle, pause).**
- [ ] **7.2 Tool finance + context ekosistem + konfirmasi.**
- [ ] **7.3 Multi-karakter siap (arsitektur), Rem saja di UI.**
- [ ] **7.4 Accessibility + text scale + TalkBack pass.**
- [ ] **7.5 Empty/error/offline states semua app.**
- [ ] **7.6 QA matriks + migrasi data nyata + performance.**
- [ ] **7.7 Dokumentasi pengguna singkat + catatan rilis + `v1.0`.**

### Fase 8 — Pasca-rilis (v1.1)

- [ ] Cloud backup Google Drive.
- [ ] Enkripsi-at-rest link privat.
- [ ] Play Store (data safety, signing, listing).
- [ ] Perbaikan bug dari lapangan + telemetry opt-in (jika diminta).

---

## 16. Kriteria Terima Global

Migrasi dianggap selesai bila:

1. Semua data dari ZIP web lama bisa diimpor tanpa kehilangan record; laporan
   verifikasi menunjukkan 0 selisih saldo dan 0 ID hilang.
2. Export dari app bisa diimpor kembali ke web lama untuk Daily OS, IdeKu,
   Kronik, CuciMoney, dan LinkKu.
3. Tidak ada fitur web yang hilang tanpa dicatat sebagai "perbedaan disengaja".
4. Saldo CuciMoney konsisten setelah serangkaian edit/hapus/transfer/import.
5. Asisten bisa chat, streaming, TTS, ekspresi, dan membuka app; avatar beranimasi.
6. Aplikasi berjalan offline untuk semua data lokal; hanya fitur AI/preview yang
   butuh jaringan dan gagal dengan pesan jelas.
7. `flutter analyze` bersih, seluruh test lulus, APK signed terpasang di
   perangkat bersih maupun upgrade.
8. Tidak ada secret di repo, backup, log, atau artifact.

---

## 17. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Lisensi Cubism/model | APK tidak boleh didistribusikan | Konfirmasi lisensi di Fase 0; fallback unduh Core saat online |
| Live2D di WebView | Animasi/audio tidak sync | Spike lebih awal; audio diputar di WebView; fallback statis |
| Data loss saat migrasi | Fatal bagi pengguna | Backup otomatis pra-import, dry-run, verifikasi jumlah/checksum, jangan hapus web |
| Kompleksitas CuciMoney | Fase 6 melar | Dikerjakan terakhir, test invariant, alat rekonsiliasi |
| Drift/ID mapping | Relasi rusak | ID TEXT dipertahankan, test migrasi per domain |
| Origin worker | Fitur AI mati di native | Uji di Fase 0; ubah worker atau wajib personal key |
| Batas kuota AI | Fitur gagal | Retry terbatas, pesan jelas, mode server/personal |
| WebView memory | App crash di HP rendah | Pause/release WebView, fallback avatar statis |
| APK size | Sulit dipasang | split-per-abi, audit aset, kompres tekstur bila lisensi izinkan |
| Play Store policy | Rilis tertunda | Distribusi GitHub dulu; siapkan data safety untuk v1.1 |
| Bug perilaku web | Pengguna bingung | Port paritas dulu, catat bug, perbaiki terpisah dengan test |

---

## 18. Pertanyaan Terbuka

Harus dijawab sebelum fase terkait:

1. **Lisensi** model Rem + Cubism Core di APK (Fase 0). Tanpa ini Live2D bisa batal.
2. **Worker AI**: boleh diubah untuk menerima app native, atau semua fitur app
   wajib personal key? (Fase 0/1)
3. **Kontrak `/api/tts`**: biner atau base64? Rekam respons nyata (Fase 0).
4. **Profil**: nama/avatar disimpan lokal saja atau ikut backup? Default: lokal,
   ikut backup sebagai `profile` di Kronik/manifest. (Fase 1)
5. **Cloud Drive**: tetap ditunda? Default: ya. (v1.1)
6. **Distribusi**: GitHub Release saja atau Play Store? Default: GitHub. (Fase 7)
7. **Batasan AI**: apakah perlu kuota/limit lokal untuk mencegah biaya? Default:
   tidak di v1; tampilkan error provider.
8. **Data gacha/RPG** yang tidak punya UI: simpan mentah atau buang? Default:
   simpan mentah di `app_meta`.

---

## 19. Referensi File Sumber

Gunakan ini saat porting perilaku:

- Hub/ringkasan: `index.html:974-1146`, backup/restore `:1245-2004`.
- Shared DB & kv: `shared/ecosystem-db.js:22-299`.
- Asisten chat/tag/TTS: `assistant/js/ui.js:14-70, 304-643`;
  character/ekspresi: `assistant/js/character.js:640-990`;
  tools finance: `assistant/js/tools.js:88-435`;
  konteks ekosistem: `assistant/js/core.js:44-293`;
  kontrak API: `api/chat.js`, `api/tts.js`.
- Daily OS data/streak: `daily-os/index.html:1854-1867, 2040-2065, 3089-3107`;
  backup/import `:3547-3756`.
- IdeKu data: `ide-ku/index.html:1493-1533, 2224-2242`; heuristik `:3172-3319`;
  AI `:2458-2689`; import `:2949-3164`.
- Kronik data/sort: `kronik/index.html:742-809, 887-1060`; mood `:1365-1555`;
  export/import `:1313-1358`.
- CuciMoney data: `cucimoney/index.html:4268-4288, 4350-4377`; transfer
  `:7901-7960`; budget `:5594-5920`; savings `:8920-9440`; export/import
  `:8385-8493`.
- LinkKu data/protocol: `linkku/index.html:590-700, 1218-1260, 1379-1500`.
- Desain lama: hub `index.html:20-54`; asisten `assistant/css/app.css`;
  kronik `kronik/index.html:69-72`; cucimoney `cucimoney/index.html:18-115`;
  linkku `linkku/index.html:675-699`.

---

## 20. Langkah Berikutnya

1. Konfirmasi asumsi A1–A7 dan pertanyaan Bagian 18.
2. Buat plan TDD detail untuk **Fase 0** (scaffold, CI, skema, backup, spike Live2D).
3. Eksekusi Fase 0 sampai gate lulus; perbarui dokumen ini dengan hasil spike
   (lisensi, kontrak TTS, worker).
4. Baru lanjut Fase 1.
