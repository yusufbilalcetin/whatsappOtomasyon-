import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidEncode,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { logger } from './logger.js';
import { setWhatsappStatus } from './firestore.js';

// Her kullanici icin ayri WhatsApp oturumu. uid -> { sock, state }
const sockets = new Map();

// Gelen mesaj (AI otomatik-yanit) icin disaridan kaydedilen isleyici.
let incomingHandler = null;
export function setIncomingHandler(fn) { incomingHandler = fn; }

// WhatsApp'tan cekilen kisi/grup listesi icin isleyici.
let contactsHandler = null;
export function setContactsHandler(fn) { contactsHandler = fn; }

function uniqueByJid(items) {
  return [...new Map(items.filter(Boolean).map((it) => [it.jid, it])).values()];
}

function phoneJidFrom(c) {
  return [c.jid, c.id].find((jid) => String(jid || '').endsWith('@s.whatsapp.net')) || '';
}

function mapContact(c, { fallbackName = true } = {}) {
  const jid = phoneJidFrom(c);
  if (!jid) return null;
  const digits = jid.split('@')[0].split(':')[0];
  const phone = `+${digits}`;
  const savedName = c.name || c.notify || c.verifiedName || '';
  const name = savedName || (fallbackName ? phone : '');
  return {
    jid,
    ...(name ? { name, nameSource: savedName ? 'whatsapp' : 'phone' } : {}),
    phone,
    type: 'user',
    source: 'whatsapp',
  };
}

function mapChat(chat) {
  const jid = chat.id || '';
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid === 'status@broadcast') return null;
  return mapContact({ id: jid, name: chat.name });
}

function mapGroup(g) {
  if (!g?.id) return null;
  return { jid: g.id, name: g.subject || 'Grup', type: 'group', source: 'whatsapp' };
}

function groupParticipantContacts(groups) {
  return Object.values(groups || {})
    .flatMap((g) => g.participants || [])
    .map((p) => mapContact(p))
    .filter(Boolean);
}

function emitContacts(uid, rawList, eventName, options = {}) {
  if (!contactsHandler) return;
  const items = uniqueByJid((rawList || []).map((c) => mapContact(c, options)));
  if (items.length) {
    Promise.resolve(contactsHandler(uid, items))
      .then(() => logger.info({ uid, eventName, count: items.length }, 'WhatsApp kisileri kaydedildi.'))
      .catch((e) => logger.error({ uid, eventName, err: e.message }, 'WhatsApp kisileri kaydedilemedi.'));
  } else {
    logger.info({ uid, eventName, rawCount: rawList?.length || 0 }, 'WhatsApp kisi eventinde kaydedilecek kisi yok.');
  }
}

function emitChatContacts(uid, rawList, eventName) {
  if (!contactsHandler) return;
  const items = uniqueByJid((rawList || []).map(mapChat));
  if (items.length) {
    Promise.resolve(contactsHandler(uid, items))
      .then(() => logger.info({ uid, eventName, count: items.length }, 'WhatsApp sohbet kisileri kaydedildi.'))
      .catch((e) => logger.error({ uid, eventName, err: e.message }, 'WhatsApp sohbet kisileri kaydedilemedi.'));
  }
}

function emitGroups(uid, rawList, eventName) {
  if (!contactsHandler) return;
  const items = uniqueByJid((rawList || []).map(mapGroup));
  if (items.length) {
    Promise.resolve(contactsHandler(uid, items))
      .then(() => logger.info({ uid, eventName, count: items.length }, 'WhatsApp gruplari kaydedildi.'))
      .catch((e) => logger.error({ uid, eventName, err: e.message }, 'WhatsApp gruplari kaydedilemedi.'));
  }
}

async function syncGroups(uid, sock) {
  if (!contactsHandler) return;
  try {
    const groups = await sock.groupFetchAllParticipating();
    const groupItems = uniqueByJid(Object.values(groups).map(mapGroup));
    const participantItems = uniqueByJid(groupParticipantContacts(groups));
    const items = uniqueByJid([...groupItems, ...participantItems]);
    if (items.length) await contactsHandler(uid, items);
    logger.info({
      uid,
      groups: groupItems.length,
      participants: participantItems.length,
      count: items.length,
    }, 'WhatsApp grup ve katilimci senkronu tamamlandi.');
  } catch (e) {
    logger.warn({ uid, err: e.message }, 'Gruplar cekilemedi.');
  }
}

const startedAt = Math.floor(Date.now() / 1000); // motor baslamadan onceki mesajlari yoksay

function extractText(msg) {
  const m = msg.message || {};
  return m.conversation || m.extendedTextMessage?.text || '';
}

let cachedVersion = null;
async function waVersion() {
  if (!cachedVersion) cachedVersion = (await fetchLatestBaileysVersion()).version;
  return cachedVersion;
}

async function clearAuthAndStartQr(uid) {
  const authDir = `${config.waAuthDir}/${uid}`;
  await fs.rm(authDir, { recursive: true, force: true });
  await setWhatsappStatus(uid, 'connecting', null);
  setTimeout(() => {
    startWhatsAppFor(uid).catch((e) => logger.error({ uid, err: e.message }, 'WhatsApp QR yeniden baslatilamadi.'));
  }, 1000);
}

