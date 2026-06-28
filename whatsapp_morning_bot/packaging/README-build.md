# Mesaj Botu — Derleme ve Installer Oluşturma

Son kullanıcının **Python veya Chrome kurmasına gerek kalmadan** çift tıkla kurabileceği bir
Windows kurulum dosyası (`MesajBotu-Setup-x.y.z.exe`) üretmek için adımlar.

## 1. Ortamı hazırla

```powershell
cd whatsapp_morning_bot
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements-dev.txt
```

Mesaj, kullanıcının kendi WhatsApp Desktop uygulaması veya varsayılan tarayıcısındaki WhatsApp Web
üzerinden gönderildiği için pakete tarayıcı gömülmez — paket küçüktür.

## 2. PyInstaller ile exe paketle

```powershell
pyinstaller packaging/MesajBotu.spec
```

Çıktı: `dist\MesajBotu\MesajBotu.exe` (yanında bağımlılıklar).

Hızlı doğrulama: `dist\MesajBotu\MesajBotu.exe` dosyasını çift tıkla; pencere açılmalı, "Web'i Aç"
ile WhatsApp uygulaması ya da varsayılan tarayıcıda WhatsApp Web açılmalı.

## 3. Inno Setup ile installer üret

- [Inno Setup 6](https://jrsoftware.org/isdl.php) kurulu olmalı.
- `packaging/installer.iss` dosyasını Inno Setup Compiler'da aç ve **Compile** et,
  veya komut satırından:

```powershell
& "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" packaging\installer.iss
```

Çıktı: `packaging\installer\MesajBotu-Setup-1.0.0.exe` — dağıtılabilir kurulum dosyası.

## Notlar

- Uygulama `Program Files\Mesaj Botu` altına kurulur; veritabanı/log/WhatsApp oturum profili
  yazılabilir `%APPDATA%\MesajBotu` klasöründe tutulur.
- Sürüm numarasını `packaging/installer.iss` içindeki `AppVersion` ile güncelle.
- Antivirüs PyInstaller exe'lerini bazen yanlış işaretleyebilir; gerekirse kod imzalama (signing)
  sertifikası kullan.
