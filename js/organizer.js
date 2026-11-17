/* ==========================================================================
   organizer.js — "Organizza settimana" della dieta
   --------------------------------------------------------------------------
   Calendario lunedì → domenica con colazione, pranzo e cena.
   - In basso i blocchi da sistemare (carne, uova, pesce… e le colazioni)
     con quanti ne restano rispetto al piano
   - Tieni premuto e trascina un blocco su una casella (da una casella a
     un'altra si scambiano), oppure tocca un blocco e poi la casella
   - Toccando una casella: blocco, spunta del carbo e cosa mangerai
   - "Copia settimana scorsa" e "Schema base"
   Ogni modifica è salvata subito.
   ========================================================================== */

import {
  $, esc, icon, toast, haptic, openSheet, confirmSheet, todayISO, addDays, startOfWeek, formatShortDate,
} from './ui.js';
import { CATEGORIES, WEEKDAYS } from './plan.js';
import { exportWeekImage } from './weekimage.js';
import {
  GRID_SLOTS, isMainSlot, blockLabel, breakfastOptions, breakfastText, getWeek, saveWeek, hasWeek, baseWeek,
  targets, used, carbsOfDay,
} from './weekplan.js';

const SLOT_LABEL = { colazione: 'Colazione', pranzo: 'Pranzo', cena: 'Cena' };
const MAX_FUTURE_WEEKS = 8;

const st = {
  weekStart: null,
  days: [],
  sel: null,       // blocco scelto dal basso: { group: 'main' | 'col', block }
  onClose: null,
};

const groupOf = (slot) => (isMainSlot(slot) ? 'main' : 'col');
/** Classe del colore del blocco. */
export const blockClass = (slot, block) => (isMainSlot(slot) ? `k-${block}` : 'k-col');

/** Blocco colorato (usato anche nella pagina Dieta). */
export function blockHTML(slot, block, extra = '') {
  if (!block) return '';
  return `<span class="blk ${blockClass(slot, block)} ${extra}">${esc(blockLabel(slot, block))}</span>`;
}

/** Spunta del carbo. */
export function carbHTML(on, attrs = '') {
  return `<span class="carb-tick ${on ? 'on' : ''}" ${attrs}><span class="carb-box">${on ? icon('check') : ''}</span>Carbo</span>`;
}

/* ==========================================================================
   Apertura e chiusura
   ========================================================================== */

export function openOrganizer(weekStart = startOfWeek(todayISO()), { onClose } = {}) {
  st.weekStart = weekStart;
  st.days = getWeek(weekStart);
  st.sel = null;
  st.onClose = onClose;
  const el = $('#diet-organizer');
  render();
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  el.scrollTop = 0;
  $('#tabbar').classList.add('hidden');
  bindOnce(el);
}

function close() {
  const el = $('#diet-organizer');
  el.classList.add('closing');
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  $('#tabbar').classList.remove('hidden');
  setTimeout(() => { el.classList.remove('closing'); el.innerHTML = ''; }, 400);
  st.onClose?.();
}

async function persist() {
  await saveWeek(st.weekStart, st.days);
  document.dispatchEvent(new CustomEvent('weekplan-changed'));
}

/* ==========================================================================
   Disegno
   ========================================================================== */

function weekName() {
  const now = startOfWeek(todayISO());
  if (st.weekStart === now) return 'Questa settimana';
  if (st.weekStart === addDays(now, 7)) return 'Settimana prossima';
  if (st.weekStart === addDays(now, -7)) return 'Settimana scorsa';
  return st.weekStart > now ? 'Settimana futura' : 'Settimana passata';
}

