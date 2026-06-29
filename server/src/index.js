import { logger } from './logger.js';
import { watchUsers, watchAutomations, writeHeartbeat } from './firestore.js';
import { startWhatsAppFor, stopWhatsAppFor } from './whatsapp.js';
import { reloadSchedulesFor, stopSchedulesFor } from './scheduler.js';

// Cok kullanicili motor: her kullanici icin ayri WhatsApp oturumu + zamanlayici.
// Panel (Vercel) users/{uid}/... yazar; motor okur ve gonderir.
const active = new Map(); // uid -> { unsubAutomations }

async function addUser(uid) {
  if (active.has(uid)) return;
  logger.info({ uid }, 'Kullanici eklendi, baglaniliyor.');
  await startWhatsAppFor(uid);
  await reloadSchedulesFor(uid);
  const unsubAutomations = watchAutomations(uid, () => {
    reloadSchedulesFor(uid).catch((e) => logger.error(e, 'Zamanlama yenileme hatasi.'));
  });
  active.set(uid, { unsubAutomations });
}

function removeUser(uid) {
  const entry = active.get(uid);
  if (!entry) return;
  logger.info({ uid }, 'Kullanici kaldirildi.');
  entry.unsubAutomations?.();
  stopSchedulesFor(uid);
  stopWhatsAppFor(uid);
  active.delete(uid);
}

function main() {
  // Kullanici listesi degistikce baglantilari ekle/kaldir.
  watchUsers((uids) => {
    const set = new Set(uids);
    for (const uid of uids) addUser(uid).catch((e) => logger.error(e, 'Kullanici eklenemedi.'));
    for (const uid of [...active.keys()]) if (!set.has(uid)) removeUser(uid);
  });

  // Tum aktif kullanicilar icin kalp atisi (panel "motor cevrimici" rozeti).
  const beat = () => {
    for (const uid of active.keys()) writeHeartbeat(uid).catch(() => {});
  };
  setInterval(beat, 60_000);

  logger.info('Cok kullanicili motor calisiyor.');
}

main();
