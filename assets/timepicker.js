// Apple tarzi wheel-picker saat secici. 24s "HH:MM" degerini gizli input'ta tutar,
// kullaniciya 12s "08:00 AM" gosterir.
const ITEM_H = 44; // px — .tp-col li yuksekligiyle ayni olmali

const $ = (s) => document.querySelector(s);

let trigger, overlay, panel, hidden, display, wheels;
let cols = {}; // { hour, minute, ampm } -> scroll container
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
  const col = wheels.querySelector(`[data-col="${name}"]`);
  col.innerHTML = '';
  const pad = document.createElement('div');
  pad.className = 'tp-pad';
  col.appendChild(pad.cloneNode());
  data[name].forEach((val) => {
    const li = document.createElement('div');
    li.className = 'tp-item';
    li.textContent = val;
    li.dataset.value = val;
    col.appendChild(li);
  });
  col.appendChild(pad.cloneNode());
  cols[name] = col;

  let raf;
  col.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => highlight(name));
  });
}

function indexOf(name) {
  return Math.round(cols[name].scrollTop / ITEM_H);
}
function highlight(name) {
  const idx = indexOf(name);
  cols[name].querySelectorAll('.tp-item').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
}
function scrollTo(name, value) {
  const i = data[name].indexOf(value);
  cols[name].scrollTop = Math.max(0, i) * ITEM_H;
  highlight(name);
}
function valueOf(name) {
  const idx = Math.min(Math.max(indexOf(name), 0), data[name].length - 1);
  return data[name][idx];
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
function confirm() {
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
  $('#tp-ok').addEventListener('click', confirm);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  syncTimeDisplay();
}
