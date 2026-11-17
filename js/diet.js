/* ==========================================================================
   diet.js — Sezione Dieta (piano settimanale)
   --------------------------------------------------------------------------
   - Settimana lunedì → domenica, con frecce per rivedere le precedenti
   - Giorni selezionabili; per ogni giorno colazione, spuntino, pranzo, cena
     con il suggerimento del piano
   - Pranzo e cena: categoria (carne, pesce, uova, legumi, latticino,
     pasto libero), "+ carbo", nota libera; "Segna come sgarro" su ogni pasto
   - Contatori settimanali fatti/previsti con avvisi in rosso se superati
   - Promemoria se il carbo è segnato più di una volta al giorno
   - Regole, porzioni dei carboidrati e piano modificabile
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, toast, haptic, openSheet,
  todayISO, addDays, startOfWeek, formatFullDate, formatShortDate, formatDay, fmtInt, fmtNum,
} from './ui.js';
import {
  CATEGORIES, SLOTS, WEEKDAYS, loadPlan, getPlan, savePlan, planForDate,
  dayStatus, carbCount, categoryCounts, weekDates, isCheatMeal, categoryLabel, counterLabel,
  slotOptions, plannedOption, OTHER_OPTION,
} from './plan.js';
import { afterMeal } from './motivation.js';
import {
  loadWeekPlans, getWeek, saveWeek, isMainSlot, blockLabel, breakfastOptions, breakfastText, findSwap, swapCells,
} from './weekplan.js';
import { openOrganizer, blockHTML, carbHTML } from './organizer.js';
import { weekdayIndex } from './plan.js';

const state = {
  weekStart: startOfWeek(todayISO()), // lunedì della settimana mostrata
  selected: todayISO(),               // giorno selezionato
  days: new Map(),                    // diario dei giorni della settimana mostrata
  legacyCount: 0,                     // voci del vecchio diario (calorie)
};

const notifyChange = () => document.dispatchEvent(new CustomEvent('data-changed'));

/* --- Inizializzazione ---------------------------------------------------- */

export async function initDiet() {
  await loadPlan();
  await loadWeekPlans();
  state.legacyCount = (await db.getAll('meals')).length;
  await loadWeek();
  render();

  $('#btn-diet-rules').addEventListener('click', openRules);
  $('#btn-organize').addEventListener('click', () => openOrganizer(state.weekStart, { onClose: render }));
  document.addEventListener('weekplan-changed', render);

  const root = $('#diet-content');
  root.addEventListener('click', (e) => {
    const t = e.target;
    const action = t.closest('[data-action]')?.dataset.action;
    if (action === 'prev-week') return changeWeek(-1);
    if (action === 'next-week') return changeWeek(1);
    if (action === 'rules') return openRules();
    if (action === 'portions') return openPortions();
    if (action === 'edit-plan') return openPlanEditor();
    if (action === 'legacy') return openLegacyDiary();
    if (action === 'organize') return openOrganizer(state.weekStart, { onClose: render });
    if (action === 'day-yes') return answerYes(state.selected);
    if (action === 'day-no') return openDaySheet(state.selected);
    const dayBtn = t.closest('[data-date]');
    if (dayBtn) { state.selected = dayBtn.dataset.date; haptic(5); return render(); }
    const meal = t.closest('[data-slot]');
    if (meal && !meal.classList.contains('locked')) openMealSheet(meal.dataset.slot);
  });
}

/** Ricarica dopo un'importazione dei dati. */
export async function refreshDiet() {
  await loadPlan();
  await loadWeekPlans();
  state.legacyCount = (await db.getAll('meals')).length;
  await loadWeek();
  render();
}

/** Mostra un giorno preciso (dal calendario della Home). */
export async function showDietDate(date) {
  state.weekStart = startOfWeek(date);
  state.selected = date;
  await loadWeek();
  render();
}

async function loadWeek() {
  const dates = weekDates(state.weekStart);
  const rows = await Promise.all(dates.map((d) => db.get('dietDays', d)));
  state.days = new Map(dates.map((d, i) => [d, rows[i] || null]));
}

async function changeWeek(delta) {
  const next = addDays(state.weekStart, delta * 7);
  if (next > startOfWeek(todayISO())) return;
  state.weekStart = next;
  // Nella settimana corrente si seleziona oggi, nelle altre il lunedì
  const today = todayISO();
  state.selected = next === startOfWeek(today) ? today : next;
  haptic(5);
  await loadWeek();
  render();
}

/* --- Rendering ----------------------------------------------------------- */

