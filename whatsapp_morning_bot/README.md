# Mesaj Botu

Windows için CustomTkinter ile geliştirilmiş WhatsApp günlük mesaj otomasyonu masaüstü uygulaması.
Mesajı kullanıcının **kendi WhatsApp Desktop uygulaması** veya **varsayılan tarayıcısındaki WhatsApp
Web** üzerinden gönderir. Apple tarzı kaydırmalı saat seçici ve dağıtılabilir kurulum sihirbazı
(.exe) ile gelir.

Uygulama yalnızca kullanıcının kendi WhatsApp Web oturumu ile, açıkça eklenip seçilen kişilere
mesaj göndermek için tasarlanmıştır. Toplu mesaj, rastgele numara veya izinsiz gönderim içermez.

## Son kullanıcı için (kurulum dosyası)

Hazır `MesajBotu-Setup-x.y.z.exe` dosyasını çift tıklayıp kurun. **Python veya Chrome kurmanıza
gerek yoktur** — gerekli her şey installer ile gelir. Kurduktan sonra:

1. Sol panelden bir kişi ekleyin (`+905xxxxxxxxx` veya `+49xxxxxxxxx` gibi uluslararası format).
2. `Web'i Aç` ile açılan pencerede QR kodu telefonunuzdan **WhatsApp > Bağlı Cihazlar** ile okutun.
3. Mesajınızı yazın, saati kaydırmalı seçiciyle ayarlayın, `Mesajı Gönder` ile test edin.
4. Çalışıyorsa `Otomasyonu Başlat`.

Verileriniz (kişiler, ayarlar, log, WhatsApp oturumu) `%APPDATA%\MesajBotu` klasöründe tutulur.

## Geliştirici kurulumu

Python 3.11+ gerekir.

```powershell
cd whatsapp_morning_bot
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python -m playwright install chromium
python app.py
```

### Testler

```powershell
pip install -r requirements-dev.txt
pytest
```

### Dağıtılabilir installer üretme

`packaging/README-build.md` dosyasındaki adımları izleyin (PyInstaller + Inno Setup).

## Arayüz

Ana ekran üç panelden oluşur:

- **Kişiler** (sol): Ad ve uluslararası telefon numarası. `0` ile başlayan TR numaraları otomatik
  `+90`'a çevrilir.
- **Mesaj** (orta): Mesaj metni (en fazla 1000 karakter), Apple tarzı kaydırmalı saat seçici ve
  `Mesajı Gönder`.
- **Otomasyon** (sağ): Durum, istatistikler, başlat/durdur ve Windows görev butonları.

Test gönderimleri loglara `Test Başarılı`/`Test Hata`; zamanlanmış gönderimler
`Otomatik Başarılı`/`Otomatik Hata` veya aynı gün tekrarında `Atlandı` olarak yazılır.

## Gönderim nasıl çalışır?

Mesaj kullanıcının kendi WhatsApp'ı üzerinden gönderilir:

1. **WhatsApp Desktop uygulaması kuruluysa** → `whatsapp://` ile uygulamada sohbet açılır.
2. **Kurulu değilse** → WhatsApp Web, bilgisayarın **varsayılan tarayıcısında** (kendi profilin,
   normal sekme — gizli/incognito değil) açılır.

Sohbet açılıp mesaj yazıldıktan sonra uygulama klavyeyi taklit ederek **Enter'a basıp otomatik
gönderir** (`WHATSAPP_AUTO_SEND=false` ile kapatılabilir; o zaman gönderme tuşuna siz basarsınız).

> Önemli: Otomatik gönderim, açılan WhatsApp penceresinin önde ve ekranın açık (kilitsiz) olmasını
> gerektirir. Zamanlanmış gönderimde bilgisayar uyanık olmalı ve WhatsApp'a giriş yapılmış olmalıdır.

## Otomatik Yanıt (AI) — ayrı kategori

Üstteki **Otomatik Yanıt** sekmesi, gelen WhatsApp mesajlarını izleyip **senin üslubunla** Claude
ile cevaplar üretir.

