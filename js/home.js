/* ==========================================================================
   home.js — Pagina Home (riepilogo all'avvio)
   --------------------------------------------------------------------------
   - Riepilogo: allenamenti della settimana (obiettivo 4) e del mese,
     giorni puliti e sgarri della dieta (settimana e mese)
   - Contatore acqua: obiettivo 2 litri, "+ 250 ml", correzione
   - Schede della settimana (cerchi A, B, C, D) + allenamenti extra
   - Calendario del mese con tre puntini per giorno e dettaglio della giornata
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, haptic, openSheet, todayISO, startOfWeek, addDays, parseISO,
  formatFullDate, formatShortDate, formatMonth, parseNum,
} from './ui.js';
import { strengthTemplates } from './templates.js';
import {
  openStartSheet, resumeActive, startTemplate, activeBanner, suggestedTemplate,
  isActive, isStrength, isExtra, isCardio, isActivity, workoutLabel, activityType, workoutStats,
  isPartial, partialText, templateStatusForWeek,
} from './workouts.js';
import { WATER_GOAL, WATER_STEP, setWater, liters } from './water.js';
import { dayStatus, SLOTS, mealLabel, isCheatMeal } from './plan.js';

const WEEKLY_GOAL = 4;

let calMonth = todayISO().slice(0, 7); // mese mostrato nel calendario, "AAAA-MM"
const data = { workouts: [], water: new Map(), diet: new Map() };

/* --- Eventi -------------------------------------------------------------- */

export function initHome() {
  $('#home-content').addEventListener('click', (e) => {
    const t = e.target;
    const action = t.closest('[data-action]')?.dataset.action;
    if (action === 'start') return openStartSheet();
    if (action === 'resume') return resumeActive();
    if (action === 'water-edit') return editWater(todayISO());
    if (action === 'cal-prev') return shiftMonth(-1);
    if (action === 'cal-next') return shiftMonth(1);
    const water = t.closest('[data-water]');
    if (water) return changeWater(todayISO(), Number(water.dataset.water));
    const day = t.closest('[data-day]');
    if (day) return openDaySheet(day.dataset.day);
    const tpl = t.closest('[data-template]');
    if (tpl) startTemplate(tpl.dataset.template);
  });
}

/* --- Dati ---------------------------------------------------------------- */

async function load() {
  const [workouts, water, diet] = await Promise.all([
    db.getAll('workouts'), db.getAll('water'), db.getAll('dietDays'),
  ]);
  data.workouts = workouts;
  data.water = new Map(water.map((w) => [w.date, w.ml]));
  data.diet = new Map(diet.map((d) => [d.date, d]));
}

const waterOf = (date) => data.water.get(date) || 0;
const workoutsOf = (date) => data.workouts.filter((w) => !isActive(w) && w.date === date);

/** Giorni puliti e sgarri tra due date (incluse). */
function dietStats(from, to) {
  let clean = 0;
  let cheat = 0;
  for (const [date, day] of data.diet) {
    if (date < from || date > to) continue;
    const st = dayStatus(day);
    if (st === 'clean') clean++;
    if (st === 'cheat') cheat++;
  }
  return { clean, cheat };
}

/* --- Rendering ----------------------------------------------------------- */

