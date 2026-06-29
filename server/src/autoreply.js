import { logger } from './logger.js';
import { listContactPhones, addLog } from './firestore.js';
import { sendRawTo, normalizePhone } from './whatsapp.js';
import { generateReply } from './gemini.js';

// uid -> autoReply config ({ enabled, persona, onlyContacts })
const configs = new Map();
export function setAutoReplyConfig(uid, cfg) {
  configs.set(uid, cfg || {});
}
export function clearAutoReplyConfig(uid) {
  configs.delete(uid);
}

// Cevap dongusunu/spam'i onlemek icin sohbet basina bekleme (ms).
const COOLDOWN_MS = 30_000;
const lastReplyAt = new Map(); // `${uid}:${jid}` -> timestamp

function jidToPhone(jid) {
  // 905xxxxxxxxx@s.whatsapp.net -> +905xxxxxxxxx
  const digits = (jid.split('@')[0] || '').split(':')[0];
  try { return normalizePhone(digits); } catch { return null; }
}

export async function handleIncoming(uid, { jid, text }) {
  const cfg = configs.get(uid);
  if (!cfg || !cfg.enabled) return;

  // Sadece kayitli kisilere yanit (opsiyonel).
  if (cfg.onlyContacts) {
    const phone = jidToPhone(jid);
    const phones = (await listContactPhones(uid)).map((p) => {
      try { return normalizePhone(p); } catch { return p; }
    });
    if (!phone || !phones.includes(phone)) return;
  }

  // Sohbet basina cooldown.
  const key = `${uid}:${jid}`;
  const now = Date.now();
  if (now - (lastReplyAt.get(key) || 0) < COOLDOWN_MS) return;
  lastReplyAt.set(key, now);

  try {
    const reply = await generateReply(cfg.persona, text);
    if (!reply) return;
    await sendRawTo(uid, jid, reply);
    await addLog(uid, {
      automationId: null, contactName: jid.split('@')[0], phone: jidToPhone(jid) || '',
      message: reply, status: 'AI yanit', error: null,
    });
    logger.info({ uid, jid }, 'AI otomatik yanit gonderildi.');
  } catch (err) {
    logger.error({ uid, err: err.message }, 'AI yanit uretilemedi.');
  }
}