> ⚠️ **Yasaklama riski:** Otomatik okuma/yanıt WhatsApp Hizmet Şartları'na aykırıdır ve numaran
> **yasaklanabilir.** Tercihen ikincil bir numarayla kullan. Sorumluluk sana aittir.

Nasıl çalışır:
- **Kapsam**: *Seçili kişiler* (beyaz liste) veya *Tüm gelen mesajlar*.
- **Gönderim**: *Önce öner/onayla* (taslak kuyruğa düşer, sen onaylarsın) veya *Tam otomatik*.
- **Yapay zeka**: Claude API anahtarı gerekir (kullanım başına ücretlidir). Anahtarı sayfaya gir
  veya `ANTHROPIC_API_KEY` ortam değişkenini kullan. Model seçilebilir (varsayılan
  `claude-opus-4-8`; daha ucuz için `claude-sonnet-4-6`/`claude-haiku-4-5`).
- **Üslup**: "Üslubun/talimatın" kutusu + örnek mesajların (her satıra bir) modele stil olarak verilir.

Kullanım:
1. İlk seferde **"Yanıt motorunu kur"** ile gönderim tarayıcısını (Chromium) bir kez indir.
2. API anahtarı, kapsam, gönderim modu ve üslubunu ayarlayıp **"Ayarları Kaydet"**.
3. **"Başlat"** → açılan pencerede QR okut. Yeni mesajlar izlenir; onay modunda taslaklar kuyruğa
   düşer, **Gönder** ile yollarsın. **"Durdur"** ile temiz durur.

Bu özellik, izleme için sürekli açık ayrı bir WhatsApp Web oturumu (kendi QR'ı) kullanır; günlük
mesaj akışından bağımsızdır. Gelen/giden mesajlar yanıt üretimi için Claude API'ye gönderilir.

## Windows Görev Zamanlayıcı

Uygulama kapalıyken de günlük deneme için `Görevi Kaydet` butonunu kullanın. Görev, seçili kişi ve
ayarlarla uygulamayı `--send-now` parametresiyle çalıştırır (paketlenmiş kurulumda doğrudan exe'yi
çağırır). `Otomasyonu Durdur` seçilirse görev çalışsa bile mesaj gönderilmez.

## Opsiyonel .env ayarları

`.env.example` dosyasını `.env` olarak kopyalayabilirsiniz:

```env
WHATSAPP_AUTO_SEND=true
WHATSAPP_APP_SEND_WAIT=8
WHATSAPP_WEB_SEND_WAIT=15
WHATSAPP_ENTER_PRESSES=1
WHATSAPP_FORCE_WEB=false
WHATSAPP_TIMEZONE=Europe/Istanbul
WINDOWS_TASK_NAME=WhatsAppMorningBot
# MESAJBOTU_DATA_DIR=
```

`WHATSAPP_AUTO_SEND` otomatik Enter'ı açar/kapatır. `WHATSAPP_APP_SEND_WAIT` /
`WHATSAPP_WEB_SEND_WAIT`, sohbet yüklendikten sonra Enter'a basmadan önce beklenecek saniyedir
(internet/sistem yavaşsa artırın). `WHATSAPP_FORCE_WEB=true`, WhatsApp Desktop kurulu olsa bile her
zaman web kullanmaya zorlar. `WHATSAPP_TIMEZONE` zamanlayıcının saat dilimi (geçersizse
`Europe/Istanbul`). Loglar `%APPDATA%\MesajBotu\app.log` dosyasına yazılır.

## Güvenli kullanım notu

- Yalnızca kendi WhatsApp hesabınızla ve izinli kişilere gönderim yapın.
- Toplu mesaj, spam veya izinsiz gönderim amacıyla kullanmayın.
- Uygulama kayıtlı ve seçili kişi olmadan otomatik gönderim yapmaz.
- Aynı gün aynı kişiye ikinci otomatik başarılı gönderim yapılmaz.
- Tüm denemeler SQLite log tablosuna ve log dosyasına yazılır.
