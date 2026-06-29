import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, limit, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, GoogleAuthProvider, signInWithPopup,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let uid = null;
let unsubs = [];
let contacts = [];
const selectedContactIdsState = new Set();
let contactPickerOpen = false;

// Kullaniciya ozel koleksiyon/dokuman referanslari
const uCol = (name) => collection(db, 'users', uid, name);
const uItem = (name, id) => doc(db, 'users', uid, name, id);
const userRef = () => doc(db, 'users', uid);

const DAYS = [['mon', 'Pzt'], ['tue', 'Sal'], ['wed', 'Çar'], ['thu', 'Per'], ['fri', 'Cum'], ['sat', 'Cmt'], ['sun', 'Paz']];
const dayTr = Object.fromEntries(DAYS);

// --- Toast ---
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// --- Telefon dogrulama ---
function normalizePhone(phone) {
  let v = String(phone).replace(/[\s\-()]/g, '').trim();
  if (v.startsWith('00')) v = '+' + v.slice(2);
  else if (v.startsWith('0') && v.length === 11) v = '+90' + v.slice(1);
  else if (v.startsWith('90') && !v.startsWith('+')) v = '+' + v;
  else if (v.startsWith('5') && v.length === 10) v = '+90' + v;
  if (!/^\+[1-9]\d{7,14}$/.test(v)) throw new Error('Telefon formatı hatalı. Örn: +905xxxxxxxxx');
  return v;
}

// =================== Sekmeler ===================
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
function selectedContactIds() {
  return [...selectedContactIdsState];
}
function setSelectedContacts(ids) {
  selectedContactIdsState.clear();
  (ids || []).forEach((id) => selectedContactIdsState.add(id));
  renderContactPicker();
}
function toggleModeFields() {
  const mode = autoForm.messageMode.value;
  $$('#automation-form [data-mode]').forEach((el) => el.classList.toggle('hidden', el.dataset.mode !== mode));
}
autoForm.messageMode.onchange = toggleModeFields;

function resetAutomationForm() {
  autoForm.reset();
  autoForm.id.value = '';
  $$('#automation-form input[name="days"]').forEach((cb) => (cb.checked = true));
  setSelectedContacts([]);
  autoForm.time.value = '08:00';
  $('#automation-title').textContent = 'Yeni otomasyon';
  toggleModeFields();
}
$('#automation-reset').onclick = resetAutomationForm;

autoForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(autoForm);
  const days = fd.getAll('days');
  if (!days.length) return toast('En az bir gün seçin.');
  const contactIds = selectedContactIds();
  if (!contactIds.length) return toast('En az bir kişi seçin.');
  const mode = fd.get('messageMode');
  if (mode === 'fixed' && !fd.get('messageText').trim()) return toast('Mesaj yazın.');
  if (mode === 'ai' && !fd.get('aiPrompt').trim()) return toast('AI isteği yazın.');
  const payload = {
    name: fd.get('name').trim(),
    contactIds,
    time: fd.get('time'),
    messageMode: mode,
    messageText: fd.get('messageText').trim(),
    aiPrompt: fd.get('aiPrompt').trim(),
    enabled: autoForm.enabled.checked,
    days,
    timezone: 'Europe/Istanbul',
  };
  try {
    const id = autoForm.id.value;
    if (id) await updateDoc(uItem('automations', id), payload);
    else await addDoc(uCol('automations'), { ...payload, lastRunDate: '' });
    resetAutomationForm();
    toast('Kaydedildi.');
  } catch (err) { toast(err.message); }
};

