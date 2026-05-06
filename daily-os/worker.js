// ============================================
// Cloudflare Worker — Daily OS AI
// Proxy ke Groq API
// 
// Setup:
// 1. Buat Worker baru di Cloudflare dashboard
// 2. Paste kode ini
// 3. Settings → Variables → tambah:
//    GROQ_API_KEY = (api key groq kamu)
// ============================================

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.3-70b-versatile";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request, env) {

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // Hanya terima POST
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Parse body dari Daily OS
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Validasi — butuh field "prompt" atau "messages"
    const messages = body.messages || [{ role: "user", content: body.prompt }];
    const systemPrompt = body.system || null;

    if (!messages || messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Kirim ke Groq
    const groqBody = {
      model: MODEL,
      max_tokens: body.max_tokens || 1000,
      messages: systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...messages]
        : messages,
    };

    let groqResp;
    try {
      groqResp = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(groqBody),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to reach Groq", detail: err.message }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const groqData = await groqResp.json();

    if (!groqResp.ok) {
      return new Response(JSON.stringify({ error: "Groq error", detail: groqData }), {
        status: groqResp.status,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Ambil teks dari response Groq
    const text = groqData.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  },
};
