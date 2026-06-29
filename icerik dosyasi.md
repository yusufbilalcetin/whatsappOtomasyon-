# İçerik Dosyası — WhatsApp Otomasyon

Bu dosya, projenin **README.md** belgesinin içeriğini özetler ve hangi bölümde neyin anlatıldığını açıklar. Detaylar için `README.md` dosyasına bakın.

---

## README.md neyi anlatıyor?

### 1. Genel tanıtım
Projenin ne olduğu: çok kullanıcılı, bulut tabanlı bir WhatsApp otomasyon platformu. Kullanıcılar web panelinden WhatsApp bağlar, zamanlanmış mesajlar kurar, gelen mesajlara AI ile otomatik yanıt verir, kişi yönetir. İki bağımsız parça (Panel + Motor) ve aralarındaki köprü olan Firestore anlatılır.

### 2. Nasıl çalışır? (Mimari)
- ASCII diyagramla **Panel (Vercel) ↔ Firestore ↔ Motor (Node.js)** akışı.
- Panel ve motorun birbirini doğrudan tanımadığı; Firestore üzerinden komut/ayar yazıp canlı `onSnapshot` ile okudukları açıklanır.

### 3. Teknoloji yığını
Her katmanın hangi teknolojiyi kullandığı tablo halinde: Panel (vanilla HTML/CSS/JS + Firebase Web SDK), Auth, Firestore, Baileys, node-cron, Gemini, firebase-admin, pino, Vercel, Windows/systemd.

### 4. Proje yapısı
Tüm klasör ve dosyaların ne işe yaradığı açıklamalı dosya ağacı:
- `index.html`, `assets/` (app.js, style.css, firebase-config.js)
- `server/src/` (index, whatsapp, scheduler, autoreply, gemini, firestore, config, logger)
- `server/deploy/` (Windows + Linux kurulum dosyaları)

### 5. Veri akışı
Üç somut örnekle akış: (1) otomasyon kurup gönderme, (2) telefon koduyla WhatsApp bağlama, (3) AI otomatik yanıt.

### 6. Firestore veri modeli
`users/{uid}` altındaki alanlar (waState, waQr, waPairingCode, engineHeartbeat, autoReply…) ve koleksiyonlar (automations, contacts, commands, logs) şema olarak gösterilir.

### 7. Özellikler
Çok kullanıcılılık, zamanlanmış mesajlar, AI otomatik yanıt, kişi/grup yönetimi, iki bağlanma yöntemi, sağlam bağlantı yönetimi, tema, responsive tasarım.

### 8. WhatsApp bağlantısı (QR + kod)
QR ve eşleştirme kodu yöntemleri; backoff + deneme limiti, eşleştirme hatası yönetimi, başarılı bağlantıda sayaç sıfırlama gibi dayanıklılık önlemleri.

### 9. Kurulum
- **Firebase:** proje, Auth, Firestore, kurallar, web yapılandırması, servis hesabı.
- **Panel (Vercel):** otomatik deploy, cache başlıkları, sürüm parametresi.
- **Motor:** `npm install` + `.env` + `npm start`; Windows (Görev Zamanlayıcı) ve Linux (systemd) otomatik başlatma.

### 10. Firestore güvenlik kuralları
Kopyalanabilir hazır kural bloğu: her kullanıcı yalnızca kendi verisine erişir.

### 11. Ortam değişkenleri
`server/.env` tablosu: `GOOGLE_CLOUD_PROJECT`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `DEFAULT_TIMEZONE`, `WA_AUTH_DIR` vb.

### 12. Komutlar (panel → motor)
`requestPairingCode`, `reconnectWhatsApp`, `disconnectWhatsApp`, `syncContacts`, `runNow` komutlarının ne yaptığı.

### 13. Mobil / responsive
Kırılma noktaları (≤720px, ≤420px, yatay), soldan açılan drawer menü, iOS Safari uyumu (sayfa akışı + dvh yedeği), çentik desteği, yatay taşma önlemleri.

### 14. Sık karşılaşılan sorunlar
İnternet hatası, cache'li bozuk tasarım, motor çevrimdışı, eşleştirme kodu reddi, boşta bağlantı, AI çalışmaması — belirti/çözüm tablosu.

---

## Kısa özet (bir paragraf)

