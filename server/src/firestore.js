import { initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'node:fs';
import { logger } from './logger.js';

// service-account.json varsa onu, yoksa GOOGLE_APPLICATION_CREDENTIALS'i kullan.
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

// --- Koleksiyon kisayollari ---
const contactsCol = () => db.collection('contacts');
const messagesCol = () => db.collection('messages');
const automationsCol = () => db.collection('automations');
const logsCol = () => db.collection('logs');
const settingsDoc = () => db.collection('settings').doc('global');

const DEFAULT_MESSAGES = [
  'Gunaydin guzelim, umarim bugun yuzun hep guler',
  'Gunaydin hayatim, yeni gun sana guzellikler getirsin',
  'Gunaydin sevgilim, bugun de aklimdasin. Seni seviyorum',
  'Gunaydin canim, guzel bir gun gecirmeni istiyorum',
  'Gunaydin askim, bugun senin icin cok guzel gecsin insallah',
];

export async function ensureSeed() {
  const settings = await settingsDoc().get();
  if (!settings.exists) {
    await settingsDoc().set({
      defaultTimezone: 'Europe/Istanbul',
      autoReplyEnabled: false, // AI otomatik-yanit: simdilik pasif
    });
    logger.info('settings/global olusturuldu.');
  }
  const msgSnap = await messagesCol().limit(1).get();
  if (msgSnap.empty) {
    const batch = db.batch();
    for (const text of DEFAULT_MESSAGES) {
      batch.set(messagesCol().doc(), { text, isActive: true });
    }
    await batch.commit();
    logger.info('Varsayilan mesajlar eklendi.');
  }
}

// --- Contacts ---
export async function listContacts() {
  const snap = await contactsCol().orderBy('name').get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function getContact(id) {
  if (!id) return null;
  const doc = await contactsCol().doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}
export async function addContact(name, phone) {
  const ref = await contactsCol().add({ name: name.trim(), phone: phone.trim() });
  return ref.id;
}
export async function updateContact(id, name, phone) {
  await contactsCol().doc(id).update({ name: name.trim(), phone: phone.trim() });
}
export async function deleteContact(id) {
  await contactsCol().doc(id).delete();
}

// --- Messages ---
export async function listMessages({ activeOnly = false } = {}) {
  let q = messagesCol();
  if (activeOnly) q = q.where('isActive', '==', true);
  const snap = await q.get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function addMessage(text, isActive = true) {
  const ref = await messagesCol().add({ text: text.trim(), isActive });
  return ref.id;
}
export async function updateMessage(id, text, isActive) {
  await messagesCol().doc(id).update({ text: text.trim(), isActive: !!isActive });
}
export async function deleteMessage(id) {
  await messagesCol().doc(id).delete();
}

// --- Automations (cok sayida) ---
export async function listAutomations() {
  const snap = await automationsCol().get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function getAutomation(id) {
  const doc = await automationsCol().doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}
export async function addAutomation(data) {
  const ref = await automationsCol().add(normalizeAutomation(data));
  return ref.id;
}
export async function updateAutomation(id, data) {
  await automationsCol().doc(id).update(normalizeAutomation(data, { partial: true }));
}
export async function deleteAutomation(id) {
  await automationsCol().doc(id).delete();
}
export async function markAutomationRun(id, dateStr) {
  await automationsCol().doc(id).update({ lastRunDate: dateStr });
}

function normalizeAutomation(data, { partial = false } = {}) {
  const out = {};
  const assign = (key, val) => {
    if (val !== undefined) out[key] = val;
  };
  assign('name', data.name?.trim());
  assign('contactId', data.contactId);
  assign('time', data.time);
  assign('days', Array.isArray(data.days) ? data.days : undefined);
  assign('timezone', data.timezone);
  assign('messageMode', data.messageMode); // 'random' | 'fixed' | 'ai'
  assign('messageId', data.messageId ?? null);
  assign('aiPrompt', data.aiPrompt ?? '');
  if (data.enabled !== undefined) out.enabled = !!data.enabled;
  if (!partial) {
    out.lastRunDate = data.lastRunDate ?? '';
    if (out.enabled === undefined) out.enabled = true;
    if (!out.days) out.days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    if (!out.messageMode) out.messageMode = 'random';
  }
  return out;
}

// --- Logs ---
export async function addLog(entry) {
  await logsCol().add({ ...entry, sentAt: FieldValue.serverTimestamp() });
}
export async function listLogs(limit = 100) {
  const snap = await logsCol().orderBy('sentAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => {
    const data = d.data();
    return { id: d.id, ...data, sentAt: data.sentAt?.toDate?.()?.toISOString() ?? null };
  });
}

// --- Settings ---
export async function getSettings() {
  const doc = await settingsDoc().get();
  return doc.exists ? doc.data() : {};
}
export async function updateSettings(patch) {
  await settingsDoc().set(patch, { merge: true });
}