export async function renderHome() {
  await load();
  const today = todayISO();
  const weekFrom = startOfWeek(today);
  const weekTo = addDays(weekFrom, 6);
  const monthFrom = today.slice(0, 8) + '01';

  const sub = formatFullDate(today);
  $('#home-date').textContent = sub.charAt(0).toUpperCase() + sub.slice(1);

  const strength = data.workouts.filter(isStrength);
  const inWeek = (w) => w.date >= weekFrom && w.date <= weekTo;
  const weekCount = strength.filter(inWeek).length;
  const monthCount = strength.filter((w) => w.date >= monthFrom && w.date <= today).length;
  const dWeek = dietStats(weekFrom, weekTo);
  const dMonth = dietStats(monthFrom, today);
  const active = data.workouts.find(isActive);

  $('#home-content').innerHTML = `
    ${active ? activeBanner(active) : ''}

    <div class="card summary-card">
      <div class="sum-col">
        <div class="sum-label">${icon('dumbbell')} Allenamenti</div>
        <div class="sum-big num">${weekCount}<span>/${WEEKLY_GOAL}</span></div>
        <div class="bar"><span style="width:${Math.min(100, (weekCount / WEEKLY_GOAL) * 100)}%"></span></div>
        <div class="sum-sub">Questo mese <b class="num">${monthCount}</b></div>
      </div>
      <div class="sum-sep"></div>
      <div class="sum-col">
        <div class="sum-label">${icon('utensils')} Dieta</div>
        <div class="sum-big num">${dWeek.clean}<span> ${dWeek.clean === 1 ? 'pulito' : 'puliti'}</span></div>
        <div class="sum-cheat ${dWeek.cheat ? 'has' : ''}"><b class="num">${dWeek.cheat}</b> ${dWeek.cheat === 1 ? 'sgarro' : 'sgarri'} in settimana</div>
        <div class="sum-sub">Mese <b class="num">${dMonth.clean}</b> puliti · <b class="num">${dMonth.cheat}</b> sgarri</div>
      </div>
    </div>

    <div class="card water-card" id="water-card">${waterCardInner(waterOf(today))}</div>

    <div class="card week-card">${weekCardInner(weekFrom, weekTo, active)}</div>

    <div class="card cal-card" id="cal-card">${calendarInner()}</div>`;
}

function waterCardInner(ml) {
  const pct = Math.min(100, (ml / WATER_GOAL) * 100);
  const left = WATER_GOAL - ml;
  return `
    <div class="water-head">
      <button class="water-amount" data-action="water-edit" aria-label="Correggi la quantità di acqua">
        <span class="sum-label">${icon('droplet')} Acqua</span>
        <span class="sum-big num">${liters(ml)}<span> / ${liters(WATER_GOAL)} L</span></span>
      </button>
      <div class="water-btns">
        <button class="icon-btn" data-water="-${WATER_STEP}" aria-label="Togli ${WATER_STEP} ml" ${ml <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
        <button class="btn btn-water" data-water="${WATER_STEP}">${icon('plus')} ${WATER_STEP} ml</button>
      </div>
    </div>
    <div class="bar water ${ml >= WATER_GOAL ? 'full' : ''}"><span style="width:${pct}%"></span></div>
    <div class="sum-sub">${left > 0 ? `Mancano ${left} ml` : 'Obiettivo raggiunto'} · tocca il numero per correggere</div>`;
}

function weekCardInner(weekFrom, weekTo, active) {
  const week = data.workouts.filter((w) => !isActive(w) && w.date >= weekFrom && w.date <= weekTo);
  // Piena se fatta, mezza piena se chiusa come parziale, vuota se mancante
  const status = templateStatusForWeek(data.workouts, weekFrom);

  const circles = strengthTemplates().map((t) => {
    const st = status.get(t.id) || '';
    const running = active && active.templateId === t.id;
    const label = st === 'done' ? 'fatta' : st === 'partial' ? 'fatta in parte' : 'da fare';
    return `<button class="wk-circle ${st} ${running ? 'running' : ''}" data-template="${t.id}"
              aria-label="Scheda ${esc(t.code)} ${esc(t.name)}: ${label}"><span>${esc(t.code)}</span></button>`;
  }).join('');

  // Extra: cardio e allenamenti liberi raggruppati per tipo, es. "+1 corsa"
  const extras = new Map();
  week.filter(isExtra).forEach((w) => {
    const label = isCardio(w) ? 'cardio' : activityType(w.activity).label.toLowerCase();
    extras.set(label, (extras.get(label) || 0) + 1);
  });
  const extraChips = [...extras].map(([label, n]) => `<span class="extra-chip">+${n} ${esc(label)}</span>`).join('');

  const next = suggestedTemplate();
  const cta = active
    ? `<button class="btn btn-primary btn-block btn-hero" data-action="resume">${icon('play')} Riprendi allenamento</button>`
    : `<button class="btn btn-primary btn-block btn-hero" data-action="start">${icon('play')} Inizia allenamento</button>
       ${next ? `<p class="hero-note">Consigliata: <b>${esc(next.code)} · ${esc(next.name)}</b></p>` : ''}`;

  return `
    <div class="card-head">
      <span class="sum-label">${icon('calendar-check')} Schede della settimana</span>
      <span class="sum-sub" style="margin:0">${esc(formatShortDate(weekFrom))} – ${esc(formatShortDate(weekTo))}</span>
    </div>
    <div class="wk-row">${circles}</div>
    ${extraChips ? `<div class="wk-extras"><span class="wk-extras-label">Extra</span>${extraChips}</div>` : ''}
    <div class="home-cta">${cta}</div>`;
}

