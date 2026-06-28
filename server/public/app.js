const api = async (path, options = {}) => {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || res.statusText);
  }
  return res.status === 204 ? null : res.json();
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let contactsCache = [];
let messagesCache = [];

// --- Sekmeler ---
$$('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    $$('.tabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    $$('.tab').forEach((t) => t.classList.add('hidden'));
    $('#tab-' + btn.dataset.tab).classList.remove('hidden');
  };
});

// --- Durum / QR ---
async function refreshStatus() {
  try {
    const { whatsapp } = await api('/status');
    const el = $('#wa-status');
    el.className = 'status ' + whatsapp.state;
    const labels = { open: 'Bagli', qr: 'QR bekleniyor', connecting: 'Baglaniyor', disconnected: 'Bagli degil' };
    el.textContent = labels[whatsapp.state] || whatsapp.state;
    const qrBox = $('#qr-box');
    if (whatsapp.state === 'qr' && whatsapp.qr) {
      $('#qr-img').src = whatsapp.qr;
      qrBox.classList.remove('hidden');
    } else {
      qrBox.classList.add('hidden');
    }
  } catch (e) {
    $('#wa-status').textContent = 'Sunucuya ulasilamiyor';
  }
}

// --- Otomasyonlar ---
const autoForm = $('#automation-form');
function toggleModeFields() {
  const mode = autoForm.messageMode.value;
  $$('#automation-form [data-mode]').forEach((el) => {
    el.classList.toggle('hidden', el.dataset.mode !== mode);
  });
}
autoForm.messageMode.onchange = toggleModeFields;

$('#automation-reset').onclick = () => {
  autoForm.reset();
  autoForm.id.value = '';
  toggleModeFields();
};

autoForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(autoForm);
  const payload = {
    name: fd.get('name'),
    contactId: fd.get('contactId'),
    time: fd.get('time'),
    messageMode: fd.get('messageMode'),
    messageId: fd.get('messageId') || null,
    aiPrompt: fd.get('aiPrompt') || '',
    enabled: fd.get('enabled') === 'on',
    days: fd.getAll('days'),
  };
  const id = autoForm.id.value;
  try {
    if (id) await api('/automations/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/automations', { method: 'POST', body: JSON.stringify(payload) });
    autoForm.reset();
    autoForm.id.value = '';
    toggleModeFields();
    loadAutomations();
  } catch (err) { alert(err.message); }
};

async function loadAutomations() {
  const list = await api('/automations');
  const ul = $('#automation-list');
  ul.innerHTML = '';
  const dayTr = { mon: 'Pzt', tue: 'Sal', wed: 'Car', thu: 'Per', fri: 'Cum', sat: 'Cmt', sun: 'Paz' };
  list.forEach((a) => {
    const contact = contactsCache.find((c) => c.id === a.contactId);
    const li = document.createElement('li');
    const days = (a.days || []).map((d) => dayTr[d] || d).join(' ');
    li.innerHTML = `
      <div>
        <div>${a.name} <span class="badge ${a.enabled ? 'ok' : 'off'}">${a.enabled ? 'aktif' : 'pasif'}</span></div>
        <div class="meta">${a.time} · ${contact ? contact.name : '(kisi yok)'} · ${a.messageMode} · ${days}</div>
      </div>
      <div class="li-actions">
        <button class="ghost" data-run>Test</button>
        <button class="ghost" data-edit>Duzenle</button>
        <button class="danger" data-del>Sil</button>
      </div>`;
    li.querySelector('[data-run]').onclick = async () => {
      try { await api('/automations/' + a.id + '/run-now', { method: 'POST' }); alert('Gonderildi.'); loadLogs(); }
      catch (e) { alert(e.message); }
    };
    li.querySelector('[data-edit]').onclick = () => fillAutomationForm(a);
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Silinsin mi?')) return;
      await api('/automations/' + a.id, { method: 'DELETE' });
      loadAutomations();
    };
    ul.appendChild(li);
  });
}

