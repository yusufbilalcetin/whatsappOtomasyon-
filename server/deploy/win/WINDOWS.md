# Motoru Windows'ta 7/24 arka planda çalıştırma

Motor bu bilgisayarda, açılışta otomatik başlayıp arka planda çalışır; çökerse kendini
yeniden başlatır. **Bilgisayar açık kaldığı sürece** WhatsApp bağlı kalır. Siteyi/tarayıcıyı
kapatıp telefondan yönetebilirsin.

> Bilgisayarı kapatır veya uyku moduna alırsan motor durur ve WhatsApp kopar. Bu yöntemin
> doğası budur (bedava + kartsız + tek cihaz).

## Önkoşullar
1. `server\.env` dolu (var).
2. **`server\service-account.json`** — yeni Firebase projesi (`whatsappotomasyon-5d7a5`) için
   gerekli. Firebase Console → ⚙️ Project Settings → **Service accounts** →
   **Generate new private key** → inen dosyayı `server\service-account.json` olarak kaydet.
   Bu olmadan motor Firestore'a bağlanamaz.

## Kurulum (tek komut)
PowerShell aç, `server` klasörüne gel ve çalıştır:
```powershell
powershell -ExecutionPolicy Bypass -File deploy\win\install-task.ps1
```
Bu; `WhatsAppMotor` adlı bir Görev Zamanlayıcı görevi oluşturur (oturum açılışında
otomatik başlar), gizli pencerede çalıştırır ve hemen başlatır.

## Uyku/kapanmayı engelle (önemli)
Motorun durmaması için bilgisayar uyumamalı:
- **Ayarlar → Sistem → Güç ve pil → Ekran ve uyku** → "Uyku" sürelerini **Hiçbir zaman** yap.
- **Dizüstüyse:** Denetim Masası → Güç Seçenekleri → "Kapağı kapattığımda" → **Hiçbir şey yapma**.

## Doğrulama
1. **Görev Yöneticisi → Ayrıntılar**'da `node.exe` görünür (pencere yok).
2. Panelde (telefondan/tarayıcıdan) "Motor çevrimiçi" yazar.
3. Tarayıcıyı kapat → motor çalışmaya devam eder; telefondan yönet.
4. Test: Görev Yöneticisi'nden `node.exe`'yi bitir → ~5 sn içinde yeniden başlar.
5. Bilgisayarı yeniden başlat + oturum aç → motor kendiliğinden başlar.

## Yönetim komutları
```powershell
Start-ScheduledTask  -TaskName WhatsAppMotor      # baslat
Stop-ScheduledTask   -TaskName WhatsAppMotor      # durdur (gorev), node'u Task Manager'dan kapat
powershell -ExecutionPolicy Bypass -File deploy\win\uninstall-task.ps1   # tamamen kaldir
```

## Manuel kurulum (yedek — script çalışmazsa)
Görev Zamanlayıcı (Task Scheduler) → **Görev Oluştur**:
- **Genel:** Ad `WhatsAppMotor`.
- **Tetikleyiciler → Yeni:** "Oturum açıldığında".
- **Eylemler → Yeni:** Program `wscript.exe`, Bağımsız değişken:
  `"<TAM_YOL>\server\deploy\win\start-hidden.vbs"`
- **Koşullar:** "Yalnızca AC gücünde çalıştır" işaretini **kaldır**.
- Kaydet.

## ⚠️ Tek kopya çalıştır
Daha önce elle `npm start` açtıysan o pencereyi **kapat**. Aynı `auth_info` ile iki kopya
çalışırsa WhatsApp çakışır (sürekli kopma).