function render() {
  const plan = getPlan();
  const today = todayISO();
  const isCurrentWeek = state.weekStart === startOfWeek(today);
  const dates = weekDates(state.weekStart);
  const days = dates.map((d) => state.days.get(d));
  const counts = categoryCounts(days);
  const over = CATEGORIES.filter((c) => counts[c.id] > (plan.targets[c.id] ?? 0));

  // Navigazione tra le settimane
  let html = `
    <div class="day-nav">
      <button class="icon-btn" data-action="prev-week" aria-label="Settimana precedente">${icon('chevron-left')}</button>
      <div class="week-label">
        <b>${esc(formatShortDate(dates[0]))} – ${esc(formatShortDate(dates[6]))}</b>
        <span>${isCurrentWeek ? 'Questa settimana' : 'Settimana passata'}</span>
      </div>
      <button class="icon-btn" data-action="next-week" aria-label="Settimana successiva" ${isCurrentWeek ? 'disabled' : ''}>${icon('chevron-right')}</button>
    </div>`;

  // Avvisi in rosso per le categorie superate
  html += over.map((c) => `
    <div class="alert-banner">${icon('triangle-alert')}
      <span><b>${esc(counterLabel(c.id))}:</b> ${counts[c.id]} volte ${isCurrentWeek ? 'questa settimana' : 'in quella settimana'}, il piano ne prevede ${plan.targets[c.id]}</span>
    </div>`).join('');

  // Riepilogo delle settimane passate
  if (!isCurrentWeek) html += weekSummary(days, counts);

  // Giorni della settimana
  html += `<div class="day-strip">${dates.map((d, i) => {
    const st = dayStatus(state.days.get(d));
    return `
      <button class="day-chip ${d === state.selected ? 'active' : ''} ${d === today ? 'today' : ''}" data-date="${d}">
        <span class="dc-wd">${WEEKDAYS[i].slice(0, 3)}</span>
        <span class="dc-num num">${Number(d.slice(8))}</span>
        <span class="dc-dot ${st === 'empty' ? '' : st}"></span>
      </button>`;
  }).join('')}</div>`;

  html += dayView(state.selected);

  // Contatori settimanali fatti/previsti
  html += `
    <div class="card counters-card">
      <div class="card-head"><span class="sum-label">${icon('chart-no-axes-column')} Categorie della settimana</span></div>
      <div class="counters">
        ${CATEGORIES.map((c) => {
          const n = counts[c.id];
          const target = plan.targets[c.id] ?? 0;
          const cls = n > target ? 'over' : n === target && target > 0 ? 'met' : '';
          return `
            <div class="counter ${cls}">
              <span class="counter-label">${esc(c.counter)}</span>
              <span class="counter-value num"><b>${n}</b>/${target}</span>
              <span class="counter-bar"><span style="width:${target ? Math.min(100, (n / target) * 100) : 0}%"></span></span>
            </div>`;
        }).join('')}
      </div>
    </div>`;


  // Informazioni e impostazioni
  html += `
    <div class="list" style="margin-top:var(--s-5)">
      <button class="list-row" data-action="rules">
        <span class="row-icon">${icon('book-open')}</span>
        <span class="row-main"><span class="row-title">Regole</span><span class="row-sub">Olio, condimenti, bevande, dolci</span></span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>
      <button class="list-row" data-action="portions">
        <span class="row-icon">${icon('wheat')}</span>
        <span class="row-main"><span class="row-title">Porzioni carbo</span><span class="row-sub">Una sola volta al giorno</span></span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>
      <button class="list-row" data-action="edit-plan">
        <span class="row-icon">${icon('pencil')}</span>
        <span class="row-main"><span class="row-title">Modifica piano</span><span class="row-sub">Pasti, categorie, limiti settimanali, regole</span></span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>
      ${state.legacyCount ? `
      <button class="list-row" data-action="legacy">
        <span class="row-icon">${icon('history')}</span>
        <span class="row-main"><span class="row-title">Diario precedente</span><span class="row-sub">${state.legacyCount} voci con calorie e macro</span></span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>` : ''}
    </div>`;

  $('#diet-content').innerHTML = html;
}

/** Breve riepilogo di una settimana passata. */
function weekSummary(days, counts) {
  const plan = getPlan();
  const statuses = days.map(dayStatus);
  const clean = statuses.filter((s) => s === 'clean').length;
  const cheat = statuses.filter((s) => s === 'cheat').length;
  const over = CATEGORIES.filter((c) => counts[c.id] > plan.targets[c.id]);
  const missing = CATEGORIES.filter((c) => counts[c.id] < plan.targets[c.id]);
  const fmt = (list) => list.map((c) => `${counterLabel(c.id).toLowerCase()} ${counts[c.id]}/${plan.targets[c.id]}`).join(', ');
  return `
    <div class="card summary-week">
      <div class="sum-label">${icon('clipboard-list')} Riepilogo della settimana</div>
      <div class="sw-stats">
        <span><b class="num">${clean}</b> ${clean === 1 ? 'giorno pulito' : 'giorni puliti'}</span>
        <span class="${cheat ? 'cheat' : ''}"><b class="num">${cheat}</b> ${cheat === 1 ? 'sgarro' : 'sgarri'}</span>
      </div>
      ${over.length ? `<div class="sw-line over">Superate: ${esc(fmt(over))}</div>` : ''}
      ${missing.length ? `<div class="sw-line">Mancanti: ${esc(fmt(missing))}</div>` : ''}
      ${!over.length && !missing.length ? '<div class="sw-line">Tutte le categorie come da piano.</div>' : ''}
    </div>`;
}

/* --- Giornata: cosa è in programma e com'è andata ------------------------ */

/** Casella della settimana organizzata per quel giorno e pasto. */
function cellFor(date, slotId) {
  return getWeek(startOfWeek(date))[weekdayIndex(date)][slotId] || null;
}

/** Pasto previsto (per i fogli di dettaglio): dalla settimana organizzata. */
function plannedFor(date, slotId) {
  if (slotId === 'spuntino') return { text: planForDate(date).spuntino };
  const cell = cellFor(date, slotId);
  if (isMainSlot(slotId)) {
    return {
      category: cell?.block || null, carbo: Boolean(cell?.carbo),
      text: [cell?.block ? categoryLabel(cell.block) : 'Non programmato', cell?.note].filter(Boolean).join(' · '),
    };
  }
  return { option: cell?.block || null, text: [breakfastText(cell?.block) || 'Non programmata', cell?.note].filter(Boolean).join(' · ') };
}

/** Stato di un pasto segnato: 'planned', 'swapped' oppure 'cheat'. */
function mealState(meal, cell, slotId) {
  if (!meal) return null;
  if (isCheatMeal(meal) || (meal.cheat && slotId !== 'pranzo' && slotId !== 'cena')) return 'cheat';
  if (meal.status === 'swapped') return 'swapped';
  if (isMainSlot(slotId) && cell?.block && meal.category && meal.category !== cell.block) return 'swapped';
  return 'planned';
}

