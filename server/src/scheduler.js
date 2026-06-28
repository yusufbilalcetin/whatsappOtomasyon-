import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import {
  listAutomations,
  getContact,
  addLog,
  markAutomationRun,
} from './firestore.js';
import { sendMessage } from './whatsapp.js';
import { generateMessage } from './gemini.js';

const DAY_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// Her otomasyonun kendi cron job'i. id -> task
const tasks = new Map();

function todayStr(timezone) {
  // YYYY-MM-DD (otomasyonun saat dilimine gore)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function cronExpr(time, days) {
  const [hour, minute] = time.split(':').map(Number);
  const dow = (days?.length ? days : Object.keys(DAY_INDEX))
    .map((d) => DAY_INDEX[d])
    .filter((n) => n !== undefined)
    .sort()
    .join(',');
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

async function runAutomation(automation) {
  const tz = automation.timezone || config.defaultTimezone;
  const today = todayStr(tz);

  // Gunde-bir tekrar korumasi.
  if (automation.lastRunDate === today) {
    logger.info({ id: automation.id }, 'Bugun zaten calisti, atlandi.');
    return;
  }

  const contact = await getContact(automation.contactId);
  if (!contact) {
    await addLog({
      automationId: automation.id,
      contactName: '',
      phone: '',
      message: '',
      status: 'Hata',
      error: 'Secili kisi bulunamadi.',
    });
    return;
  }

  try {
    const text = await resolveMessage(automation);
    const { phone } = await sendMessage(contact.phone, text);
    await markAutomationRun(automation.id, today);
    await addLog({
      automationId: automation.id,
      contactName: contact.name,
      phone,
      message: text,
      status: 'Basarili',
      error: null,
    });
    logger.info({ id: automation.id, to: contact.name }, 'Otomatik mesaj gonderildi.');
  } catch (err) {
    await addLog({
      automationId: automation.id,
      contactName: contact.name,
      phone: contact.phone,
      message: '',
      status: 'Hata',
      error: err.message,
    });
    logger.error({ id: automation.id, err: err.message }, 'Otomatik gonderim hatasi.');
  }
}

function scheduleOne(automation) {
  const tz = automation.timezone || config.defaultTimezone;
  const expr = cronExpr(automation.time, automation.days);
  const task = cron.schedule(expr, () => runAutomation(automation), { timezone: tz });
  tasks.set(automation.id, task);
  logger.info({ id: automation.id, expr, tz }, 'Otomasyon zamanlandi.');
}

// Tum job'lari Firestore'daki guncel duruma gore yeniden kurar.
// Panelden her degisiklikten sonra cagrilir; cakisma/ezme olmaz.
export async function reloadSchedules() {
  for (const task of tasks.values()) task.stop();
  tasks.clear();

  const automations = await listAutomations();
  for (const a of automations) {
    if (a.enabled && a.time && a.contactId) scheduleOne(a);
  }
  logger.info({ count: tasks.size }, 'Zamanlamalar yeniden yuklendi.');
}

// Panelden "hemen gonder" / test icin.
export async function runNow(automation) {
  return runAutomation({ ...automation, lastRunDate: '' });
}
