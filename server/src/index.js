import { config } from './config.js';
import { logger } from './logger.js';
import { ensureSeed } from './firestore.js';
import { startWhatsApp } from './whatsapp.js';
import { reloadSchedules } from './scheduler.js';
import { createApp } from './api.js';

async function main() {
  await ensureSeed();
  await startWhatsApp();
  await reloadSchedules();

  const app = createApp();
  app.listen(config.port, () => {
    logger.info(`Panel ve API hazir: http://localhost:${config.port}`);
  });
}

main().catch((err) => {
  logger.error(err, 'Baslatma hatasi.');
  process.exit(1);
});
