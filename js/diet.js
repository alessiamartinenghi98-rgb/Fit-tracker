/* ==========================================================================
   diet.js — Sezione Dieta
   --------------------------------------------------------------------------
   - Navigazione per giorno (frecce o selettore data)
   - Riepilogo giornaliero: calorie e macronutrienti
   - Pasti divisi in colazione, pranzo, cena e spuntini
   - Storico: elenco dei giorni registrati con i totali
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, toast, haptic, openSheet, confirmSheet, emptyState,
  todayISO, addDays, formatDay, fmtInt, fmtNum, parseNum,
} from './ui.js';

/* Tipi di pasto, nell'ordine in cui compaiono nella giornata */
const MEAL_TYPES = [
  { id: 'colazione', label: 'Colazione', icon: 'coffee' },
  { id: 'pranzo', label: 'Pranzo', icon: 'sun' },
  { id: 'cena', label: 'Cena', icon: 'moon' },
  { id: 'spuntino', label: 'Spuntini', single: 'Spuntino', icon: 'apple' },
];

const state = {
  date: todayISO(), // giorno visualizzato
  meals: [],        // pasti del giorno visualizzato
};

/* --- Calcoli ------------------------------------------------------------- */

/** Calorie stimate dai macronutrienti (4 kcal/g proteine e carboidrati, 9 kcal/g grassi). */
function kcalFromMacros(p, c, f) {
  return (p || 0) * 4 + (c || 0) * 4 + (f || 0) * 9;
}

function totals(meals) {
  return meals.reduce((t, m) => ({
    kcal: t.kcal + (m.kcal || 0),
    protein: t.protein + (m.protein || 0),
    carbs: t.carbs + (m.carbs || 0),
    fat: t.fat + (m.fat || 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}

/** Ora del giorno → tipo di pasto più probabile (per il nuovo inserimento). */
function guessMealType() {
  const h = new Date().getHours();
  if (h < 11) return 'colazione';
  if (h < 15) return 'pranzo';
  if (h >= 19) return 'cena';
  return 'spuntino';
}

/* --- Inizializzazione ---------------------------------------------------- */

export async function initDiet() {
  await loadDay();
  render();

  $('#btn-diet-history').addEventListener('click', openHistory);

  const root = $('#diet-content');
  root.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-action="prev"]')) return changeDay(-1);
    if (t.closest('[data-action="next"]')) return changeDay(1);
    const add = t.closest('[data-add]');
    if (add) return openMealSheet(null, add.dataset.add || guessMealType());
    const item = t.closest('[data-meal]');
    if (item) {
      const meal = state.meals.find((m) => m.id === item.dataset.meal);
      if (meal) openMealSheet(meal);
    }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id === 'diet-date' && e.target.value) {
      state.date = e.target.value;
      await loadDay();
      render();
    }
  });
}

/** Ricarica dopo un'importazione dei dati. */
export async function refreshDiet() {
  await loadDay();
  render();
}

