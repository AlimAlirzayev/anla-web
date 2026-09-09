/* ANLA — Big Five (IPIP-50) test runner.
   No build step, no framework, no network beyond the question file. Answers
   never leave the browser: progress lives in localStorage, a shared result
   travels in the URL hash and carries scores only, never item answers. */

'use strict';

const PER_PAGE = 5;
const STORE = 'anla.bigfive.v1';
const TRAIT_ORDER = ['E', 'A', 'C', 'N', 'O'];

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let DATA = null;
let answers = {};       // item id -> 1..5
let page = 0;
let form = 'full';      // 'full' = IPIP-50, 'mini' = the published Mini-IPIP 20
let sharedView = false; // true when the page is showing someone else's result

// Mini-IPIP is a PUBLISHED subset, flagged per item — never "the first twenty",
// which would destroy the balance of positively and negatively keyed items.
const items = () => (form === 'mini' ? DATA.items.filter((i) => i.mini) : DATA.items);
const pageCount = () => Math.ceil(items().length / PER_PAGE);

/* ----------------------------------------------------------------- scoring */

// Reverse-keyed items invert on the scale: 1 becomes 5. Each trait carries 10
// items, so a raw sum runs 10..50 and maps onto 0..100.
function score(all) {
  const out = {};
  for (const t of TRAIT_ORDER) {
    const mine = items().filter((i) => i.trait === t);
    let raw = 0;
    for (const item of mine) {
      const a = all[item.id];
      if (!a) return null;                       // incomplete -> no score
      raw += item.key === 1 ? a : (DATA.scale.max + DATA.scale.min) - a;
    }
    // Bounds come from the item count in play, so the short form scores on its
    // own range instead of being scaled against fifty answers it never asked.
    const lo = mine.length * DATA.scale.min;
    const hi = mine.length * DATA.scale.max;
    out[t] = Math.round(((raw - lo) / (hi - lo)) * 100);
  }
  return out;
}

const levelOf = (pct) => (pct >= 65 ? 'high' : pct <= 35 ? 'low' : 'mid');

/* -------------------------------------------------------------- persistence */

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ answers, page, form, at: Date.now() }));
  } catch { /* private mode — the test still works, it just won't resume */ }
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.answers && Object.keys(d.answers).length ? d : null;
  } catch { return null; }
}

/* -------------------------------------------------------------------- views */

function show(id) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('on', s.id === id);
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
}

function renderPage() {
  // Any pending auto-advance dies here. Without this, pressing "Növbəti" while
  // the timer was still running advanced twice and skipped five questions.
  clearTimeout(advanceTimer);
  const host = $('#q-host');
  host.textContent = '';
  const slice = items().slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  for (const item of slice) {
    const q = el('div', 'q');
    const text = el('div', 'text');
    text.append(el('span', 'num', `${item.id}.`), document.createTextNode(item.text));
    q.append(text);

    const group = el('div', 'likert');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', item.text);
    DATA.scale.labels.forEach((label, idx) => {
      const value = idx + DATA.scale.min;
      const lab = el('label');
      const input = el('input');
      input.type = 'radio';
      input.name = `q${item.id}`;
      input.value = String(value);
      input.checked = answers[item.id] === value;
      input.addEventListener('change', () => {
        answers[item.id] = value;
        save();
        syncNav();
        maybeAdvance();
      });
      // The visible cap is the short form; assistive tech gets the full anchor,
      // because "Heç" on its own does not say what it is short for.
      input.setAttribute('aria-label', label);
      lab.append(input, el('span', 'dot'), el('span', 'cap', DATA.scale.short[idx]));
      lab.title = label;
      group.append(lab);
    });
    q.append(group);
    host.append(q);
  }

  const first = page * PER_PAGE + 1;
  const last = Math.min((page + 1) * PER_PAGE, items().length);
  $('#p-label').textContent = `${first}–${last} / ${items().length}`;
  const done = Object.keys(answers).length;
  const pct = Math.round((done / items().length) * 100);
  $('#p-pct').textContent = `${pct}%`;
  $('#p-fill').style.width = `${pct}%`;
  $('#prev').disabled = page === 0;
  syncNav();
}

// Fifty items is ten button presses on top of fifty taps. When a page is
// complete the next one comes on its own, after a beat long enough to change
// your mind. Never on the last page: seeing your result should be deliberate.
let advanceTimer = null;
function maybeAdvance() {
  clearTimeout(advanceTimer);
  const slice = items().slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const isLast = (page + 1) * PER_PAGE >= items().length;
  if (isLast || slice.some((i) => !answers[i.id])) return;
  advanceTimer = setTimeout(() => {
    if (!$('#s-test').classList.contains('on')) return;
    page++; save(); renderPage();
  }, 650);
}