/* --- Calendario ---------------------------------------------------------- */

function shiftMonth(delta) {
  const [y, m] = calMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  if (next > todayISO().slice(0, 7)) return;
  calMonth = next;
  haptic(5);
  $('#cal-card').innerHTML = calendarInner();
}

/** Stato dei tre obiettivi di un giorno. */
function dayGoals(date) {
  return {
    water: waterOf(date) >= WATER_GOAL,
    diet: dayStatus(data.diet.get(date)) === 'clean',
    gym: workoutsOf(date).some((w) => isStrength(w) || isExtra(w)),
  };
}

function calendarInner() {
  const today = todayISO();
  const [y, m] = calMonth.split('-').map(Number);
  const first = `${calMonth}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  const offset = (parseISO(first).getDay() + 6) % 7; // lunedì = 0
  const isCurrent = calMonth === today.slice(0, 7);

  let cells = ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d) => `<span class="cal-wd">${d}</span>`).join('');
  cells += '<span></span>'.repeat(offset);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${calMonth}-${String(day).padStart(2, '0')}`;
    const future = date > today;
    const g = future ? null : dayGoals(date);
    cells += `
      <button class="cal-day ${date === today ? 'today' : ''} ${future ? 'future' : ''}" data-day="${date}" ${future ? 'disabled' : ''}
              aria-label="${esc(formatFullDate(date))}">
        <span class="cal-num num">${day}</span>
        <span class="cal-dots">${g ? `
          <i class="dot water ${g.water ? 'on' : ''}"></i><i class="dot diet ${g.diet ? 'on' : ''}"></i><i class="dot gym ${g.gym ? 'on' : ''}"></i>` : ''}
        </span>
      </button>`;
  }

  return `
    <div class="cal-head">
      <button class="icon-btn" data-action="cal-prev" aria-label="Mese precedente">${icon('chevron-left')}</button>
      <div class="cal-title">${esc(formatMonth(first))}</div>
      <button class="icon-btn" data-action="cal-next" aria-label="Mese successivo" ${isCurrent ? 'disabled' : ''}>${icon('chevron-right')}</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span><i class="dot water on"></i>Acqua 2 L</span>
      <span><i class="dot diet on"></i>Giornata pulita</span>
      <span><i class="dot gym on"></i>Allenamento</span>
    </div>`;
}

/* --- Acqua --------------------------------------------------------------- */

async function changeWater(date, delta) {
  const ml = await setWater(date, waterOf(date) + delta, { notify: false });
  data.water.set(date, ml);
  haptic(delta > 0 ? 10 : 5);
  refreshWater(date);
}

/** Aggiorna solo la card dell'acqua e il calendario (senza ridisegnare tutta la pagina). */
function refreshWater(date) {
  if (date === todayISO()) {
    const card = $('#water-card');
    if (card) card.innerHTML = waterCardInner(waterOf(date));
  }
  const cal = $('#cal-card');
  if (cal) cal.innerHTML = calendarInner();
}

/** Foglio per correggere a mano i millilitri di un giorno. */
function editWater(date) {
  const s = openSheet({
    title: 'Correggi acqua',
    html: `
      <label class="field">
        <span class="field-label">${esc(formatFullDate(date))}</span>
        <span class="input-unit">
          <input class="input num" data-ml type="text" inputmode="numeric" value="${waterOf(date)}" autocomplete="off">
          <span class="unit">ml</span>
        </span>
      </label>
      <div class="chips" data-quick>
        ${[0, 500, 1000, 1500, 2000].map((v) => `<button class="chip" data-v="${v}">${v === 0 ? 'Azzera' : `${liters(v)} L`}</button>`).join('')}
      </div>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button>
      </div>`,
  });
  const input = $('[data-ml]', s.body);
  $('[data-quick]', s.body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (b) input.value = b.dataset.v;
  });
  $('[data-save]', s.body).addEventListener('click', async () => {
    const ml = await setWater(date, parseNum(input.value) || 0, { notify: false });
    data.water.set(date, ml);
    s.close();
    refreshWater(date);
  });
}