async function loadDay() {
  state.meals = (await db.getByDate('meals', state.date))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

async function changeDay(delta) {
  const next = addDays(state.date, delta);
  if (next > todayISO()) return;
  haptic(5);
  state.date = next;
  await loadDay();
  render();
}

/* --- Rendering ----------------------------------------------------------- */

function render() {
  const root = $('#diet-content');
  const isToday = state.date >= todayISO();

  const nav = `
    <div class="day-nav">
      <button class="icon-btn" data-action="prev" aria-label="Giorno precedente">${icon('chevron-left')}</button>
      <label class="date-pill">
        ${icon('calendar-days')}<span>${esc(formatDay(state.date, { long: true }))}</span>
        <input type="date" id="diet-date" value="${state.date}" max="${todayISO()}" aria-label="Scegli il giorno">
      </label>
      <button class="icon-btn" data-action="next" aria-label="Giorno successivo" ${isToday ? 'disabled' : ''}>${icon('chevron-right')}</button>
    </div>`;

  if (state.meals.length === 0) {
    root.innerHTML = nav + `<div class="card">${emptyState({
      iconName: 'utensils',
      title: 'Nessun pasto registrato',
      text: isToday
        ? 'Annota cosa mangi oggi. Calorie e macronutrienti sono facoltativi.'
        : 'Per questo giorno non hai registrato pasti.',
      action: `<button class="btn btn-primary" data-add="">${icon('plus')} Aggiungi pasto</button>`,
    })}</div>`;
    return;
  }

  root.innerHTML = nav + summaryCard() + MEAL_TYPES.map(mealSection).join('');
}

function summaryCard() {
  const t = totals(state.meals);
  // Quota di calorie per ciascun macro (per la barra impilata)
  const pK = t.protein * 4;
  const cK = t.carbs * 4;
  const fK = t.fat * 9;
  const sum = pK + cK + fK;
  const bar = sum > 0
    ? `<span class="m-p" style="flex-grow:${pK}"></span><span class="m-c" style="flex-grow:${cK}"></span><span class="m-f" style="flex-grow:${fK}"></span>`
    : '';
  const pct = (v) => (sum > 0 ? ` · ${Math.round((v / sum) * 100)}%` : '');
  const n = state.meals.length;

  return `
    <div class="card">
      <div class="field-label" style="margin-bottom:var(--s-1)">Calorie</div>
      <div class="kcal-hero"><span class="big num">${fmtInt(t.kcal)}</span><span class="unit">kcal</span></div>
      <div class="kcal-sub">${n} ${n === 1 ? 'voce registrata' : 'voci registrate'}</div>
      <div class="macro-bar" role="img" aria-label="Ripartizione delle calorie tra i macronutrienti">${bar}</div>
      <div class="macro-grid">
        ${macro('Proteine', t.protein, 'm-p', pct(pK))}
        ${macro('Carboidrati', t.carbs, 'm-c', pct(cK))}
        ${macro('Grassi', t.fat, 'm-f', pct(fK))}
      </div>
    </div>`;
}

function macro(label, grams, cls, pct) {
  return `
    <div class="macro">
      <div class="lbl"><span class="dot ${cls}"></span>${label}</div>
      <div class="val num">${fmtInt(grams)}<small>g</small></div>
      <div class="kcal-sub" style="margin-top:0">${pct ? pct.slice(3) : '&nbsp;'}</div>
    </div>`;
}

function mealSubtitle(m) {
  const parts = [];
  if (m.kcal) parts.push(`${fmtInt(m.kcal)} kcal`);
  if (m.protein) parts.push(`P ${fmtNum(m.protein)} g`);
  if (m.carbs) parts.push(`C ${fmtNum(m.carbs)} g`);
  if (m.fat) parts.push(`G ${fmtNum(m.fat)} g`);
  return parts.join(' · ');
}

function mealSection(type) {
  const items = state.meals.filter((m) => m.type === type.id);
  const kcal = totals(items).kcal;

  const rows = items.map((m) => {
    const sub = mealSubtitle(m);
    return `
      <button class="list-row meal-item" data-meal="${m.id}">
        <span class="row-main">
          <span class="row-title">${esc(m.description)}</span>
          ${sub ? `<span class="row-sub num">${sub}</span>` : ''}
        </span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>`;
  }).join('');

  const addLabel = items.length ? 'Aggiungi' : `Aggiungi ${(type.single || type.label).toLowerCase()}`;

  return `
    <section class="meal-section">
      <div class="meal-head">
        <h3>${icon(type.icon)}${type.label}</h3>
        ${kcal ? `<span class="meal-kcal num">${fmtInt(kcal)} kcal</span>` : ''}
      </div>
      <div class="list ${items.length ? '' : 'meal-empty'}" style="${items.length ? '' : 'background:transparent'}">
        ${rows}
        <button class="meal-add" data-add="${type.id}">${icon('plus')} ${addLabel}</button>
      </div>
    </section>`;
}

/* --- Inserimento e modifica di un pasto ---------------------------------- */

function openMealSheet(meal, presetType) {
  const editing = Boolean(meal);
  let type = meal ? meal.type : presetType;

  const numField = (key, label, unit, value) => `
    <label class="field" style="margin-bottom:0">
      <span class="field-label">${label} <span class="opt">· facoltativo</span></span>
      <span class="input-unit">
        <input class="input num" data-f="${key}" type="text" inputmode="decimal"
               value="${fmtNum(value)}" placeholder="0" autocomplete="off">
        <span class="unit">${unit}</span>
      </span>
    </label>`;

  const s = openSheet({
    title: editing ? 'Modifica pasto' : 'Nuovo pasto',
    tall: false,
    html: `
      <div class="field">
        <span class="field-label">Pasto</span>
        <div class="chips" data-types>
          ${MEAL_TYPES.map((t) => `
            <button class="chip ${t.id === type ? 'active' : ''}" data-type="${t.id}">
              ${icon(t.icon)}${t.single || t.label}
            </button>`).join('')}
        </div>
      </div>
      <label class="field">
        <span class="field-label">Cosa hai mangiato</span>
        <textarea class="input" data-f="description" rows="3" maxlength="300"
                  placeholder="Es. yogurt greco, avena e mirtilli">${esc(meal?.description || '')}</textarea>
      </label>
      <div class="grid-2">
        ${numField('kcal', 'Calorie', 'kcal', meal?.kcal)}
        ${numField('protein', 'Proteine', 'g', meal?.protein)}
        ${numField('carbs', 'Carboidrati', 'g', meal?.carbs)}
        ${numField('fat', 'Grassi', 'g', meal?.fat)}
      </div>
      <p class="footnote">Se lasci vuote le calorie ma inserisci i macronutrienti, le calcolo io.</p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} ${editing ? 'Salva modifiche' : 'Aggiungi pasto'}</button>
        ${editing ? `<button class="btn btn-danger btn-block" data-delete>${icon('trash-2')} Elimina pasto</button>` : ''}
      </div>`,
  });

  const body = s.body;
  const f = (k) => body.querySelector(`[data-f="${k}"]`);

  // Selezione del tipo di pasto
  body.querySelector('[data-types]').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    type = chip.dataset.type;
    body.querySelectorAll('[data-type]').forEach((c) => c.classList.toggle('active', c === chip));
    haptic(5);
  });

  // Stima delle calorie mostrata come suggerimento mentre si scrivono i macro
  const updatePlaceholder = () => {
    const est = kcalFromMacros(parseNum(f('protein').value), parseNum(f('carbs').value), parseNum(f('fat').value));
    f('kcal').placeholder = est > 0 ? `≈ ${fmtInt(est)}` : '0';
  };
  ['protein', 'carbs', 'fat'].forEach((k) => f(k).addEventListener('input', updatePlaceholder));
  updatePlaceholder();

  // Un nuovo pasto apre subito la tastiera sulla descrizione
  if (!editing) setTimeout(() => f('description').focus(), 400);

  body.querySelector('[data-save]').addEventListener('click', async () => {
    const description = f('description').value.trim();
    if (!description) {
      f('description').focus();
      return toast('Scrivi cosa hai mangiato', { error: true });
    }
    const clean = (v) => { const n = parseNum(v); return n === null ? null : Math.max(0, n); };
    const protein = clean(f('protein').value);
    const carbs = clean(f('carbs').value);
    const fat = clean(f('fat').value);
    let kcal = clean(f('kcal').value);
    if (kcal === null && (protein || carbs || fat)) kcal = Math.round(kcalFromMacros(protein, carbs, fat));

    const record = {
      id: meal?.id || db.uid(),
      date: meal?.date || state.date,
      type,
      description,
      kcal, protein, carbs, fat,
      createdAt: meal?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    await db.put('meals', record);
    s.close();
    await loadDay();
    render();
    haptic(15);
    toast(editing ? 'Pasto aggiornato' : 'Pasto aggiunto');
  });

  body.querySelector('[data-delete]')?.addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({
      title: 'Eliminare il pasto?',
      message: `«${meal.description}» verrà eliminato definitivamente.`,
      confirmLabel: 'Elimina',
      danger: true,
    });
    if (!ok) return;
    await db.del('meals', meal.id);
    await loadDay();
    render();
    toast('Pasto eliminato');
  });
}

