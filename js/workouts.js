/* ==========================================================================
   workouts.js — Sezione Allenamenti
   --------------------------------------------------------------------------
   - Schede (A, B, C, D, cardio): si sceglie quale fare e si apre già compilata
   - Allenamento "in corso": salvato a ogni modifica, ritrovato alla riapertura
   - Editor a schermo intero: serie (peso × ripetizioni), stepper +/-,
     suggerimento "Aumenta il peso", timer di recupero, "Termina allenamento"
   - Storico raggruppato per mese e libreria esercizi
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, toast, haptic, openSheet, confirmSheet, emptyState,
  todayISO, startOfWeek, addDays, formatDay, formatShortDate, formatMonth,
  fmtNum, fmtInt, parseNum,
} from './ui.js';
import {
  seedTemplates, loadTemplates, strengthTemplates, cardioTemplate, getTemplate,
  repRange, targetText, notesHTML, UNIT_SHORT, renameExerciseInTemplates, openTemplatesManager,
} from './templates.js';
import { loadTimerSetting, isTimerEnabled, setTimerEnabled, startRest, stopRest } from './timer.js';

/* Esercizi proposti al primo avvio (si possono rinominare o eliminare) */
const DEFAULT_EXERCISES = [
  'Panca piana', 'Squat', 'Stacco da terra', 'Military press', 'Trazioni',
  'Rematore con bilanciere', 'Lat machine', 'Leg press', 'Affondi', 'Hip thrust',
  'Curl con bilanciere', 'French press', 'Alzate laterali', 'Dip',
];

const WEIGHT_STEP = 2.5; // kg per ogni tocco su +/-
const REPS_STEP = 1;

/* Recupero: 2-3 minuti per il primo esercizio, 60-90 secondi per gli altri.
   Si parte dal valore centrale; ±15 s dalla barra del timer. */
const REST_FIRST = 150;
const REST_OTHERS = 75;

const state = {
  workouts: [],   // tutti gli allenamenti, dal più recente
  exercises: [],  // libreria, in ordine alfabetico
  current: null,  // allenamento aperto nell'editor
};

/* ==========================================================================
   Calcoli condivisi (usati anche da Home e Progressi)
   ========================================================================== */

/** Serie valide: completate (spunta) e con almeno una ripetizione. */
export function completedSets(entry) {
  return (entry.sets || []).filter((s) => s.done && (s.reps || 0) > 0);
}

/** Volume = somma di ripetizioni × peso delle serie completate. */
export function entryVolume(entry) {
  return completedSets(entry).reduce((sum, s) => sum + s.reps * (s.weight || 0), 0);
}

export function workoutStats(w) {
  const entries = w.exercises || [];
  return {
    exercises: entries.length,
    sets: entries.reduce((n, e) => n + completedSets(e).length, 0),
    totalSets: entries.reduce((n, e) => n + (e.sets || []).length, 0),
    volume: entries.reduce((v, e) => v + entryVolume(e), 0),
  };
}

/** Ordina dal più recente: prima per data, poi per ora di creazione. */
export function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
}

export const isActive = (w) => w.status === 'active';
export const isCardio = (w) => w.kind === 'cardio';
export const isActivity = (w) => w.kind === 'activity';
/** Cardio e allenamenti liberi: contano per il calendario, non per l'obiettivo dei 4. */
export const isExtra = (w) => isCardio(w) || isActivity(w);
/** Allenamento con i pesi terminato: conta per l'obiettivo settimanale. */
export const isStrength = (w) => !isActive(w) && !isExtra(w) && (w.exercises || []).length > 0;

/* Tipi di allenamento libero */
export const ACTIVITY_TYPES = [
  { id: 'corsa', label: 'Corsa', icon: 'activity' },
  { id: 'nuoto', label: 'Nuoto', icon: 'waves' },
  { id: 'camminata', label: 'Camminata', icon: 'footprints' },
  { id: 'bici', label: 'Bici', icon: 'bike' },
  { id: 'altro', label: 'Altro', icon: 'circle-plus' },
];
export const activityType = (id) => ACTIVITY_TYPES.find((a) => a.id === id) || ACTIVITY_TYPES[4];

/** Breve descrizione per Home e calendario, es. "Corsa · 30 min". */
export function workoutLabel(w) {
  if (isActivity(w)) return `${activityType(w.activity).label}${w.duration ? ` · ${w.duration} min` : ''}`;
  if (isCardio(w)) return w.name || 'Cardio';
  return `${w.templateCode ? `${w.templateCode} · ` : ''}${w.name || 'Allenamento'}`;
}

/** Allenamento in corso (al massimo uno). */
export function getActiveWorkout() {
  return state.workouts.find(isActive) || null;
}

/** Id delle schede completate nella settimana corrente (lunedì-domenica). */
export function templatesDoneThisWeek() {
  const from = startOfWeek(todayISO());
  const to = addDays(from, 6);
  return new Set(state.workouts
    .filter((w) => !isActive(w) && w.templateId && w.date >= from && w.date <= to)
    .map((w) => w.templateId));
}

/** Prima scheda non ancora fatta questa settimana, nell'ordine A → D. */
export function suggestedTemplate() {
  const done = templatesDoneThisWeek();
  return strengthTemplates().find((t) => !done.has(t.id)) || null;
}

/** Avvisa Home (e chiunque ascolti) che i dati sono cambiati. */
function notifyChange() {
  document.dispatchEvent(new CustomEvent('data-changed'));
}

/* ==========================================================================
   Caricamento dati
   ========================================================================== */

