import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const db = getFirestore(initializeApp(firebaseConfig));
const col = (name) => collection(db, name);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let contacts = [];
let messages = [];

const DAYS = [['mon', 'Pzt'], ['tue', 'Sal'], ['wed', 'Çar'], ['thu', 'Per'], ['fri', 'Cum'], ['sat', 'Cmt'], ['sun', 'Paz']];
const dayTr = Object.fromEntries(DAYS);

// --- Toast ---
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// --- Telefon dogrulama (sunucu ile ayni mantik) ---
function normalizePhone(phone) {
  let v = String(phone).replace(/[\s\-()]/g, '').trim();
  if (v.startsWith('00')) v = '+' + v.slice(2);
  else if (v.startsWith('0') && v.length === 11) v = '+90' + v.slice(1);
  else if (v.startsWith('90') && !v.startsWith('+')) v = '+' + v;
  else if (v.startsWith('5') && v.length === 10) v = '+90' + v;
  if (!/^\+[1-9]\d{7,14}$/.test(v)) throw new Error('Telefon formatı hatalı. Örn: +905xxxxxxxxx');
  return v;
}

// --- Sekmeler ---
$$('.seg').forEach((btn) => {
  btn.onclick = () => {
    $$('.seg').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach((t) => t.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
  };
});

// =================== Otomasyonlar ===================
const autoForm = $('#automation-form');
function toggleModeFields() {
  const mode = autoForm.messageMode.value;
  $$('#automation-form [data-mode]').forEach((el) => el.classList.toggle('hidden', el.dataset.mode !== mode));
}
autoForm.messageMode.onchange = toggleModeFields;

function resetAutomationForm() {
  autoForm.reset();
  autoForm.id.value = '';
  $$('#automation-form input[name="days"]').forEach((cb) => (cb.checked = true));
  $('#automation-title').textContent = 'Yeni otomasyon';
  toggleModeFields();
}
$('#automation-reset').onclick = resetAutomationForm;

autoForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(autoForm);
  const days = fd.getAll('days');
  if (!days.length) return toast('En az bir gün seçin.');
  if (!fd.get('contactId')) return toast('Önce bir kişi ekleyin.');
  const payload = {
    name: fd.get('name').trim(),
    contactId: fd.get('contactId'),
    time: fd.get('time'),
    messageMode: fd.get('messageMode'),
    messageId: fd.get('messageId') || null,
    aiPrompt: fd.get('aiPrompt') || '',
    enabled: autoForm.enabled.checked,
    days,
    timezone: 'Europe/Istanbul',
  };
  try {
    const id = autoForm.id.value;
    if (id) await updateDoc(doc(db, 'automations', id), payload);
    else await addDoc(col('automations'), { ...payload, lastRunDate: '' });
    resetAutomationForm();
    toast('Kaydedildi.');
  } catch (err) { toast(err.message); }
};

function renderAutomations(items) {
  const ul = $('#automation-list');
  ul.innerHTML = '';
  if (!items.length) { ul.innerHTML = '<li class="li-main"><div class="li-sub">Henüz otomasyon yok.</div></li>'; return; }
  items.forEach((a) => {
    const c = contacts.find((x) => x.id === a.contactId);
    const days = (a.days || []).map((d) => dayTr[d] || d).join(' ');
    const modeTr = { random: 'Rastgele', fixed: 'Sabit', ai: 'AI' }[a.messageMode] || a.messageMode;
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="li-main">
        <div class="li-title">${a.name} <span class="badge ${a.enabled ? 'ok' : 'off'}">${a.enabled ? 'aktif' : 'pasif'}</span></div>
        <div class="li-sub">${a.time} · ${c ? c.name : '(kişi yok)'} · ${modeTr} · ${days}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" title="Düzenle">✎</button>
        <button class="icon-btn danger" title="Sil">🗑</button>
      </div>`;
    const [edit, del] = li.querySelectorAll('button');
    edit.onclick = () => fillAutomation(a);
    del.onclick = async () => { if (confirm('Silinsin mi?')) { await deleteDoc(doc(db, 'automations', a.id)); toast('Silindi.'); } };
    ul.appendChild(li);
  });
}

function fillAutomation(a) {
  autoForm.id.value = a.id;
  autoForm.name.value = a.name || '';
  autoForm.contactId.value = a.contactId || '';
  autoForm.time.value = a.time || '08:00';
  autoForm.messageMode.value = a.messageMode || 'random';
  autoForm.messageId.value = a.messageId || '';
  autoForm.aiPrompt.value = a.aiPrompt || '';
  autoForm.enabled.checked = !!a.enabled;
  $$('#automation-form input[name="days"]').forEach((cb) => (cb.checked = (a.days || []).includes(cb.value)));
  $('#automation-title').textContent = 'Otomasyonu düzenle';
  toggleModeFields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =================== Kişiler ===================
const contactForm = $('#contact-form');
$('#contact-reset').onclick = () => { contactForm.reset(); contactForm.id.value = ''; };
contactForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(contactForm);
  try {
    const phone = normalizePhone(fd.get('phone'));
    const payload = { name: fd.get('name').trim(), phone };
    const id = contactForm.id.value;
    if (id) await updateDoc(doc(db, 'contacts', id), payload);
    else await addDoc(col('contacts'), payload);
    contactForm.reset(); contactForm.id.value = '';
    toast('Kaydedildi.');
  } catch (err) { toast(err.message); }
};

function renderContacts(items) {
  contacts = items;
  const ul = $('#contact-list');
  ul.innerHTML = '';
  items.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="li-main"><div class="li-title">${c.name}</div><div class="li-sub">${c.phone}</div></div>
      <div class="li-actions"><button class="icon-btn">✎</button><button class="icon-btn danger">🗑</button></div>`;
    const [edit, del] = li.querySelectorAll('button');
    edit.onclick = () => { contactForm.id.value = c.id; contactForm.name.value = c.name; contactForm.phone.value = c.phone; window.scrollTo({ top: 0, behavior: 'smooth' }); };
    del.onclick = async () => { if (confirm('Silinsin mi?')) { await deleteDoc(doc(db, 'contacts', c.id)); toast('Silindi.'); } };
    ul.appendChild(li);
  });
  autoForm.contactId.innerHTML = items.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')
    || '<option value="">(önce kişi ekleyin)</option>';
}

