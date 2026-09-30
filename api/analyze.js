// Tabak Kalori — fotoğrafı Gemini'ye gönderip kalori tahmini döndüren sunucu fonksiyonu.
// Vercel ortam değişkenleri:
//   GEMINI_API_KEY  (zorunlu) — aistudio.google.com'dan alınan ücretsiz anahtar
//   GEMINI_MODEL    (isteğe bağlı) — model adı; boşsa aşağıdaki varsayılan kullanılır
//   ERISIM_KODU     (isteğe bağlı) — ayarlanırsa sadece ?kod=... linkiyle açanlar kullanabilir

// Sırayla denenir; biri kapalı, limiti dolmuş ya da meşgulse bir sonrakine geçilir
const MODELS = ["gemini-3.5-flash", "gemini-flash-latest", "gemini-3-flash-preview", "gemini-2.5-flash"];

const PROMPT = (hint) => `Sen bir beslenme uzmanısın. Fotoğraftaki tabakta/öğünde bulunan her yiyeceği ve içeceği tanı, porsiyonunu gözle tahmin et ve kalorisini hesapla. Türk mutfağını iyi bil (pilav, köfte, mercimek çorbası, börek, dolma vb.).
${hint ? "Kullanıcının notu (buna öncelik ver): " + hint + "\n" : ""}
Sadece şu biçimde JSON döndür, başka metin yazma:
{"baslik":"öğünün kısa adı, örn. Köfte ve pilav","yemekler":[{"ad":"Türkçe yemek adı","porsiyon":"kolay anlaşılır miktar, örn. 1 kepçe / 4 adet / ~150 g","kalori":sayı,"protein":gram,"karbonhidrat":gram,"yag":gram}],"not":"kısa tek cümle: tahmini zorlaştıran bir şey varsa (yağ miktarı, gizli sos vb.), yoksa boş"}
Fotoğrafta yemek yoksa {"baslik":"","yemekler":[],"not":"Fotoğrafta yemek göremedim."} döndür.`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ hata: "POST kullan" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ hata: "GEMINI_API_KEY ayarlanmamış" });
  const models = process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL, ...MODELS] : MODELS;

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const code = process.env.ERISIM_KODU;
  if (code && body.kod !== code) return res.status(401).json({ hata: "kod" });

  const image = typeof body.image === "string" ? body.image : "";
  if (!image) return res.status(400).json({ hata: "fotoğraf yok" });
  if (image.length > 4_000_000) return res.status(413).json({ hata: "fotoğraf çok büyük" });
  const hint = String(body.hint || "").slice(0, 300);

  const payload = JSON.stringify({
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: "image/jpeg", data: image } },
        { text: PROMPT(hint) },
      ],
    }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
  });

  try {
    let r = null, lastErr = "";
    for (const model of models) {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { method: "POST", headers: { "x-goog-api-key": key, "content-type": "application/json" }, body: payload }
      );
      // 404: model kapalı, 429: bu modelin ücretsiz limiti doldu, 500/503: model o an meşgul
      // Her modelin limiti ayrı, o yüzden sıradakini dene
      if (![404, 429, 500, 503].includes(r.status)) break;
      lastErr = model + " → " + r.status;
      console.error("Sıradaki modele geçiliyor:", lastErr);
    }

    if (r.status === 429) return res.status(429).json({ hata: "yoğun" });
    if (!r.ok) {
      const t = await r.text();
      console.error("Gemini hata", r.status, t);
      let msg = lastErr;
      try { msg = JSON.parse(t).error.message || msg; } catch {}
      return res.status(502).json({ hata: "Gemini " + r.status + ": " + String(msg).slice(0, 160) });
    }

    const out = await r.json();
    const parts = (out.candidates && out.candidates[0] && out.candidates[0].content && out.candidates[0].content.parts) || [];
    const text = parts.map(p => p.text || "").join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    const data = JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text);
    return res.status(200).json(data);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ hata: "okunamadı" });
  }
};