function render() {
  const el = $('#diet-organizer');
  const today = todayISO();
  const maxWeek = addDays(startOfWeek(today), 7 * MAX_FUTURE_WEEKS);
  const scrollTop = el.scrollTop;

  const rows = st.days.map((d, i) => {
    const date = addDays(st.weekStart, i);
    const twoCarbs = carbsOfDay(d) > 1;
    return `
      <div class="org-row ${date === today ? 'is-today' : ''} ${date < today ? 'is-past' : ''}">
        <div class="org-day ${twoCarbs ? 'warn' : ''}"><b>${WEEKDAYS[i].slice(0, 3)}</b><span class="num">${Number(date.slice(8))}</span></div>
        ${GRID_SLOTS.map((s) => cellHTML(i, s, d[s])).join('')}
      </div>`;
  }).join('');

  el.innerHTML = `
    <header class="topbar scrolled">
      <button class="back-btn" data-o="close">${icon('chevron-left')}<span>Dieta</span></button>
      <span class="topbar-title" style="opacity:1">Organizza settimana</span>
      <div class="topbar-actions"><button class="btn btn-ghost" data-o="close" style="font-weight:600">Fine</button></div>
    </header>
    <div class="day-nav" style="margin-top:var(--s-2)">
      <button class="icon-btn" data-o="prev" aria-label="Settimana precedente">${icon('chevron-left')}</button>
      <div class="week-label"><b>${esc(formatShortDate(st.weekStart))} – ${esc(formatShortDate(addDays(st.weekStart, 6)))}</b><span>${weekName()}${hasWeek(st.weekStart) ? '' : ' · schema base'}</span></div>
      <button class="icon-btn" data-o="next" aria-label="Settimana successiva" ${st.weekStart >= maxWeek ? 'disabled' : ''}>${icon('chevron-right')}</button>
    </div>
    <div class="org-actions">
      <button class="chip" data-o="copy">${icon('copy')}Copia settimana scorsa</button>
      <button class="chip" data-o="base">${icon('rotate-ccw')}Schema base</button>
      <button class="chip" data-o="image">${icon('image-down')}Salva immagine</button>
    </div>
    <div class="org-cols"><span></span>${GRID_SLOTS.map((s) => `<span>${SLOT_LABEL[s]}</span>`).join('')}</div>
    <div class="org-grid">${rows}</div>
    ${dockHTML()}`;
  el.scrollTop = scrollTop;
}

function cellHTML(i, slot, cell) {
  const compatible = st.sel && st.sel.group === groupOf(slot);
  const target = compatible ? 'target' : '';
  if (!cell?.block) {
    return `
      <button class="org-cell is-empty ${target}" data-d="${i}" data-s="${slot}">
        ${compatible ? 'Tocca per mettere qui' : `${icon('plus')}<span>Vuoto</span>`}
      </button>`;
  }
  return `
    <div class="org-cell ${target}" data-d="${i}" data-s="${slot}" role="button" tabindex="0">
      ${blockHTML(slot, cell.block, 'drag')}
      ${isMainSlot(slot) ? carbHTML(cell.carbo, 'data-carb') : ''}
      ${cell.note ? `<span class="org-note">${esc(cell.note)}</span>` : ''}
    </div>`;
}

function dockHTML() {
  const groups = [
    { id: 'main', slot: 'pranzo', title: 'Pranzo e cena', blocks: CATEGORIES.map((c) => c.id) },
    { id: 'col', slot: 'colazione', title: 'Colazione', blocks: breakfastOptions().map((o) => o.id) },
  ];
  let left = 0;
  const html = groups.map((g) => {
    const tg = targets(g.id);
    const us = used(st.days, g.id);
    const chips = g.blocks.map((b) => {
      const rest = (tg[b] || 0) - (us[b] || 0);
      if (rest > 0) left += rest;
      const sel = st.sel && st.sel.group === g.id && st.sel.block === b;
      return `
        <button class="blk ${blockClass(g.slot, b)} drag dock-blk ${sel ? 'sel' : ''} ${rest <= 0 ? 'spent' : ''}"
                data-dock="${g.id}" data-block="${esc(b)}">${esc(blockLabel(g.slot, b))}<span class="n ${rest < 0 ? 'neg' : ''}">${rest}</span></button>`;
    }).join('');
    return `<div class="dock-sub">${g.title}</div><div class="dock-chips">${chips}</div>`;
  }).join('');
  return `
    <div class="org-dock">
      <div class="dock-head">Blocchi da sistemare
        <span class="${left ? '' : 'ok'}">${left ? `${left} ${left === 1 ? 'rimasto' : 'rimasti'}` : `${icon('check')} Settimana completa`}</span></div>
      ${html}
      <div class="dock-hint">${icon('hand')}${st.sel ? 'Ora tocca una casella (tocca di nuovo il blocco per annullare)' : 'Tieni premuto e trascina, oppure tocca un blocco e poi una casella'}</div>
    </div>`;
}