async function load() {
  const [workouts, exercises] = await Promise.all([db.getAll('workouts'), db.getAll('exercises')]);
  state.workouts = workouts.sort(byNewest);
  state.exercises = exercises.sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

/** Al primo avvio inserisce alcuni esercizi comuni nella libreria. */
async function seedExercises() {
  if (await db.getMeta('seeded')) return;
  const existing = await db.getAll('exercises');
  if (existing.length === 0) {
    const now = Date.now();
    await db.putMany('exercises', DEFAULT_EXERCISES.map((name, i) => ({
      id: db.uid(), name, createdAt: now + i,
    })));
  }
  await db.setMeta('seeded', true);
}

/** Nome attuale di un esercizio (dalla libreria, se esiste ancora). */
function exerciseName(entry) {
  const ex = state.exercises.find((e) => e.id === entry.exerciseId);
  return ex ? ex.name : entry.name;
}

/**
 * Ultima esecuzione di un esercizio in un allenamento terminato, precedente
 * a quello corrente. Restituisce { date, entry, sets } oppure null.
 */
function lastPerformance(exerciseId, current) {
  for (const w of state.workouts) {
    if (isActive(w)) continue;
    if (current && w.id === current.id) continue;
    if (current && w.date > current.date) continue; // solo sessioni precedenti
    const entry = (w.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (entry) {
      const sets = completedSets(entry);
      if (sets.length) return { date: w.date, entry, sets };
    }
  }
  return null;
}

/**
 * Regola di progressione: se l'ultima volta tutte le serie previste sono
 * state fatte al massimo delle ripetizioni (es. 8 su 6-8), è ora di aumentare.
 */
function shouldIncrease(entry, current) {
  const target = entry.target;
  if (!target || !target.repMax) return false;
  const last = lastPerformance(entry.exerciseId, current);
  if (!last) return false;
  const lastTarget = last.entry.target || target;
  const needed = lastTarget.sets || target.sets;
  const top = lastTarget.repMax || target.repMax;
  return last.sets.length >= needed && last.sets.every((s) => s.reps >= top);
}

/* ==========================================================================
   Inizializzazione e scheda principale
   ========================================================================== */

export async function initWorkouts() {
  await seedExercises();
  await seedTemplates();
  await Promise.all([loadTemplates(), loadTimerSetting()]);
  await load();
  renderList();

  $('#btn-library').addEventListener('click', openLibrary);

  // Delega degli eventi sulla lista: un solo listener per tutto
  $('#workouts-content').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'start') return openStartSheet();
    if (action === 'resume') return resumeActive();
    if (action === 'free') return openActivitySheet();
    if (action === 'edit-templates') return openTemplatesManager();
    const tpl = e.target.closest('[data-template]');
    if (tpl) return startTemplate(tpl.dataset.template);
    const card = e.target.closest('[data-workout]');
    if (card) {
      const w = state.workouts.find((x) => x.id === card.dataset.workout);
      if (!w) return;
      if (isCardio(w)) return openCardioRecord(w);
      if (isActivity(w)) return openActivitySheet(w);
      openEditor(structuredClone(w));
    }
  });

  // Le schede modificate si riflettono subito nella lista
  document.addEventListener('templates-changed', async () => {
    await loadTemplates();
    renderList();
    notifyChange();
  });

  // Salvataggio immediato quando l'app va in background o viene chiusa
  const flush = () => { if (state.current) saveNow(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  window.addEventListener('pagehide', flush);

  // Allenamento lasciato a metà: riapre subito l'editor dove eri rimasta
  const active = getActiveWorkout();
  if (active) openEditor(structuredClone(active), { resumed: true });
}

/** Ricarica i dati (es. dopo un'importazione) e ridisegna. */
export async function refreshWorkouts() {
  await loadTemplates();
  await load();
  renderList();
}

function renderList() {
  const root = $('#workouts-content');
  const active = getActiveWorkout();
  const done = templatesDoneThisWeek();
  const history = state.workouts.filter((w) => !isActive(w));
  let html = '';

  // Allenamento in corso
  if (active) html += activeBanner(active);

  // Schede
  html += `
    <div class="section-label" ${active ? '' : 'style="margin-top:0"'}>
      <span>Schede</span>
      <button class="btn-ghost link-btn" data-action="edit-templates">${icon('pencil')} Modifica</button>
    </div>
    <div class="tpl-grid fade-list">
      ${strengthTemplates().map((t) => templateCard(t, done.has(t.id))).join('')}
    </div>`;

  const cardio = cardioTemplate();
  if (cardio) {
    const cardioDone = history.some((w) => isCardio(w) && w.date >= startOfWeek(todayISO()));
    html += `
      <button class="card card-tap tpl-cardio" data-template="${cardio.id}">
        <span class="tpl-badge cardio ${cardioDone ? 'done' : ''}">${icon(cardioDone ? 'check' : 'heart-pulse')}</span>
        <span class="row-main">
          <span class="row-title">${esc(cardio.name)}</span>
          <span class="row-sub">${cardioDone ? 'Fatto questa settimana' : 'Facoltativo · non conta nell\'obiettivo'}</span>
        </span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>`;
  }

  html += `
    <button class="card card-tap tpl-cardio" data-action="free">
      <span class="tpl-badge cardio">${icon('activity')}</span>
      <span class="row-main">
        <span class="row-title">Allenamento libero</span>
        <span class="row-sub">Corsa, nuoto, camminata, bici o altro</span>
      </span>
      <span class="row-trail">${icon('plus')}</span>
    </button>`;

  // Storico
  html += '<div class="section-label">Storico</div>';
  if (history.length === 0) {
    html += `<div class="card">${emptyState({
      iconName: 'dumbbell',
      compact: true,
      title: 'Nessun allenamento ancora',
      text: 'Scegli una scheda qui sopra: si apre già compilata con esercizi, serie e ripetizioni obiettivo.',
      action: `<button class="btn btn-primary" data-action="start">${icon('play')} Inizia allenamento</button>`,
    })}</div>`;
  } else {
    let currentMonth = '';
    let group = '';
    const flush = () => { if (group) html += `<div class="fade-list">${group}</div>`; group = ''; };
    for (const w of history) {
      const month = w.date.slice(0, 7);
      if (month !== currentMonth) {
        flush();
        currentMonth = month;
        html += `<div class="month-label">${formatMonth(w.date)}</div>`;
      }
      group += isCardio(w) ? cardioCard(w) : isActivity(w) ? activityCard(w) : workoutCard(w);
    }
    flush();
  }

  root.innerHTML = html;
}

/** Riquadro "Allenamento in corso" (usato anche nella Home). */
export function activeBanner(w) {
  const st = workoutStats(w);
  return `
    <button class="card card-tap active-banner" data-action="resume">
      <span class="pulse-dot"></span>
      <span class="row-main">
        <span class="ab-label">Allenamento in corso</span>
        <span class="row-title">${w.templateCode ? `${esc(w.templateCode)} · ` : ''}${esc(w.name || 'Allenamento')}</span>
        <span class="row-sub num">${st.sets} di ${st.totalSets} serie completate</span>
      </span>
      <span class="ab-cta">Riprendi ${icon('chevron-right')}</span>
    </button>`;
}

function templateCard(t, doneThisWeek) {
  const last = state.workouts.find((w) => !isActive(w) && w.templateId === t.id);
  const sub = last ? `Ultima ${formatShortDate(last.date)}` : 'Mai fatta';
  return `
    <button class="card card-tap tpl-card" data-template="${t.id}">
      <span class="tpl-top">
        <span class="tpl-badge ${doneThisWeek ? 'done' : ''}">${esc(t.code)}</span>
        ${doneThisWeek ? `<span class="tpl-check">${icon('check')}</span>` : ''}
      </span>
      <span class="tpl-name">${esc(t.name)}</span>
      <span class="tpl-sub">${t.exercises.length} esercizi · ${esc(sub)}</span>
    </button>`;
}

function workoutCard(w) {
  const st = workoutStats(w);
  const entries = w.exercises || [];
  const shown = entries.slice(0, 4).map((e) => {
    const n = completedSets(e).length;
    return `<span>${esc(exerciseName(e))} <span style="display:inline;color:var(--text-3)">· ${n} serie</span></span>`;
  }).join('');
  const more = entries.length > 4 ? `<span>+ altri ${entries.length - 4}</span>` : '';

  return `
    <article class="card card-tap workout-card" data-workout="${w.id}">
      <div class="wc-head">
        <div class="wc-title">${w.templateCode ? `<span class="mini-badge">${esc(w.templateCode)}</span>` : ''}${esc(w.name || 'Allenamento')}</div>
        <div class="wc-date">${esc(formatDay(w.date))}</div>
      </div>
      <div class="wc-stats">
        <div class="stat-mini"><div class="v num">${st.exercises}</div><div class="l">Esercizi</div></div>
        <div class="stat-mini"><div class="v num">${st.sets}</div><div class="l">Serie</div></div>
        <div class="stat-mini"><div class="v num">${fmtInt(st.volume)}<small>kg</small></div><div class="l">Volume</div></div>
      </div>
      ${entries.length ? `<div class="wc-ex">${shown}${more}</div>` : ''}
    </article>`;
}

function cardioCard(w) {
  return `
    <article class="card card-tap workout-card cardio-card" data-workout="${w.id}">
      <div class="wc-head" style="align-items:center">
        <div class="wc-title" style="display:flex;align-items:center;gap:10px">
          <span class="tpl-badge cardio done small">${icon('check')}</span>${esc(w.name || 'Cardio')}
        </div>
        <div class="wc-date">${esc(formatDay(w.date))}</div>
      </div>
    </article>`;
}

function activityCard(w) {
  const type = activityType(w.activity);
  return `
    <article class="card card-tap workout-card cardio-card" data-workout="${w.id}">
      <div class="wc-head" style="align-items:center">
        <div class="wc-title" style="display:flex;align-items:center;gap:10px">
          <span class="tpl-badge cardio small">${icon(type.icon)}</span>${esc(workoutLabel(w))}
        </div>
        <div class="wc-date">${esc(formatDay(w.date))}</div>
      </div>
      ${w.note ? `<div class="wc-ex"><span>${esc(w.note)}</span></div>` : ''}
    </article>`;
}

/* ==========================================================================
   Avvio di un allenamento
   ========================================================================== */

/** Foglio "Scegli la scheda" (dalla Home o dal pulsante Inizia). */
export function openStartSheet() {
  const active = getActiveWorkout();
  if (active) return resumeActive();

  const done = templatesDoneThisWeek();
  const next = suggestedTemplate();
  const cardio = cardioTemplate();

  const rows = strengthTemplates().map((t) => `
    <button class="list-row" data-template="${t.id}">
      <span class="tpl-badge ${done.has(t.id) ? 'done' : ''}">${esc(t.code)}</span>
      <span class="row-main">
        <span class="row-title">${esc(t.name)}</span>
        <span class="row-sub">${t.exercises.length} esercizi${done.has(t.id) ? ' · fatta questa settimana' : ''}</span>
      </span>
      ${next && next.id === t.id ? '<span class="pill-accent">Consigliata</span>' : `<span class="row-trail">${icon('chevron-right')}</span>`}
    </button>`).join('');

  const s = openSheet({
    title: 'Scegli la scheda',
    html: `
      <div class="list">${rows}</div>
      ${cardio ? `
        <div class="list" style="margin-top:var(--s-3)">
          <button class="list-row" data-template="${cardio.id}">
            <span class="tpl-badge cardio">${icon('heart-pulse')}</span>
            <span class="row-main"><span class="row-title">${esc(cardio.name)}</span>
            <span class="row-sub">Facoltativo · non conta nell'obiettivo</span></span>
            <span class="row-trail">${icon('chevron-right')}</span>
          </button>
        </div>` : ''}
      <button class="btn btn-ghost btn-block" data-free style="margin-top:var(--s-3)">${icon('plus')} Allenamento libero</button>`,
  });

  s.body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-template]');
    if (row) { s.close(); startTemplate(row.dataset.template); return; }
    if (e.target.closest('[data-free]')) { s.close(); openActivitySheet(); }
  });
}

