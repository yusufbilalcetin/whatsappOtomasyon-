# Motoru 7/24 sunucuda çalıştırma

Bilgisayarını/siteyi kapatsan bile WhatsApp'ın **bağlı kalması** için motorun
sürekli açık bir sunucuda çalışması gerekir. Site (panel) sadece bir kontrol
ekranıdır; telefondan açıp sistemi yönetirsin ama bağlantıyı sunucu tutar.

## 1. Sunucu edin
Önerilen: **Oracle Cloud Always Free** (ücretsiz). Alternatif: Hetzner / DigitalOcean
küçük VPS (~€4–5/ay, daha kolay). İşletim sistemi: **Ubuntu 22.04+**.

> Railway/Render ücretsiz katmanları **önerilmez**: uyur ve kalıcı disk yoktur,
> bu yüzden WhatsApp oturumu (`auth_info/`) kaybolur ve sürekli QR ister.

## 2. Projeyi sunucuya koy
SSH ile bağlan, sonra:
```bash
git clone <repo-url> whatsapp-otomasyon
cd whatsapp-otomasyon/server
```
(Repo yoksa: bilgisayarından `scp -r` ile `server/` klasörünü kopyala.)

## 3. Gerekli dosyaları ekle
- `server/service-account.json` — Firebase servis hesabı anahtarı
  (Firebase Console → ⚙️ → Service accounts → Generate new private key).
- `server/.env` — `.env.example`'i kopyala, `GEMINI_API_KEY` vb. doldur.

## 4. Tek komutla kur
```bash
bash deploy/setup.sh
```
Bu; Node 20'yi kurar, bağımlılıkları yükler, systemd servisini bu makineye göre
oluşturur, etkinleştirir ve başlatır (çökse de otomatik yeniden başlar, sunucu
yeniden açılınca da kendi başlar).

## 5. QR okut
```bash
journalctl -u whatsapp-otomasyon -f
```
Logda (ve panelde) QR çıkar. Telefon → WhatsApp → Bağlı cihazlar → Cihaz bağla.
Oturum `auth_info/`'da kalır; **bir daha QR gerekmez.**

## 6. Telefondan yönet
Siteyi (Vercel paneli) telefondan aç, giriş yap. Motor sunucuda çalıştığı için
bilgisayarın kapalı olsa da WhatsApp bağlı kalır; her şeyi panelden yönetirsin.

## Faydalı komutlar
```bash
sudo systemctl status whatsapp-otomasyon     # durum
sudo systemctl restart whatsapp-otomasyon    # yeniden başlat
journalctl -u whatsapp-otomasyon -f          # canlı log / QR
```

> Not: Motoru **yalnızca tek bir yerde** çalıştır. Hem sunucuda hem kendi
> bilgisayarında aynı `auth_info` ile çalıştırırsan WhatsApp çakışır (sürekli
> kopma). Sunucuya geçince bilgisayardaki `npm start`'ı kapat.