/** Pasti del giorno selezionato. */
function dayView(date) {
  const day = state.days.get(date);
  const today = todayISO();
  const future = date > today;
  const title = formatFullDate(date);
  const loggedCount = SLOTS.filter((sl) => day?.meals?.[sl.id]).length;
  const status = dayStatus(day);

  const rows = SLOTS.map((slot) => {
    const logged = day?.meals?.[slot.id];
    const cell = slot.id === 'spuntino' ? null : cellFor(date, slot.id);
    const st = mealState(logged, cell, slot.id);
    let what;
    if (slot.id === 'spuntino') {
      what = `<span class="dy-snack">${esc(planForDate(date).spuntino || 'Yogurt bianco')}</span>`;
    } else {
      what = `
        <div class="dy-top">${cell?.block ? blockHTML(slot.id, cell.block, 'blk-lg') : '<span class="dy-empty">Non programmato</span>'}
          ${isMainSlot(slot.id) && cell?.block ? carbHTML(cell.carbo) : ''}</div>
        ${cell?.note ? `<span class="dy-note">${esc(cell.note)}</span>` : ''}`;
    }
    const mark = !st ? ''
      : st === 'cheat' ? '<span class="status-pill cheat small">Sgarro</span>'
        : st === 'swapped' ? `<span class="dy-mark swapped">${icon('arrow-left-right')}</span>`
          : `<span class="dy-mark">${icon('circle-check')}</span>`;
    const extra = st === 'cheat' && logged.note ? `<span class="dy-note">Sgarro: ${esc(logged.note)}</span>`
      : st === 'swapped' && logged.swappedFrom ? `<span class="dy-note">Invertito: era ${esc(isMainSlot(slot.id) ? categoryLabel(logged.swappedFrom) : blockLabel('colazione', logged.swappedFrom))}</span>` : '';
    return `
      <div class="dy-meal ${logged ? 'logged' : ''}" ${logged && !future ? `data-slot="${slot.id}"` : ''}>
        <div class="dy-label">${esc(slot.label)}</div>
        <div class="dy-what">${what}${extra}</div>
        <div class="dy-state">${mark}</div>
      </div>`;
  }).join('');

  let html = `
    <div class="card today-card">
      <div class="today-head"><b>${date === today ? 'Oggi in programma' : future ? 'In programma' : 'Programma del giorno'}</b>
        <span>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</span></div>
      ${rows}
    </div>`;

  if (carbCount(day) > 1) {
    html += `<div class="note-banner">${icon('wheat')}<span>Hai segnato il carbo ${carbCount(day)} volte: il piano ne prevede una sola porzione al giorno.</span></div>`;
  }

  if (future) {
    html += `
      <div class="card ask-card">
        <div class="ask-sub" style="margin:0">Potrai segnare com'è andata a partire da quel giorno.</div>
        <button class="btn btn-secondary btn-block" data-action="organize" style="margin-top:var(--s-3)">${icon('calendar-range')} Organizza settimana</button>
      </div>`;
  } else if (loggedCount === SLOTS.length) {
    const changed = SLOTS.some((sl) => ['swapped', 'cheat'].includes(mealState(day.meals[sl.id], sl.id === 'spuntino' ? null : cellFor(date, sl.id), sl.id)));
    html += `
      <div class="card ask-card done">
        <div class="ask-row">
          <span class="ask-icon ${status}">${icon(status === 'cheat' ? 'heart' : 'circle-check')}</span>
          <span class="row-main"><span class="ask-title">${status === 'cheat' ? 'Giornata con uno sgarro' : changed ? 'Dieta rispettata, con un cambio' : 'Fatto come programmato'}</span>
          <span class="ask-sub" style="margin:0">${status === 'cheat' ? 'Domani si riparte, senza sensi di colpa.' : 'Giornata pulita.'}</span></span>
        </div>
        <button class="btn btn-ghost btn-block" data-action="day-no">${icon('pencil')} Modifica</button>
      </div>`;
  } else {
    html += `
      <div class="card ask-card">
        <div class="ask-title">${date === today ? 'Oggi come programmato?' : 'Com\'è andata?'}</div>
        <div class="ask-sub">${loggedCount ? `Hai già segnato ${loggedCount} pasti su 4: rispondi per completare la giornata.` : 'Rispondi a fine giornata (o quando vuoi).'}</div>
        <div class="grid-2">
          <button class="btn btn-primary" data-action="day-yes">${icon('check')} Sì</button>
          <button class="btn btn-secondary" data-action="day-no">${icon('x')} No</button>
        </div>
      </div>`;
  }
  return html;
}

/** Pasto "come previsto" dalla casella della settimana. */
function plannedMeal(date, slotId, at) {
  if (slotId === 'spuntino') {
    const opt = plannedOption(date, 'spuntino');
    return { note: '', cheat: false, at, status: 'planned', ...(opt ? { option: opt.id, optionLabel: opt.label } : {}) };
  }
  const cell = cellFor(date, slotId);
  if (isMainSlot(slotId)) {
    return { category: cell?.block || null, carbo: Boolean(cell?.carbo), note: cell?.note || '', cheat: false, at, status: 'planned' };
  }
  const opt = breakfastOptions().find((o) => o.id === cell?.block);
  return { note: cell?.note || '', cheat: false, at, status: 'planned', ...(opt ? { option: opt.id, optionLabel: opt.label } : {}) };
}

/** Salva tutti i pasti di una giornata in una volta. */
async function saveDay(date, meals) {
  const day = state.days.get(date) || { date, meals: {} };
  day.meals = { ...day.meals, ...meals };
  day.updatedAt = Date.now();
  await db.put('dietDays', day);
  state.days.set(date, day);
  notifyChange();
  const list = Object.values(meals);
  const cheat = list.find(isCheatMeal);
  afterMeal(date, cheat || list[list.length - 1]);
}