/** Riapre l'allenamento in corso. */
export function resumeActive() {
  const active = getActiveWorkout();
  if (active) openEditor(structuredClone(active));
}

/** Se c'è già un allenamento in corso, propone di riprenderlo. */
async function guardActive() {
  const active = getActiveWorkout();
  if (!active) return false;
  const ok = await confirmSheet({
    title: 'Hai un allenamento in corso',
    message: `«${active.templateCode ? `${active.templateCode} · ` : ''}${active.name || 'Allenamento'}» non è ancora terminato. ` +
      'Riprendilo e premi "Termina allenamento" prima di iniziarne un altro.',
    confirmLabel: 'Riprendi allenamento',
  });
  if (ok) resumeActive();
  return true;
}

/** Inizia una scheda: esercizi, serie e pesi dell'ultima volta già compilati. */
export async function startTemplate(templateId) {
  const t = getTemplate(templateId);
  if (!t) return;
  if (t.kind === 'cardio') return openCardioSheet(t);
  if (await guardActive()) return;

  haptic();
  const now = Date.now();
  const w = {
    id: db.uid(),
    date: todayISO(),
    name: t.name,
    templateId: t.id,
    templateCode: t.code,
    status: 'active',
    exercises: [],
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  };
  w.exercises = t.exercises.map((te) => entryFromTemplate(te, w));
  await db.put('workouts', w);
  state.workouts.unshift(w);
  state.workouts.sort(byNewest);
  renderList();
  notifyChange();
  openEditor(structuredClone(w));
}

/** Esercizio della scheda → voce dell'allenamento con le serie precompilate. */
function entryFromTemplate(te, workout) {
  const last = lastPerformance(te.exerciseId, workout);
  const sets = Array.from({ length: te.sets }, (_, i) => {
    // Peso usato l'ultima volta nella stessa serie (o nell'ultima disponibile)
    const ls = last ? (last.sets[i] || last.sets[last.sets.length - 1]) : null;
    return { weight: ls ? ls.weight : null, reps: null, done: false };
  });
  return {
    exerciseId: te.exerciseId,
    name: te.name,
    target: { sets: te.sets, repMin: te.repMin, repMax: te.repMax, unit: te.unit || '' },
    sets,
  };
}

/**
 * Allenamento libero: tipo (corsa, nuoto, camminata, bici, altro), durata e nota.
 * Con un allenamento già registrato il foglio serve a modificarlo o eliminarlo.
 */
