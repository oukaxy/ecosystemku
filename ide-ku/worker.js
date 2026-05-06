const ALLOWED_ORIGIN = "https://oukaxy2.github.io";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const isAllowed = origin.startsWith(ALLOWED_ORIGIN);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": isAllowed ? origin : ALLOWED_ORIGIN,
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Only allow from IdeKu origin
    if (!isAllowed) {
      return new Response("Forbidden", { status: 403 });
    }

    try {
      const body = await request.json();
      const { title, notes, category, priority, mode, systemPrompt, userPrompt } = body;

      if (!title) {
        return new Response(JSON.stringify({ error: "Judul ide tidak boleh kosong" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      let messages;
      let maxTokens;

      // ── MODE: breakdown — pakai systemPrompt + userPrompt dari frontend ──
      if (mode === "breakdown" && systemPrompt && userPrompt) {
        messages = [
          { role: "system", content: systemPrompt },
          { role: "user",   content: userPrompt },
        ];
        maxTokens = 400;
      } else {
        // ── MODE: default — Perkaya Ide ──
        const prompt = `## Konteks
Kamu adalah asisten pencatat ide pribadi. Tugasmu membantu merapikan catatan ide yang masih mentah menjadi versi yang lebih matang. Output kamu akan langsung disimpan sebagai catatan di aplikasi — bukan untuk dibaca panjang-panjang.

## Tugas
Tulis ulang catatan ide berikut menjadi versi yang lebih matang dan konkret:

Judul: ${title}
Kategori: ${category || "-"}
Catatan awal: ${notes || "(belum ada catatan)"}

## Format
WAJIB: Tulis tepat 2-3 kalimat saja — tidak boleh lebih. Satu paragraf, bahasa Indonesia santai, langsung ke inti.

Contoh output yang benar (perhatikan panjangnya):
"Aplikasi kasir sederhana untuk UMKM yang tidak perlu koneksi internet. Fokus pada fitur inti: catat transaksi, hitung kembalian, dan laporan harian. Cocok untuk warung atau toko kecil yang belum pakai sistem apapun."

## Batasan
- MAKSIMAL 3 KALIMAT — ini aturan paling penting, jangan dilanggar
- Tidak boleh lebih dari 60 kata
- Tidak boleh pakai bullet point, heading, atau markdown apapun
- Tidak boleh ada kalimat pembuka seperti "Tentu", "Berikut", "Ide ini", dll
- Sesuai konteks kategori: ${category || "umum"}`;

        messages = [{ role: "user", content: prompt }];
        maxTokens = 120;
      }

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          max_tokens: maxTokens,
          temperature: 0.5,
          messages,
        }),
      });

      if (!groqRes.ok) {
        const err = await groqRes.text();
        return new Response(JSON.stringify({ error: "Groq API error", detail: err }), {
          status: 502,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        });
      }

      const data = await groqRes.json();
      const result = data.choices?.[0]?.message?.content?.trim() || "";

      return new Response(JSON.stringify({ result }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      });

    } catch (err) {
      return new Response(JSON.stringify({ error: "Internal error", detail: err.message }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      });
    }
  },
};
