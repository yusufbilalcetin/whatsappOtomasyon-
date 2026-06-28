# WhatsApp Otomasyon — Bulut Mimarisi Planı (Ücretsiz)

Hedef: Bilgisayar kapalıyken 7/24 çalışan, birden fazla zamanlı otomasyon
kurabilen, mesaj metnini Gemini ile üretebilen, verisi Firebase'de duran
bir sistem. **Tamamı ücretsiz katmanlarla.**

---

## 1. Neden mevcut sistem buluta taşınamıyor?

- Gönderim `pyautogui` ile **klavye taklidi** yapıyor → açık ekran + ön plan
  pencere + fiziksel bilgisayar gerektiriyor.
- Vercel **serverless** → kalıcı WhatsApp oturumu tutamaz, ekranı yoktur.
- Bu yüzden gönderim katmanı (transport) **baştan değişmek zorunda.**

## 2. Seçilen mimari (ücretsiz)

```
┌─────────────────────────────────────────────────────────────┐
│  Oracle Cloud "Always Free" VM  (kalıcı ücretsiz Linux)      │
│                                                              │
│   ┌────────────────────┐    ┌──────────────────────────┐    │
│   │  Baileys (Node.js) │    │  node-cron (zamanlayıcı)  │    │
│   │  WhatsApp gönderim │◄───┤  çoklu otomasyon job'ları │    │
│   │  (kendi numaran)   │    └──────────────────────────┘    │
│   └─────────┬──────────┘                                     │
│             │                  ┌────────────────────────┐    │
│             └─────────────────►│  Gemini API (metin)    │    │
│                                └────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────┘
                           │  okuma/yazma
                ┌──────────▼───────────┐
                │  Firebase Firestore  │  (kişiler, otomasyonlar,
                │  (ücretsiz Spark)    │   mesajlar, loglar, ayarlar)
                └──────────▲───────────┘
                           │
                ┌──────────┴───────────┐
                │  Yönetim Paneli (Web)│  Vercel ücretsiz (statik/Next)
                │  telefondan da girilir│
                └──────────────────────┘
```

### Katman maliyetleri
| Katman | Servis | Ücret |
|---|---|---|
| 7/24 host | Oracle Cloud Always Free VM | Ücretsiz (kalıcı) |
| Gönderim | Baileys (open source) | Ücretsiz |
| Zamanlama | node-cron | Ücretsiz |
| Veri | Firebase Firestore (Spark) | Ücretsiz |
| AI metin | Gemini API (AI Studio free tier) | Ücretsiz |
| Panel | Vercel Hobby | Ücretsiz |

> Risk notu: Baileys resmi olmayan yoldur; aşırı/spam kullanımda numara
> engellenebilir. Günde birkaç normal mesaj için risk düşüktür.

---

## 3. Yeni veri modeli (Firestore koleksiyonları)

Mevcut SQLite tablolarının Firestore karşılığı:

- `contacts/{id}` → `{ name, phone }`
- `messages/{id}` → `{ text, isActive }`
- **`automations/{id}`** → ÇOKLU OTOMASYON (yeni, kök çözüm)
  ```
  {
    name: "Sabah mesajı",
    contactId: "...",
    time: "08:00",
    days: ["mon","tue","wed","thu","fri","sat","sun"],
    timezone: "Europe/Istanbul",
    messageMode: "random" | "fixed" | "ai",
    messageId: "...",          // fixed modda
    aiPrompt: "...",           // ai modda (Gemini'ye gider)
    enabled: true,
    lastRunDate: "2026-06-29"  // günde-bir dedup
  }
  ```
- `logs/{id}` → `{ automationId, contactName, phone, message, status, sentAt, error }`
- `settings/global` → `{ defaultTimezone, geminiModel }`
- (AI yanıt motoru opsiyonel — 2. faza bırakılabilir)

---

## 4. "Çoklu otomasyon + saat hatası" kök çözümü

Mevcut hata: `scheduler.py` tek sabit job (`id="daily_whatsapp_message"`)
ve tek Windows görevi kullanıp her seferinde öncekini eziyor.

Yeni tasarımda: **her `automations/{id}` için ayrı bir node-cron job.**
- Açılışta tüm `enabled` otomasyonlar Firestore'dan okunur, her biri için
  `cron.schedule(cronExpr, ...)` ile job kurulur.
- Firestore `onSnapshot` ile panel'den değişiklik anında job'lar
  yeniden kurulur (ekle/sil/güncelle çakışmadan çalışır).
- `lastRunDate` ile aynı gün ikinci gönderim engellenir (mevcut
  `automatic_success_exists_today` mantığının karşılığı).

---

## 5. Uygulama adımları (sırayla)

**Faz 0 — Hesaplar (senin yapacakların, hepsi ücretsiz)**
1. Firebase projesi aç → Firestore'u başlat → service account JSON indir.
2. Google AI Studio'dan Gemini API anahtarı al.
3. Oracle Cloud hesabı aç → Always Free Ubuntu VM oluştur.

**Faz 1 — Sunucu servisi (Node + Baileys)**
4. `server/` projesi: Baileys bağlantısı, QR'ı bir kez okutma, oturumu
   diskte kalıcı saklama (`auth_info`).
5. Firestore bağlantısı (firebase-admin) + veri erişim katmanı.
6. node-cron zamanlayıcı + çoklu otomasyon job yönetimi (Bölüm 4).
7. Gemini entegrasyonu (`ai` modlu otomasyonlar için metin üretimi).
8. Gönderim + loglama + günde-bir dedup.
9. systemd servisi → VM yeniden başlasa bile otomatik ayağa kalkar.

**Faz 2 — Yönetim paneli (Web, Vercel)**
10. Next.js panel: kişiler, mesajlar, **otomasyon CRUD**, loglar.
11. Firestore'a doğrudan bağlanır (veya sunucudaki küçük API'ye).
12. Telefondan da kullanılabilir (responsive).

**Faz 3 — Taşıma & kapanış**
13. Mevcut SQLite verisini Firestore'a aktaran tek seferlik script.
14. Eski Python/pyautogui sistemi devre dışı (artık bilgisayar gerekmez).

---

## 6. Karar verilecek küçük noktalar
- Panel'i Vercel'de Next.js mı yoksa sunucuda basit bir sayfa mı?
- AI yanıt (gelen mesaja otomatik cevap) motoru 1. faza mı 2. faza mı?
- Oracle VM yerine alternatif gerekirse: Fly.io / kendi Raspberry Pi.
