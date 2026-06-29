import 'dotenv/config'; // .env'i firebase-admin baslatmadan ONCE yukle (projectId icin sart)
import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'node:fs';
import { logger } from './logger.js';

// service-account.json varsa onu, yoksa GOOGLE_APPLICATION_CREDENTIALS / ADC kullan.
function buildCredential() {
  const localPath = './service-account.json';
  if (fs.existsSync(localPath)) {
    return cert(JSON.parse(fs.readFileSync(localPath, 'utf8')));
  }
  return applicationDefault();
}

initializeApp({
  credential: buildCredential(),
  projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined,
});

export const db = getFirestore();
export { FieldValue };

// ---- Cok kullanicili yapi: her sey users/{uid}/... altinda ----
const usersCol = () => db.collection('users');
const userDoc = (uid) => usersCol().doc(uid);
const contactsCol = (uid) => userDoc(uid).collection('contacts');
const automationsCol = (uid) => userDoc(uid).collection('automations');
const logsCol = (uid) => userDoc(uid).collection('logs');

// --- Kullanicilar ---
export function watchUsers(onChange) {
  return usersCol().onSnapshot(
    (snap) => onChange(snap.docs.map((d) => d.id)),
    (err) => logger.error({ err: err.message }, 'users dinleyici hatasi.'),
  );
}

// Bir koleksiyondaki tum dokumanlari parti parti siler.
async function deleteAllDocs(colRef) {
  let total = 0;
  while (true) {
    const snap = await colRef.limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    total += snap.size;
    if (snap.size < 400) break;
  }
  return total;
}

// "Baglantiyi kes" sonrasi sistemi tamamen sifirla: kisiler + kayitlar + otomasyonlar.
export async function clearUserData(uid) {
  const contacts = await deleteAllDocs(contactsCol(uid));
  const logs = await deleteAllDocs(logsCol(uid));
  const automations = await deleteAllDocs(automationsCol(uid));
  logger.info({ uid, contacts, logs, automations }, 'Kullanici verisi sifirlandi (baglanti kesildi).');
  return { contacts, logs, automations };
}

// --- Contacts ---
export async function getContact(uid, id) {
  if (!id) return null;
  const doc = await contactsCol(uid).doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}
export async function listContactPhones(uid) {
  const snap = await contactsCol(uid).get();
  return snap.docs.map((d) => d.data().phone).filter(Boolean);
}

// WhatsApp'tan cekilen kisileri/gruplari toplu ekler/gunceller (jid = dokuman id).
// Kota dostu: yalnizca gercekten degisen alanlari yazar, kullanicinin verdigi customName'e dokunmaz.
export async function upsertContacts(uid, items) {
  const valid = items.filter((it) => it && it.jid);
  for (let i = 0; i < valid.length; i += 400) {
    const chunk = valid.slice(i, i + 400);
    const batch = db.batch();
    let writes = 0;
    for (const it of chunk) {
      const id = it.jid.replace(/\//g, '_');
      const ref = contactsCol(uid).doc(id);
      const data = { ...it };
      const existing = await ref.get();
      const existingData = existing.exists ? existing.data() : {};
      // Telefon-yedek isim, daha once gelmis gercek WhatsApp ismini ezmesin.
      if (data.type === 'user' && data.nameSource === 'phone'
        && existingData.name && existingData.nameSource !== 'phone') {
        delete data.name;
        delete data.nameSource;
      }
      // Hicbir alan degismiyorsa yazma (gereksiz Firestore yazimini onler).
      const changed = Object.keys(data).some((k) => existingData[k] !== data[k]);
      if (!existing.exists || changed) {
        batch.set(ref, data, { merge: true });
        writes++;
      }
    }
    if (writes) await batch.commit();
  }
}

// --- Automations ---
export async function listAutomations(uid) {
  const snap = await automationsCol(uid).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function getAutomation(uid, id) {
  const doc = await automationsCol(uid).doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}
export async function markAutomationRun(uid, id, dateStr) {
  await automationsCol(uid).doc(id).update({ lastRunDate: dateStr });
}
export function watchAutomations(uid, onChange) {
  return automationsCol(uid).onSnapshot(
    () => onChange(),
    (err) => logger.error({ uid, err: err.message }, 'automations dinleyici hatasi.'),
  );
}

// --- Logs ---
export async function addLog(uid, entry) {
  await logsCol(uid).add({ ...entry, sentAt: FieldValue.serverTimestamp() });
}

// --- Komutlar (panel -> motor): users/{uid}/commands ---
const commandsCol = (uid) => userDoc(uid).collection('commands');
export function watchCommands(uid, onAdded) {
  return commandsCol(uid).onSnapshot(
    (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type === 'added') onAdded({ id: ch.doc.id, ...ch.doc.data() });
      });
    },
    (err) => logger.error({ uid, err: err.message }, 'commands dinleyici hatasi.'),
  );
}
export async function deleteCommand(uid, id) {
  await commandsCol(uid).doc(id).delete();
}

// --- Kullanici dokumanini izle (autoReply config cache icin) ---
export function watchUserDoc(uid, onChange) {
  return userDoc(uid).onSnapshot(
    (d) => onChange(d.data() || {}),
    (err) => logger.error({ uid, err: err.message }, 'user doc dinleyici hatasi.'),
  );
}

// --- Kullanici durum (panel okur): users/{uid} dokumaninda tutulur ---
// waQr atlanirsa (undefined) mevcut QR'a dokunulmaz; null verilirse QR temizlenir.
export async function setWhatsappStatus(uid, waState, waQr) {
  const data = { waState, waUpdated: FieldValue.serverTimestamp() };
  if (waQr !== undefined) data.waQr = waQr;
  if (['open', 'disconnected', 'logged_out'].includes(waState)) {
    data.waPairingCode = FieldValue.delete();
    data.waPairingPhone = FieldValue.delete();
    data.waPairingError = FieldValue.delete();
    data.waPairingUpdated = FieldValue.delete();
  }
  await userDoc(uid).set(data, { merge: true });
}
export async function setWhatsappPairing(uid, { code, phone, error } = {}) {
  const data = { waPairingUpdated: FieldValue.serverTimestamp() };
  if (code !== undefined) data.waPairingCode = code || FieldValue.delete();
  if (phone !== undefined) data.waPairingPhone = phone || FieldValue.delete();
  if (error !== undefined) data.waPairingError = error || FieldValue.delete();
  await userDoc(uid).set(data, { merge: true });
}
export async function writeHeartbeat(uid) {
  await userDoc(uid).set({ engineHeartbeat: FieldValue.serverTimestamp() }, { merge: true });
}
