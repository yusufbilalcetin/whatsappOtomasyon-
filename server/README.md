# WhatsApp Otomasyon — Bulut Sunucu

Bilgisayar kapaliyken 7/24 calisan, cok sayida zamanli otomasyon kurabilen
WhatsApp mesaj servisi. Gonderim **Baileys** (kendi numaran) ile, veri
**Firebase Firestore**, mesaj uretimi (opsiyonel) **Gemini** ile yapilir.

## Mimari
```
Node servis (bu klasor)
 ├─ Baileys     → WhatsApp gonderim (QR bir kez okutulur, oturum auth_info/'da kalir)
 ├─ node-cron   → her otomasyon icin ayri job (cakisma yok)
 ├─ Gemini      → 'ai' modlu otomasyonlarda mesaj uretimi
 └─ Express     → /api + public/ yonetim paneli (telefondan da girilir)
Firestore       → contacts, messages, automations, logs, settings
```

## Kurulum (Oracle Cloud Always Free VM — ucretsiz)

1. **Firebase**: Console'da proje > Firestore baslat > Project Settings >
   Service accounts > "Generate new private key". Inen dosyayi
   `service-account.json` adiyla bu klasore koy.
2. **Gemini**: https://aistudio.google.com/app/apikey adresinden ucretsiz anahtar al.
3. `.env.example` dosyasini `.env` olarak kopyala, `GEMINI_API_KEY` gir.
4. Bagimliliklar ve baslatma:
   ```bash
   npm install
   npm start
   ```
5. Ilk calistirmada loglarda QR cikar (panelde de gorunur). Telefonda
   WhatsApp > Bagli cihazlar > Cihaz bagla ile okut. Oturum `auth_info/`'da
   kalir; bir daha QR gerekmez.
6. Tarayicidan panel: `http://SUNUCU_IP:3000`
7. 7/24 calismasi icin systemd: bkz. `deploy/whatsapp-otomasyon.service`.

> **Bedava 7/24 sunucu (onerilen):** Google Cloud "Always Free" e2-micro VM —
> adim adim: `deploy/DEPLOY-gcp.md`. Genel/Oracle/VPS icin: `deploy/DEPLOY.md`.
> Kurulum tek komut: `bash deploy/setup.sh`.

## Eski Python verisini tasima (opsiyonel)
```bash
npm i better-sqlite3
node scripts/migrate-sqlite.js "<AppData>/Roaming/MesajBotu/app.db"
```

## AI Otomatik-Yanit
Panelde "AI Yanit" sekmesi vardir ancak **su an pasiftir** (buton devre disi).
Gelen mesaja otomatik cevap motoru ileride eklenecek.

## Notlar
- Baileys resmi olmayan bir yoldur; asiri/spam kullanimda numara engellenebilir.
- Firestore, Gemini ve Oracle VM ucretsiz katmanlari bu kullanim icin yeterlidir.
