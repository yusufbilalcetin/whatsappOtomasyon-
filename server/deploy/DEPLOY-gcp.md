# Google Cloud "Always Free" VM'de 7/24 çalıştırma

Bilgisayarını/siteyi kapatsan bile WhatsApp'ın **bağlı kalması** için motor sürekli
açık bir sunucuda çalışmalı. Google Cloud'un **Always Free** e2-micro sunucusu bunun
için ücretsiz ve kalıcıdır. Zaten Firebase (Google) hesabın var.

> Motor yalnızca **dışa** bağlanır (WhatsApp + Firestore). İçeri port açmaz, bu yüzden
> **firewall/port ayarı gerekmez.** Panel Vercel'de; sunucuda web sunucusu yoktur.

---

## 1. Ücretsiz VM oluştur
[console.cloud.google.com](https://console.cloud.google.com) → üstte projeyi seç (veya
yeni proje) → **Compute Engine → VM instances → Create instance**.

- **Name:** `whatsapp-motor` (fark etmez)
- **Region:** Always Free için **mutlaka** şu üçünden biri:
  `us-west1` (Oregon), `us-central1` (Iowa) veya `us-east1` (S. Carolina)
- **Machine type:** **e2-micro** (Always Free kapsamı)
- **Boot disk:** **Ubuntu 22.04 LTS**, boyut **30 GB Standard** (ücretsiz sınır)
- **Firewall:** "Allow HTTP/HTTPS" işaretlemene **gerek yok**
- **Create** de.

> İlk kez Compute Engine açıyorsan faturalandırma hesabı (kart) ister; e2-micro
> Always Free sınırında kalırsan **ücret çıkmaz**. Bütçe alarmı koyabilirsin.

## 2. Sunucuya bağlan
VM listesinde satırın sağındaki **SSH** düğmesine tıkla → tarayıcıda terminal açılır
(anahtar/parola uğraşı yok).

## 3. Kodu sunucuya al
```bash
sudo apt-get update && sudo apt-get install -y git
git clone <REPO_URL> whatsapp-otomasyon
cd whatsapp-otomasyon/server
```
Repo yoksa: kendi bilgisayarından `server/` klasörünü `scp -r` ile kopyala.

## 4. Gizli dosyaları ekle
```bash
nano service-account.json   # Firebase servis hesabı JSON'unu yapıştır, Ctrl+O, Ctrl+X
cp .env.example .env
nano .env                   # GEMINI_API_KEY vb. doldur, kaydet
```
- `service-account.json`: Firebase Console → ⚙️ → Service accounts → Generate new private key.
- Bu iki dosya `.gitignore`'da; git'e gitmez.

## 5. Tek komutla kur
```bash
bash deploy/setup.sh
```
Node 20'yi kurar, bağımlılıkları yükler, systemd servisini oluşturur, başlatır.
Motor çökse de / VM yeniden açılsa da **kendi başlar.**

## 6. QR okut
```bash
journalctl -u whatsapp-otomasyon -f
```
Logda (ve panelde) QR çıkar. Telefon → WhatsApp → **Bağlı cihazlar → Cihaz bağla**.
Oturum `auth_info/`'da diskte kalır; **bir daha QR gerekmez.** (`Ctrl+C` ile log izlemeden çık.)

## 7. Telefondan yönet
Vercel panelini telefondan aç, giriş yap. Motor VM'de çalıştığı için bilgisayarın
kapalıyken de WhatsApp bağlı kalır; her şeyi panelden yönetirsin.

---

## Faydalı komutlar
```bash
sudo systemctl status whatsapp-otomasyon     # durum
sudo systemctl restart whatsapp-otomasyon    # yeniden başlat
journalctl -u whatsapp-otomasyon -f          # canlı log / QR
```

## ⚠️ Tek yerde çalıştır
VM'ye geçince kendi bilgisayarındaki `npm start`'ı **kapat**. Aynı `auth_info` ile iki
yerde çalışırsa WhatsApp çakışır (sürekli kopma).