/* ==========================================================================
   Modifiche
   ========================================================================== */

/** Mette un blocco in una casella, con gli avvisi del caso. */
async function place(dayIdx, slot, block) {
  const cell = st.days[dayIdx][slot];
  if (cell.block === block) return;
  cell.block = block;
  haptic(10);
  // Stesso alimento a pranzo e a cena dello stesso giorno
  if (isMainSlot(slot)) {
    const other = slot === 'pranzo' ? 'cena' : 'pranzo';
    if (st.days[dayIdx][other].block === block) toast(`${blockLabel(slot, block)} sia a pranzo sia a cena di ${WEEKDAYS[dayIdx].toLowerCase()}`, { error: true });
  }
  await persist();
}

async function swap(a, b) {
  const ca = st.days[a.day][a.slot];
  const cb = st.days[b.day][b.slot];
  [ca.block, cb.block] = [cb.block, ca.block];
  [ca.note, cb.note] = [cb.note || '', ca.note || ''];
  haptic(15);
  await persist();
}

async function toggleCarb(dayIdx, slot) {
  const cell = st.days[dayIdx][slot];
  cell.carbo = !cell.carbo;
  haptic(5);
  if (cell.carbo && carbsOfDay(st.days[dayIdx]) > 1) toast('Carbo: una sola porzione al giorno', { error: true });
  await persist();
  render();
}

async function changeWeek(delta) {
  st.weekStart = addDays(st.weekStart, delta * 7);
  st.days = getWeek(st.weekStart);
  st.sel = null;
  haptic(5);
  render();
  $('#diet-organizer').scrollTop = 0;
}

/** Foto della settimana (solo il calendario), senza cambiare nulla. */
async function saveImage(btn) {
  btn.disabled = true;
  try {
    await exportWeekImage(st.weekStart, st.days);
  } catch (err) {
    console.error(err);
    toast('Non sono riuscita a creare l\'immagine', { error: true });
  } finally {
    btn.disabled = false;
  }
}

async function copyPrevious() {
  const prev = addDays(st.weekStart, -7);
  const ok = await confirmSheet({
    title: 'Copiare la settimana scorsa?',
    message: `Blocchi, carbo e testi della settimana dal ${formatShortDate(prev)} sostituiscono quelli di questa settimana.`,
    confirmLabel: 'Copia',
  });
  if (!ok) return;
  st.days = getWeek(prev);
  await persist();
  render();
  toast('Settimana copiata');
}

async function resetBase() {
  const ok = await confirmSheet({
    title: 'Tornare allo schema base?',
    message: 'I blocchi tornano quelli della dieta e i testi che hai scritto vengono cancellati.',
    confirmLabel: 'Schema base',
    danger: true,
  });
  if (!ok) return;
  st.days = baseWeek();
  await persist();
  render();
  toast('Schema base ripristinato');
}