/* --- Dettaglio di una giornata ------------------------------------------- */

function openDaySheet(date) {
  const title = formatFullDate(date);
  const s = openSheet({ title: title.charAt(0).toUpperCase() + title.slice(1), html: dayDetail(date) });

  s.body.addEventListener('click', async (e) => {
    const w = e.target.closest('[data-dwater]');
    if (w) {
      const ml = await setWater(date, waterOf(date) + Number(w.dataset.dwater), { notify: false });
      data.water.set(date, ml);
      haptic(5);
      s.body.innerHTML = dayDetail(date);
      refreshWater(date);
      return;
    }
    if (e.target.closest('[data-open-diet]')) {
      s.close();
      document.dispatchEvent(new CustomEvent('open-diet', { detail: date }));
    }
  });
}

function dayDetail(date) {
  const g = dayGoals(date);
  const ml = waterOf(date);
  const day = data.diet.get(date);
  const status = dayStatus(day);
  const workouts = workoutsOf(date);

  const statusPill = {
    clean: '<span class="status-pill clean">Giornata pulita</span>',
    cheat: '<span class="status-pill cheat">Sgarro</span>',
    empty: '<span class="status-pill">Nessun pasto segnato</span>',
  }[status];

  const meals = SLOTS.map((slot) => {
    const m = day?.meals?.[slot.id];
    if (!m) return '';
    const what = mealLabel(m);
    return `
      <div class="list-row">
        <span class="row-icon">${icon(slot.icon)}</span>
        <span class="row-main">
          <span class="row-title">${esc(slot.label)} · ${esc(what)}</span>
          ${m.note ? `<span class="row-sub">${esc(m.note)}</span>` : ''}
        </span>
        ${isCheatMeal(m) ? '<span class="status-pill cheat small">Sgarro</span>' : ''}
      </div>`;
  }).join('');

  const workoutRows = workouts.map((w) => {
    const sub = isActivity(w) ? (w.note || '')
      : isCardio(w) ? 'Cardio del sabato'
        : isPartial(w) ? `Parziale · ${partialText(w)} serie` : `${workoutStats(w).sets} serie`;
    return `
      <div class="list-row">
        <span class="row-icon accent">${icon(isActivity(w) ? activityType(w.activity).icon : isCardio(w) ? 'heart-pulse' : 'dumbbell')}</span>
        <span class="row-main">
          <span class="row-title">${esc(workoutLabel(w))}</span>
          ${sub ? `<span class="row-sub">${esc(sub)}</span>` : ''}
        </span>
      </div>`;
  }).join('');

  return `
    <div class="day-section">
      <div class="day-section-head"><i class="dot water ${g.water ? 'on' : ''}"></i>Acqua</div>
      <div class="card day-water">
        <div class="sum-big num">${liters(ml)}<span> / ${liters(WATER_GOAL)} L</span></div>
        <div class="water-btns">
          <button class="icon-btn" data-dwater="-${WATER_STEP}" aria-label="Togli ${WATER_STEP} ml" ${ml <= 0 ? 'disabled' : ''}>${icon('minus')}</button>
          <button class="btn btn-water" data-dwater="${WATER_STEP}">${icon('plus')} ${WATER_STEP} ml</button>
        </div>
      </div>
    </div>

    <div class="day-section">
      <div class="day-section-head"><i class="dot diet ${g.diet ? 'on' : ''}"></i>Dieta ${statusPill}</div>
      ${meals ? `<div class="list">${meals}</div>` : ''}
      <button class="btn btn-secondary btn-block" data-open-diet style="margin-top:var(--s-2)">${icon('utensils')} Apri nella Dieta</button>
    </div>

    <div class="day-section">
      <div class="day-section-head"><i class="dot gym ${g.gym ? 'on' : ''}"></i>Allenamento</div>
      ${workoutRows ? `<div class="list">${workoutRows}</div>` : '<p class="confirm-text">Nessun allenamento registrato.</p>'}
    </div>`;
}
