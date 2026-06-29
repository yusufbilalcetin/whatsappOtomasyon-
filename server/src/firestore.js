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

// --- Contacts ---
export async function getContact(uid, id) {
  if (!id) return null;
  const doc = await contactsCol(uid).doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
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

// --- Kullanici durum (panel okur): users/{uid} dokumaninda tutulur ---
export async function setWhatsappStatus(uid, waState, waQr = null) {
  await userDoc(uid).set(
    { waState, waQr, waUpdated: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
export async function writeHeartbeat(uid) {
  await userDoc(uid).set({ engineHeartbeat: FieldValue.serverTimestamp() }, { merge: true });
}
