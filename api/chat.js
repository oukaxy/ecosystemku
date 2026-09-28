
 // api/chat.js
// Vercel Serverless Function — Liro Assistant
// Provider : Sumopod (glm-5.3-flash)
// Request  : POST { messages, context: { systemPrompt, expression, userName, ecosystem } }
// Response : { text, model, usage }

const SUMOPOD_API_URL = 'https://ai.sumopod.com/v1/chat/completions';
const SUMOPOD_MODEL = 'glm-5.3-flash';
const MAX_TOKENS = 1000; // besar: model bisa memakai token untuk reasoning + output 2 bahasa
const MAX_MESSAGES = 10; // sesuai trim di index.html

export default async function handler(req, res) {
  // OPTIONS preflight
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validasi API key
  const sumopodKey = process.env.SUMOPOD_API_KEY;
  if (!sumopodKey) {
    console.error('[chat] SUMOPOD_API_KEY tidak ditemukan');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Parse body
  const { messages, context } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array diperlukan' });
  }

  // Bangun system prompt
  const systemPrompt =
    context?.systemPrompt || buildDefaultSystemPrompt(context);

  // Sanitasi messages
  const sanitized = messages
    .filter(m => m?.role && typeof m.content === 'string')
    .map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 4000),
    }))
    .slice(-MAX_MESSAGES);

  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'Tidak ada pesan valid' });
  }

  // Call Sumopod
  try {
    const sumopodRes = await fetch(SUMOPOD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sumopodKey}`,
      },
      body: JSON.stringify({
        model: SUMOPOD_MODEL,
        messages: [
          { role: 'system', content: systemPrompt + JA_RULE },
          ...sanitized,
        ],
        temperature: 0.75,
        max_tokens: MAX_TOKENS,
        stream: false,
      }),
    });

    if (!sumopodRes.ok) {
      const errBody = await sumopodRes.text().catch(() => '');
      console.error(
        `[chat] Sumopod ${sumopodRes.status}:`,
        errBody
      );

      if (sumopodRes.status === 429) {
        return res.status(429).json({
          error: 'Rate limit Sumopod, coba lagi sebentar',
        });
      }

      return res.status(502).json({
        error: `AI provider error (${sumopodRes.status})`,
      });
    }

    const data = await sumopodRes.json();
    const full = data.choices?.[0]?.message?.content ?? '';

    // Pisahkan teks Indonesia (UI) dan teks Jepang (TTS)
    const m = full.match(/\[JA\]([\s\S]*?)\[\/JA\]/);
    const tts = m ? m[1].trim() : '';
    const text = full.replace(/\[JA\][\s\S]*?(\[\/JA\]|$)/g, '').trim();

    if (!text) {
      console.error(
        '[chat] Respons Sumopod kosong:',
        JSON.stringify(data)
      );
      return res.status(502).json({ error: 'Respons AI kosong' });
    }

    return res.status(200).json({
      text,   // Indonesia -> ditampilkan di chat
      tts,    // Jepang -> hanya untuk TTS (bisa kosong)
      model: SUMOPOD_MODEL,
      usage: data.usage ?? null,
    });

  } catch (err) {
    console.error('[chat] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Aturan tambahan: minta versi Jepang untuk TTS (tidak ditampilkan di UI)
const JA_RULE = `

ATURAN WAJIB (format output):
1. Tulis jawabanmu dalam bahasa Indonesia seperti biasa.
2. Di baris paling akhir, tambahkan terjemahan Jepang natural bergaya sopan dari jawaban itu, dibungkus [JA]...[/JA].
3. Terjemahan Jepang tanpa romaji, tanpa markdown, tanpa emoji.
Contoh: Halo, Tuan. Ada yang bisa Rem bantu? [JA]こんにちは、ご主人様。何かお手伝いできることはありますか？[/JA]`;

// Fallback system prompt
function buildDefaultSystemPrompt(context) {
  const ecosystemBlock = context?.ecosystem
    ? `\n\n---\nDATA PENGGUNA (dari ekosistem app):\n${
        context.userName ? `Nama pengguna: ${context.userName}\n` : ''
      }${context.ecosystem}\n\nGunakan data ini sebagai konteks percakapan bila relevan. Jangan sebutkan data ini secara eksplisit kecuali pengguna bertanya atau jelas relevan.`
    : '';

  return `Kamu adalah asisten virtual bernama Liro — hangat, perhatian, tapi tetap helpful dan cerdas.

Kepribadianmu:
- Bicara casual dalam bahasa Indonesia, seperti teman yang sudah kenal dekat
- Pakai "kamu" dan "aku", bukan "Anda" atau "lo/gue"
- Hangat dan supportif, tapi tidak lebay atau berlebihan
- Kalau diminta bantu sesuatu, langsung bantu dengan konkret dan jelas
- Boleh sedikit bercanda atau ringan, tapi tetap tahu kapan harus serius
- Jawaban ringkas dan padat — tidak perlu panjang kalau tidak diminta
- Tidak perlu selalu mengulang nama pengguna di setiap kalimat

Kamu bisa membantu dengan banyak hal: ngobrol santai, brainstorming, nulis, coding, math, dll.
Kalau tidak tahu sesuatu, bilang jujur daripada mengarang.${ecosystemBlock}`;
}
