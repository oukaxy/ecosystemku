// api/tts.js
// Vercel Serverless Function — ElevenLabs TTS untuk Liro
//
// Request  : POST { text, voiceId?, voiceSettings? }
// Response : audio/mpeg binary  (ArrayBuffer di sisi client)
//
// Pipeline di index.html:
//   fetch('/api/tts') → res.arrayBuffer() → audioCtx.decodeAudioData()
//   → AudioBufferSourceNode → analyser → destination
//   (BUKAN <Audio> element — harus return raw audio/mpeg)

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1/text-to-speech';

// Model: eleven_multilingual_v2 support Bahasa Indonesia
// Alternatif lebih cepat: 'eleven_turbo_v2_5' (latensi ~50% lebih rendah)
const TTS_MODEL = 'eleven_multilingual_v2';

// Voice ID default — ganti dengan voice ID Liro kalau sudah punya
// Rekomendasi untuk karakter soft female / virtual assistant:
//   "EXAVITQu4vr4xnSDxMaL"  Bella   — lembut, warm
//   "21m00Tcm4TlvDq8ikWAM"  Rachel  — calm, clear
//   "AZnzlk1XvdvUeBnXmlld"  Domi    — energetic
const DEFAULT_VOICE_ID = 'cgSgspJ2msm6clMCkdW9'; // Jessica — default

// Batas karakter TTS — hemat quota & cegah latency tinggi
const MAX_CHARS = 500;

// ── Bersihkan teks sebelum dikirim ke ElevenLabs ─────────────────────
// Hapus markdown formatting yang tidak relevan untuk audio
function cleanText(raw) {
  return raw
    .replace(/\*\*(.*?)\*\*/g, '$1')   // **bold**
    .replace(/\*(.*?)\*/g,     '$1')   // *italic*
    .replace(/`([^`]+)`/g,     '$1')   // `code`
    .replace(/#{1,6}\s+/g,     '')     // ## heading
    .replace(/\n[-*•]\s+/g,    '. ')   // bullet → kalimat
    .replace(/\n+/g,           ' ')    // newline → spasi
    .replace(/\s{2,}/g,        ' ')    // multiple spaces
    .trim();
}

// ── Truncate di batas kalimat ─────────────────────────────────────────
function truncate(text, max) {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastPunct = Math.max(
    cut.lastIndexOf('.'),
    cut.lastIndexOf('?'),
    cut.lastIndexOf('!'),
    cut.lastIndexOf(','),
  );

  // Potong di tanda baca kalau cukup jauh dari awal
  return lastPunct > max * 0.5
    ? cut.slice(0, lastPunct + 1)
    : cut + '…';
}

// ── Handler ───────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // Validasi API key
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenKey) {
    console.error('[tts] ELEVENLABS_API_KEY tidak ditemukan');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  const { text, voiceId, voiceSettings } = req.body ?? {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text diperlukan' });
  }

  // Bersihkan & truncate
  const finalText = truncate(cleanText(text), MAX_CHARS);
  if (!finalText) return res.status(400).json({ error: 'Teks kosong setelah dibersihkan' });

  // Pilih voice ID: dari request > env var > hardcoded default
  const targetVoice = voiceId
    || process.env.ELEVENLABS_VOICE_ID
    || DEFAULT_VOICE_ID;

  // Voice settings — bisa di-override dari client
  const settings = {
    stability:        voiceSettings?.stability        ?? 0.50,
    similarity_boost: voiceSettings?.similarity_boost ?? 0.75,
    style:            voiceSettings?.style            ?? 0.30,
    use_speaker_boost: true,
  };

  try {
    const elRes = await fetch(`${ELEVENLABS_BASE}/${targetVoice}`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key':   elevenKey,
        'Accept':       'audio/mpeg',
      },
      body: JSON.stringify({
        text:           finalText,
        model_id:       TTS_MODEL,
        language_code:  'id',   // paksa output Bahasa Indonesia
        voice_settings: settings,
      }),
    });

    if (!elRes.ok) {
      const errBody = await elRes.text().catch(() => '');
      console.error(`[tts] ElevenLabs ${elRes.status}:`, errBody);

      const map = {
        401: 'API key ElevenLabs tidak valid',
        422: 'Voice ID tidak valid atau teks bermasalah',
        429: 'Quota ElevenLabs habis atau rate limit',
      };
      return res.status(elRes.status in map ? elRes.status : 502)
                .json({ error: map[elRes.status] || `ElevenLabs error (${elRes.status})` });
    }

    // ── Stream audio ke client ─────────────────────────────────────
    // index.html pakai: res.arrayBuffer() → audioCtx.decodeAudioData()
    // Jadi kita perlu return raw audio/mpeg, bukan JSON.
    const audioBuffer = await elRes.arrayBuffer();

    res.setHeader('Content-Type',   'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.setHeader('Cache-Control',  'no-store');
    res.setHeader('X-Chars-Used',   String(finalText.length));

    return res.status(200).send(Buffer.from(audioBuffer));

  } catch (err) {
    console.error('[tts] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