function renderAutomations(items) {
  const ul = $('#automation-list');
  ul.innerHTML = '';
  if (!items.length) { ul.innerHTML = '<li class="li-main"><div class="li-sub">Henüz otomasyon yok.</div></li>'; return; }
  items.forEach((a) => {
    const ids = a.contactIds?.length ? a.contactIds : (a.contactId ? [a.contactId] : []);
    const names = ids.map((id) => {
      const contact = contacts.find((x) => x.id === id);
      return contact ? contactName(contact) : '';
    }).filter(Boolean);
    const who = names.length ? names.join(', ') : '(kişi yok)';
    const days = (a.days || []).map((d) => dayTr[d] || d).join(' ');
    const modeTr = { fixed: 'Mesaj', ai: 'AI' }[a.messageMode] || a.messageMode;
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="li-main">
        <div class="li-title">${a.name} <span class="badge ${a.enabled ? 'ok' : 'off'}">${a.enabled ? 'aktif' : 'pasif'}</span></div>
        <div class="li-sub">${a.time} · ${who} · ${modeTr} · ${days}</div>
      </div>
      <div class="li-actions">
        <button class="icon-btn" title="Hemen gönder">▶</button>
        <button class="icon-btn" title="Düzenle">✎</button>
        <button class="icon-btn danger" title="Sil">🗑</button>
      </div>`;
    const [test, edit, del] = li.querySelectorAll('button');
    test.onclick = async () => {
      try {
        await addDoc(uCol('commands'), { type: 'runNow', automationId: a.id, createdAt: serverTimestamp() });
        toast('Gönderiliyor…');
      } catch (e) { toast(e.message); }
    };
    edit.onclick = () => fillAutomation(a);
    del.onclick = async () => { if (confirm('Silinsin mi?')) { await deleteDoc(uItem('automations', a.id)); toast('Silindi.'); } };
    ul.appendChild(li);
  });
}

function fillAutomation(a) {
  autoForm.id.value = a.id;
  autoForm.name.value = a.name || '';
  setSelectedContacts(a.contactIds?.length ? a.contactIds : (a.contactId ? [a.contactId] : []));
  autoForm.time.value = a.time || '08:00';
  autoForm.messageMode.value = a.messageMode || 'fixed';
  autoForm.messageText.value = a.messageText || '';
  autoForm.aiPrompt.value = a.aiPrompt || '';
  autoForm.enabled.checked = !!a.enabled;
  $$('#automation-form input[name="days"]').forEach((cb) => (cb.checked = (a.days || []).includes(cb.value)));
  $('#automation-title').textContent = 'Otomasyonu düzenle';
  toggleModeFields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =================== Kişiler ===================
function searchText(v) {
  return String(v || '').toLocaleLowerCase('tr-TR').trim();
}

function contactDetail(c) {
  return c.type === 'group' ? 'Grup' : (c.phone || '');
}

function contactName(c) {
  return c.customName || c.name || c.phone || c.jid || '';
}

function matchesContact(c, term) {
  const q = searchText(term);
  if (!q) return true;
  return [c.customName, c.name, c.phone, c.jid, c.type === 'group' ? 'grup' : 'kişi']
    .some((v) => searchText(v).includes(q));
}

// Tek bir kişi/grup satırı oluşturur.
function buildContactLi(c) {
  const li = document.createElement('li');
  const renamed = c.customName ? ' <span class="badge ok">özel ad</span>' : '';
  li.innerHTML = `
    <div class="li-main"><div class="li-title">${contactName(c)}${renamed}</div><div class="li-sub">${contactDetail(c)}</div></div>
    <div class="li-actions">
      <button class="icon-btn" title="İsim ver / düzenle">✎</button>
    </div>`;
  li.querySelector('button').onclick = () => startRenameContact(li, c);
  return li;
}

// Bir kategori başlığı (Kişiler / Gruplar) oluşturur.
function categoryHeader(title, count) {
  const li = document.createElement('li');
  li.className = 'list-category';
  li.innerHTML = `<div class="li-sub"><strong>${title}</strong> (${count})</div>`;
  return li;
}

function renderContactList() {
  const ul = $('#contact-list');
  const term = $('#contact-search')?.value || '';
  const filtered = contacts.filter((c) => matchesContact(c, term));

  ul.innerHTML = '';
  if (!contacts.length) {
    ul.innerHTML = '<li class="li-main"><div class="li-sub">WhatsApp bağlandıktan sonra kişiler ve gruplar burada görünecek.</div></li>';
    return;
  }
  if (!filtered.length) {
    ul.innerHTML = '<li class="li-main"><div class="li-sub">Aramaya uygun kişi veya grup yok.</div></li>';
    return;
  }

  const groups = filtered.filter((c) => c.type === 'group');
  const people = filtered.filter((c) => c.type !== 'group');

  if (people.length) {
    ul.appendChild(categoryHeader('Kişiler', people.length));
    people.forEach((c) => ul.appendChild(buildContactLi(c)));
  }
  if (groups.length) {
    ul.appendChild(categoryHeader('Gruplar', groups.length));
    groups.forEach((c) => ul.appendChild(buildContactLi(c)));
  }
}

// Kişiye panelden özel ad ver (WhatsApp isim getirmediğinde). customName WhatsApp senkronunda korunur.
function startRenameContact(li, c) {
  const main = li.querySelector('.li-main');
  main.innerHTML = `
    <div class="rename-row">
      <input class="rename-input" type="text" maxlength="60" placeholder="${c.phone || 'İsim'}" />
      <button type="button" class="btn btn-primary btn-sm rename-save">Kaydet</button>
      <button type="button" class="btn btn-ghost btn-sm rename-cancel">Vazgeç</button>
    </div>
    <div class="li-sub">${contactDetail(c)}</div>`;
  const input = main.querySelector('.rename-input');
  input.value = c.customName || '';
  input.focus();
  const save = async () => {
    try {
      await updateDoc(uItem('contacts', c.id), { customName: input.value.trim() });
      toast('İsim güncellendi.');
    } catch (e) { toast(e.message); renderContactList(); }
  };
  main.querySelector('.rename-save').onclick = save;
  main.querySelector('.rename-cancel').onclick = () => renderContactList();
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); save(); }
    if (e.key === 'Escape') renderContactList();
  };
}

function renderSelectedContacts() {
  const wrap = $('#selected-contacts');
  if (!wrap) return;

  wrap.innerHTML = '';
  const selected = selectedContactIds().map((id) => contacts.find((c) => c.id === id)).filter(Boolean);
  if (!selected.length) {
    wrap.innerHTML = '<span class="muted small">Seçili kişi yok.</span>';
    return;
  }

  selected.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'selected-contact';
    item.innerHTML = `<span>${contactName(c)}</span><button type="button" aria-label="Kaldır">×</button>`;
    item.querySelector('button').onclick = () => {
      selectedContactIdsState.delete(c.id);
      renderContactPicker();
    };
    wrap.appendChild(item);
  });
}

function renderContactPicker() {
  renderSelectedContacts();

  const input = $('#contact-picker-input');
  const options = $('#contact-picker-options');
  if (!input || !options) return;

  const selected = new Set(selectedContactIds());
  const filtered = contacts
    .filter((c) => !selected.has(c.id) && matchesContact(c, input.value))
    .slice(0, 50);

  options.innerHTML = '';
  if (!contactPickerOpen) {
    options.classList.add('hidden');
    return;
  }

  if (!contacts.length) {
    options.innerHTML = '<div class="contact-option-empty">WhatsApp bağlandıktan sonra görünecek.</div>';
  } else if (!filtered.length) {
    options.innerHTML = '<div class="contact-option-empty">Sonuç yok.</div>';
  } else {
    filtered.forEach((c) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'contact-option';
      btn.innerHTML = `<span>${contactName(c)}</span><small>${contactDetail(c)}</small>`;
      btn.onclick = () => {
        selectedContactIdsState.add(c.id);
        input.value = '';
        contactPickerOpen = true;
        renderContactPicker();
        input.focus();
      };
      options.appendChild(btn);
    });
  }
  options.classList.remove('hidden');
}

// Kişi senkronu sırasında çok sık güncelleme gelir; yeniden çizimi geciktirip
// birleştir (debounce) ki ekran sürekli yenilenmiş gibi sıçramasın.
let contactsRenderTimer;
function renderContacts(items) {
  contacts = items; // veri hemen guncel olsun (arama/secim son veriyi kullansin)
  clearTimeout(contactsRenderTimer);
  contactsRenderTimer = setTimeout(() => {
    // Kullanıcı arama yazıyor veya isim düzenliyorsa listeyi bozma.
    const el = document.activeElement;
    const busy = el && (el.id === 'contact-search' || el.classList.contains('rename-input'));
    if (busy) return;
    renderContactList();
    renderContactPicker();
  }, 800);
}

$('#contact-search').oninput = renderContactList;

// Manuel kişi ekleme (WhatsApp'ta olmayan/isimsiz gelen kişiler için).
$('#contact-add-form').onsubmit = async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value.trim();
  let phone;
  try { phone = normalizePhone(form.phone.value); }
  catch (err) { return toast(err.message); }
  if (!name) return toast('İsim yazın.');
  const jid = `${phone.replace('+', '')}@s.whatsapp.net`;
  const id = jid.replace(/\//g, '_');
  try {
    await setDoc(uItem('contacts', id), {
      jid, phone, customName: name, type: 'user', source: 'manual',
    }, { merge: true });
    form.reset();
    toast('Kişi eklendi.');
  } catch (err) { toast(err.message); }
};
$('#contact-picker-input').onfocus = () => { contactPickerOpen = true; renderContactPicker(); };
$('#contact-picker-input').oninput = () => { contactPickerOpen = true; renderContactPicker(); };
$('#contact-picker-input').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const first = $('#contact-picker-options .contact-option');
  if (first) first.click();
};
document.addEventListener('click', (e) => {
  if ($('#contact-picker')?.contains(e.target)) return;
  contactPickerOpen = false;
  renderContactPicker();
});

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

// =================== Motor + WhatsApp durumu ===================
let lastRenderedQr = null;
function renderEngine(s = {}) {
  const beat = s.engineHeartbeat?.toDate ? s.engineHeartbeat.toDate() : null;
  const engineOnline = beat && (Date.now() - beat.getTime() < 3 * 60 * 1000);

  const pill = $('#engine-pill');
  const pillText = $('#engine-text');
  if (!engineOnline) { pill.className = 'pill pill--off'; pillText.textContent = 'Motor çevrimdışı'; }
  else if (s.waState === 'open') { pill.className = 'pill pill--ok'; pillText.textContent = 'WhatsApp bağlı'; }
  else { pill.className = 'pill pill--muted'; pillText.textContent = 'Motor açık · WhatsApp bekliyor'; }

  const text = $('#conn-text');
  const qr = $('#conn-qr');
  const disconnectBtn = $('#wa-disconnect-btn');
  const canResetWa = engineOnline && s.waState !== 'qr' && s.waState !== 'connecting';
  disconnectBtn.classList.toggle('hidden', !canResetWa);
  disconnectBtn.disabled = !canResetWa;

  // QR görselini yalnızca gerçekten değiştiğinde güncelle (sürekli yeniden yüklenip yanıp sönmesini önler).
  const showQr = engineOnline && s.waState === 'qr' && !!s.waQr;
  if (showQr) {
    if (s.waQr !== lastRenderedQr) { qr.src = s.waQr; lastRenderedQr = s.waQr; }
    qr.classList.remove('hidden');
  } else {
    lastRenderedQr = null;
    qr.classList.add('hidden');
  }

  if (!engineOnline) text.textContent = 'Motor çevrimdışı. Mesaj gönderimi için motoru (bilgisayar/sunucu) çalıştırın.';
  else if (s.waState === 'open') text.textContent = '✓ WhatsApp bağlı. Otomasyonlar çalışmaya hazır.';
  else if (showQr) text.textContent = 'Telefonunuzla bu QR kodu okutun:';
  else if (s.waState === 'connecting') text.textContent = 'WhatsApp’a bağlanılıyor…';
  else if (s.waState === 'logged_out') text.textContent = 'Oturum kapandı. Yeni QR oluşturmak için bağlantıyı kesin.';
  else text.textContent = 'WhatsApp bağlantısı bekleniyor…';
}

$('#contacts-sync-btn').onclick = async () => {
  try {
    await addDoc(uCol('commands'), { type: 'syncContacts', createdAt: serverTimestamp() });
    toast('Kişiler yeniden senkronize ediliyor…');
  } catch (e) { toast(e.message); }
};

$('#wa-disconnect-btn').onclick = async () => {
  if (!confirm('WhatsApp bağlantısı kesilsin ve yeni QR oluşturulsun mu?')) return;
  try {
    await addDoc(uCol('commands'), { type: 'disconnectWhatsApp', createdAt: serverTimestamp() });
    toast('Bağlantı kesiliyor, QR hazırlanıyor…');
  } catch (e) { toast(e.message); }
};

// =================== AI Otomatik Yanıt ===================
const aiForm = $('#ai-form');
function renderAiConfig(s = {}) {
  // Kullanıcı formla uğraşırken üzerine yazma.
  if (aiForm.contains(document.activeElement)) return;
  const cfg = s.autoReply || {};
  aiForm.enabled.checked = !!cfg.enabled;
  aiForm.persona.value = cfg.persona || '';
  aiForm.onlyContacts.checked = !!cfg.onlyContacts;
}
aiForm.onsubmit = async (e) => {
  e.preventDefault();
  try {
    await setDoc(userRef(), {
      autoReply: {
        enabled: aiForm.enabled.checked,
        persona: aiForm.persona.value.trim(),
        onlyContacts: aiForm.onlyContacts.checked,
      },
    }, { merge: true });
    toast('AI ayarları kaydedildi.');
  } catch (err) { toast(err.message); }
};

// =================== Giriş / Oturum ===================
function showAuth() {
  $('#auth-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}
function showApp() {
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
}

function startListeners() {
  toggleModeFields();
  unsubs.push(onSnapshot(uCol('contacts'), (s) => {
    const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => contactName(a).localeCompare(contactName(b), 'tr'));
    renderContacts(list);
  }));
  unsubs.push(onSnapshot(uCol('automations'), (s) => renderAutomations(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  unsubs.push(onSnapshot(query(uCol('logs'), orderBy('sentAt', 'desc'), limit(100)), (s) => renderLogs(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  unsubs.push(onSnapshot(userRef(), (d) => { const data = d.data() || {}; renderEngine(data); renderAiConfig(data); }));
}

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((fn) => fn());
  unsubs = [];
  selectedContactIdsState.clear();
  if (!user) { uid = null; showAuth(); return; }
  uid = user.uid;
  try { await setDoc(userRef(), { email: user.email || '', updatedAt: serverTimestamp() }, { merge: true }); } catch (e) { /* yoksay */ }
  $('#user-email').textContent = user.email || 'Hesabım';
  showApp();
  startListeners();
});

// --- Giriş / Kayıt ---
const authForm = $('#auth-form');
let authMode = 'login'; // 'login' | 'signup'

function showAuthError(msg) {
  const el = $('#auth-error');
  if (!msg) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = msg;
  el.classList.remove('hidden');
}

function setAuthMode(mode) {
  authMode = mode;
  $$('.auth-tab').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  $('#confirm-field').classList.toggle('hidden', mode !== 'signup');
  $('#auth-submit').textContent = mode === 'login' ? 'Giriş yap' : 'Kayıt ol';
  $('#auth-subtitle').textContent = mode === 'login' ? 'Hesabınıza giriş yapın' : 'Yeni hesap oluşturun';
  authForm.password.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
  showAuthError('');
}
$$('.auth-tab').forEach((b) => (b.onclick = () => setAuthMode(b.dataset.mode)));

$('#pw-toggle').onclick = () => {
  const inp = authForm.password;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  $('#pw-toggle').classList.toggle('on', inp.type === 'text');
};

authForm.onsubmit = async (e) => {
  e.preventDefault();
  showAuthError('');
  const email = authForm.email.value.trim();
  const pass = authForm.password.value;
  if (pass.length < 6) return showAuthError('Şifre en az 6 karakter olmalı.');
  if (authMode === 'signup' && pass !== authForm.password2.value) {
    return showAuthError('Şifreler eşleşmiyor.');
  }
  const btn = $('#auth-submit');
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = 'Lütfen bekleyin…';
  try {
    if (authMode === 'login') await signInWithEmailAndPassword(auth, email, pass);
    else await createUserWithEmailAndPassword(auth, email, pass);
  } catch (err) { showAuthError(authError(err)); }
  finally { btn.disabled = false; btn.textContent = prev; }
};

$('#google-btn').onclick = async () => {
  showAuthError('');
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (err) { showAuthError(authError(err)); }
};
$('#logout-btn').onclick = () => signOut(auth);

function authError(err) {
  const map = {
    'auth/invalid-email': 'Geçersiz e-posta.',
    'auth/missing-password': 'Şifre girin.',
    'auth/weak-password': 'Şifre en az 6 karakter olmalı.',
    'auth/email-already-in-use': 'Bu e-posta zaten kayıtlı.',
    'auth/invalid-credential': 'E-posta veya şifre hatalı.',
    'auth/popup-closed-by-user': 'Giriş penceresi kapatıldı.',
    'auth/unauthorized-domain': 'Bu alan adı Firebase’de yetkili değil (Authentication → Settings → Authorized domains).',
  };
  return map[err.code] || err.message;
}