/** "Sì": la giornata è andata come programmato (i pasti già segnati restano). */
async function answerYes(date) {
  const empty = ['pranzo', 'cena'].filter((sl) => !cellFor(date, sl)?.block && !state.days.get(date)?.meals?.[sl]);
  if (empty.length) {
    toast(`${empty.map((sl) => SLOTS.find((x) => x.id === sl).label).join(' e ')} non programmat${empty.length > 1 ? 'i' : 'o'}: dimmi cosa hai mangiato`, { error: true });
    return openDaySheet(date);
  }
  const at = Date.now();
  const meals = {};
  SLOTS.forEach((sl) => { if (!state.days.get(date)?.meals?.[sl.id]) meals[sl.id] = plannedMeal(date, sl.id, at); });
  await saveDay(date, meals);
  haptic(20);
  render();
  toast('Giornata segnata come programmato');
}

/** "No" (o Modifica): per ogni pasto come previsto, invertito o sgarro. */
function openDaySheet(date) {
  const weekStart = startOfWeek(date);
  const dayIdx = weekdayIndex(date);
  const week = getWeek(weekStart);
  const day = state.days.get(date);
  const loggedIn = (i, slot) => Boolean(state.days.get(addDays(weekStart, i))?.meals?.[slot]);

  // Stato di partenza di ogni pasto
  const draft = {};
  SLOTS.forEach((sl) => {
    const meal = day?.meals?.[sl.id];
    const cell = sl.id === 'spuntino' ? null : week[dayIdx][sl.id];
    const st = mealState(meal, cell, sl.id) || 'planned';
    const ate = st === 'swapped' ? (meal.category || meal.option || null) : null;
    draft[sl.id] = {
      state: st,
      ate,
      note: st === 'cheat' ? meal.note || '' : '',
      // Già invertito in precedenza: la casella contiene ciò che hai mangiato, si mostra l'originale
      orig: st === 'swapped' && cell?.block === ate && meal.swappedFrom ? meal.swappedFrom : (cell?.block || null),
    };
  });

  const choices = (slotId) => (isMainSlot(slotId) ? CATEGORIES.map((c) => c.id) : breakfastOptions().map((o) => o.id));
  const planned = (slotId) => draft[slotId]?.orig || null;
  const current = (slotId) => week[dayIdx][slotId]?.block || null;

  const swapText = (slotId) => {
    const d = draft[slotId];
    const was = planned(slotId);
    if (d.state !== 'swapped' || !d.ate || d.ate === was || d.ate === current(slotId)) return '';
    const label = (b) => (isMainSlot(slotId) ? categoryLabel(b) : blockLabel('colazione', b));
    const target = findSwap(week, dayIdx, slotId, d.ate, loggedIn);
    if (!was) return '';
    if (!target) return `Nessun altro giorno della settimana ha ${label(d.ate)} da scambiare: il conteggio della settimana cambierà.`;
    const dayName = WEEKDAYS[target.day].toLowerCase();
    const when = target.day === dayIdx ? 'oggi' : dayName;
    return `${when.charAt(0).toUpperCase() + when.slice(1)} a ${target.slot} avevi <b>${esc(label(d.ate))}</b>: diventa <b>${esc(label(was))}</b>. Così la settimana resta in equilibrio.`;
  };

  const rowHTML = (sl) => {
    const d = draft[sl.id];
    const opts = sl.id === 'spuntino' ? ['planned', 'cheat'] : ['planned', 'swapped', 'cheat'];
    const names = { planned: 'Come previsto', swapped: 'Invertito', cheat: 'Sgarro' };
    const plannedChip = sl.id === 'spuntino'
      ? `<span class="dy-snack">${esc(planForDate(date).spuntino || 'Yogurt bianco')}</span>`
      : planned(sl.id) ? blockHTML(sl.id, planned(sl.id)) : '<span class="dy-empty">Non programmato</span>';
    const info = swapText(sl.id);
    return `
      <div class="dm-row" data-row="${sl.id}">
        <div class="dm-head"><b>${esc(sl.label)}</b>${plannedChip}</div>
        <div class="seg3 n${opts.length}">${opts.map((o) => `<button class="${d.state === o ? `on ${o}` : ''}" data-st="${o}">${names[o]}</button>`).join('')}</div>
        ${d.state === 'swapped' ? `
          <div class="dm-label">Cosa hai mangiato?</div>
          <div class="chips">${choices(sl.id).filter((b) => b !== planned(sl.id)).map((b) => `
            <button class="blk ${isMainSlot(sl.id) ? `k-${b}` : 'k-col'} ${d.ate === b ? 'sel' : ''}" data-ate="${esc(b)}">${esc(blockLabel(sl.id, b))}</button>`).join('')}</div>
          ${info ? `<div class="dm-info">${icon('arrow-left-right')}<span>${info}</span></div>` : ''}` : ''}
        ${d.state === 'cheat' ? `
          <input class="input dm-cheat" data-cheat-note value="${esc(d.note)}" maxlength="200" placeholder="Cosa hai mangiato (facoltativo)" autocomplete="off">` : ''}
      </div>`;
  };

  const s = openSheet({
    title: 'Com\'è andata?',
    tall: true,
    html: `<div data-rows>${SLOTS.map(rowHTML).join('')}</div>
      <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save>${icon('check')} Salva la giornata</button></div>`,
  });
  const body = s.body;
  const redraw = (slotId) => {
    const el = $(`[data-row="${slotId}"]`, body);
    el.outerHTML = rowHTML(SLOTS.find((x) => x.id === slotId));
  };
  body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-row]');
    if (!row) return;
    const slotId = row.dataset.row;
    const stBtn = e.target.closest('[data-st]');
    if (stBtn) {
      draft[slotId].state = stBtn.dataset.st;
      haptic(5);
      return redraw(slotId);
    }
    const ate = e.target.closest('[data-ate]');
    if (ate) {
      draft[slotId].ate = ate.dataset.ate;
      haptic(5);
      return redraw(slotId);
    }
  });
  body.addEventListener('input', (e) => {
    if (e.target.matches('[data-cheat-note]')) draft[e.target.closest('[data-row]').dataset.row].note = e.target.value;
  });

  $('[data-save]', body).addEventListener('click', async () => {
    // Controlli: invertito senza scelta, pasto non programmato
    for (const sl of SLOTS) {
      const d = draft[sl.id];
      if (d.state === 'swapped' && !d.ate) return toast(`${sl.label}: scegli cosa hai mangiato`, { error: true });
      if (d.state === 'planned' && isMainSlot(sl.id) && !current(sl.id)) {
        return toast(`${sl.label} non programmato: scegli "Invertito" e cosa hai mangiato`, { error: true });
      }
    }
    const at = Date.now();
    const meals = {};
    let moved = 0;
    for (const sl of SLOTS) {
      const d = draft[sl.id];
      const prev = day?.meals?.[sl.id];
      if (d.state === 'planned') {
        meals[sl.id] = plannedMeal(date, sl.id, prev?.at || at);
      } else if (d.state === 'cheat') {
        meals[sl.id] = { cheat: true, note: d.note.trim(), at: prev?.at || at, status: 'cheat',
          ...(isMainSlot(sl.id) ? { carbo: Boolean(week[dayIdx][sl.id]?.carbo) } : {}) };
      } else {
        const was = planned(sl.id);
        const cur = current(sl.id);
        if (cur && d.ate !== cur) {
          // Scambio nella settimana: il pasto previsto va nel giorno che aveva quello mangiato
          const target = findSwap(week, dayIdx, sl.id, d.ate, loggedIn);
          if (target) { swapCells(week, { day: dayIdx, slot: sl.id }, target); moved++; }
          else week[dayIdx][sl.id].block = d.ate;
        }
        const cell = week[dayIdx][sl.id];
        const opt = breakfastOptions().find((o) => o.id === d.ate);
        meals[sl.id] = isMainSlot(sl.id)
          ? { category: d.ate, carbo: Boolean(cell.carbo), note: cell.note || '', cheat: false, at: prev?.at || at, status: 'swapped', swappedFrom: was }
          : { option: d.ate, optionLabel: opt?.label || '', note: cell.note || '', cheat: false, at: prev?.at || at, status: 'swapped', swappedFrom: was };
      }
    }
    await saveWeek(weekStart, week);
    await saveDay(date, meals);
    s.close();
    haptic(20);
    render();
    toast(moved ? 'Giornata salvata · settimana aggiornata' : 'Giornata salvata');
  });
}

