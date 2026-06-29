import { logger } from './logger.js';
import {
  watchUsers, watchAutomations, watchCommands, watchUserDoc,
  deleteCommand, getAutomation, writeHeartbeat, upsertContacts,
} from './firestore.js';
import {
  startWhatsAppFor, stopWhatsAppFor, resetWhatsAppFor, resyncContactsFor,
  requestPairingCodeFor, reconnectWhatsAppFor, setIncomingHandler, setContactsHandler,
} from './whatsapp.js';
import { reloadSchedulesFor, stopSchedulesFor, runNow } from './scheduler.js';
import { handleIncoming, setAutoReplyConfig, clearAutoReplyConfig } from './autoreply.js';

const BEAT_MS = 45_000;

// Cok kullanicili motor: her kullanici icin ayri WhatsApp oturumu + zamanlayici.
// Panel (Vercel) users/{uid}/... yazar; motor okur ve gonderir.
const active = new Map(); // uid -> { unsubAutomations, unsubCommands, unsubUserDoc }

async function handleCommand(uid, cmd) {
  try {
    if (cmd.type === 'runNow' && cmd.automationId) {
      const automation = await getAutomation(uid, cmd.automationId);
      if (automation) await runNow(uid, automation);
    } else if (cmd.type === 'disconnectWhatsApp') {
      await resetWhatsAppFor(uid);
    } else if (cmd.type === 'syncContacts') {
      await resyncContactsFor(uid);
    } else if (cmd.type === 'requestPairingCode' && cmd.phone) {
      await requestPairingCodeFor(uid, cmd.phone);
    } else if (cmd.type === 'reconnectWhatsApp') {
      await reconnectWhatsAppFor(uid);
    }
  } catch (e) {
    logger.error({ uid, err: e.message }, 'Komut calistirilamadi.');
  } finally {
    deleteCommand(uid, cmd.id).catch(() => {});
  }
}

async function addUser(uid) {
  if (active.has(uid)) return;
  active.set(uid, {}); // tekrar girisi ANINDA engelle (async bosluk yarisini onler)
  logger.info({ uid }, 'Kullanici eklendi, baglaniliyor.');
  await writeHeartbeat(uid); // panelin "motor cevrimici" gostergesi hemen yansisin
  await startWhatsAppFor(uid);
  await reloadSchedulesFor(uid);

  const unsubAutomations = watchAutomations(uid, () => {
    reloadSchedulesFor(uid).catch((e) => logger.error(e, 'Zamanlama yenileme hatasi.'));
  });
  const unsubCommands = watchCommands(uid, (cmd) => handleCommand(uid, cmd));
  const unsubUserDoc = watchUserDoc(uid, (data) => setAutoReplyConfig(uid, data.autoReply));

  active.set(uid, { unsubAutomations, unsubCommands, unsubUserDoc });
}

function removeUser(uid) {
  const entry = active.get(uid);
  if (!entry) return;
  logger.info({ uid }, 'Kullanici kaldirildi.');
  entry.unsubAutomations?.();
  entry.unsubCommands?.();
  entry.unsubUserDoc?.();
  clearAutoReplyConfig(uid);
  stopSchedulesFor(uid);
  stopWhatsAppFor(uid);
  active.delete(uid);
}

function main() {
  setIncomingHandler(handleIncoming); // AI otomatik-yanit
  setContactsHandler(upsertContacts); // WhatsApp kisi/grup senkronu

  watchUsers((uids) => {
    const set = new Set(uids);
    for (const uid of uids) addUser(uid).catch((e) => logger.error(e, 'Kullanici eklenemedi.'));
    for (const uid of [...active.keys()]) if (!set.has(uid)) removeUser(uid);
  });

  const beat = () => {
    for (const uid of active.keys()) writeHeartbeat(uid).catch(() => {});
  };
  setInterval(beat, BEAT_MS);

  logger.info('Cok kullanicili motor calisiyor.');
}

main();
