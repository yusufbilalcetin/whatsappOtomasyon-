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

let sock = null;
let connectionState = 'disconnected'; // 'disconnected' | 'connecting' | 'qr' | 'open'

export async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(config.waAuthDir);
  const { version } = await fetchLatestBaileysVersion();
  logger.info({ version }, 'WhatsApp Web surumu alindi.');

  sock = makeWASocket({
    version,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    logger: logger.child({ module: 'baileys' }),
    markOnlineOnConnect: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      connectionState = 'qr';
      // QR'i hem terminale ASCII yaz hem de panelin gosterebilmesi icin Firestore'a koy.
      const ascii = await QRCode.toString(qr, { type: 'terminal', small: true });
      console.log('\n=== WhatsApp QR kodu (telefondan okut) ===\n' + ascii);
      const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      setWhatsappStatus('qr', dataUrl).catch((e) => logger.warn(e, 'QR yazilamadi.'));
    }
    if (connection === 'connecting') {
      connectionState = 'connecting';
      setWhatsappStatus('connecting').catch(() => {});
    }
    if (connection === 'open') {
      connectionState = 'open';
      logger.info('WhatsApp baglantisi acildi.');
      setWhatsappStatus('open', null).catch(() => {});
    }
    if (connection === 'close') {
      connectionState = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      logger.warn({ statusCode, loggedOut }, 'WhatsApp baglantisi kapandi.');
      setWhatsappStatus(loggedOut ? 'logged_out' : 'disconnected', null).catch(() => {});
      if (!loggedOut) {
        setTimeout(() => startWhatsApp().catch((e) => logger.error(e)), 3000);
      }
    }
  });

  return sock;
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

export async function sendMessage(phone, text) {
  if (connectionState !== 'open' || !sock) {
    throw new Error('WhatsApp bagli degil. Panelden QR okutun.');
  }
  const normalized = normalizePhone(phone);
  const jid = jidEncode(normalized.replace('+', ''), 's.whatsapp.net');
  await sock.sendMessage(jid, { text });
  return { phone: normalized };
}