/** Foglio di una casella: blocco, carbo, cosa mangerai. */
function openCell(dayIdx, slot) {
  const cell = st.days[dayIdx][slot];
  const main = isMainSlot(slot);
  const draft = { block: cell.block, carbo: Boolean(cell.carbo) };
  const date = addDays(st.weekStart, dayIdx);
  const blocks = main ? CATEGORIES.map((c) => c.id) : breakfastOptions().map((o) => o.id);

  const s = openSheet({
    title: `${WEEKDAYS[dayIdx]} ${Number(date.slice(8))} · ${SLOT_LABEL[slot]}`,
    html: `
      <div class="field">
        <span class="field-label">Blocco</span>
        <div class="chips" data-blocks>
          ${blocks.map((b) => `<button class="blk blk-lg ${blockClass(slot, b)} ${b === draft.block ? 'sel' : ''}" data-b="${esc(b)}">${esc(blockLabel(slot, b))}</button>`).join('')}
        </div>
        ${main ? '' : `<p class="footnote" data-desc style="margin-top:var(--s-2)">${esc(breakfastText(draft.block))}</p>`}
      </div>
      ${main ? `<button class="card carb-row ${draft.carbo ? 'on' : ''}" data-carb-row>
          <span class="carb-box">${draft.carbo ? icon('check') : ''}</span><span>Carbo in questo pasto</span><small>una volta al giorno</small>
        </button>` : ''}
      <label class="field" style="margin-top:var(--s-4)">
        <span class="field-label">Cosa mangerai</span>
        <textarea class="input" data-note rows="3" maxlength="300" placeholder="Scrivi qui">${esc(cell.note || '')}</textarea>
      </label>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button>
        ${cell.block ? `<button class="btn btn-ghost btn-block" data-clear>Svuota casella</button>` : ''}
      </div>`,
  });
  const body = s.body;
  $('[data-blocks]', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-b]');
    if (!b) return;
    draft.block = b.dataset.b;
    body.querySelectorAll('[data-b]').forEach((x) => x.classList.toggle('sel', x === b));
    const desc = $('[data-desc]', body);
    if (desc) desc.textContent = breakfastText(draft.block);
    haptic(5);
  });
  $('[data-carb-row]', body)?.addEventListener('click', (e) => {
    draft.carbo = !draft.carbo;
    const row = e.currentTarget;
    row.classList.toggle('on', draft.carbo);
    $('.carb-box', row).innerHTML = draft.carbo ? icon('check') : '';
    haptic(5);
  });
  $('[data-save]', body).addEventListener('click', async () => {
    if (!draft.block) return toast('Scegli un blocco', { error: true });
    const before = cell.block;
    cell.note = $('[data-note]', body).value.trim();
    if (main) cell.carbo = draft.carbo;
    s.close();
    if (before !== draft.block) await place(dayIdx, slot, draft.block);
    else await persist();
    if (main && cell.carbo && carbsOfDay(st.days[dayIdx]) > 1) toast('Carbo: una sola porzione al giorno', { error: true });
    render();
  });
  $('[data-clear]', body)?.addEventListener('click', async () => {
    cell.block = null;
    cell.note = '';
    s.close();
    await persist();
    render();
  });
}

/* ==========================================================================
   Tocchi e trascinamento
   ========================================================================== */

let bound = false;
const drag = {
  timer: null, active: false, src: null, ghost: null, startX: 0, startY: 0, over: null, justDragged: false,
  x: 0, y: 0, raf: null,
};

function bindOnce(el) {
  if (bound) return;
  bound = true;

  el.addEventListener('click', async (e) => {
    if (drag.justDragged) { drag.justDragged = false; return; }
    const o = e.target.closest('[data-o]')?.dataset.o;
    if (o === 'close') return close();
    if (o === 'prev') return changeWeek(-1);
    if (o === 'next') return changeWeek(1);
    if (o === 'copy') return copyPrevious();
    if (o === 'base') return resetBase();
    if (o === 'image') return saveImage(e.target.closest('[data-o]'));

    const dockBtn = e.target.closest('[data-dock]');
    if (dockBtn) {
      const { dock, block } = dockBtn.dataset;
      st.sel = st.sel && st.sel.group === dock && st.sel.block === block ? null : { group: dock, block };
      haptic(5);
      return render();
    }

    const cellEl = e.target.closest('.org-cell');
    if (!cellEl) return;
    const dayIdx = Number(cellEl.dataset.d);
    const slot = cellEl.dataset.s;
    if (e.target.closest('[data-carb]')) return toggleCarb(dayIdx, slot);
    if (st.sel && st.sel.group === groupOf(slot)) {
      await place(dayIdx, slot, st.sel.block);
      // Il blocco resta scelto finché ne restano da sistemare
      const rest = (targets(st.sel.group)[st.sel.block] || 0) - (used(st.days, st.sel.group)[st.sel.block] || 0);
      if (rest <= 0) st.sel = null;
      return render();
    }
    openCell(dayIdx, slot);
  });

  // Tieni premuto e trascina (dal basso o da una casella)
  el.addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.blk.drag');
    if (!b || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const cellEl = b.closest('.org-cell');
    drag.src = cellEl
      ? { type: 'cell', day: Number(cellEl.dataset.d), slot: cellEl.dataset.s, group: groupOf(cellEl.dataset.s) }
      : { type: 'dock', group: b.dataset.dock, block: b.dataset.block };
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    clearTimeout(drag.timer);
    drag.timer = setTimeout(() => startDrag(b, e.clientX, e.clientY), 260);
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag.active) {
      // Se il dito si muove prima del tempo, è uno scorrimento
      if (drag.timer && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 8) { clearTimeout(drag.timer); drag.timer = null; }
      return;
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
  });
  const end = async () => {
    clearTimeout(drag.timer);
    drag.timer = null;
    if (!drag.active) return;
    drag.active = false;
    cancelAnimationFrame(drag.raf);
    drag.justDragged = true;
    setTimeout(() => { drag.justDragged = false; }, 350);
    drag.ghost?.remove();
    drag.ghost = null;
    document.body.classList.remove('dragging-block');
    const over = drag.over;
    el.querySelectorAll('.org-cell.drop').forEach((c) => c.classList.remove('drop'));
    drag.over = null;
    if (!over) return render();
    const src = drag.src;
    if (src.type === 'dock') await place(over.day, over.slot, src.block);
    else if (src.day !== over.day || src.slot !== over.slot) await swap(src, over);
    render();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  // Durante il trascinamento la pagina non scorre
  el.addEventListener('touchmove', (e) => { if (drag.active) e.preventDefault(); }, { passive: false });
  el.addEventListener('contextmenu', (e) => { if (e.target.closest('.blk.drag')) e.preventDefault(); });
}