WhatsApp Otomasyon; bir **web panelinden** (Vercel'de statik) yönetilen, **Node.js motorunun** (Baileys ile) WhatsApp oturumunu sürekli açık tuttuğu, **Firestore'un köprü** görevi gördüğü çok kullanıcılı bir otomasyon sistemidir. Kullanıcılar QR veya telefon koduyla bağlanır; saatli/günlü **zamanlanmış mesajlar** (sabit metin veya **Gemini** ile üretilen) gönderir; gelen mesajlara **AI otomatik yanıt** kurabilir; kişi ve gruplarını yönetir. Panel mobil-uyumludur (soldan açılan menü, iOS Safari uyumu, tüm telefon boyutları).

---

# Güvenlik

Bu bölüm, kapatılan güvenlik açıklarını ve mevcut güvenlik önlemlerini açıklar.

## Kapatılan açıklar

### 1. Stored XSS (kalıcı siteler arası betik çalıştırma) — KAPATILDI
**Risk:** Panel, kişi adlarını, otomasyon adlarını, telefon numaralarını ve log içeriklerini `innerHTML` ile DOM'a basıyordu. Kişi adları WhatsApp `pushName`/`notify` alanından gelir ve **saldırgan tarafından kontrol edilebilir** — biri size kötü amaçlı bir görünen-ad (`<img src=x onerror=...>` gibi) ile mesaj atarsa, kişi listesi/loglar açıldığında panelde keyfi JavaScript çalışabilirdi.

**Çözüm:** Tüm dinamik değerleri HTML-escape eden bir `esc()` yardımcısı eklendi ve `innerHTML`'e konan her dinamik veri (isim, telefon, mesaj, log, gün, mod) bu fonksiyondan geçirildi. Böylece HTML olarak değil düz metin olarak işlenir.

## Mevcut güvenlik önlemleri

- **Firestore kuralları:** Her kullanıcı yalnızca kendi `users/{uid}` verisine erişir; giriş yapmamış kimse hiçbir şeye erişemez. Veriler kullanıcı bazında tamamen izole.
- **Kimlik doğrulama:** Firebase Authentication (e-posta/şifre + Google). Tüm Firestore erişimi kimliğe bağlı.
- **Telefon doğrulama:** Motor, gelen `requestPairingCode` komutundaki numarayı katı bir regex (`normalizePhone`) ile doğrular; geçersiz/biçimsiz girdi reddedilir.
- **Sır yönetimi:** `service-account.json` ve `.env` (Gemini API anahtarı dâhil) `.gitignore` ile dışlanır, repoya girmez. `firebase-config.js` içindeki anahtarlar Firebase tarafından **herkese açık olması tasarlanmış** public web anahtarlarıdır (gizli değildir; güvenlik Firestore kuralları + Auth ile sağlanır).
- **HTTP güvenlik başlıkları (Vercel):**
  - `X-Content-Type-Options: nosniff` — MIME tipi tahminini engeller.
  - `X-Frame-Options: SAMEORIGIN` — clickjacking (siteyi başka sitede iframe'leme) engeli.
  - `Referrer-Policy: strict-origin-when-cross-origin` — referrer sızıntısını azaltır.
  - `Permissions-Policy` — kullanılmayan tarayıcı özelliklerini (konum, mikrofon, kamera, ödeme) kapatır.
  - `Strict-Transport-Security` — yalnızca HTTPS zorunluluğu.
- **Bağlantı güvenliği:** WhatsApp oturum dosyaları (`auth_info/`) yerelde tutulur ve repoya girmez; her kullanıcı için ayrı dizin.

## Öneriler (gelecek için)

- İçerik Güvenliği Politikası (CSP) eklenebilir — ancak Firebase/Google oturum açma akışlarını bozmamak için dikkatli yapılandırılmalı ve test edilmeli.
- Motorun çalıştığı makinede `.env` ve `service-account.json` dosyalarının dosya izinleri kısıtlanmalı.

---

# Kapsamlı Doküman

> Aşağıdaki bölüm, `README.md` dosyasının tam içeriğidir. Hızlı referans için buraya da gömülmüştür.

WhatsApp Otomasyon, çok kullanıcılı, bulut tabanlı bir WhatsApp otomasyon platformudur. İki bağımsız parça (Panel + Motor) ve aralarındaki köprü olan Firestore'dan oluşur.

## Mimari

```
PANEL (Vercel, statik)  ──yazar──►  FIRESTORE  ◄──okur/yazar──  MOTOR (Node.js)
 • Firebase Auth                   users/{uid}/...              • Baileys (WhatsApp)
 • Otomasyon/Kişi CRUD             (commands, automations,       • node-cron
 • QR / kod gösterimi              contacts, logs, waState…)     • Gemini (AI)
```

Panel ve motor birbirini doğrudan tanımaz: panel komut/ayar yazar, motor gerçek zamanlı `onSnapshot` ile okuyup uygular, sonuçları (durum, QR, kod, log, kişi) yine Firestore'a yazar.

## Teknoloji yığını
Vanilla HTML/CSS/JS + Firebase Web SDK (panel) · Firebase Auth · Firestore · Baileys · node-cron · Gemini (`gemini-2.5-flash`) · firebase-admin · pino · Vercel (panel) · Windows Görev Zamanlayıcı / Linux systemd (motor).

## Proje yapısı (özet)
- `index.html`, `assets/` (app.js, style.css, firebase-config.js) — panel
- `server/src/` — motor: index, whatsapp, scheduler, autoreply, gemini, firestore, config, logger
- `server/deploy/` — Windows + Linux otomatik başlatma dosyaları

## Firestore veri modeli
`users/{uid}` alanları: `email`, `engineHeartbeat`, `waState`, `waQr`, `waPairingPhone`, `waPairingCode`, `waPairingError`, `autoReply`.
Alt koleksiyonlar: `automations`, `contacts`, `commands`, `logs`.

## Özellikler
Çok kullanıcılılık · zamanlanmış mesajlar (sabit/AI) · AI otomatik yanıt (persona + cooldown + sadece-kayıtlı seçeneği) · kişi/grup yönetimi · QR + kod ile bağlanma · backoff + deneme limitli sağlam bağlantı · açık/koyu/sistem tema · tüm telefonlarda responsive (mobil drawer).

## Kurulum (özet)
1. **Firebase:** proje + Auth (e-posta/Google) + Firestore + kurallar + servis hesabı.
2. **Panel:** Vercel'e `main` push → otomatik deploy.
3. **Motor:** `cd server && npm install && cp .env.example .env && npm start`; Windows/Linux otomatik başlatma `server/deploy/` altında.

## Komutlar (panel → motor)
`requestPairingCode`, `reconnectWhatsApp`, `disconnectWhatsApp`, `syncContacts`, `runNow`.

## Mobil / responsive
Kırılma noktaları ≤720px ve ≤420px + yatay; soldan açılan drawer menü; iOS Safari için sayfa-akışı + `100dvh`/`100vh`; çentik (`safe-area`) desteği; yatay taşma koruması.

> Detaylı kurulum, ortam değişkenleri tablosu, güvenlik kuralları ve sorun giderme için `README.md` dosyasına bakın.
