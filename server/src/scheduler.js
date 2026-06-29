import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { listAutomations, getContact, addLog, markAutomationRun } from './firestore.js';
import { sendMessageFor, sendRawTo } from './whatsapp.js';
import { generateMessage } from './gemini.js';

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Tum kullanicilarin tum otomasyonlari: key = `${uid}::${automationId}` -> cron task
const tasks = new Map();

function todayStr(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function cronExpr(time, days) {
  const [hour, minute] = time.split(':').map(Number);
  const dow = (days?.length ? days : Object.keys(DAY_INDEX))
    .map((d) => DAY_INDEX[d]).filter((n) => n !== undefined).sort().join(',');
  return `${minute} ${hour} * * ${dow}`;
}

async function resolveMessage(automation) {
  if (automation.messageMode === 'ai') {
    return generateMessage(automation.aiPrompt || automation.messageText || 'Gunaydin mesaji');
  }
  const text = (automation.messageText || '').trim();
  if (!text) throw new Error('Mesaj metni bos.');
  return text;
}

async function runAutomation(uid, automation) {
  const tz = automation.timezone || config.defaultTimezone;
  const today = todayStr(tz);

  if (automation.lastRunDate === today) {
    logger.info({ uid, id: automation.id }, 'Bugun zaten calisti, atlandi.');
    return;
  }

  // Coklu kisi: contactIds (yoksa eski tek contactId).
  const ids = automation.contactIds?.length ? automation.contactIds
    : (automation.contactId ? [automation.contactId] : []);
  if (!ids.length) {
    await addLog(uid, {
      automationId: automation.id, contactName: '', phone: '', message: '',
      status: 'Hata', error: 'Secili kisi yok.',
    });
    return;
  }

  let text;
  try {
    text = await resolveMessage(automation);
  } catch (err) {
    await addLog(uid, {
      automationId: automation.id, contactName: '', phone: '', message: '',
      status: 'Hata', error: err.message,
    });
    return;
  }

  let anySuccess = false;
  for (const id of ids) {
    const contact = await getContact(uid, id);
    if (!contact) {
      await addLog(uid, {
        automationId: automation.id, contactName: '', phone: '', message: '',
        status: 'Hata', error: 'Kisi bulunamadi.',
      });
      continue;
    }
    try {
      // Grup veya senkron kisi: jid varsa dogrudan; yoksa telefondan.
      let phone = contact.phone || '';
      if (contact.jid) await sendRawTo(uid, contact.jid, text);
      else ({ phone } = await sendMessageFor(uid, contact.phone, text));
      anySuccess = true;
      await addLog(uid, {
        automationId: automation.id, contactName: contact.name, phone,
        message: text, status: 'Basarili', error: null,
      });
      logger.info({ uid, id: automation.id, to: contact.name }, 'Otomatik mesaj gonderildi.');
    } catch (err) {
      await addLog(uid, {
        automationId: automation.id, contactName: contact.name, phone: contact.phone,
        message: '', status: 'Hata', error: err.message,
      });
      logger.error({ uid, id: automation.id, err: err.message }, 'Otomatik gonderim hatasi.');
    }
  }

  // Gunde-bir korumasi: en az bir gonderim basarili olduysa isaretle.
  if (anySuccess) await markAutomationRun(uid, automation.id, today);
}

function scheduleOne(uid, automation) {
  const tz = automation.timezone || config.defaultTimezone;
  const expr = cronExpr(automation.time, automation.days);
  const task = cron.schedule(expr, () => runAutomation(uid, automation), { timezone: tz });
  tasks.set(`${uid}::${automation.id}`, task);
}

// Bir kullanicinin tum job'larini Firestore'daki guncel duruma gore yeniden kurar.
export async function reloadSchedulesFor(uid) {
  for (const [key, task] of tasks) {
    if (key.startsWith(`${uid}::`)) { task.stop(); tasks.delete(key); }
  }
  const automations = await listAutomations(uid);
  for (const a of automations) {
    const hasContacts = a.contactIds?.length || a.contactId;
    if (a.enabled && a.time && hasContacts) scheduleOne(uid, a);
  }
  logger.info({ uid, count: automations.length }, 'Zamanlamalar yuklendi.');
}

export function stopSchedulesFor(uid) {
  for (const [key, task] of tasks) {
    if (key.startsWith(`${uid}::`)) { task.stop(); tasks.delete(key); }
  }
}

// Panelden "Test" icin (gunde-bir korumasini atla).
export async function runNow(uid, automation) {
  return runAutomation(uid, { ...automation, lastRunDate: '' });
}
