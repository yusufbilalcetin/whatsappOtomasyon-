# WhatsApp motorunu Windows oturum acilisinda otomatik baslatan gorev olusturur.
# Calistirma:  powershell -ExecutionPolicy Bypass -File deploy\win\install-task.ps1
# (server/ dizininden veya tam yolla)

$ErrorActionPreference = 'Stop'
$taskName = 'WhatsAppMotor'
$vbs = Join-Path $PSScriptRoot 'start-hidden.vbs'

if (-not (Test-Path $vbs)) {
  Write-Host "HATA: start-hidden.vbs bulunamadi: $vbs" -ForegroundColor Red
  exit 1
}

# Onkosul uyarilari
$serverDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$adcPath = Join-Path $env:APPDATA 'gcloud\application_default_credentials.json'
if (-not (Test-Path (Join-Path $serverDir 'service-account.json')) -and -not (Test-Path $adcPath)) {
  Write-Host "UYARI: Ne service-account.json ne de gcloud ADC bulundu. Motor Firestore'a baglanamayabilir." -ForegroundColor Yellow
  Write-Host "  Cozum: 'gcloud auth application-default login' veya service-account.json ekle." -ForegroundColor Yellow
}
if (-not (Test-Path (Join-Path $serverDir '.env'))) {
  Write-Host "UYARI: $serverDir\.env YOK. .env.example'i kopyalayip doldur." -ForegroundColor Yellow
}

$action  = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $vbs)
$trigger = New-ScheduledTaskTrigger -AtLogOn
# Pil/guc kisitlamasi olmadan, suresiz calissin
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)

# Varsa eski gorevi kaldir
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'WhatsApp Otomasyon motorunu arka planda calistirir' | Out-Null

Write-Host "OK: '$taskName' gorevi kuruldu (oturum acilisinda otomatik baslar)." -ForegroundColor Green
Write-Host "Hemen baslatmak icin: Start-ScheduledTask -TaskName $taskName" -ForegroundColor Cyan

# Hemen baslat
Start-ScheduledTask -TaskName $taskName
Write-Host "Motor simdi baslatildi. Kontrol: Task Manager > Details > node.exe" -ForegroundColor Green
