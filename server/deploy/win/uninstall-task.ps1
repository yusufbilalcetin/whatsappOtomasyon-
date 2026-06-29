# WhatsApp motoru otomatik-baslatma gorevini kaldirir.
# Calistirma:  powershell -ExecutionPolicy Bypass -File deploy\win\uninstall-task.ps1
$taskName = 'WhatsAppMotor'
try {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction Stop
  Write-Host "OK: '$taskName' gorevi kaldirildi." -ForegroundColor Green
} catch {
  Write-Host "Gorev zaten yok veya kaldirilamadi: $($_.Exception.Message)" -ForegroundColor Yellow
}
Write-Host "Not: Calisan node.exe surecini Task Manager'dan elle bitirebilirsin." -ForegroundColor Cyan
