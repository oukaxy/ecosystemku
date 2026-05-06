// api/chat.js
// Vercel Serverless Function — Liro Assistant
// Provider : Groq  (llama-3.3-70b-versatile)
// Request  : POST { messages, context: { systemPrompt, expression, userName, ecosystem } }
// Response : { text, model, usage }

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';
const MAX_TOKENS   = 1024;
const MAX_MESSAGES = 20;   // jumlah messages terakhir yang dikirim ke Groq

export default async function handler(req, res) {
  // ── OPTIONS preflight ─────────────────────────────────────────────
  // (CORS header sudah di-set vercel.json, tapi tetap handle OPTIONS)
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // ── Validasi API key ──────────────────────────────────────────────
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    console.error('[chat] GROQ_API_KEY tidak ditemukan');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // ── Parse body ────────────────────────────────────────────────────
  const { messages, context } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array diperlukan' });
  }

  // ── Bangun system prompt ──────────────────────────────────────────
  // index.html sudah membangun finalSystemPrompt lengkap (dengan context
  // ekosistem) dan mengirimnya via context.systemPrompt — pakai langsung.
  // Fallback ke buildDefaultSystemPrompt() kalau context tidak ada.
  const systemPrompt = context?.systemPrompt || buildDefaultSystemPrompt(context);

  // ── Sanitasi messages ─────────────────────────────────────────────
  const sanitized = messages
    .filter(m => m?.role && typeof m.content === 'string')
    .map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.slice(0, 4000),
    }))
    .slice(-MAX_MESSAGES);

  if (sanitized.length === 0) {
    return res.status(400).json({ error: 'Tidak ada pesan valid' });
  }

  // ── Call Groq ─────────────────────────────────────────────────────
  try {
    const groqRes = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...sanitized,
        ],
        temperature: 0.75,
        max_tokens:  MAX_TOKENS,
        stream:      false,
      }),
    });

    if (!groqRes.ok) {
      const errBody = await groqRes.text().catch(() => '');
      console.error(`[chat] Groq ${groqRes.status}:`, errBody);

      if (groqRes.status === 429) {
        return res.status(429).json({ error: 'Rate limit Groq, coba lagi sebentar' });
      }
      return res.status(502).json({ error: `AI provider error (${groqRes.status})` });
    }

    const data = await groqRes.json();
    const text = data.choices?.[0]?.message?.content ?? '';

    if (!text) {
      console.error('[chat] Respons Groq kosong:', JSON.stringify(data));
      return res.status(502).json({ error: 'Respons AI kosong' });
    }

    // index.html membaca: data?.text || data?.message || data?.content
    // → kita return { text } agar masuk branch pertama
    return res.status(200).json({
      text,
      model: GROQ_MODEL,
      usage: data.usage ?? null,
    });

  } catch (err) {
    console.error('[chat] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── Fallback system prompt ────────────────────────────────────────────
// Dipakai hanya kalau client tidak mengirim context.systemPrompt.
// Normalnya index.html selalu mengirim systemPrompt yang sudah di-inject
// dengan data ekosistem via loadEcosystemContext().
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