function startDrag(b, x, y) {
  drag.timer = null;
  drag.active = true;
  haptic(20);
  const r = b.getBoundingClientRect();
  const ghost = b.cloneNode(true);
  ghost.classList.add('blk-ghost');
  ghost.style.width = `${r.width}px`;
  document.body.append(ghost);
  drag.ghost = ghost;
  document.body.classList.add('dragging-block');
  moveGhost(x, y);
  autoScroll();
}

/**
 * Vicino ai bordi (sotto l'intestazione o sopra i blocchi in basso) il
 * calendario scorre da solo, così si può trascinare da lunedì a domenica.
 */
function autoScroll() {
  if (!drag.active) return;
  const el = $('#diet-organizer');
  const top = $('.org-cols', el)?.getBoundingClientRect().bottom ?? 120;
  const bottom = $('.org-dock', el)?.getBoundingClientRect().top ?? window.innerHeight;
  const zone = 56;
  let speed = 0;
  if (drag.y < top + zone) speed = -Math.ceil(((top + zone - drag.y) / zone) * 12);
  else if (drag.y > bottom - zone) speed = Math.ceil(((drag.y - (bottom - zone)) / zone) * 12);
  if (speed) {
    const before = el.scrollTop;
    el.scrollTop += Math.max(-18, Math.min(18, speed));
    if (el.scrollTop !== before) moveGhost(drag.x, drag.y);
  }
  drag.raf = requestAnimationFrame(autoScroll);
}

function moveGhost(x, y) {
  drag.x = x;
  drag.y = y;
  drag.ghost.style.transform = `translate(${x - 30}px, ${y - 22}px) scale(1.08)`;
  // Sopra i blocchi in basso o sotto l'intestazione non si lascia nulla
  const hit = document.elementFromPoint(x, y);
  const under = hit && !hit.closest('.org-dock, .org-cols, .topbar') ? hit.closest('.org-cell') : null;
  const ok = under && groupOf(under.dataset.s) === drag.src.group;
  const key = ok ? `${under.dataset.d}-${under.dataset.s}` : null;
  const prevKey = drag.over ? `${drag.over.day}-${drag.over.slot}` : null;
  if (key === prevKey) return; // stessa casella (anche mentre scorre da solo)
  $('#diet-organizer').querySelectorAll('.org-cell.drop').forEach((c) => c.classList.remove('drop'));
  if (ok) {
    under.classList.add('drop');
    drag.over = { day: Number(under.dataset.d), slot: under.dataset.s };
    haptic(3);
  } else {
    drag.over = null;
  }
}
