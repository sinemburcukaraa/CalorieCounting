// Tabak Kalori — fotoğrafı Claude'a gönderip kalori tahmini döndüren sunucu fonksiyonu.
// Vercel ortam değişkenleri:
//   ANTHROPIC_API_KEY  (zorunlu) — console.anthropic.com'dan alınan anahtar
//   ERISIM_KODU        (isteğe bağlı) — ayarlanırsa sadece ?kod=... linkiyle açanlar kullanabilir

const MODEL = "claude-sonnet-5-5";

const PROMPT = (hint) => `Sen bir beslenme uzmanısın. Fotoğraftaki tabakta/öğünde bulunan her yiyeceği ve içeceği tanı, porsiyonunu gözle tahmin et ve kalorisini hesapla. Türk mutfağını iyi bil (pilav, köfte, mercimek çorbası, börek, dolma vb.).
${hint ? "Kullanıcının notu (buna öncelik ver): " + hint + "\n" : ""}
Sadece şu biçimde JSON döndür, başka metin yazma:
{"baslik":"öğünün kısa adı, örn. Köfte ve pilav","yemekler":[{"ad":"Türkçe yemek adı","porsiyon":"kolay anlaşılır miktar, örn. 1 kepçe / 4 adet / ~150 g","kalori":sayı,"protein":gram,"karbonhidrat":gram,"yag":gram}],"not":"kısa tek cümle: tahmini zorlaştıran bir şey varsa (yağ miktarı, gizli sos vb.), yoksa boş"}
Fotoğrafta yemek yoksa {"baslik":"","yemekler":[],"not":"Fotoğrafta yemek göremedim."} döndür.`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ hata: "POST kullan" });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ hata: "ANTHROPIC_API_KEY ayarlanmamış" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const code = process.env.ERISIM_KODU;
  if (code && body.kod !== code) return res.status(401).json({ hata: "kod" });

  const image = typeof body.image === "string" ? body.image : "";
  if (!image) return res.status(400).json({ hata: "fotoğraf yok" });
  if (image.length > 4_000_000) return res.status(413).json({ hata: "fotoğraf çok büyük" });
  const hint = String(body.hint || "").slice(0, 300);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
            { type: "text", text: PROMPT(hint) },
          ],
        }],
      }),
    });

    if (r.status === 429) return res.status(429).json({ hata: "yoğun" });
    if (!r.ok) {
      console.error("Anthropic hata", r.status, await r.text());
      return res.status(502).json({ hata: "servis" });
    }

    const out = await r.json();
    const text = (out.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    const data = JSON.parse(a >= 0 && b > a ? text.slice(a, b + 1) : text);
    return res.status(200).json(data);
  } catch (e) {
    console.error(e);
    return res.status(502).json({ hata: "okunamadı" });
  }
};
