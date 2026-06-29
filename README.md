# WhatsApp Otomasyon

Çok kullanıcılı, bulut tabanlı bir **WhatsApp otomasyon platformu**. Kullanıcılar bir web panelinden WhatsApp hesaplarını bağlar, zamanlanmış otomatik mesajlar kurar (sabit metin veya yapay zekâ ile üretilmiş), gelen mesajlara Gemini ile otomatik yanıt verir ve kişilerini yönetir.

Mimari iki bağımsız parçadan oluşur ve aralarındaki tek köprü **Firestore**'dur:

- **Panel (Frontend)** — statik web uygulaması, Vercel'de yayınlanır. Kullanıcıya hiçbir sunucu gerektirmeden çalışır; doğrudan Firebase ile konuşur.
- **Motor (Backend)** — Node.js servisi. WhatsApp bağlantısını (Baileys) sürekli açık tutar, zamanlamaları çalıştırır ve mesaj gönderir. Kalıcı oturum ve ekran gerektirdiği için serverless'ta **değil**, bir bilgisayarda / sunucuda çalışır.

---

## İçindekiler

- [Nasıl çalışır? (Mimari)](#nasıl-çalışır-mimari)
- [Teknoloji yığını](#teknoloji-yığını)
- [Proje yapısı](#proje-yapısı)
- [Veri akışı](#veri-akışı)
- [Firestore veri modeli](#firestore-veri-modeli)
- [Özellikler](#özellikler)
- [WhatsApp bağlantısı (QR + kod)](#whatsapp-bağlantısı-qr--kod)
- [Kurulum](#kurulum)
- [Firestore güvenlik kuralları](#firestore-güvenlik-kuralları)
- [Ortam değişkenleri](#ortam-değişkenleri)
- [Komutlar (panel → motor)](#komutlar-panel--motor)
- [Mobil / responsive](#mobil--responsive)
- [Sık karşılaşılan sorunlar](#sık-karşılaşılan-sorunlar)

---

## Nasıl çalışır? (Mimari)

```
┌────────────────────────┐         ┌──────────────────────────┐
│   PANEL (Vercel)        │         │   MOTOR (Bilgisayar/Sunucu)│
│   index.html + assets   │         │   server/ (Node.js)        │
│                         │         │                            │
│  • Firebase Auth        │         │  • Baileys (WhatsApp Web)  │
│  • Otomasyon CRUD       │         │  • node-cron (zamanlayıcı) │
│  • Kişi yönetimi        │         │  • Gemini (AI mesaj/yanıt) │
│  • QR / kod gösterimi   │         │  • firebase-admin          │
└───────────┬─────────────┘         └─────────────┬──────────────┘
            │                                      │
            │  yazar (commands, automations,       │  okur + yazar
            │  contacts, autoReply ayarı)          │  (waState, QR, kod,
            ▼                                      ▼   loglar, kişiler)
        ┌───────────────────────────────────────────────┐
        │              Firebase Firestore                │
        │         users/{uid}/...  (köprü)               │
        └───────────────────────────────────────────────┘
```

Panel ve motor **birbirini doğrudan tanımaz**. Panel Firestore'a komut/ayar yazar; motor bunları gerçek zamanlı `onSnapshot` dinleyicileriyle okuyup uygular ve sonuçları (bağlantı durumu, QR, kod, loglar, kişiler) yine Firestore'a yazar. Panel de bu değişiklikleri canlı dinler. Böylece panel her yerden (telefon dâhil) açılabilir, motor ise tek bir yerde sürekli çalışır.

---

## Teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Panel | Vanilla HTML/CSS/JS (framework yok), Firebase Web SDK 10.12.5 |
| Kimlik doğrulama | Firebase Authentication (e-posta/şifre + Google) |
| Veritabanı / köprü | Cloud Firestore |
| Motor | Node.js (ESM), `@whiskeysockets/baileys` |
| Zamanlama | `node-cron` |
| Yapay zekâ | Google Gemini (`@google/generative-ai`, varsayılan `gemini-2.5-flash`) |
| Admin erişimi | `firebase-admin` |
| Loglama | `pino` |
| Panel hosting | Vercel (statik) |
| Motor hosting | Windows (Görev Zamanlayıcı) veya Linux sunucu (systemd) |

---

## Proje yapısı

```
whatsappOtomatik/
├── index.html              # Panel: giriş ekranı + uygulama (tek sayfa)
├── vercel.json             # Vercel statik yayın + cache başlıkları
├── assets/
│   ├── app.js              # Panel mantığı (auth, CRUD, canlı dinleyiciler, UI)
│   ├── style.css           # WhatsApp tarzı tema + responsive (mobil drawer)
│   └── firebase-config.js  # Firebase web yapılandırması (public anahtarlar)
│
├── server/                 # MOTOR (Node.js)
│   ├── src/
│   │   ├── index.js        # Giriş noktası; kullanıcıları izler, komutları işler
│   │   ├── whatsapp.js     # Baileys: bağlantı, QR, eşleştirme kodu, gönderim
│   │   ├── scheduler.js    # node-cron ile zamanlanmış otomasyonlar
│   │   ├── autoreply.js    # Gelen mesajlara AI otomatik yanıt
│   │   ├── gemini.js       # Gemini istemcisi (mesaj/yanıt üretimi)
│   │   ├── firestore.js    # firebase-admin: okuma/yazma/dinleme yardımcıları
│   │   ├── config.js       # .env tabanlı yapılandırma
│   │   └── logger.js       # pino logger
│   ├── deploy/
│   │   ├── DEPLOY.md, DEPLOY-gcp.md     # Sunucu kurulum rehberleri
│   │   ├── whatsapp-otomasyon.service   # systemd birimi (Linux)
│   │   └── win/                          # Windows otomatik başlatma
│   │       ├── install-task.ps1, uninstall-task.ps1
│   │       ├── run-motor.bat, start-hidden.vbs
│   │       └── WINDOWS.md
│   └── package.json
│
├── PLAN.md                 # İlk tasarım/planlama notları
└── README.md               # Bu dosya
```

> Not: Firestore güvenlik kuralları Firebase Console üzerinden yönetilir (repoda tutulmaz).

---

## Veri akışı

**Örnek 1 — Otomasyon kurma ve gönderim**

1. Kullanıcı panelde otomasyon oluşturur → `users/{uid}/automations/{id}` belgesi yazılır.
2. Motor `watchAutomations` ile değişikliği görür, `node-cron` görevini (saat + günler) kurar.
3. Belirlenen saatte motor mesajı çözer (sabit metin veya Gemini), WhatsApp'tan gönderir.
4. Sonuç `users/{uid}/logs` altına yazılır; panel "Kayıtlar" sekmesinde canlı gösterir.

**Örnek 2 — WhatsApp bağlama (kod ile)**

1. Kullanıcı panelde telefon numarasını girip "Kod al" der → `commands` koleksiyonuna `requestPairingCode` komutu yazılır.
2. Motor komutu işler, temiz bir oturum açar, Baileys'ten eşleştirme kodu üretir → `waPairingCode` alanına yazar.
3. Panel kodu canlı gösterir; kullanıcı telefonuna girer; bağlantı kurulunca `waState = "open"` olur.

**Örnek 3 — AI otomatik yanıt**

1. Kullanıcı "AI Yanıt" sekmesinden açar → `users/{uid}` belgesine `autoReply` ayarı yazılır.
2. Motor gelen birebir mesajları dinler; cooldown ve "sadece kayıtlı kişiler" kurallarına göre Gemini'den yanıt üretip gönderir.

---

## Firestore veri modeli

```
users/{uid}
├── (alanlar)
│   ├── email
│   ├── engineHeartbeat      # motorun "çevrimiçi" göstergesi (her 45 sn yenilenir)
│   ├── waState              # connecting | qr | open | disconnected | logged_out
│   ├── waQr                 # QR görseli (data URL)
│   ├── waPairingPhone       # kod istenen numara
│   ├── waPairingCode        # üretilen eşleştirme kodu
│   ├── waPairingError       # kod/bağlantı hata mesajı
│   └── autoReply            # { enabled, persona, onlyContacts }
│
├── automations/{id}         # { name, contactIds[], time, days[], messageMode,
│                            #   messageText | aiPrompt, enabled, lastRunDate }
├── contacts/{id}            # { name, phone, jid, type: user|group, customName, source }
├── commands/{id}            # panel → motor komutları (işlenince silinir)
└── logs/{id}                # gönderim/işlem kayıtları
```

---

## Özellikler

- **Çok kullanıcılı:** Her kullanıcının ayrı WhatsApp oturumu, ayrı verisi. Motor tüm kullanıcıları aynı anda yönetir.
- **Zamanlanmış mesajlar:** Saat + haftanın günleri seçilir; sabit metin veya Gemini ile üretilen mesaj gönderilir. Aynı gün tekrar göndermeyi önleyen koruma vardır.
- **AI otomatik yanıt:** Gelen birebir mesajlara, belirlenen "karakter/üslup" (persona) ile Gemini yanıtı. Spam/döngü önleyici cooldown ve "sadece kayıtlı kişilere yanıt" seçeneği.
- **Kişi & grup yönetimi:** Bağlantı sonrası kişiler ve gruplar WhatsApp'tan otomatik çekilir; telefonda kayıtlı isimlerle gelir. Elle kişi eklenebilir, özel ad verilebilir.
- **İki bağlanma yöntemi:** QR kod veya telefon numarası + eşleştirme kodu (Android & iOS için adım adım rehber panelde).
- **Sağlam bağlantı yönetimi:** Üstel geri çekilme (backoff) + deneme limiti; boşta kalınca "Yeniden dene" ile elle tetikleme. Çift oturum çakışması ve sonsuz yeniden bağlanma döngüleri engellenir.
- **Tema:** Açık / Koyu / Sistem.
- **Responsive:** Tüm telefon boyutlarında (320–430px, dik + yatay) çalışır; mobilde soldan açılan çekmece (drawer) menü.

---

## WhatsApp bağlantısı (QR + kod)

Bağlantı `server/src/whatsapp.js` içinde Baileys ile yönetilir:

- **QR ile:** Motor QR üretir, panel gösterir, telefondan okutulur.
- **Kod ile:** Numara girilir, motor temiz bir oturumdan eşleştirme kodu üretir; telefonda **WhatsApp → Bağlı cihazlar → Cihaz bağla → Telefon numarasıyla bağla** ile girilir. Kod 2 dakika geçerlidir; yeni kod öncekini geçersiz kılar.

Dayanıklılık önlemleri:
- Geçici hatalarda **üstel backoff** (3s → 6s → … → 60s) ve **deneme limiti** (QR 6, bağlantı 8 deneme); sınır aşılınca boşta beklenir.
- Eşleştirme kodu hatası artık QR döngüsüne düşmez; net hata gösterilip beklenir.
- Başarılı bağlantıda sayaçlar sıfırlanır; `515 (restartRequired)` hızlı ve sayaca sayılmadan yeniden bağlanır.

---

## Kurulum

### 1) Firebase

1. Firebase projesi oluştur (mevcut: `whatsappotomasyon-5d7a5`).
2. **Authentication** → E-posta/Şifre ve Google sağlayıcılarını aç.
3. **Firestore** → veritabanını oluştur, [güvenlik kurallarını](#firestore-güvenlik-kuralları) yayınla.
4. Web uygulaması ekleyip yapılandırmayı `assets/firebase-config.js` içine koy (bu anahtarlar herkese açıktır, gizli değildir).
5. Motor için bir **servis hesabı** anahtarı indir → `server/service-account.json` (gizli, repoya konmaz).

### 2) Panel (Vercel)

- Repo Vercel'e bağlıdır; `main` dalına her push otomatik deploy edilir.
- `vercel.json`: çıktı dizini kök, `cleanUrls: true`, HTML ve `/assets` için `no-cache` başlıkları (değişiklikler telefonlara anında ulaşsın diye).
- Asset linkleri `?v=YYYYMMDD-N` sürüm parametresiyle cache-busting yapar.

### 3) Motor

```bash
cd server
npm install
cp .env.example .env      # değerleri doldur (aşağıya bak)
npm start                 # node src/index.js
```

- **Windows'ta otomatik başlatma:** `server/deploy/win/install-task.ps1` (Görev Zamanlayıcı; oturum açılınca gizli çalışır). Detay: `server/deploy/win/WINDOWS.md`.
- **Linux sunucu:** `server/deploy/whatsapp-otomasyon.service` (systemd). Detay: `server/deploy/DEPLOY.md` / `DEPLOY-gcp.md`.

> Motor **serverless'ta çalışmaz** — kalıcı WhatsApp oturumu ve disk (auth) gerektirir. Vercel yalnızca paneli barındırır.

---

## Firestore güvenlik kuralları

Firebase Console → Firestore → Rules:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      match /{document=**} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

Her kullanıcı yalnızca kendi `users/{uid}` verisine erişir; giriş yapmamış kimse hiçbir şeye erişemez.

---

## Güvenlik

- **XSS koruması:** Panelde `innerHTML`'e konan tüm dinamik değerler (kişi adı, otomasyon adı, telefon, log, mesaj) `esc()` ile HTML-escape edilir. Kişi adları WhatsApp `pushName`/`notify` ile saldırgan kontrollü olduğundan bu, kalıcı (stored) XSS'i önler.
- **Erişim izolasyonu:** Firestore kuralları her kullanıcıyı yalnızca kendi verisine kısıtlar; tüm erişim Firebase Auth kimliğine bağlıdır.
- **Girdi doğrulama:** Motor, eşleştirme komutundaki telefon numarasını katı regex ile doğrular.
- **Sırlar:** `service-account.json` ve `.env` (Gemini anahtarı) `.gitignore` ile dışlanır. `firebase-config.js` anahtarları public web anahtarlarıdır (gizli değildir).
- **HTTP güvenlik başlıkları (Vercel `headers`):** `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`.

---

## Ortam değişkenleri

`server/.env` (`server/src/config.js` okur):

| Değişken | Açıklama | Varsayılan |
|---|---|---|
| `GOOGLE_CLOUD_PROJECT` | Firebase proje kimliği | — |
| `GOOGLE_APPLICATION_CREDENTIALS` | `service-account.json` yoksa ADC yolu | — |
| `GEMINI_API_KEY` | Gemini API anahtarı (AI özellikleri için) | — |
| `GEMINI_MODEL` | Kullanılacak Gemini modeli | `gemini-2.5-flash` |
| `DEFAULT_TIMEZONE` | Zamanlama saat dilimi | `Europe/Istanbul` |
| `WA_AUTH_DIR` | WhatsApp oturum dosyaları dizini | `./auth_info` |

`.env` ve `service-account.json` gizlidir; `.gitignore` ile dışlanır.

---

## Komutlar (panel → motor)

Panel `users/{uid}/commands` koleksiyonuna belge yazar; motor işleyip belgeyi siler (`server/src/index.js`):

| Komut | İşlev |
|---|---|
| `requestPairingCode` (+ `phone`) | Telefon numarasıyla eşleştirme kodu üretir |
| `reconnectWhatsApp` | Boşta kalan oturumu yeniden başlatır (QR/kod tetikler) |
| `disconnectWhatsApp` | Oturumu kapatır, verileri sıfırlar, yeni QR'a hazırlar |
| `syncContacts` | Kişi/grup listesini WhatsApp'tan yeniden çeker |
| `runNow` (+ `automationId`) | Bir otomasyonu hemen çalıştırır |

---

## Mobil / responsive

- **Kırılma noktaları:** `≤720px` (telefon düzeni) ve `≤420px` (dar telefon); ayrıca yatay (landscape, kısa yükseklik) telefonlar.
- **Menü:** Mobilde sol menü, hamburger (☰) ile **soldan açılan çekmece (drawer)** olur; karartma katmanı, ESC/arka plan tıklaması veya sekme seçimi kapatır.
- **iOS Safari uyumu:** Panel mobilde iç-scroll yerine **normal sayfa akışında** kayar (iç içe flex + `100dvh` + `overflow:auto` kalıbı iOS'ta paneli bozuyordu). `100dvh` için `100vh` yedeği vardır.
- **Çentik desteği:** `env(safe-area-inset-*)` ile üst bar, çekmece ve kenarlar çentiğin altına girmez.
- **Güvenlik:** `overflow-x: hidden`, `img/svg { max-width:100% }`, uzun kelime sarması; 320–430px arası tüm sekmelerde yatay taşma yoktur.

---

## Sık karşılaşılan sorunlar

| Belirti | Olası sebep / çözüm |
|---|---|
| "Sürekli internet hatası" | Eski sürümde Firestore long-polling zorlanıyordu; artık auto-detect + geçici hata toast'ları susturuldu. Telefonda cache temizle / sekmeyi kapat-aç. |
| Mobilde tasarım bozuk görünüyor | Tarayıcı eski CSS'i cache'lemiş olabilir. Sürüm parametresi (`?v=`) + Vercel no-cache ile çözülür; temiz açılışta düzelir. |
| "Motor çevrimdışı" | `engineHeartbeat` 3 dakikadan eski. Motoru (bilgisayar/sunucu) başlat. |
| Eşleştirme kodu kabul edilmiyor | Kod tek kullanımlıktır ve 2 dakika geçerlidir. Yeni kod alıp **en son** kodu gir; art arda kod üretme engellidir. |
| Bağlantı boşta kaldı | Deneme limiti dolmuş olabilir. Panelde **"Yeniden dene / QR oluştur"** butonuna bas. |
| AI mesaj/yanıt çalışmıyor | `GEMINI_API_KEY` motorun `.env` dosyasında tanımlı olmalı. |

---

> Bu proje kişisel kullanım/otomasyon amaçlıdır. WhatsApp'ın resmî olmayan Web API'sini (Baileys) kullanır; WhatsApp kullanım koşullarına ve ilgili gizlilik/izin kurallarına uygun kullanılmalıdır.