export function openActivitySheet(existing = null) {
  const draft = existing
    ? { activity: existing.activity, duration: existing.duration || 30, note: existing.note || '', date: existing.date }
    : { activity: 'corsa', duration: 30, note: '', date: todayISO() };

  const s = openSheet({
    title: existing ? 'Allenamento libero' : 'Nuovo allenamento libero',
    html: `
      <div class="field">
        <span class="field-label">Tipo</span>
        <div class="chips" data-types>
          ${ACTIVITY_TYPES.map((a) => `
            <button class="chip ${a.id === draft.activity ? 'active' : ''}" data-type="${a.id}">${icon(a.icon)}${a.label}</button>`).join('')}
        </div>
      </div>
      <div class="grid-2">
        <label class="field">
          <span class="field-label">Durata (minuti)</span>
          <div class="stepper" data-duration style="height:48px">
            <button data-d="-5" aria-label="Meno 5 minuti">${icon('minus')}</button>
            <input type="text" inputmode="numeric" value="${draft.duration}" autocomplete="off">
            <button data-d="5" aria-label="Più 5 minuti">${icon('plus')}</button>
          </div>
        </label>
        <label class="field">
          <span class="field-label">Data</span>
          <input class="input" type="date" data-date value="${draft.date}" max="${todayISO()}">
        </label>
      </div>
      <label class="field">
        <span class="field-label">Nota <span class="opt">· facoltativa</span></span>
        <textarea class="input" data-note rows="2" maxlength="200" placeholder="Es. 5 km al parco, ritmo tranquillo">${esc(draft.note)}</textarea>
      </label>
      <p class="footnote" style="margin-top:0">Conta per il calendario della Home, non per l'obiettivo dei 4 allenamenti settimanali.</p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} ${existing ? 'Salva modifiche' : 'Registra allenamento'}</button>
        ${existing ? `<button class="btn btn-danger btn-block" data-delete>${icon('trash-2')} Elimina</button>` : ''}
      </div>`,
  });

  const body = s.body;
  const durInput = $('[data-duration] input', body);

  $('[data-types]', body).addEventListener('click', (e) => {
    const chip = e.target.closest('[data-type]');
    if (!chip) return;
    draft.activity = chip.dataset.type;
    body.querySelectorAll('[data-type]').forEach((c) => c.classList.toggle('active', c === chip));
    haptic(5);
  });
  $('[data-duration]', body).addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    e.preventDefault();
    draft.duration = Math.max(5, Math.min(600, (parseInt(durInput.value, 10) || 0) + Number(b.dataset.d)));
    durInput.value = draft.duration;
    haptic(5);
  });

  $('[data-save]', body).addEventListener('click', async () => {
    const duration = parseInt(durInput.value, 10);
    if (!duration || duration < 1) return toast('Inserisci la durata', { error: true });
    const now = Date.now();
    const w = existing || { id: db.uid(), kind: 'activity', status: 'done', exercises: [], createdAt: now };
    Object.assign(w, {
      activity: draft.activity,
      name: activityType(draft.activity).label,
      duration: Math.min(600, duration),
      note: $('[data-note]', body).value.trim(),
      date: $('[data-date]', body).value || todayISO(),
      updatedAt: now,
      finishedAt: w.finishedAt || now,
    });
    await db.put('workouts', w);
    if (!existing) state.workouts.unshift(w);
    state.workouts.sort(byNewest);
    s.close();
    renderList();
    notifyChange();
    haptic(15);
    toast(existing ? 'Allenamento aggiornato' : 'Allenamento registrato');
  });

  $('[data-delete]', body)?.addEventListener('click', async () => {
    await db.del('workouts', existing.id);
    state.workouts = state.workouts.filter((x) => x.id !== existing.id);
    s.close();
    renderList();
    notifyChange();
    toast('Allenamento eliminato');
  });
}

/* --- Cardio: basta segnarlo come fatto ---------------------------------- */

export function openCardioSheet(t) {
  const today = todayISO();
  const doneToday = state.workouts.some((w) => isCardio(w) && w.date === today);
  const s = openSheet({
    title: t.name,
    html: `
      <div class="card notes-card">${notesHTML(t.notes)}</div>
      <p class="footnote">Facoltativo: non conta nell'obiettivo dei 4 allenamenti settimanali.</p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-done>${icon('check')} ${doneToday ? 'Segna di nuovo come fatto' : 'Segna come fatto'}</button>
        <button class="btn btn-secondary btn-block" data-close>Chiudi</button>
      </div>`,
  });
  $('[data-done]', s.body).addEventListener('click', async () => {
    const now = Date.now();
    const w = {
      id: db.uid(), date: today, name: t.name, kind: 'cardio', templateId: t.id,
      templateCode: t.code, status: 'done', exercises: [], createdAt: now, updatedAt: now, finishedAt: now,
    };
    await db.put('workouts', w);
    state.workouts.unshift(w);
    state.workouts.sort(byNewest);
    s.close();
    renderList();
    notifyChange();
    haptic(15);
    toast('Cardio registrato');
  });
}

/** Cardio già registrato: si può cambiare la data o eliminarlo. */
function openCardioRecord(w) {
  const s = openSheet({
    title: w.name || 'Cardio',
    html: `
      <label class="field">
        <span class="field-label">Data</span>
        <input class="input" type="date" data-date value="${w.date}" max="${todayISO()}">
      </label>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button>
        <button class="btn btn-danger btn-block" data-delete>${icon('trash-2')} Elimina</button>
      </div>`,
  });
  $('[data-save]', s.body).addEventListener('click', async () => {
    const date = $('[data-date]', s.body).value;
    if (date) w.date = date;
    w.updatedAt = Date.now();
    await db.put('workouts', w);
    state.workouts.sort(byNewest);
    s.close();
    renderList();
    notifyChange();
  });
  $('[data-delete]', s.body).addEventListener('click', async () => {
    await db.del('workouts', w.id);
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
    s.close();
    renderList();
    notifyChange();
    toast('Cardio eliminato');
  });
}

/* ==========================================================================
   Editor allenamento
   ========================================================================== */

