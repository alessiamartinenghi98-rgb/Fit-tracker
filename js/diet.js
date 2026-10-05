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
  state.legacyCount = (await db.getAll('meals')).length;
  await loadWeek();
  render();

  $('#btn-diet-rules').addEventListener('click', openRules);

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
    const dayBtn = t.closest('[data-date]');
    if (dayBtn) { state.selected = dayBtn.dataset.date; haptic(5); return render(); }
    const quick = t.closest('[data-quick]');
    if (quick) return quickLog(quick.dataset.quick);
    const meal = t.closest('[data-slot]');
    if (meal && !meal.classList.contains('locked')) openMealSheet(meal.dataset.slot);
  });
}

/** Ricarica dopo un'importazione dei dati. */
export async function refreshDiet() {
  await loadPlan();
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

  // Giorni della settimana
  html += `<div class="day-strip">${dates.map((d, i) => {
    const st = dayStatus(state.days.get(d));
    return `
      <button class="day-chip ${d === state.selected ? 'active' : ''} ${d === today ? 'today' : ''}" data-date="${d}">
        <span class="dc-wd">${WEEKDAYS[i].slice(0, 3)}</span>
        <span class="dc-num num">${Number(d.slice(8))}</span>
        <span class="dc-dot ${st}"></span>
      </button>`;
  }).join('')}</div>`;

  html += dayView(state.selected);

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

/** Pasti del giorno selezionato. */
function dayView(date) {
  const day = state.days.get(date);
  const status = dayStatus(day);
  const future = date > todayISO();
  const plan = planForDate(date);
  const title = formatFullDate(date);

  const pill = future ? '<span class="status-pill">In programma</span>' : {
    clean: '<span class="status-pill clean">Giornata pulita</span>',
    cheat: '<span class="status-pill cheat">Sgarro</span>',
    empty: '<span class="status-pill">Da segnare</span>',
  }[status];

  let html = `
    <div class="day-title">
      <h2>${esc(title.charAt(0).toUpperCase() + title.slice(1))}</h2>${pill}
    </div>`;

  if (carbCount(day) > 1) {
    html += `<div class="note-banner">${icon('wheat')}<span>Hai segnato il carbo ${carbCount(day)} volte: il piano ne prevede una sola porzione al giorno.</span></div>`;
  }

  html += SLOTS.map((slot) => mealCard(slot, plan[slot.id], day?.meals?.[slot.id], future)).join('');
  if (future) html += '<p class="hint">Potrai segnare i pasti a partire da quel giorno.</p>';
  return html;
}

function mealCard(slot, planned, logged, future) {
  const planText = slot.main ? planned.text : planned;
  const planCat = slot.main ? `<span class="cat-chip">${esc(categoryLabel(planned.category))}</span>` : '';

  let body;
  if (logged) {
    const tags = [];
    if (logged.category) tags.push(`<span class="cat-chip solid">${esc(categoryLabel(logged.category))}</span>`);
    if (logged.option) tags.push(`<span class="cat-chip solid wrap">${esc(logged.optionLabel || OTHER_OPTION.label)}</span>`);
    if (logged.carbo) tags.push('<span class="cat-chip carb">+ carbo</span>');
    // Pasti segnati prima delle opzioni: solo "Come da piano" (mai per uno sgarro)
    if (!logged.category && !logged.option && !logged.note && !isCheatMeal(logged)) tags.push('<span class="cat-chip solid">Come da piano</span>');
    body = `
      <div class="meal-logged">
        ${tags.length ? `<div class="meal-tags">${tags.join('')}</div>` : ''}
        ${logged.note ? `<div class="meal-note">${esc(logged.note)}</div>` : ''}
      </div>`;
  } else if (!future) {
    body = `
      <div class="meal-actions">
        <button class="btn btn-secondary" data-quick="${slot.id}">${icon('check')} Come da piano</button>
        <button class="btn btn-ghost" data-slot="${slot.id}">Altro…</button>
      </div>`;
  } else {
    body = '';
  }

  const badge = logged
    ? (isCheatMeal(logged) ? '<span class="status-pill cheat small">Sgarro</span>' : `<span class="meal-ok">${icon('circle-check')}</span>`)
    : '';

  return `
    <div class="card meal-card ${logged ? 'card-tap logged' : ''} ${future ? 'locked' : ''}" ${logged ? `data-slot="${slot.id}"` : ''}>
      <div class="meal-card-head">
        <h3>${icon(slot.icon)}${esc(slot.label)}</h3>
        ${badge}
      </div>
      <div class="plan-hint">${planCat}<span>${esc(planText)}</span></div>
      ${body}
    </div>`;
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

/** "Come da piano": un tocco e il pasto è segnato con la categoria prevista. */
async function quickLog(slotId) {
  const date = state.selected;
  const planned = planForDate(date)[slotId];
  const slot = SLOTS.find((s) => s.id === slotId);
  let meal;
  if (slot.main) {
    meal = { category: planned.category, carbo: Boolean(planned.carbo), note: '', cheat: false, at: Date.now() };
  } else {
    const opt = plannedOption(date, slotId);
    meal = { note: '', cheat: false, at: Date.now(), ...(opt ? { option: opt.id, optionLabel: opt.label } : {}) };
  }
  await saveMeal(date, slotId, meal);
  haptic(15);
  render();
  warnIfNeeded(date, slotId);
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
  const planned = planForDate(date)[slotId];
  const existing = state.days.get(date)?.meals?.[slotId] || null;
  // Colazione e spuntino: opzione prevista dal piano preselezionata
  const options = slot.main ? [] : slotOptions(slotId);
  const draft = existing
    ? { ...existing }
    : slot.main
      ? { category: planned.category, carbo: Boolean(planned.carbo), note: '', cheat: false }
      : { option: plannedOption(date, slotId)?.id || null, note: '', cheat: false };
  // Pasto segnato prima delle opzioni ("come da piano"): si parte dall'opzione del piano
  if (!slot.main && existing && !existing.option) draft.option = plannedOption(date, slotId)?.id || null;
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
        ${icon('clipboard-list')}<span>Piano: ${esc(slot.main ? planned.text : planned)}</span>
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
        draft.option = plannedOption(date, slotId)?.id || null;
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