function fillAutomationForm(a) {
  autoForm.id.value = a.id;
  autoForm.name.value = a.name || '';
  autoForm.contactId.value = a.contactId || '';
  autoForm.time.value = a.time || '08:00';
  autoForm.messageMode.value = a.messageMode || 'random';
  autoForm.messageId.value = a.messageId || '';
  autoForm.aiPrompt.value = a.aiPrompt || '';
  autoForm.enabled.checked = !!a.enabled;
  $$('#automation-form input[name="days"]').forEach((cb) => {
    cb.checked = (a.days || []).includes(cb.value);
  });
  toggleModeFields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Kisiler ---
const contactForm = $('#contact-form');
contactForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(contactForm);
  const payload = { name: fd.get('name'), phone: fd.get('phone') };
  const id = contactForm.id.value;
  try {
    if (id) await api('/contacts/' + id, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/contacts', { method: 'POST', body: JSON.stringify(payload) });
    contactForm.reset();
    contactForm.id.value = '';
    await loadContacts();
  } catch (err) { alert(err.message); }
};

async function loadContacts() {
  contactsCache = await api('/contacts');
  const ul = $('#contact-list');
  ul.innerHTML = '';
  contactsCache.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<div>${c.name}<div class="meta">${c.phone}</div></div>
      <div class="li-actions">
        <button class="ghost" data-edit>Duzenle</button>
        <button class="danger" data-del>Sil</button>
      </div>`;
    li.querySelector('[data-edit]').onclick = () => {
      contactForm.id.value = c.id; contactForm.name.value = c.name; contactForm.phone.value = c.phone;
    };
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Silinsin mi?')) return;
      await api('/contacts/' + c.id, { method: 'DELETE' }); loadContacts();
    };
    ul.appendChild(li);
  });
  // Otomasyon formundaki kisi listesini doldur.
  autoForm.contactId.innerHTML = contactsCache
    .map((c) => `<option value="${c.id}">${c.name}</option>`).join('');
}

// --- Mesajlar ---
const messageForm = $('#message-form');
messageForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(messageForm);
  const id = messageForm.id.value;
  const payload = { text: fd.get('text'), isActive: true };
  if (id) await api('/messages/' + id, { method: 'PUT', body: JSON.stringify(payload) });
  else await api('/messages', { method: 'POST', body: JSON.stringify(payload) });
  messageForm.reset();
  messageForm.id.value = '';
  loadMessages();
};

async function loadMessages() {
  messagesCache = await api('/messages');
  const ul = $('#message-list');
  ul.innerHTML = '';
  messagesCache.forEach((m) => {
    const li = document.createElement('li');
    li.innerHTML = `<div>${m.text} <span class="badge ${m.isActive ? 'ok' : 'off'}">${m.isActive ? 'aktif' : 'pasif'}</span></div>
      <div class="li-actions">
        <button class="ghost" data-toggle>${m.isActive ? 'Pasiflestir' : 'Aktiflestir'}</button>
        <button class="danger" data-del>Sil</button>
      </div>`;
    li.querySelector('[data-toggle]').onclick = async () => {
      await api('/messages/' + m.id, { method: 'PUT', body: JSON.stringify({ text: m.text, isActive: !m.isActive }) });
      loadMessages();
    };
    li.querySelector('[data-del]').onclick = async () => {
      if (!confirm('Silinsin mi?')) return;
      await api('/messages/' + m.id, { method: 'DELETE' }); loadMessages();
    };
    ul.appendChild(li);
  });
  autoForm.messageId.innerHTML = messagesCache
    .map((m) => `<option value="${m.id}">${m.text.slice(0, 40)}</option>`).join('');
}

// --- Kayitlar ---
async function loadLogs() {
  const logs = await api('/logs');
  const ul = $('#log-list');
  ul.innerHTML = '';
  logs.forEach((l) => {
    const li = document.createElement('li');
    const when = l.sentAt ? new Date(l.sentAt).toLocaleString('tr-TR') : '';
    const ok = l.status === 'Basarili';
    li.innerHTML = `<div>${l.contactName || l.phone}
        <span class="badge ${ok ? 'ok' : 'err'}">${l.status}</span>
        <div class="meta">${when} · ${l.message || l.error || ''}</div>
      </div>`;
    ul.appendChild(li);
  });
}
$('#logs-refresh').onclick = loadLogs;

// --- Baslat ---
async function init() {
  toggleModeFields();
  await loadContacts();
  await loadMessages();
  await loadAutomations();
  await loadLogs();
  await refreshStatus();
  setInterval(refreshStatus, 5000);
}
init();