// =================== Mesajlar ===================
const messageForm = $('#message-form');
messageForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(messageForm);
  await addDoc(col('messages'), { text: fd.get('text').trim(), isActive: true });
  messageForm.reset();
  toast('Eklendi.');
};

function renderMessages(items) {
  messages = items;
  const ul = $('#message-list');
  ul.innerHTML = '';
  items.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="li-main"><div class="li-title">${m.text} <span class="badge ${m.isActive ? 'ok' : 'off'}">${m.isActive ? 'aktif' : 'pasif'}</span></div></div>
      <div class="li-actions"><button class="icon-btn" title="Aç/Kapat">${m.isActive ? '⏸' : '▶'}</button><button class="icon-btn danger">🗑</button></div>`;
    const [toggle, del] = li.querySelectorAll('button');
    toggle.onclick = async () => await updateDoc(doc(db, 'messages', m.id), { isActive: !m.isActive });
    del.onclick = async () => { if (confirm('Silinsin mi?')) { await deleteDoc(doc(db, 'messages', m.id)); toast('Silindi.'); } };
    ul.appendChild(li);
  });
  autoForm.messageId.innerHTML = items.map((m) => `<option value="${m.id}">${m.text.slice(0, 48)}</option>`).join('');
}

// =================== Kayıtlar ===================
function renderLogs(items) {
  const ul = $('#log-list');
  ul.innerHTML = '';
  if (!items.length) { ul.innerHTML = '<li class="li-main"><div class="li-sub">Henüz kayıt yok.</div></li>'; return; }
  items.forEach((l) => {
    const ok = l.status === 'Basarili' || l.status === 'Başarılı';
    const when = l.sentAt?.toDate ? l.sentAt.toDate().toLocaleString('tr-TR') : '';
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="li-main">
        <div class="li-title">${l.contactName || l.phone || '-'} <span class="badge ${ok ? 'ok' : 'err'}">${l.status}</span></div>
        <div class="li-sub">${when} · ${l.message || l.error || ''}</div>
      </div>`;
    ul.appendChild(li);
  });
}

// =================== Motor durumu ===================
function renderEngine(settings) {
  const pill = $('#engine-pill');
  const text = $('#engine-text');
  const beat = settings?.engineHeartbeat?.toDate ? settings.engineHeartbeat.toDate() : null;
  const online = beat && (Date.now() - beat.getTime() < 5 * 60 * 1000);
  pill.className = 'pill ' + (online ? 'pill--ok' : 'pill--off');
  text.textContent = online ? 'Motor çevrimiçi' : 'Motor çevrimdışı';
}

// =================== Canlı dinleyiciler ===================
function start() {
  toggleModeFields();
  onSnapshot(query(col('contacts'), orderBy('name')), (s) => renderContacts(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  onSnapshot(col('messages'), (s) => renderMessages(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  onSnapshot(col('automations'), (s) => renderAutomations(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  onSnapshot(query(col('logs'), orderBy('sentAt', 'desc'), limit(100)), (s) => renderLogs(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  onSnapshot(doc(db, 'settings', 'global'), (d) => renderEngine(d.data()));
}
start();
