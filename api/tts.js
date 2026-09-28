const FISH_AUDIO_BASE = 'https://api.fish.audio/v1/tts';

const TTS_MODEL = 's2.1-pro-free';
const DEFAULT_VOICE_ID = 'eb79df9571014449b42bcd869f86fe0a';
const MAX_CHARS = 500;

function cleanText(raw) {
  return raw
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/\n[-*•]\s+/g, '. ')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function truncate(text, max) {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastPunct = Math.max(
    cut.lastIndexOf('.'),
    cut.lastIndexOf('?'),
    cut.lastIndexOf('!'),
    cut.lastIndexOf(',')
  );

  return lastPunct > max * 0.5
    ? cut.slice(0, lastPunct + 1)
    : cut + '…';
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  const apiKey = process.env.FISH_AUDIO_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: 'FISH_AUDIO_API_KEY belum diatur'
    });
  }

  const { text, voiceId } = req.body ?? {};

  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({
      error: 'text diperlukan'
    });
  }

  const finalText = truncate(cleanText(text), MAX_CHARS);

  if (!finalText) {
    return res.status(400).json({
      error: 'Teks kosong setelah dibersihkan'
    });
  }

  const targetVoice = voiceId || DEFAULT_VOICE_ID;

  try {
    const fishRes = await fetch(FISH_AUDIO_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'model': TTS_MODEL,
        'Accept': 'audio/mpeg'
      },
      body: JSON.stringify({
        text: finalText,
        reference_id: targetVoice,
        format: 'mp3'
      })
    });

    if (!fishRes.ok) {
      const errBody = await fishRes.text().catch(() => '');
      console.error(`[tts] Fish Audio ${fishRes.status}:`, errBody);

      return res.status(502).json({
        error: `Fish Audio error (${fishRes.status})`,
        details: errBody
      });
    }

    const audioBuffer = await fishRes.arrayBuffer();

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Chars-Used', String(finalText.length));

    return res.status(200).send(Buffer.from(audioBuffer));

  } catch (err) {
    console.error('[tts] Unhandled error:', err);

    return res.status(500).json({
      error: 'Internal server error'
    });
  }
}
