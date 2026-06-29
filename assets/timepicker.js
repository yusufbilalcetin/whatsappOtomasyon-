// Apple tarzi wheel-picker saat secici. 24s "HH:MM" degerini gizli input'ta tutar,
// kullaniciya 12s "08:00 AM" gosterir.
const ITEM_H = 44; // px — .tp-item yuksekligiyle ayni olmali

const $ = (s) => document.querySelector(s);

let trigger, overlay, panel, hidden, display, wheels;
const cols = {}; // name -> { el, items: [], active: -1, raf: 0 }
const data = {
  hour: Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')),
  minute: Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0')),
  ampm: ['AM', 'PM'],
};

function from24(hhmm) {
  const [H, M] = (hhmm || '08:00').split(':').map(Number);
  const ampm = H >= 12 ? 'PM' : 'AM';
  let h12 = H % 12;
  if (h12 === 0) h12 = 12;
  return { hour: String(h12).padStart(2, '0'), minute: String(M).padStart(2, '0'), ampm };
}
function to24(hour, minute, ampm) {
  let H = Number(hour) % 12;
  if (ampm === 'PM') H += 12;
  return `${String(H).padStart(2, '0')}:${minute}`;
}

export function syncTimeDisplay() {
  const { hour, minute, ampm } = from24(hidden.value);
  display.textContent = `${hour}:${minute} ${ampm}`;
}

function buildColumn(name) {
  const el = wheels.querySelector(`[data-col="${name}"]`);
  el.innerHTML = '';
  const frag = document.createDocumentFragment();
  const pad = document.createElement('div');
  pad.className = 'tp-pad';
  frag.appendChild(pad.cloneNode());
  const items = data[name].map((val) => {
    const li = document.createElement('div');
    li.className = 'tp-item';
    li.textContent = val;
    frag.appendChild(li);
    return li;
  });
  frag.appendChild(pad.cloneNode());
  el.appendChild(frag);

  const col = { el, items, active: -1, raf: 0 };
  cols[name] = col;

  // Sadece aktif (ortadaki) ogeyi guncelle — tum listeyi gezme, kasmayi onler.
  el.addEventListener('scroll', () => {
    if (col.raf) return;
    col.raf = requestAnimationFrame(() => {
      col.raf = 0;
      highlight(name);
    });
  }, { passive: true });
}

function clampIndex(name) {
  const idx = Math.round(cols[name].el.scrollTop / ITEM_H);
  return Math.min(Math.max(idx, 0), data[name].length - 1);
}
function highlight(name) {
  const col = cols[name];
  const idx = clampIndex(name);
  if (idx === col.active) return;
  if (col.active >= 0) col.items[col.active].classList.remove('active');
  col.items[idx].classList.add('active');
  col.active = idx;
}
function scrollTo(name, value) {
  const i = Math.max(0, data[name].indexOf(value));
  cols[name].el.scrollTop = i * ITEM_H;
  highlight(name);
}
function valueOf(name) {
  return data[name][clampIndex(name)];
}

function open() {
  const cur = from24(hidden.value);
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => {
    panel.classList.add('show');
    scrollTo('hour', cur.hour);
    scrollTo('minute', cur.minute);
    scrollTo('ampm', cur.ampm);
  });
}
function close() {
  panel.classList.remove('show');
  setTimeout(() => overlay.classList.add('hidden'), 180);
}
function confirmSel() {
  hidden.value = to24(valueOf('hour'), valueOf('minute'), valueOf('ampm'));
  syncTimeDisplay();
  close();
}

export function initTimePicker() {
  trigger = $('#time-trigger');
  overlay = $('#tp-overlay');
  panel = $('#tp-panel');
  hidden = $('#time-value');
  display = $('#time-display');
  wheels = $('#tp-wheels');

  ['hour', 'minute', 'ampm'].forEach(buildColumn);

  trigger.addEventListener('click', open);
  $('#tp-cancel').addEventListener('click', close);
  $('#tp-ok').addEventListener('click', confirmSel);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  syncTimeDisplay();
}