function syncNav() {
  const slice = items().slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  const missing = slice.filter((i) => !answers[i.id]).length;
  const isLast = (page + 1) * PER_PAGE >= items().length;
  $('#next').disabled = missing > 0;
  $('#next').textContent = isLast ? 'Nəticəmi göstər' : 'Növbəti';
  $('#nav-hint').textContent = missing > 0
    ? `${missing} ifadə cavabsızdır`
    : (isLast ? 'Hamısı hazırdır' : '');
  const done = Object.keys(answers).length;
  const pct = Math.round((done / items().length) * 100);
  $('#p-pct').textContent = `${pct}%`;
  $('#p-fill').style.width = `${pct}%`;
}

function renderResult(scores, { shared = false } = {}) {
  const host = $('#r-bars');
  host.textContent = '';

  sharedView = shared;
  const top = [...TRAIT_ORDER].sort((a, b) => scores[b] - scores[a])[0];
  const whose = shared ? 'Ən qabarıq ölçü' : 'Ən qabarıq ölçün';
  $('#r-title').textContent = shared ? 'Paylaşılan nəticə' : 'Sənin beş ölçün';
  $('#r-shared').hidden = !shared;
  $('#again').textContent = shared ? 'Testi mən də keçim' : 'Yenidən başla';
  $('#r-lead').textContent =
    `${whose} — ${DATA.traits[top].name.toLowerCase()}. `
    + 'Aşağıda beşinin hamısı var; heç biri təkbaşına səni izah etmir.';

  // The result must say which form produced it — a 20-item score and a 50-item
  // score look identical on screen and are not equally precise.
  const spec = DATA.forms[form];
  $('#r-form').innerHTML =
    `<b>${spec.name} versiya (${spec.items} ifadə):</b> ${spec.precision}`;
  $('#r-instrument').textContent = `Instrument: ${spec.instrument}.`;

  for (const t of TRAIT_ORDER) {
    const pct = scores[t];
    const trait = DATA.traits[t];
    const bar = el('div', 'bar');
    bar.dataset.t = t;

    const head = el('div', 'head');
    const name = el('div', 'name', trait.name);
    name.append(el('span', 'sub', trait.subtitle));
    head.append(name, el('div', 'val', `${pct}`));

    const rail = el('div', 'rail');
    const fill = el('i', 'fill');
    rail.append(fill);

    bar.append(head, rail, el('p', null, trait[levelOf(pct)]));
    host.append(bar);
    requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
  }
  show('s-result');
}

/* ---------------------------------------------------------- share + linking */

// #r=E62A78C55N40O88 — scores only. Short enough to survive every messenger.
const encodeScores = (s) => 'r=' + TRAIT_ORDER.map((t) => t + String(s[t]).padStart(2, '0')).join('')
  + (form === 'mini' ? 'f=m' : 'f=f');

function decodeScores(hash) {
  const m = /r=((?:[EACNO]\d{2}){5})/.exec(hash || '');
  if (!m) return null;
  form = /f=m/.test(hash) ? 'mini' : 'full';
  const out = {};
  for (const [, t, v] of m[1].matchAll(/([EACNO])(\d{2})/g)) out[t] = Number(v);
  return TRAIT_ORDER.every((t) => t in out) ? out : null;
}

function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The card reads the same CSS custom properties the page uses, so the palette
// has exactly one source of truth.
function drawCard(scores) {
  const c = $('#share-card');
  const g = c.getContext('2d');
  const W = c.width, H = c.height;

  g.fillStyle = token('--surface'); g.fillRect(0, 0, W, H);
  g.fillStyle = token('--accent');  g.fillRect(0, 0, W, 14);

  g.fillStyle = token('--ink-faint');
  g.font = '600 30px ' + token('--font');
  g.fillText('ANLA', 80, 120);

  g.fillStyle = token('--ink');
  g.font = '700 76px ' + token('--font');
  g.fillText('Beş Faktor', 80, 240);
  g.fillText('şəxsiyyət testi', 80, 330);

  g.fillStyle = token('--ink-soft');
  g.font = '400 32px ' + token('--font');
  // The card is shared without context, so it must not imply a precision the
  // answers behind it never had.
  g.fillText(`${DATA.forms[form].items} sual · tam azərbaycanca`, 80, 400);

  let y = 520;
  for (const t of TRAIT_ORDER) {
    const pct = scores[t];
    const colour = token('--trait-' + t.toLowerCase());

    g.fillStyle = token('--ink');
    g.font = '650 38px ' + token('--font');
    g.fillText(DATA.traits[t].name, 80, y);

    g.fillStyle = colour;
    g.font = '700 44px ' + token('--font');
    g.textAlign = 'right';
    g.fillText(String(pct), W - 80, y);
    g.textAlign = 'left';

    g.fillStyle = token('--surface-sunk');
    roundRect(g, 80, y + 22, W - 160, 22, 11); g.fill();
    g.fillStyle = colour;
    roundRect(g, 80, y + 22, Math.max(22, (W - 160) * pct / 100), 22, 11); g.fill();

    y += 140;
  }

  g.fillStyle = token('--ink-faint');
  g.font = '400 26px ' + token('--font');
  g.fillText('Bal = şkaladaki yer, əhali norması deyil.', 80, H - 110);
  g.fillText('Instrument: IPIP Big-Five Markers — ictimai mülkiyyət.', 80, H - 70);

  c.classList.add('on');
  return c;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function flash(btn, text) {
  const was = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = was; }, 1800);
}

