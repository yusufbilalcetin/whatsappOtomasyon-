import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidEncode,
  ALL_WA_PATCH_NAMES,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import fs from 'node:fs/promises';
import { config } from './config.js';
import { logger } from './logger.js';
import { setWhatsappStatus, clearUserData } from './firestore.js';

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
    // Yalnizca gruplari kaydet; grup katilimcilarini KISI olarak yazma
    // (yuzlerce isimsiz numara hem listeyi sisirir hem Firestore kotasini tuketir).
    const groupItems = uniqueByJid(Object.values(groups).map(mapGroup));
    if (groupItems.length) await contactsHandler(uid, groupItems);
    logger.info({ uid, groups: groupItems.length }, 'WhatsApp grup senkronu tamamlandi.');
  } catch (e) {
    logger.warn({ uid, err: e.message }, 'Gruplar cekilemedi.');
  }
}

// Telefonda KAYITLI kisi isimlerini WhatsApp'tan zorla cektirir.
// App-state senkronu her "contactAction" icin contacts.upsert (name = kayitli isim) yayar.
async function syncContactNames(uid, sock, { full = false } = {}) {
  try {
    await sock.resyncAppState(ALL_WA_PATCH_NAMES, full);
    logger.info({ uid, full }, 'Kayitli kisi isimleri senkronu istendi.');
  } catch (e) {
    logger.warn({ uid, err: e.message }, 'Kisi ismi senkronu yapilamadi.');
  }
}

// Panelden tetiklenen manuel kisi yeniden senkronu.
export async function resyncContactsFor(uid) {
  const entry = sockets.get(uid);
  if (!entry || entry.state !== 'open') throw new Error('WhatsApp bagli degil.');
  await syncContactNames(uid, entry.sock, { full: true });
  await syncGroups(uid, entry.sock);
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
    syncFullHistory: true, // ilk senkronda kisi listesi + isimlerin (notify) gelmesi icin gerekli
  });
  const entry = { sock, state: 'connecting', lastQr: null };
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

  // Gelen mesajlar: (1) kisi ismini (pushName) yakala, (2) AI otomatik-yanit.
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid || '';
      if (msg.key?.fromMe) continue;
      if (jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue;

      const isGroup = jid.endsWith('@g.us');
      // Mesaj atan kisinin WhatsApp adini (pushName) kisilere yaz — isimler zamanla dolar.
      // Grup mesajinda gonderen msg.key.participant'ta; birebirde remoteJid'in kendisi.
      const senderJid = isGroup ? (msg.key?.participant || '') : jid;
      if (msg.pushName && senderJid.endsWith('@s.whatsapp.net')) {
        emitContacts(uid, [{ id: senderJid, notify: msg.pushName }], isGroup ? 'group.pushName' : 'messages.pushName');
      }

      // AI otomatik-yanit: yalnizca birebir sohbet.
      if (!incomingHandler || isGroup) continue;
      if ((msg.messageTimestamp || 0) < startedAt) continue; // eski mesajlari atla
      const text = extractText(msg);
      if (!text.trim()) continue;
      Promise.resolve(incomingHandler(uid, { jid, text })).catch((e) =>
        logger.error({ uid, err: e.message }, 'AI yanit isleyici hatasi.'));
    }
  });

  sock.ev.on('connection.update', async (update) => {
    // Eski/yenilenmis socket'in gecikmis event'lerini yoksay (durum oynamasini onler).
    if (sockets.get(uid) !== entry) return;
    const { connection, qr, lastDisconnect } = update;

    // QR her donusumde (~20 sn) yenilenir; panel her zaman gecerli kodu gosterir.
    if (qr && qr !== entry.lastQr) {
      entry.lastQr = qr;
      entry.state = 'qr';
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      setWhatsappStatus(uid, 'qr', dataUrl).catch((e) => logger.warn(e, 'QR yazilamadi.'));
    }
    // 'connecting' QR'i SILMEZ; sadece zaten farkli bir durumdaysak yaz (gereksiz yazimi onler).
    if (connection === 'connecting' && entry.state !== 'connecting' && entry.state !== 'qr') {
      entry.state = 'connecting';
      setWhatsappStatus(uid, 'connecting').catch(() => {});
    }
    if (connection === 'open') {
      if (entry.state !== 'open') {
        entry.state = 'open';
        entry.lastQr = null;
        logger.info({ uid }, 'WhatsApp baglantisi acildi.');
        setWhatsappStatus(uid, 'open', null).catch(() => {});
        syncGroups(uid, sock); // gruplari cek
        // App-state'teki kisi isimlerini cektir (hafif senkron; "tried remove" gurultusunu azaltir).
        if (!entry.contactsSynced) {
          entry.contactsSynced = true;
          syncContactNames(uid, sock, { full: false });
        }
      }
    }
    if (connection === 'close') {
      entry.state = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      const manualClose = !!entry.manualClose;
      const resetting = !!entry.resetting;
      const qrTimedOut = statusCode === DisconnectReason.timedOut && !!entry.lastQr;
      // 515: eslesme sonrasi yeniden baslatma gerekli (hizli yeniden bagla).
      const restartRequired = statusCode === DisconnectReason.restartRequired;
      logger.warn({ uid, statusCode, loggedOut, manualClose, resetting, qrTimedOut, restartRequired }, 'WhatsApp baglantisi kapandi.');
      sockets.delete(uid);
      if (resetting || manualClose) return;
      if (loggedOut) {
        clearAuthAndStartQr(uid).catch((e) =>
          logger.error({ uid, err: e.message }, 'Logged out sonrasi QR baslatilamadi.'));
        return;
      }
      if (qrTimedOut) {
        // QR okutulmadan suresi doldu: tekrar deneme firtinasi yerine bekleyen QR durumunu birak.
        setWhatsappStatus(uid, 'disconnected', null).catch(() => {});
        return;
      }
      setWhatsappStatus(uid, 'connecting').catch(() => {});
      const delay = restartRequired ? 500 : 3000;
      setTimeout(() => startWhatsAppFor(uid).catch((e) => logger.error(e)), delay);
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

  // Sistemi sifirla: kisileri ve kayitlari temizle. Yeni QR okununca veriler bastan cekilir.
  try { await clearUserData(uid); } catch (e) { logger.warn({ uid, err: e.message }, 'Kullanici verisi sifirlanamadi.'); }

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