function openEditor(workout, { pickFirst = false, resumed = false } = {}) {
  state.current = workout;
  const ed = $('#workout-editor');
  const active = isActive(workout);

  ed.innerHTML = `
    <header class="topbar scrolled">
      <button class="back-btn" data-action="close">${icon('chevron-left')}<span>${active ? 'Indietro' : 'Storico'}</span></button>
      <span class="topbar-title" id="ed-topbar-title"></span>
      <div class="topbar-actions">
        <button class="icon-btn ${isTimerEnabled() ? 'on' : ''}" data-action="toggle-timer" id="ed-timer"
                aria-label="Timer di recupero">${icon(isTimerEnabled() ? 'timer' : 'timer-off')}</button>
        <button class="icon-btn" data-action="delete-workout" aria-label="Elimina allenamento">${icon('trash-2')}</button>
        ${active ? '' : '<button class="btn btn-ghost" data-action="close" style="font-weight:600">Fine</button>'}
      </div>
    </header>

    <div class="ed-title-row">
      ${workout.templateCode ? `<span class="tpl-badge">${esc(workout.templateCode)}</span>` : ''}
      <input class="title-input" id="ed-name" placeholder="Allenamento" maxlength="60"
             value="${esc(workout.name)}" autocomplete="off" enterkeyhint="done">
    </div>

    <div class="editor-meta">
      <label class="date-pill">
        ${icon('calendar-days')}<span id="ed-date-label"></span>
        <input type="date" id="ed-date" value="${workout.date}" aria-label="Data allenamento">
      </label>
      <span class="editor-summary num" id="ed-summary"></span>
    </div>

    <div id="ed-exercises"></div>

    <button class="btn btn-secondary btn-block" data-action="add-exercise" style="margin-top:var(--s-3)">
      ${icon('plus')} Aggiungi esercizio
    </button>
    ${active ? `
      <button class="btn btn-primary btn-block finish-btn" data-action="finish">
        ${icon('flag')} Termina allenamento
      </button>` : ''}
    <p class="hint">Tocca ${'✓'} per salvare una serie · scorri a sinistra per eliminarla</p>
    <div class="save-state" id="ed-save" style="justify-content:center;width:100%;margin-top:var(--s-2);opacity:0">
      ${icon('cloud-check')} Salvato
    </div>`;

  renderDate();
  renderExercises();
  updateSummary();

  // Apertura animata e barra delle schede nascosta
  ed.classList.add('open');
  ed.setAttribute('aria-hidden', 'false');
  ed.scrollTop = 0;
  $('#tabbar').classList.add('hidden');

  bindEditorOnce(ed);

  if (resumed) toast('Allenamento in corso ripreso');
  if (pickFirst) setTimeout(openExercisePicker, 380);
}

function renderDate() {
  const w = state.current;
  $('#ed-date-label').textContent = formatDay(w.date);
  $('#ed-topbar-title').textContent = w.templateCode ? `${w.templateCode} · ${formatShortDate(w.date)}` : formatShortDate(w.date);
}

function updateSummary() {
  const el = $('#ed-summary');
  if (!el || !state.current) return;
  const st = workoutStats(state.current);
  const parts = [`${st.sets}/${st.totalSets} serie`];
  if (st.volume > 0) parts.push(`${fmtInt(st.volume)} kg`);
  el.textContent = parts.join(' · ');
}

function renderExercises(newIndex = -1) {
  const list = $('#ed-exercises');
  const entries = state.current.exercises;
  if (entries.length === 0) {
    list.innerHTML = `
      <div class="card">${emptyState({
        iconName: 'list-plus',
        title: 'Nessun esercizio',
        text: 'Aggiungi il primo esercizio dalla tua libreria per iniziare a registrare le serie.',
        compact: true,
      })}</div>`;
    return;
  }
  list.innerHTML = entries.map((e, i) => exerciseCard(e, i, i === newIndex)).join('');
}

/** Ridisegna una sola card (senza toccare le altre). */
function rerenderCard(i) {
  const card = $(`.ex-card[data-ex="${i}"]`);
  if (card) card.outerHTML = exerciseCard(state.current.exercises[i], i, false);
}

function exerciseCard(entry, i, isNew) {
  const t = entry.target;
  const last = lastPerformance(entry.exerciseId, state.current);
  let ref;
  if (last) {
    const sets = last.sets.slice(0, 4).map((s) => `${fmtNum(s.weight || 0)}×${s.reps}`).join(' · ');
    const more = last.sets.length > 4 ? ' …' : '';
    ref = `${icon('history')}<span>Ultima volta ${esc(formatShortDate(last.date))} · <b class="num">${sets}${more}</b></span>`;
  } else {
    ref = `${icon('sparkles')}<span>Prima volta: nessun riferimento</span>`;
  }

  const increase = shouldIncrease(entry, state.current);
  const unit = t ? UNIT_SHORT[t.unit || ''] : '';

  return `
    <div class="card ex-card" data-ex="${i}" ${isNew ? '' : 'style="animation:none"'}>
      <div class="ex-head">
        <div style="min-width:0">
          <div class="ex-name">${esc(exerciseName(entry))}</div>
          ${t ? `<div class="ex-target num">${icon('target')}<span>Obiettivo <b>${esc(targetText(t))}</b></span></div>` : ''}
          <div class="ex-ref">${ref}</div>
          ${increase ? `<div class="hint-pill">${icon('trending-up')} Aumenta il peso</div>` : ''}
        </div>
        <button class="ex-menu" data-action="ex-menu" aria-label="Opzioni esercizio">${icon('ellipsis')}</button>
      </div>
      <div class="sets-head"><span>Serie</span><span>Kg</span><span>Rep${unit ? ` /${unit}` : ''}</span><span></span></div>
      <div class="sets">${entry.sets.map((s, j) => setRow(s, j, t)).join('')}</div>
      <button class="add-set" data-action="add-set">${icon('plus')} Aggiungi serie</button>
    </div>`;
}

function setRow(s, j, target) {
  const repsHint = target ? repRange(target.repMin, target.repMax) : '–';
  return `
    <div class="set-wrap" data-set="${j}">
      <div class="set-delete">${icon('trash-2')} Elimina</div>
      <div class="set-row ${s.done ? 'done' : ''}">
        <div class="set-num num">${j + 1}</div>
        ${stepper('weight', s.weight, 'decimal', '–')}
        ${stepper('reps', s.reps, 'numeric', repsHint)}
        <button class="set-check" data-action="toggle-set" aria-label="Completa serie">${icon('check')}</button>
      </div>
    </div>`;
}

function stepper(field, value, mode, placeholder) {
  const label = field === 'weight' ? 'peso' : 'ripetizioni';
  return `
    <div class="stepper" data-field="${field}">
      <button data-step="-1" aria-label="Diminuisci ${label}">${icon('minus')}</button>
      <input type="text" inputmode="${mode}" value="${fmtNum(value)}" placeholder="${placeholder}"
             autocomplete="off" aria-label="${label}">
      <button data-step="1" aria-label="Aumenta ${label}">${icon('plus')}</button>
    </div>`;
}

/* --- Salvataggio automatico ---------------------------------------------- */

let saveTimer = null;

/** Salvataggio ritardato (mentre si digita). */
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 300);
  updateSummary();
}

/** Salvataggio immediato su IndexedDB. */
async function saveNow() {
  clearTimeout(saveTimer);
  const w = state.current;
  if (!w) return;
  w.updatedAt = Date.now();
  const copy = structuredClone(w);
  await db.put('workouts', copy);

  // Aggiorna la copia nella lista
  const idx = state.workouts.findIndex((x) => x.id === w.id);
  if (idx >= 0) state.workouts[idx] = structuredClone(copy);
  else state.workouts.push(structuredClone(copy));
  state.workouts.sort(byNewest);
  updateSummary();

  const ind = $('#ed-save');
  if (ind) {
    ind.style.opacity = '1';
    clearTimeout(ind._t);
    ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 1200);
  }
}

