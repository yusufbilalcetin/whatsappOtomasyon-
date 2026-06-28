import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as store from './firestore.js';
import { getStatus, normalizePhone } from './whatsapp.js';
import { reloadSchedules, runNow } from './scheduler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.use(express.json());

  // Basit parola korumasi (opsiyonel).
  app.use('/api', (req, res, next) => {
    if (!config.panelPassword) return next();
    if (req.headers['x-panel-password'] === config.panelPassword) return next();
    return res.status(401).json({ error: 'Yetkisiz.' });
  });

  const ok = (res, data) => res.json(data ?? { ok: true });
  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  // --- Durum ---
  app.get('/api/status', wrap(async (req, res) => {
    const settings = await store.getSettings();
    ok(res, { whatsapp: getStatus(), autoReplyEnabled: !!settings.autoReplyEnabled });
  }));

  // --- Contacts ---
  app.get('/api/contacts', wrap(async (req, res) => ok(res, await store.listContacts())));
  app.post('/api/contacts', wrap(async (req, res) => {
    const { name, phone } = req.body;
    normalizePhone(phone); // dogrulama
    ok(res, { id: await store.addContact(name, phone) });
  }));
  app.put('/api/contacts/:id', wrap(async (req, res) => {
    const { name, phone } = req.body;
    normalizePhone(phone);
    await store.updateContact(req.params.id, name, phone);
    ok(res);
  }));
  app.delete('/api/contacts/:id', wrap(async (req, res) => {
    await store.deleteContact(req.params.id);
    ok(res);
  }));

  // --- Messages ---
  app.get('/api/messages', wrap(async (req, res) => ok(res, await store.listMessages())));
  app.post('/api/messages', wrap(async (req, res) =>
    ok(res, { id: await store.addMessage(req.body.text, req.body.isActive ?? true) })));
  app.put('/api/messages/:id', wrap(async (req, res) => {
    await store.updateMessage(req.params.id, req.body.text, req.body.isActive);
    ok(res);
  }));
  app.delete('/api/messages/:id', wrap(async (req, res) => {
    await store.deleteMessage(req.params.id);
    ok(res);
  }));

  // --- Automations ---
  app.get('/api/automations', wrap(async (req, res) => ok(res, await store.listAutomations())));
  app.post('/api/automations', wrap(async (req, res) => {
    const id = await store.addAutomation(req.body);
    await reloadSchedules();
    ok(res, { id });
  }));
  app.put('/api/automations/:id', wrap(async (req, res) => {
    await store.updateAutomation(req.params.id, req.body);
    await reloadSchedules();
    ok(res);
  }));
  app.delete('/api/automations/:id', wrap(async (req, res) => {
    await store.deleteAutomation(req.params.id);
    await reloadSchedules();
    ok(res);
  }));
  app.post('/api/automations/:id/run-now', wrap(async (req, res) => {
    const automation = await store.getAutomation(req.params.id);
    if (!automation) throw new Error('Otomasyon bulunamadi.');
    await runNow(automation);
    ok(res);
  }));

  // --- Logs ---
  app.get('/api/logs', wrap(async (req, res) => ok(res, await store.listLogs(100))));

  // --- AI otomatik-yanit (su an PASIF; buton var, devre disi) ---
  app.post('/api/auto-reply/toggle', wrap(async (req, res) => {
    // Bilincli olarak devre disi: motor henuz aktif degil.
    res.status(501).json({ error: 'AI otomatik-yanit motoru henuz aktif degil.' });
  }));

  // Statik panel
  app.use(express.static(path.join(__dirname, '..', 'public')));

  return app;
}