export async function startWhatsAppFor(uid) {
  if (sockets.has(uid)) return; // zaten baglaniyor/bagli
  const authDir = `${config.waAuthDir}/${uid}`;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version = await waVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.macOS('Desktop'),
    logger: logger.child({ module: 'baileys', uid }),
    markOnlineOnConnect: false,
    syncFullHistory: true,
  });
  const entry = { sock, state: 'connecting', qrWritten: false };
  sockets.set(uid, entry);

  sock.ev.on('creds.update', saveCreds);

  // WhatsApp kisi senkronu (ilk gecmis senkronu + sonradan eklenenler).
  sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
    emitContacts(uid, contacts, 'messaging-history.set');
    emitChatContacts(uid, chats, 'messaging-history.set.chats');
  });
  sock.ev.on('contacts.upsert', (cs) => emitContacts(uid, cs, 'contacts.upsert'));
  sock.ev.on('contacts.update', (cs) => emitContacts(uid, cs, 'contacts.update', { fallbackName: false }));
  sock.ev.on('chats.upsert', (cs) => emitChatContacts(uid, cs, 'chats.upsert'));
  sock.ev.on('chats.update', (cs) => emitChatContacts(uid, cs, 'chats.update'));
  sock.ev.on('groups.upsert', (gs) => emitGroups(uid, gs, 'groups.upsert'));
  sock.ev.on('groups.update', (gs) => emitGroups(uid, gs, 'groups.update'));

  // Gelen mesajlar (AI otomatik-yanit). Sadece birebir sohbet, bize gelen, metinli.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify' || !incomingHandler) return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid || '';
      if (msg.key?.fromMe) continue;
      if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid === 'status@broadcast') continue;
      if ((msg.messageTimestamp || 0) < startedAt) continue; // eski mesajlari atla
      const text = extractText(msg);
      if (!text.trim()) continue;
      Promise.resolve(incomingHandler(uid, { jid, text })).catch((e) =>
        logger.error({ uid, err: e.message }, 'AI yanit isleyici hatasi.'));
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr && !entry.qrWritten) {
      entry.qrWritten = true;
      entry.state = 'qr';
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      setWhatsappStatus(uid, 'qr', dataUrl).catch((e) => logger.warn(e, 'QR yazilamadi.'));
    }
    if (connection === 'connecting') {
      entry.state = 'connecting';
      setWhatsappStatus(uid, 'connecting').catch(() => {});
    }
    if (connection === 'open') {
      entry.state = 'open';
      logger.info({ uid }, 'WhatsApp baglantisi acildi.');
      setWhatsappStatus(uid, 'open', null).catch(() => {});
      syncGroups(uid, sock); // gruplari cek
    }
    if (connection === 'close') {
      entry.state = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const manualClose = !!entry.manualClose;
      const resetting = !!entry.resetting;
      const qrTimedOut = statusCode === DisconnectReason.timedOut && entry.state === 'qr';
      logger.warn({ uid, statusCode, loggedOut, manualClose, resetting, qrTimedOut }, 'WhatsApp baglantisi kapandi.');
      sockets.delete(uid);
      if (resetting) return;
      if (loggedOut) {
        clearAuthAndStartQr(uid).catch((e) =>
          logger.error({ uid, err: e.message }, 'Logged out sonrasi QR baslatilamadi.'));
        return;
      }
      setWhatsappStatus(uid, 'disconnected', null).catch(() => {});
      if (!loggedOut && !manualClose && !qrTimedOut) {
        setTimeout(() => startWhatsAppFor(uid).catch((e) => logger.error(e)), 3000);
      }
    }
  });
}

export function stopWhatsAppFor(uid) {
  const entry = sockets.get(uid);
  if (entry) {
    entry.manualClose = true;
    try { entry.sock.end(); } catch { /* yoksay */ }
    sockets.delete(uid);
  }
  setWhatsappStatus(uid, 'disconnected', null).catch(() => {});
}

export async function resetWhatsAppFor(uid) {
  const entry = sockets.get(uid);
  if (entry) {
    entry.manualClose = true;
    entry.resetting = true;
    try { await entry.sock.logout('Panelden baglanti kesildi.'); } catch { /* yoksay */ }
    try { entry.sock.end(); } catch { /* yoksay */ }
    sockets.delete(uid);
  }

  await clearAuthAndStartQr(uid);
}

// +905xxxxxxxxx / 05xx / 5xx gibi girdileri uluslararasi formata cevirir.
export function normalizePhone(phone) {
  let v = String(phone).replace(/[\s\-()]/g, '').trim();
  if (v.startsWith('00')) v = '+' + v.slice(2);
  else if (v.startsWith('0') && v.length === 11) v = '+90' + v.slice(1);
  else if (v.startsWith('90') && !v.startsWith('+')) v = '+' + v;
  else if (v.startsWith('5') && v.length === 10) v = '+90' + v;
  if (!/^\+[1-9]\d{7,14}$/.test(v)) {
    throw new Error('Telefon numarasi uluslararasi formatta olmali. Orn: +905xxxxxxxxx');
  }
  return v;
}

export async function sendMessageFor(uid, phone, text) {
  const entry = sockets.get(uid);
  if (!entry || entry.state !== 'open') {
    throw new Error('WhatsApp bagli degil. Panelden QR okutun.');
  }
  const normalized = normalizePhone(phone);
  const jid = jidEncode(normalized.replace('+', ''), 's.whatsapp.net');
  await entry.sock.sendMessage(jid, { text });
  return { phone: normalized };
}

// Belirli bir sohbete (jid) dogrudan gonderim — AI otomatik-yanit icin.
export async function sendRawTo(uid, jid, text) {
  const entry = sockets.get(uid);
  if (!entry || entry.state !== 'open') throw new Error('WhatsApp bagli degil.');
  await entry.sock.sendMessage(jid, { text });
}
