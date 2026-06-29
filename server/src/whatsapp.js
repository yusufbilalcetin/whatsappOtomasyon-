import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  Browsers,
  DisconnectReason,
  jidEncode,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { config } from './config.js';
import { logger } from './logger.js';
import { setWhatsappStatus } from './firestore.js';

// Her kullanici icin ayri WhatsApp oturumu. uid -> { sock, state }
const sockets = new Map();

let cachedVersion = null;
async function waVersion() {
  if (!cachedVersion) cachedVersion = (await fetchLatestBaileysVersion()).version;
  return cachedVersion;
}

export async function startWhatsAppFor(uid) {
  if (sockets.has(uid)) return; // zaten baglaniyor/bagli
  const authDir = `${config.waAuthDir}/${uid}`;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version = await waVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: logger.child({ module: 'baileys', uid }),
    markOnlineOnConnect: false,
  });
  const entry = { sock, state: 'connecting' };
  sockets.set(uid, entry);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
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
    }
    if (connection === 'close') {
      entry.state = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      logger.warn({ uid, statusCode, loggedOut }, 'WhatsApp baglantisi kapandi.');
      setWhatsappStatus(uid, loggedOut ? 'logged_out' : 'disconnected', null).catch(() => {});
      sockets.delete(uid);
      if (!loggedOut) {
        setTimeout(() => startWhatsAppFor(uid).catch((e) => logger.error(e)), 3000);
      }
    }
  });
}

export function stopWhatsAppFor(uid) {
  const entry = sockets.get(uid);
  if (entry) {
    try { entry.sock.end(); } catch { /* yoksay */ }
    sockets.delete(uid);
  }
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
