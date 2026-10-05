/* ==========================================================================
   ui.js — Funzioni di interfaccia condivise
   --------------------------------------------------------------------------
   - Icone Lucide come stringhe SVG
   - Date e numeri in formato italiano
   - Toast, bottom sheet, conferme
   - Segmented control e header che si compatta durante lo scroll
   ========================================================================== */

/* --- Selettori e sicurezza ---------------------------------------------- */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Evita che il testo inserito dall'utente venga interpretato come HTML. */
export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* --- Icone --------------------------------------------------------------- */

/**
 * Restituisce l'SVG di un'icona Lucide (es. icon('dumbbell')).
 * Usa i dati delle icone della libreria caricata da CDN: così l'HTML
 * generato contiene già l'SVG e non serve una seconda passata sul DOM.
 */
export function icon(name, extraClass = '') {
  const lib = window.lucide && window.lucide.icons;
  const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, __, c) => c.toUpperCase());
  const node = lib && lib[pascal];
  if (!node) return '<svg class="lucide" viewBox="0 0 24 24"></svg>';
  const children = node
    .map(([tag, attrs]) =>
      `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`)
    .join('');
  return `<svg class="lucide lucide-${name} ${extraClass}" xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

/** Sostituisce i segnaposto <i data-lucide="..."> presenti nell'HTML statico. */
export function hydrateIcons(root = document) {
  $$('i[data-lucide]', root).forEach((el) => {
    el.outerHTML = icon(el.dataset.lucide);
  });
}

/* --- Date ---------------------------------------------------------------- */

const pad = (n) => String(n).padStart(2, '0');

/** Data locale in formato "AAAA-MM-GG". */
export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO() {
  return toISO(new Date());
}

/** Converte "AAAA-MM-GG" in Date a mezzanotte locale (niente sorprese col fuso). */
export function parseISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Lunedì della settimana che contiene la data. */
export function startOfWeek(iso) {
  const d = parseISO(iso);
  const day = (d.getDay() + 6) % 7; // lunedì = 0
  d.setDate(d.getDate() - day);
  return toISO(d);
}

const fmtCache = {};
function fmt(opts) {
  const k = JSON.stringify(opts);
  return (fmtCache[k] ||= new Intl.DateTimeFormat('it-IT', opts));
}

/** "Oggi", "Ieri" o "lun 5 ott" (con l'anno se diverso da quello corrente). */
export function formatDay(iso, { long = false } = {}) {
  const today = todayISO();
  if (iso === today) return 'Oggi';
  if (iso === addDays(today, -1)) return 'Ieri';
  if (iso === addDays(today, 1)) return 'Domani';
  const d = parseISO(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return fmt({
    weekday: long ? 'long' : 'short',
    day: 'numeric',
    month: long ? 'long' : 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/** Data completa senza "Oggi"/"Ieri", es. "lunedì 5 ottobre". */
export function formatFullDate(iso) {
  return fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(parseISO(iso));
}

export function formatShortDate(iso) {
  return fmt({ day: 'numeric', month: 'short' }).format(parseISO(iso));
}

/** "Ottobre 2026" */
export function formatMonth(iso) {
  const s = fmt({ month: 'long', year: 'numeric' }).format(parseISO(iso));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --- Numeri -------------------------------------------------------------- */

const numFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 });

/** 62.5 → "62,5"; 5240 → "5.240" */
export function fmtNum(n) {
  if (n === null || n === undefined || n === '' || Number.isNaN(n)) return '';
  return numFmt.format(n);
}

export function fmtInt(n) {
  return intFmt.format(Math.round(n || 0));
}

/** Legge un numero scritto con virgola o punto. Restituisce null se vuoto. */
export function parseNum(str) {
  if (str === null || str === undefined) return null;
  const s = String(str).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* --- Feedback ------------------------------------------------------------ */

/** Piccola vibrazione (dove supportata: Android. iOS la ignora). */
export function haptic(ms = 10) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

let toastTimer;
/** Messaggio breve in alto, scompare da solo. */
export function toast(message, { error = false } = {}) {
  const el = $('#toast');
  el.className = 'toast' + (error ? ' error' : '');
  el.innerHTML = icon(error ? 'circle-alert' : 'circle-check') + `<span>${esc(message)}</span>`;
  // Forza il reflow perché l'animazione riparta anche con toast ravvicinati
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* --- Bottom sheet -------------------------------------------------------- */

/**
 * Apre un foglio che sale dal basso.
 * @param {object} o
 * @param {string} o.title       Titolo del foglio
 * @param {string} o.html        Contenuto HTML del corpo
 * @param {string} [o.headerRight] HTML a destra del titolo (es. pulsante)
 * @param {boolean} [o.tall]     Foglio quasi a tutto schermo
 * @param {Function} [o.onClose] Chiamata alla chiusura
 * @returns {{el: HTMLElement, body: HTMLElement, close: Function}}
 */
export function openSheet({ title = '', html = '', headerRight = '', tall = false, onClose } = {}) {
  const backdrop = document.createElement('div');
  backdrop.className = 'backdrop';

  const sheet = document.createElement('div');
  sheet.className = 'sheet' + (tall ? ' tall' : '');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.innerHTML = `
    <div class="sheet-handle-area">
      <div class="sheet-handle"></div>
      <div class="sheet-header">
        <h2 class="sheet-title">${esc(title)}</h2>
        ${headerRight || `<button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button>`}
      </div>
    </div>
    <div class="sheet-body">${html}</div>`;

  document.body.append(backdrop, sheet);

  // Doppio requestAnimationFrame: garantisce che la transizione parta
  requestAnimationFrame(() => requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  }));

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (document.activeElement && sheet.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    sheet.classList.remove('open', 'dragging');
    sheet.style.transform = '';
    backdrop.classList.remove('open');
    setTimeout(() => { sheet.remove(); backdrop.remove(); }, 400);
    if (onClose) onClose();
  }

  backdrop.addEventListener('click', close);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });

  enableDragToDismiss(sheet, $('.sheet-handle-area', sheet), backdrop, close);

  return { el: sheet, body: $('.sheet-body', sheet), close };
}

/** Trascinando la maniglia verso il basso il foglio si chiude. */
function enableDragToDismiss(sheet, handle, backdrop, close) {
  let startY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let dragging = false;

  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    startY = lastY = e.clientY;
    lastT = performance.now();
    velocity = 0;
    sheet.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dy = Math.max(0, e.clientY - startY);
    const now = performance.now();
    velocity = (e.clientY - lastY) / Math.max(1, now - lastT);
    lastY = e.clientY;
    lastT = now;
    sheet.style.transform = `translateY(${dy}px)`;
    backdrop.style.opacity = String(Math.max(0, 1 - dy / 400));
  });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const dy = lastY - startY;
    backdrop.style.opacity = '';
    if (dy > 120 || velocity > 0.6) {
      close();
    } else {
      sheet.style.transform = '';
    }
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/**
 * Chiede conferma con un foglio. Restituisce una Promise<boolean>.
 */
export function confirmSheet({ title, message, confirmLabel = 'Conferma', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const s = openSheet({
      title,
      html: `
        <p class="confirm-text">${esc(message)}</p>
        <div class="sheet-actions">
          <button class="btn btn-block ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirmLabel)}</button>
          <button class="btn btn-block btn-secondary" data-close>Annulla</button>
        </div>`,
      onClose: () => { if (!answered) resolve(false); },
    });
    $('[data-ok]', s.body).addEventListener('click', () => {
      answered = true;
      resolve(true);
      s.close();
    });
  });
}

/* --- Segmented control --------------------------------------------------- */

/**
 * Attiva un controllo a segmenti: <div class="seg"><button data-value>...</button></div>
 * L'indicatore scorre sotto il pulsante attivo.
 */
export function initSeg(seg, onChange) {
  const buttons = $$('button', seg);
  let indicator = $('.seg-indicator', seg);
  if (!indicator) {
    indicator = document.createElement('span');
    indicator.className = 'seg-indicator';
    seg.prepend(indicator);
  }
  const place = () => {
    const i = Math.max(0, buttons.findIndex((b) => b.classList.contains('active')));
    indicator.style.width = `calc((100% - 6px) / ${buttons.length})`;
    indicator.style.transform = `translateX(${i * 100}%)`;
  };
  buttons.forEach((b) => b.addEventListener('click', () => {
    if (b.classList.contains('active')) return;
    buttons.forEach((x) => x.classList.toggle('active', x === b));
    place();
    haptic(5);
    onChange(b.dataset.value);
  }));
  place();
}

/* --- Header compatto durante lo scroll ---------------------------------- */

/** Mostra il titolo piccolo e lo sfondo sfocato quando il titolo grande esce dallo schermo. */
export function bindScrollHeader(scroller) {
  const bar = $('.topbar', scroller);
  if (!bar) return;
  const update = () => bar.classList.toggle('scrolled', scroller.scrollTop > 36);
  scroller.addEventListener('scroll', update, { passive: true });
  update();
}

/* --- Stato vuoto --------------------------------------------------------- */

export function emptyState({ iconName, title, text, action = '', compact = false }) {
  return `
    <div class="empty ${compact ? 'compact' : ''}">
      <div class="empty-icon">${icon(iconName)}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(text)}</p>
      ${action}
    </div>`;
}