/** Chiude l'editor. Un allenamento in corso resta in corso. */
async function closeEditor() {
  if (document.activeElement) document.activeElement.blur();
  await saveNow();

  // Un allenamento senza esercizi non viene conservato
  const w = state.current;
  if (w && w.exercises.length === 0) {
    await db.del('workouts', w.id);
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
  }
  hideEditor();
}

function hideEditor() {
  const ed = $('#workout-editor');
  state.current = null;
  stopRest();
  ed.classList.add('closing');
  ed.classList.remove('open');
  ed.setAttribute('aria-hidden', 'true');
  $('#tabbar').classList.remove('hidden');
  setTimeout(() => { ed.classList.remove('closing'); ed.innerHTML = ''; }, 400);
  renderList();
  notifyChange();
}

/** "Termina allenamento": registra nello storico. */
async function finishWorkout() {
  const w = state.current;
  if (document.activeElement) document.activeElement.blur();
  const st = workoutStats(w);

  if (st.sets === 0) {
    const ok = await confirmSheet({
      title: 'Nessuna serie completata',
      message: 'Non hai segnato nessuna serie con la spunta. Vuoi eliminare questo allenamento?',
      confirmLabel: 'Elimina allenamento',
      danger: true,
    });
    if (!ok) return;
    clearTimeout(saveTimer);
    await db.del('workouts', w.id);
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
    hideEditor();
    return;
  }

  const pending = st.totalSets - st.sets;
  if (pending > 0) {
    const ok = await confirmSheet({
      title: 'Terminare l\'allenamento?',
      message: `${pending} ${pending === 1 ? 'serie non è stata completata e non verrà registrata' : 'serie non sono state completate e non verranno registrate'}.`,
      confirmLabel: 'Termina allenamento',
    });
    if (!ok) return;
  }

  // Nello storico restano solo le serie completate
  w.exercises = w.exercises
    .map((e) => ({ ...e, sets: e.sets.filter((s) => s.done && (s.reps || 0) > 0) }))
    .filter((e) => e.sets.length > 0);
  w.status = 'done';
  w.finishedAt = Date.now();
  await saveNow();
  hideEditor();
  haptic(20);
  toast('Allenamento registrato');
}

/* --- Eventi dell'editor (registrati una sola volta, con delega) ---------- */

let editorBound = false;

function bindEditorOnce(ed) {
  if (editorBound) return;
  editorBound = true;

  ed.addEventListener('click', async (e) => {
    const t = e.target;
    const action = t.closest('[data-action]')?.dataset.action;
    const card = t.closest('.ex-card');
    const exIndex = card ? Number(card.dataset.ex) : -1;

    // Pulsanti +/-
    const stepBtn = t.closest('[data-step]');
    if (stepBtn) {
      const wrap = t.closest('.set-wrap');
      const field = t.closest('.stepper').dataset.field;
      const entry = state.current.exercises[exIndex];
      const s = entry.sets[Number(wrap.dataset.set)];
      let next;
      if (field === 'reps' && s.reps === null && entry.target) {
        // Primo tocco su ripetizioni vuote: parte dal minimo dell'obiettivo
        next = entry.target.repMin;
      } else {
        const step = (field === 'weight' ? WEIGHT_STEP : REPS_STEP) * Number(stepBtn.dataset.step);
        next = Math.max(0, Math.round(((s[field] || 0) + step) * 100) / 100);
      }
      s[field] = next;
      $(`.stepper[data-field="${field}"] input`, wrap).value = fmtNum(next);
      haptic(5);
      scheduleSave();
      return;
    }

    switch (action) {
      case 'close': return closeEditor();
      case 'finish': return finishWorkout();
      case 'add-exercise': return openExercisePicker();
      case 'delete-workout': return deleteCurrentWorkout();
      case 'toggle-timer': return toggleTimer();
      case 'ex-menu': return openExerciseMenu(exIndex);
      case 'add-set': return addSet(exIndex);
      case 'toggle-set': return toggleSet(exIndex, Number(t.closest('.set-wrap').dataset.set));
      default:
    }
  });

  // Digitazione nei campi peso/ripetizioni
  ed.addEventListener('input', (e) => {
    if (e.target.id === 'ed-name') {
      state.current.name = e.target.value;
      return scheduleSave();
    }
    const stepperEl = e.target.closest('.stepper');
    if (!stepperEl) return;
    const card = e.target.closest('.ex-card');
    const wrap = e.target.closest('.set-wrap');
    const s = state.current.exercises[Number(card.dataset.ex)].sets[Number(wrap.dataset.set)];
    const field = stepperEl.dataset.field;
    let v = parseNum(e.target.value);
    if (v !== null) v = field === 'reps' ? Math.max(0, Math.round(v)) : Math.max(0, v);
    s[field] = v;
    scheduleSave();
  });

  // Uscendo dal campo: valore riscritto in formato pulito e salvataggio immediato
  ed.addEventListener('focusout', (e) => {
    const stepperEl = e.target.closest('.stepper');
    if (!stepperEl) return;
    const card = e.target.closest('.ex-card');
    const wrap = e.target.closest('.set-wrap');
    if (!card || !wrap) return;
    const s = state.current?.exercises[Number(card.dataset.ex)]?.sets[Number(wrap.dataset.set)];
    if (s) e.target.value = fmtNum(s[stepperEl.dataset.field]);
    if (state.current) saveNow();
  });

  // Toccando un campo, il contenuto viene selezionato per sostituirlo subito
  ed.addEventListener('focusin', (e) => {
    if (e.target.matches('.stepper input')) {
      const el = e.target;
      setTimeout(() => el.setSelectionRange(0, el.value.length), 0);
    }
  });

  ed.addEventListener('change', (e) => {
    if (e.target.id === 'ed-date' && e.target.value) {
      state.current.date = e.target.value;
      renderDate();
      renderExercises(); // i riferimenti "ultima volta" dipendono dalla data
      saveNow();
    }
  });

  bindSwipeToDelete(ed);
}

function toggleTimer() {
  const on = !isTimerEnabled();
  setTimerEnabled(on);
  const btn = $('#ed-timer');
  btn.classList.toggle('on', on);
  btn.innerHTML = icon(on ? 'timer' : 'timer-off');
  haptic(5);
  toast(on ? 'Timer di recupero attivo' : 'Timer di recupero disattivato');
}