/* --- Inserimento e modifica dei pasti ------------------------------------ */

async function saveMeal(date, slotId, meal) {
  const day = state.days.get(date) || { date, meals: {} };
  if (meal) day.meals[slotId] = meal;
  else delete day.meals[slotId];
  day.updatedAt = Date.now();
  if (Object.keys(day.meals).length === 0) {
    await db.del('dietDays', date);
    state.days.set(date, null);
  } else {
    await db.put('dietDays', day);
    state.days.set(date, day);
  }
  notifyChange();
  if (meal) afterMeal(date, meal);
}

/** Avvisa subito se il pasto appena segnato supera un limite. */
function warnIfNeeded(date, slotId) {
  const meal = state.days.get(date)?.meals?.[slotId];
  if (!meal) return;
  const plan = getPlan();
  if (meal.category) {
    const counts = categoryCounts(weekDates(state.weekStart).map((d) => state.days.get(d)));
    const n = counts[meal.category];
    if (n > plan.targets[meal.category]) {
      toast(`${counterLabel(meal.category)}: ${n} volte, il piano ne prevede ${plan.targets[meal.category]}`, { error: true });
      return;
    }
  }
  if (meal.carbo && carbCount(state.days.get(date)) > 1) {
    toast('Carbo: una sola porzione al giorno', { error: true });
    return;
  }
  toast('Pasto segnato');
}