/* --------------------------------------------------------------------- boot */

async function boot() {
  $('#year').textContent = new Date().getFullYear();

  try {
    const r = await fetch('data/questions.az.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    DATA = await r.json();
  } catch (err) {
    // Say what broke, in the operator's own language, instead of a blank page.
    $('#s-intro').innerHTML =
      '<h1>Suallar yüklənmədi</h1>'
      + '<p>Sual faylı açıla bilmədi, ona görə testi başlatmıram — yarımçıq test '
      + 'yanlış nəticə verər.</p><p class="meta">Texniki detal: '
      + String(err.message).replace(/[<>&]/g, '') + ' · <code>data/questions.az.json</code>. '
      + 'Səhifəni <code>file://</code> ilə açmısansa, brauzer faylı bloklayır — '
      + 'yerli server lazımdır.</p>';
    return;
  }

  const saved = load();
  if (saved) {
    const btn = $('#resume');
    btn.hidden = false;
    form = saved.form === 'mini' ? 'mini' : 'full';
    btn.textContent = `Yarımçıq testi davam et (${Object.keys(saved.answers).length}/${items().length})`;
    btn.addEventListener('click', () => {
      form = saved.form === 'mini' ? 'mini' : 'full';
      answers = saved.answers;
      page = Math.min(saved.page || 0, pageCount() - 1);
      show('s-test'); renderPage();
    });
  }

  for (const [id, chosen] of [['start-mini', 'mini'], ['start-full', 'full']]) {
    $(`#${id}`).addEventListener('click', () => {
      form = chosen; answers = {}; page = 0; save();
      show('s-test'); renderPage();
    });
  }

  $('#prev').addEventListener('click', () => {
    if (page === 0) return;
    page--; save(); renderPage();
  });

  $('#next').addEventListener('click', () => {
    const isLast = (page + 1) * PER_PAGE >= items().length;
    if (!isLast) { page++; save(); renderPage(); return; }
    const scores = score(answers);
    if (!scores) { syncNav(); return; }
    location.hash = encodeScores(scores);
    renderResult(scores);
  });

  $('#again').addEventListener('click', () => {
    const cameFromShare = sharedView;
    answers = {}; page = 0; sharedView = false;
    try { localStorage.removeItem(STORE); } catch { /* nothing to clear */ }
    history.replaceState(null, '', location.pathname);
    $('#share-card').classList.remove('on');
    // Arriving from a friend's link, the visitor already knows what this is —
    // send them straight into the questions instead of back to the pitch.
    if (cameFromShare) { form = 'full'; save(); show('s-test'); renderPage(); return; }
    show('s-intro');
  });

  // Both handlers grab the button synchronously: `event.currentTarget` is
  // already null once an await or a toBlob callback runs.
  $('#make-card').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const scores = decodeScores(location.hash) || score(answers);
    if (!scores) return;
    const canvas = drawCard(scores);
    canvas.toBlob((blob) => {
      if (!blob) { flash(btn, 'Şəkil yaradılmadı'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'anla-bes-faktor.png';
      a.click();
      URL.revokeObjectURL(a.href);
      flash(btn, 'Şəkil endirildi ✓');
    }, 'image/png');
  });

  $('#copy-link').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    try {
      await navigator.clipboard.writeText(location.href);
      flash(btn, 'Kopyalandı ✓');
    } catch {
      flash(btn, 'Kopyalamaq olmadı — linki əl ilə götür');
    }
  });

  // 1–5 answers the first unanswered item on the page — fast for repeat users.
  document.addEventListener('keydown', (ev) => {
    if (!$('#s-test').classList.contains('on')) return;
    const n = Number(ev.key);
    if (!(n >= DATA.scale.min && n <= DATA.scale.max)) return;
    const slice = items().slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
    const next = slice.find((i) => !answers[i.id]);
    if (!next) return;
    const input = document.querySelector(`input[name="q${next.id}"][value="${n}"]`);
    if (input) { input.checked = true; input.dispatchEvent(new Event('change')); }
  });

  // Decided last, once every control is live: a visitor arriving on someone
  // else's shared link must still be able to press every button on the page.
  const shared = decodeScores(location.hash);
  if (shared) renderResult(shared, { shared: true });
}

boot();