/* --- Storico per data ---------------------------------------------------- */

async function openHistory() {
  const all = await db.getAll('meals');

  // Raggruppa per giorno
  const byDay = new Map();
  for (const m of all) {
    if (!byDay.has(m.date)) byDay.set(m.date, []);
    byDay.get(m.date).push(m);
  }
  const days = [...byDay.keys()].sort().reverse();

  let html;
  if (days.length === 0) {
    html = emptyState({
      iconName: 'calendar-days', compact: true,
      title: 'Storico vuoto',
      text: 'I giorni in cui registri dei pasti compariranno qui.',
    });
  } else {
    // Media delle calorie negli ultimi 7 giorni con dati
    const weekAgo = addDays(todayISO(), -6);
    const recent = days.filter((d) => d >= weekAgo);
    const avg = recent.length
      ? recent.reduce((s, d) => s + totals(byDay.get(d)).kcal, 0) / recent.length
      : 0;

    html = `
      <div class="card" style="margin-bottom:var(--s-4)">
        <div class="field-label" style="margin-bottom:var(--s-1)">Media ultimi 7 giorni</div>
        <div class="kcal-hero"><span class="big num" style="font-size:36px">${fmtInt(avg)}</span><span class="unit">kcal / giorno</span></div>
        <div class="kcal-sub">Calcolata sui ${recent.length} ${recent.length === 1 ? 'giorno registrato' : 'giorni registrati'}</div>
      </div>
      <div class="list">
        ${days.map((d) => {
          const t = totals(byDay.get(d));
          const n = byDay.get(d).length;
          return `
            <button class="list-row" data-day="${d}">
              <span class="row-main">
                <span class="row-title" style="text-transform:capitalize">${esc(formatDay(d))}</span>
                <span class="row-sub num">${n} ${n === 1 ? 'voce' : 'voci'} · P ${fmtInt(t.protein)} · C ${fmtInt(t.carbs)} · G ${fmtInt(t.fat)} g</span>
              </span>
              <span class="row-trail num">${fmtInt(t.kcal)} kcal ${icon('chevron-right')}</span>
            </button>`;
        }).join('')}
      </div>`;
  }

  const s = openSheet({ title: 'Storico pasti', tall: true, html });
  s.body.addEventListener('click', async (e) => {
    const row = e.target.closest('[data-day]');
    if (!row) return;
    state.date = row.dataset.day;
    s.close();
    await loadDay();
    render();
  });
}
