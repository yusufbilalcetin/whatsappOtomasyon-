import { logger } from './logger.js';
import { ensureSeed, writeHeartbeat, watchAutomations } from './firestore.js';
import { startWhatsApp } from './whatsapp.js';
import { reloadSchedules } from './scheduler.js';

// Motor: WhatsApp baglantisi + zamanlayici. Panel ayri (Vercel) calisir;
// ikisi Firestore uzerinden konusur.
async function main() {
  await ensureSeed();
  await startWhatsApp();
  await reloadSchedules();

  // Panelden otomasyon degisince zamanlamalari yeniden kur.
  watchAutomations(() => {
    reloadSchedules().catch((e) => logger.error(e, 'Zamanlama yenileme hatasi.'));
  });

  // Panelin "motor cevrimici" rozetini beslemek icin kalp atisi.
  const beat = () => writeHeartbeat().catch((e) => logger.warn(e, 'Heartbeat yazilamadi.'));
  beat();
  setInterval(beat, 60_000);

  logger.info('Motor calisiyor. WhatsApp QR bekleniyor (ilk kurulumda).');
}

main().catch((err) => {
  logger.error(err, 'Baslatma hatasi.');
  process.exit(1);
});