function openMealSheet(slotId) {
  const date = state.selected;
  const slot = SLOTS.find((s) => s.id === slotId);
  const planned = plannedFor(date, slotId);
  const existing = state.days.get(date)?.meals?.[slotId] || null;
  // Colazione e spuntino: opzione prevista dal piano preselezionata
  const options = slot.main ? [] : slotOptions(slotId);
  const draft = existing
    ? { ...existing }
    : slot.main
      ? { category: planned.category, carbo: Boolean(planned.carbo), note: '', cheat: false }
      : { option: planned.option || plannedOption(date, slotId)?.id || null, note: '', cheat: false };
  // Pasto segnato prima delle opzioni ("come da piano"): si parte dall'opzione del piano
  if (!slot.main && existing && !existing.option) draft.option = planned.option || plannedOption(date, slotId)?.id || null;
  // Opzione non più presente nel piano: resta visibile per non perderla
  if (!slot.main && draft.option && !options.some((o) => o.id === draft.option)) {
    options.splice(options.length - 1, 0, { id: draft.option, label: draft.optionLabel || 'Opzione eliminata' });
  }

  const switchRow = (key, label, sub, cls = '') => `
    <label class="switch-row ${cls}">
      <span class="row-main"><span class="row-title">${label}</span>${sub ? `<span class="row-sub" data-sub-${key}>${sub}</span>` : ''}</span>
      <input type="checkbox" class="switch" data-k="${key}" ${draft[key] ? 'checked' : ''}>
    </label>`;

  const s = openSheet({
    title: `${slot.label} · ${formatDay(date)}`,
    html: `
      <div class="plan-hint" style="margin-bottom:var(--s-4)">
        ${icon('clipboard-list')}<span>In programma: ${esc(planned.text)}</span>
      </div>
      ${slot.main ? `
        <div class="field" data-what ${draft.cheat ? 'hidden' : ''}>
          <span class="field-label">Cosa hai mangiato</span>
          <div class="chips" data-cats>
            ${CATEGORIES.map((c) => `<button class="chip ${draft.category === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`).join('')}
          </div>
        </div>` : `
        <div class="field" data-what ${draft.cheat ? 'hidden' : ''}>
          <span class="field-label">Cosa hai mangiato</span>
          <div class="chips stack" data-options>
            ${options.map((o) => `<button class="chip ${draft.option === o.id ? 'active' : ''}" data-opt="${esc(o.id)}">${esc(o.label)}</button>`).join('')}
          </div>
        </div>`}
      <label class="field">
        <span class="field-label">Note <span class="opt">· facoltative</span></span>
        <textarea class="input" data-note rows="2" maxlength="300"
                  placeholder="${slot.main ? 'Es. pollo alla piastra, finocchi, riso' : 'Es. con mirtilli invece dei lamponi'}">${esc(draft.note || '')}</textarea>
      </label>
      <div class="list switch-list">
        ${slot.main ? switchRow('carbo', '+ carbo', 'Una sola porzione al giorno') : ''}
        ${switchRow('cheat', 'Segna come sgarro', 'La giornata diventa sgarro · non conta nelle categorie', 'danger')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} ${existing ? 'Salva modifiche' : 'Segna pasto'}</button>
        ${existing ? `<button class="btn btn-danger btn-block" data-delete>${icon('trash-2')} Togli</button>` : ''}
      </div>`,
  });

  const body = s.body;
  const cheatInput = $('[data-k="cheat"]', body);
  const whatField = $('[data-what]', body);
  // Sgarro: non serve scegliere cosa hai mangiato, basta (se vuoi) scriverlo.
  // Spegnendo lo sgarro ricompare la lista, con la scelta del piano.
  cheatInput.addEventListener('change', () => {
    draft.cheat = cheatInput.checked;
    whatField.hidden = draft.cheat;
    if (!draft.cheat) {
      if (slot.main && !draft.category) {
        draft.category = planned.category;
        body.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('active', c.dataset.cat === draft.category));
      }
      if (!slot.main && !draft.option) {
        draft.option = planned.option || plannedOption(date, slotId)?.id || null;
        body.querySelectorAll('[data-opt]').forEach((c) => c.classList.toggle('active', c.dataset.opt === draft.option));
      }
    }
  });

  $('[data-options]', body)?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-opt]');
    if (!chip) return;
    draft.option = chip.dataset.opt;
    body.querySelectorAll('[data-opt]').forEach((c) => c.classList.toggle('active', c === chip));
    haptic(5);
    if (draft.option === OTHER_OPTION.id) $('[data-note]', body).focus();
  });

  $('[data-cats]', body)?.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    draft.category = chip.dataset.cat;
    body.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('active', c === chip));
    haptic(5);
  });

  $('[data-save]', body).addEventListener('click', async () => {
    const cheat = cheatInput.checked;
    const note = $('[data-note]', body).value.trim();
    const at = existing?.at || Date.now();
    let meal;
    if (cheat) {
      // Pasto sgarro: senza categoria o opzione, conta solo per lo stato della giornata
      meal = { cheat: true, note, at, ...(slot.main ? { carbo: $('[data-k="carbo"]', body).checked } : {}) };
    } else {
      if (slot.main && !draft.category) return toast('Scegli la categoria', { error: true });
      if (!slot.main && !draft.option) return toast('Scegli cosa hai mangiato', { error: true });
      const chosen = options.find((o) => o.id === draft.option);
      meal = {
        ...(slot.main
          ? { category: draft.category, carbo: $('[data-k="carbo"]', body).checked }
          : { option: draft.option, optionLabel: chosen ? chosen.label : OTHER_OPTION.label }),
        note, cheat: false, at,
      };
    }
    await saveMeal(date, slotId, meal);
    s.close();
    haptic(15);
    render();
    warnIfNeeded(date, slotId);
  });

  $('[data-delete]', body)?.addEventListener('click', async () => {
    await saveMeal(date, slotId, null);
    s.close();
    render();
    toast('Pasto tolto');
  });
}

/* --- Regole e porzioni --------------------------------------------------- */

