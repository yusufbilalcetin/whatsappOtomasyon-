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
function toggleModeFields() {
  const mode = autoForm.messageMode.value;
  $$('#automation-form [data-mode]').forEach((el) => el.classList.toggle('hidden', el.dataset.mode !== mode));
}
autoForm.messageMode.onchange = toggleModeFields;

function resetAutomationForm() {
  autoForm.reset();
  autoForm.id.value = '';
  $$('#automation-form input[name="days"]').forEach((cb) => (cb.checked = true));
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
  if (!fd.get('contactId')) return toast('Önce bir kişi ekleyin.');
  const mode = fd.get('messageMode');
  if (mode === 'fixed' && !fd.get('messageText').trim()) return toast('Mesaj yazın.');
  if (mode === 'ai' && !fd.get('aiPrompt').trim()) return toast('AI isteği yazın.');
  const payload = {
    name: fd.get('name').trim(),
    contactId: fd.get('contactId'),
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
    const c = contacts.find((x) => x.id === a.contactId);
    const days = (a.days || []).map((d) => dayTr[d] || d).join(' ');
    const modeTr = { fixed: 'Mesaj', ai: 'AI' }[a.messageMode] || a.messageMode;
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
    del.onclick = async () => { if (confirm('Silinsin mi?')) { await deleteDoc(uItem('automations', a.id)); toast('Silindi.'); } };
    ul.appendChild(li);
  });
}

function fillAutomation(a) {
  autoForm.id.value = a.id;
  autoForm.name.value = a.name || '';
  autoForm.contactId.value = a.contactId || '';
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
const contactForm = $('#contact-form');
$('#contact-reset').onclick = () => { contactForm.reset(); contactForm.id.value = ''; };
contactForm.onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(contactForm);
  try {
    const phone = normalizePhone(fd.get('phone'));
    const payload = { name: fd.get('name').trim(), phone };
    const id = contactForm.id.value;
    if (id) await updateDoc(uItem('contacts', id), payload);
    else await addDoc(uCol('contacts'), payload);
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
    del.onclick = async () => { if (confirm('Silinsin mi?')) { await deleteDoc(uItem('contacts', c.id)); toast('Silindi.'); } };
    ul.appendChild(li);
  });
  autoForm.contactId.innerHTML = items.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')
    || '<option value="">(önce kişi ekleyin)</option>';
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

// =================== Motor + WhatsApp durumu ===================
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
  qr.classList.add('hidden');
  if (!engineOnline) text.textContent = 'Motor çevrimdışı. Mesaj gönderimi için motoru (bilgisayar/sunucu) çalıştırın.';
  else if (s.waState === 'open') text.textContent = '✓ WhatsApp bağlı. Otomasyonlar çalışmaya hazır.';
  else if (s.waState === 'qr' && s.waQr) { text.textContent = 'Telefonunuzla bu QR kodu okutun:'; qr.src = s.waQr; qr.classList.remove('hidden'); }
  else if (s.waState === 'connecting') text.textContent = 'WhatsApp’a bağlanılıyor…';
  else if (s.waState === 'logged_out') text.textContent = 'Oturum kapandı. Motoru yeniden başlatıp QR’ı tekrar okutun.';
  else text.textContent = 'WhatsApp bağlantısı bekleniyor…';
}

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
  unsubs.push(onSnapshot(query(uCol('contacts'), orderBy('name')), (s) => renderContacts(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  unsubs.push(onSnapshot(uCol('automations'), (s) => renderAutomations(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  unsubs.push(onSnapshot(query(uCol('logs'), orderBy('sentAt', 'desc'), limit(100)), (s) => renderLogs(s.docs.map((d) => ({ id: d.id, ...d.data() })))));
  unsubs.push(onSnapshot(userRef(), (d) => renderEngine(d.data())));
}

onAuthStateChanged(auth, async (user) => {
  unsubs.forEach((fn) => fn());
  unsubs = [];
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