function addSet(exIndex) {
  const entry = state.current.exercises[exIndex];
  const prev = entry.sets[entry.sets.length - 1];
  // La nuova serie riprende peso e ripetizioni della precedente
  entry.sets.push({ weight: prev ? prev.weight : null, reps: prev ? prev.reps : null, done: false });
  haptic(5);
  const card = $(`.ex-card[data-ex="${exIndex}"]`);
  $('.sets', card).insertAdjacentHTML('beforeend', setRow(entry.sets[entry.sets.length - 1], entry.sets.length - 1, entry.target));
  const added = $('.sets', card).lastElementChild;
  added.animate(
    [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  );
  saveNow();
}

function toggleSet(exIndex, setIndex) {
  const s = state.current.exercises[exIndex].sets[setIndex];
  const row = $(`.ex-card[data-ex="${exIndex}"] .set-wrap[data-set="${setIndex}"] .set-row`);

  if (!s.done && !(s.reps > 0)) {
    toast('Inserisci le ripetizioni', { error: true });
    row.animate(
      [{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
      { duration: 280 }
    );
    return;
  }

  s.done = !s.done;
  if (s.weight === null) s.weight = 0;
  if (document.activeElement) document.activeElement.blur();
  row.classList.toggle('done', s.done);
  row.classList.remove('just-done');
  if (s.done) {
    void row.offsetWidth; // fa ripartire l'animazione
    row.classList.add('just-done');
    haptic(15);
    // Recupero: più lungo dopo il primo esercizio della scheda
    startRest(exIndex === 0 ? REST_FIRST : REST_OTHERS);
  }
  saveNow(); // ogni serie è salvata subito
}

function removeSet(exIndex, setIndex) {
  const entry = state.current.exercises[exIndex];
  entry.sets.splice(setIndex, 1);
  rerenderCard(exIndex);
  saveNow();
}

/** Scorrere una serie verso sinistra mostra "Elimina"; oltre la soglia la elimina. */
function bindSwipeToDelete(root) {
  const THRESHOLD = 90;
  let row = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let tracking = false;
  let horizontal = null;

  root.addEventListener('pointerdown', (e) => {
    const r = e.target.closest('.set-row');
    if (!r || e.pointerType === 'mouse' && e.button !== 0) return;
    row = r;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    tracking = true;
    horizontal = null;
  });

  root.addEventListener('pointermove', (e) => {
    if (!tracking || !row) return;
    const mx = e.clientX - startX;
    const my = e.clientY - startY;
    if (horizontal === null && (Math.abs(mx) > 8 || Math.abs(my) > 8)) {
      horizontal = Math.abs(mx) > Math.abs(my) && mx < 0;
      if (horizontal) {
        row.classList.add('dragging');
        row.closest('.set-wrap').classList.add('swiping');
        if (document.activeElement) document.activeElement.blur();
      } else {
        tracking = false;
      }
    }
    if (horizontal) {
      dx = Math.min(0, mx);
      row.style.transform = `translateX(${dx}px)`;
    }
  });

  const end = () => {
    if (!row) return;
    const r = row;
    row = null;
    if (!horizontal) { tracking = false; return; }
    tracking = false;
    r.classList.remove('dragging');
    if (dx < -THRESHOLD) {
      const wrap = r.closest('.set-wrap');
      const card = r.closest('.ex-card');
      r.style.transform = 'translateX(-100%)';
      haptic(20);
      const h = wrap.offsetHeight;
      wrap.animate([{ height: `${h}px`, marginBottom: '6px' }, { height: '0px', marginBottom: '0px' }],
        { duration: 220, delay: 120, easing: 'ease-out', fill: 'forwards' })
        .finished.then(() => removeSet(Number(card.dataset.ex), Number(wrap.dataset.set)));
    } else {
      r.style.transform = '';
      // Lo sfondo rosso sparisce quando la riga è tornata al suo posto
      setTimeout(() => r.closest('.set-wrap')?.classList.remove('swiping'), 280);
    }
  };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);

  // Evita che un trascinamento orizzontale venga interpretato come tocco
  root.addEventListener('click', (e) => {
    if (horizontal && Math.abs(dx) > 8) { e.stopPropagation(); e.preventDefault(); horizontal = null; }
  }, true);
}

/* --- Menu dell'esercizio (sposta / rimuovi) ----------------------------- */

function openExerciseMenu(exIndex) {
  const entries = state.current.exercises;
  const entry = entries[exIndex];
  const s = openSheet({
    title: exerciseName(entry),
    html: `
      <div class="list">
        <button class="list-row" data-m="up" ${exIndex === 0 ? 'disabled style="opacity:.4"' : ''}>
          <span class="row-icon">${icon('arrow-up')}</span><span class="row-main"><span class="row-title">Sposta su</span></span>
        </button>
        <button class="list-row" data-m="down" ${exIndex === entries.length - 1 ? 'disabled style="opacity:.4"' : ''}>
          <span class="row-icon">${icon('arrow-down')}</span><span class="row-main"><span class="row-title">Sposta giù</span></span>
        </button>
        <button class="list-row" data-m="remove">
          <span class="row-icon danger">${icon('trash-2')}</span><span class="row-main"><span class="row-title" style="color:var(--danger)">Rimuovi dall'allenamento</span></span>
        </button>
      </div>
      <p class="footnote">Le modifiche valgono solo per questo allenamento. Per cambiare la scheda usa "Modifica" nella sezione Allenamenti.</p>`,
  });

  s.body.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    if (m === 'up' || m === 'down') {
      const to = m === 'up' ? exIndex - 1 : exIndex + 1;
      [entries[exIndex], entries[to]] = [entries[to], entries[exIndex]];
    } else if (m === 'remove') {
      entries.splice(exIndex, 1);
    }
    renderExercises();
    saveNow();
    s.close();
  });
}

async function deleteCurrentWorkout() {
  const active = isActive(state.current);
  const ok = await confirmSheet({
    title: active ? 'Annullare l\'allenamento?' : 'Eliminare l\'allenamento?',
    message: 'L\'allenamento e tutte le sue serie verranno eliminati definitivamente.',
    confirmLabel: active ? 'Annulla allenamento' : 'Elimina allenamento',
    danger: true,
  });
  if (!ok) return;
  const id = state.current.id;
  clearTimeout(saveTimer);
  await db.del('workouts', id);
  state.workouts = state.workouts.filter((w) => w.id !== id);
  hideEditor();
  toast(active ? 'Allenamento annullato' : 'Allenamento eliminato');
}

/* ==========================================================================
   Scelta dell'esercizio e libreria
   ========================================================================== */