function linesHTML(text) {
  return `<ul class="notes-list">${text.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
}

function openRules() {
  openSheet({
    title: 'Regole',
    html: `<div class="card notes-card">${linesHTML(getPlan().rules)}</div>
      <p class="footnote">Puoi modificarle da "Modifica piano".</p>`,
  });
}

function openPortions() {
  openSheet({
    title: 'Porzioni carbo',
    html: `<div class="card notes-card">
        <div class="notes-title">Una sola volta al giorno</div>${linesHTML(getPlan().carbPortions)}
      </div>`,
  });
}

/* --- Modifica del piano -------------------------------------------------- */

function openPlanEditor() {
  const rows = () => {
    const plan = getPlan();
    return `
      ${plan.days.map((d, i) => `
        <button class="list-row" data-day-i="${i}">
          <span class="row-icon num">${WEEKDAYS[i].slice(0, 2)}</span>
          <span class="row-main"><span class="row-title">${WEEKDAYS[i]}</span>
          <span class="row-sub">P ${esc(categoryLabel(d.pranzo.category))}${d.pranzo.carbo ? ' + carbo' : ''} · C ${esc(categoryLabel(d.cena.category))}${d.cena.carbo ? ' + carbo' : ''}</span></span>
          <span class="row-trail">${icon('chevron-right')}</span>
        </button>`).join('')}`;
  };

  const s = openSheet({
    title: 'Modifica piano',
    tall: true,
    html: `
      <div class="field-label">Giorni</div>
      <div class="list" data-rows>${rows()}</div>
      <div class="field-label" style="margin-top:var(--s-5)">Altro</div>
      <div class="list">
        <button class="list-row" data-edit="opt-colazione">
          <span class="row-icon">${icon('coffee')}</span>
          <span class="row-main"><span class="row-title">Opzioni colazione</span><span class="row-sub">${getPlan().options.colazione.length} opzioni + Altro</span></span>
          <span class="row-trail">${icon('chevron-right')}</span>
        </button>
        <button class="list-row" data-edit="opt-spuntino">
          <span class="row-icon">${icon('apple')}</span>
          <span class="row-main"><span class="row-title">Opzioni spuntino</span><span class="row-sub">${getPlan().options.spuntino.length} opzioni + Altro</span></span>
          <span class="row-trail">${icon('chevron-right')}</span>
        </button>
        <button class="list-row" data-edit="targets">
          <span class="row-icon">${icon('chart-no-axes-column')}</span>
          <span class="row-main"><span class="row-title">Limiti settimanali</span><span class="row-sub">Quante volte per categoria</span></span>
          <span class="row-trail">${icon('chevron-right')}</span>
        </button>
        <button class="list-row" data-edit="rules">
          <span class="row-icon">${icon('book-open')}</span>
          <span class="row-main"><span class="row-title">Regole</span></span>
          <span class="row-trail">${icon('chevron-right')}</span>
        </button>
        <button class="list-row" data-edit="carbPortions">
          <span class="row-icon">${icon('wheat')}</span>
          <span class="row-main"><span class="row-title">Porzioni carbo</span></span>
          <span class="row-trail">${icon('chevron-right')}</span>
        </button>
      </div>
      <p class="footnote">Le modifiche valgono per tutti i giorni, anche quelli già passati: i pasti che hai segnato restano invariati.</p>`,
    onClose: render,
  });

  const refresh = () => { $('[data-rows]', s.body).innerHTML = rows(); };
  s.body.addEventListener('click', (e) => {
    const day = e.target.closest('[data-day-i]');
    if (day) return editPlanDay(Number(day.dataset.dayI), refresh);
    const what = e.target.closest('[data-edit]')?.dataset.edit;
    if (what === 'targets') return editTargets();
    if (what === 'opt-colazione' || what === 'opt-spuntino') return editOptions(what.slice(4));
    if (what) return editPlanText(what);
  });
}

function editPlanDay(i, onDone) {
  const plan = getPlan();
  const d = structuredClone(plan.days[i]);

  // Colazione e spuntino: opzione prevista (preselezionata) e testo del suggerimento
  d.options = d.options || {};
  const optionBlock = (slotId, label) => `
    <div class="field">
      <span class="field-label">${label}</span>
      <div class="chips stack" data-opts="${slotId}" style="margin-bottom:var(--s-2)">
        ${slotOptions(slotId).filter((o) => o.id !== OTHER_OPTION.id).map((o) => `
          <button class="chip ${d.options[slotId] === o.id ? 'active' : ''}" data-opt="${esc(o.id)}">${esc(o.label)}</button>`).join('')}
      </div>
      <span class="field-label" style="margin-top:var(--s-3)">Testo del suggerimento</span>
      <textarea class="input" data-text="${slotId}" rows="2">${esc(d[slotId])}</textarea>
    </div>`;

  const mainBlock = (slotId, label) => `
    <div class="field">
      <span class="field-label">${label}</span>
      <div class="chips" data-cats="${slotId}" style="margin-bottom:var(--s-2)">
        ${CATEGORIES.map((c) => `<button class="chip ${d[slotId].category === c.id ? 'active' : ''}" data-cat="${c.id}">${esc(c.label)}</button>`).join('')}
      </div>
      <textarea class="input" data-text="${slotId}" rows="2">${esc(d[slotId].text)}</textarea>
      <label class="switch-row compact">
        <span class="row-main"><span class="row-title">+ carbo</span></span>
        <input type="checkbox" class="switch" data-carbo="${slotId}" ${d[slotId].carbo ? 'checked' : ''}>
      </label>
    </div>`;

  const s = openSheet({
    title: WEEKDAYS[i],
    tall: true,
    html: `
      ${optionBlock('colazione', 'Colazione')}
      ${optionBlock('spuntino', 'Spuntino')}
      ${mainBlock('pranzo', 'Pranzo')}
      ${mainBlock('cena', 'Cena')}
      <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button></div>`,
  });

  s.body.addEventListener('click', (e) => {
    const opt = e.target.closest('[data-opt]');
    if (opt) {
      const group = opt.closest('[data-opts]');
      d.options[group.dataset.opts] = opt.dataset.opt;
      group.querySelectorAll('[data-opt]').forEach((c) => c.classList.toggle('active', c === opt));
      return;
    }
    const chip = e.target.closest('[data-cat]');
    if (!chip) return;
    const group = chip.closest('[data-cats]');
    d[group.dataset.cats].category = chip.dataset.cat;
    group.querySelectorAll('[data-cat]').forEach((c) => c.classList.toggle('active', c === chip));
  });

  $('[data-save]', s.body).addEventListener('click', async () => {
    d.colazione = $('[data-text="colazione"]', s.body).value.trim();
    d.spuntino = $('[data-text="spuntino"]', s.body).value.trim();
    for (const slotId of ['pranzo', 'cena']) {
      d[slotId].text = $(`[data-text="${slotId}"]`, s.body).value.trim();
      d[slotId].carbo = $(`[data-carbo="${slotId}"]`, s.body).checked;
    }
    plan.days[i] = d;
    await savePlan(plan);
    s.close();
    onDone();
    toast('Piano aggiornato');
  });
}

/** Modifica dell'elenco di opzioni di colazione o spuntino ("Altro" resta sempre). */
function editOptions(slotId) {
  const plan = getPlan();
  const list = structuredClone(plan.options[slotId]);
  const label = slotId === 'colazione' ? 'colazione' : 'spuntino';

  const rowsHTML = () => list.map((o, i) => `
    <div class="option-row">
      <input class="input" data-i="${i}" value="${esc(o.label)}" maxlength="80" autocomplete="off" enterkeyhint="done">
      <button class="icon-btn" data-remove="${i}" aria-label="Togli opzione">${icon('trash-2')}</button>
    </div>`).join('');

  const s = openSheet({
    title: `Opzioni ${label}`,
    tall: true,
    html: `
      <div data-rows>${rowsHTML()}</div>
      <button class="btn btn-ghost btn-block" data-add>${icon('plus')} Aggiungi opzione</button>
      <p class="footnote">"Altro" è sempre disponibile in fondo alla lista. I pasti già segnati mantengono il testo che avevano.</p>
      <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button></div>`,
  });

  const readInputs = () => {
    s.body.querySelectorAll('[data-i]').forEach((input) => { list[Number(input.dataset.i)].label = input.value; });
  };
  const redraw = () => { $('[data-rows]', s.body).innerHTML = rowsHTML(); };

  s.body.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (rm) { readInputs(); list.splice(Number(rm.dataset.remove), 1); redraw(); return; }
    if (e.target.closest('[data-add]')) {
      readInputs();
      list.push({ id: db.uid(), label: '' });
      redraw();
      const inputs = s.body.querySelectorAll('[data-i]');
      inputs[inputs.length - 1]?.focus();
    }
  });

  $('[data-save]', s.body).addEventListener('click', async () => {
    readInputs();
    const clean = list.map((o) => ({ ...o, label: o.label.trim() })).filter((o) => o.label);
    plan.options[slotId] = clean;
    // I giorni che prevedevano un'opzione tolta passano alla prima disponibile
    plan.days.forEach((d) => {
      if (d.options && !clean.some((o) => o.id === d.options[slotId])) d.options[slotId] = clean[0]?.id || null;
    });
    await savePlan(plan);
    s.close();
    toast('Opzioni aggiornate');
  });
}

function editTargets() {
  const plan = getPlan();
  const draft = { ...plan.targets };
  const s = openSheet({
    title: 'Limiti settimanali',
    html: `
      ${CATEGORIES.map((c) => `
        <div class="target-row">
          <span class="row-title">${esc(c.counter)}</span>
          <div class="stepper" data-t="${c.id}">
            <button data-d="-1" aria-label="Meno">${icon('minus')}</button>
            <input type="text" inputmode="numeric" value="${draft[c.id]}" autocomplete="off">
            <button data-d="1" aria-label="Più">${icon('plus')}</button>
          </div>
        </div>`).join('')}
      <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button></div>`,
  });
  s.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const st = b.closest('[data-t]');
    const input = $('input', st);
    const v = Math.max(0, Math.min(14, (parseInt(input.value, 10) || 0) + Number(b.dataset.d)));
    input.value = v;
    haptic(5);
  });
  $('[data-save]', s.body).addEventListener('click', async () => {
    CATEGORIES.forEach((c) => {
      const v = parseInt($(`[data-t="${c.id}"] input`, s.body).value, 10);
      plan.targets[c.id] = Number.isFinite(v) ? Math.max(0, Math.min(14, v)) : plan.targets[c.id];
    });
    await savePlan(plan);
    s.close();
    render();
    toast('Limiti aggiornati');
  });
}

function editPlanText(key) {
  const plan = getPlan();
  const s = openSheet({
    title: key === 'rules' ? 'Regole' : 'Porzioni carbo',
    html: `
      <label class="field">
        <span class="field-label">Una voce per riga</span>
        <textarea class="input" data-text rows="10" style="min-height:220px">${esc(plan[key])}</textarea>
      </label>
      <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button></div>`,
  });
  $('[data-save]', s.body).addEventListener('click', async () => {
    plan[key] = $('[data-text]', s.body).value;
    await savePlan(plan);
    s.close();
    toast('Salvato');
  });
}

/* --- Vecchio diario (calorie e macro), in sola lettura ------------------- */

async function openLegacyDiary() {
  const all = await db.getAll('meals');
  const byDay = new Map();
  for (const m of all) {
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m);
  }
  const days = [...byDay.keys()].sort().reverse();
  const html = days.map((d) => {
    const items = byDay.get(d);
    const kcal = items.reduce((s, m) => s + (m.kcal || 0), 0);
    return `
      <div class="field-label" style="margin-top:var(--s-4);display:flex;justify-content:space-between">
        <span style="text-transform:capitalize">${esc(formatDay(d))}</span><span class="num">${kcal ? `${fmtInt(kcal)} kcal` : ''}</span>
      </div>
      <div class="list">${items.map((m) => {
        const parts = [];
        if (m.kcal) parts.push(`${fmtInt(m.kcal)} kcal`);
        if (m.protein) parts.push(`P ${fmtNum(m.protein)} g`);
        if (m.carbs) parts.push(`C ${fmtNum(m.carbs)} g`);
        if (m.fat) parts.push(`G ${fmtNum(m.fat)} g`);
        return `
          <div class="list-row">
            <span class="row-main"><span class="row-title" style="white-space:normal">${esc(m.description)}</span>
            ${parts.length ? `<span class="row-sub num">${parts.join(' · ')}</span>` : ''}</span>
          </div>`;
      }).join('')}</div>`;
  }).join('');

  openSheet({
    title: 'Diario precedente',
    tall: true,
    html: `<p class="footnote" style="margin-top:0">Le voci registrate prima del piano settimanale, conservate in sola lettura (sono incluse anche nel backup).</p>${html}`,
  });
}