function libraryRows(query, { forPicker }) {
  const q = query.trim().toLowerCase();
  const list = state.exercises.filter((e) => e.name.toLowerCase().includes(q));
  const exact = state.exercises.some((e) => e.name.toLowerCase() === q);
  let html = '';

  if (q && !exact) {
    html += `
      <button class="list-row" data-create="${esc(query.trim())}">
        <span class="row-icon accent">${icon('plus')}</span>
        <span class="row-main"><span class="row-title">Crea «${esc(query.trim())}»</span>
        <span class="row-sub">Nuovo esercizio nella libreria</span></span>
      </button>`;
  }

  for (const ex of list) {
    const last = lastPerformance(ex.id, null);
    const sub = last ? `Ultima volta ${formatShortDate(last.date)}` : 'Mai eseguito';
    html += `
      <button class="list-row" data-ex-id="${ex.id}">
        <span class="row-icon">${icon('dumbbell')}</span>
        <span class="row-main"><span class="row-title">${esc(ex.name)}</span><span class="row-sub">${sub}</span></span>
        <span class="row-trail">${icon(forPicker ? 'plus' : 'chevron-right')}</span>
      </button>`;
  }

  if (!html) {
    return emptyState({
      iconName: 'library-big', compact: true,
      title: 'Libreria vuota',
      text: 'Scrivi il nome di un esercizio qui sopra per crearlo.',
    });
  }
  return `<div class="list">${html}</div>`;
}

function searchBox(placeholder) {
  return `
    <div class="search">${icon('search')}
      <input class="input" type="search" placeholder="${placeholder}" autocomplete="off"
             autocorrect="off" autocapitalize="sentences" enterkeyhint="search" data-search>
    </div>`;
}

async function createExercise(name) {
  const clean = name.trim().replace(/\s+/g, ' ');
  const existing = state.exercises.find((e) => e.name.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  const ex = { id: db.uid(), name: clean, createdAt: Date.now() };
  await db.put('exercises', ex);
  state.exercises.push(ex);
  state.exercises.sort((a, b) => a.name.localeCompare(b.name, 'it'));
  return ex;
}

/**
 * Foglio di scelta di un esercizio dalla libreria (con ricerca e creazione).
 * Restituisce una Promise con l'esercizio scelto, oppure null se si chiude.
 */
export function pickExercise({ title = 'Aggiungi esercizio' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const s = openSheet({
      title,
      tall: true,
      html: `${searchBox('Cerca o crea un esercizio')}<div data-results>${libraryRows('', { forPicker: true })}</div>`,
      onClose: () => resolve(chosen),
    });
    const input = $('[data-search]', s.body);
    const results = $('[data-results]', s.body);
    input.addEventListener('input', () => {
      results.innerHTML = libraryRows(input.value, { forPicker: true });
    });
    results.addEventListener('click', async (e) => {
      const createBtn = e.target.closest('[data-create]');
      const exBtn = e.target.closest('[data-ex-id]');
      if (createBtn) chosen = await createExercise(createBtn.dataset.create);
      else if (exBtn) chosen = state.exercises.find((x) => x.id === exBtn.dataset.exId) || null;
      if (chosen) s.close();
    });
  });
}

/** Aggiunge un esercizio all'allenamento aperto. */
async function openExercisePicker() {
  if (!state.current) return;
  const ex = await pickExercise();
  if (ex && state.current) addExerciseToWorkout(ex);
}

/** Esercizio fuori scheda: serie precompilate con i valori dell'ultima volta. */
function addExerciseToWorkout(ex) {
  const last = lastPerformance(ex.id, state.current);
  const sets = last
    ? last.sets.map((s) => ({ weight: s.weight, reps: s.reps, done: false }))
    : [{ weight: null, reps: null, done: false }];
  state.current.exercises.push({ exerciseId: ex.id, name: ex.name, sets });
  const i = state.current.exercises.length - 1;
  renderExercises(i);
  saveNow();
  haptic();
  // Porta in vista la nuova card
  setTimeout(() => {
    $(`.ex-card[data-ex="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 60);
}

/** Libreria esercizi (dal pulsante in alto nella scheda Allenamenti). */
function openLibrary() {
  const s = openSheet({
    title: 'Libreria esercizi',
    tall: true,
    html: `${searchBox('Cerca o crea un esercizio')}<div data-results>${libraryRows('', { forPicker: false })}</div>
           <p class="footnote">Tocca un esercizio per rinominarlo o eliminarlo. Eliminarlo dalla libreria non cancella lo storico.</p>`,
  });
  const input = $('[data-search]', s.body);
  const results = $('[data-results]', s.body);
  const refresh = () => { results.innerHTML = libraryRows(input.value, { forPicker: false }); };
  input.addEventListener('input', refresh);

  results.addEventListener('click', async (e) => {
    const createBtn = e.target.closest('[data-create]');
    const exBtn = e.target.closest('[data-ex-id]');
    if (createBtn) {
      await createExercise(createBtn.dataset.create);
      input.value = '';
      refresh();
      toast('Esercizio creato');
    } else if (exBtn) {
      const ex = state.exercises.find((x) => x.id === exBtn.dataset.exId);
      if (ex) editExercise(ex, refresh);
    }
  });
}

/** Foglio per rinominare o eliminare un esercizio della libreria. */
function editExercise(ex, onDone) {
  const s = openSheet({
    title: 'Modifica esercizio',
    html: `
      <label class="field">
        <span class="field-label">Nome</span>
        <input class="input" data-name value="${esc(ex.name)}" maxlength="60" autocomplete="off" enterkeyhint="done">
      </label>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>Salva</button>
        <button class="btn btn-danger btn-block" data-delete>${icon('trash-2')} Elimina dalla libreria</button>
      </div>`,
  });

  $('[data-save]', s.body).addEventListener('click', async () => {
    const name = $('[data-name]', s.body).value.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Il nome non può essere vuoto', { error: true });
    const dup = state.exercises.find((e) => e.id !== ex.id && e.name.toLowerCase() === name.toLowerCase());
    if (dup) return toast('Esiste già un esercizio con questo nome', { error: true });

    ex.name = name;
    await db.put('exercises', ex);
    // Aggiorna il nome anche negli allenamenti già registrati e nelle schede
    const touched = [];
    for (const w of state.workouts) {
      let changed = false;
      for (const entry of w.exercises || []) {
        if (entry.exerciseId === ex.id) { entry.name = name; changed = true; }
      }
      if (changed) touched.push(w);
    }
    if (touched.length) await db.putMany('workouts', touched);
    await renameExerciseInTemplates(ex.id, name);
    state.exercises.sort((a, b) => a.name.localeCompare(b.name, 'it'));
    s.close();
    onDone();
    renderList();
    toast('Esercizio aggiornato');
  });

  $('[data-delete]', s.body).addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({
      title: `Eliminare «${ex.name}»?`,
      message: 'L\'esercizio sparirà dalla libreria. Gli allenamenti già registrati e le schede restano invariati.',
      confirmLabel: 'Elimina',
      danger: true,
    });
    if (!ok) return;
    await db.del('exercises', ex.id);
    state.exercises = state.exercises.filter((e) => e.id !== ex.id);
    onDone();
    toast('Esercizio eliminato');
  });
}
