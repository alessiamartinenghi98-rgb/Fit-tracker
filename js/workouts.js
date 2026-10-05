/* ==========================================================================
   workouts.js — Sezione Allenamenti
   --------------------------------------------------------------------------
   - Storico degli allenamenti (raggruppato per mese)
   - Editor a schermo intero: esercizi, serie (peso × ripetizioni), stepper +/-
   - Libreria esercizi con ricerca, creazione, rinomina ed eliminazione
   - "Ultima volta": valori della sessione precedente come riferimento
   Ogni modifica nell'editor viene salvata automaticamente.
   ========================================================================== */

import * as db from './db.js';
import {
  $, $$, esc, icon, toast, haptic, openSheet, confirmSheet, emptyState,
  todayISO, formatDay, formatFullDate, formatShortDate, formatMonth,
  fmtNum, fmtInt, parseNum,
} from './ui.js';

/* Esercizi proposti al primo avvio (si possono rinominare o eliminare) */
const DEFAULT_EXERCISES = [
  'Panca piana', 'Squat', 'Stacco da terra', 'Military press', 'Trazioni',
  'Rematore con bilanciere', 'Lat machine', 'Leg press', 'Affondi', 'Hip thrust',
  'Curl con bilanciere', 'French press', 'Alzate laterali', 'Dip',
];

const WEIGHT_STEP = 2.5; // kg per ogni tocco su +/-
const REPS_STEP = 1;

const state = {
  workouts: [],   // tutti gli allenamenti, dal più recente
  exercises: [],  // libreria, in ordine alfabetico
  current: null,  // allenamento aperto nell'editor
};

/* ==========================================================================
   Calcoli condivisi (usati anche dalla sezione Progressi)
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
    volume: entries.reduce((v, e) => v + entryVolume(e), 0),
  };
}

/** Ordina dal più recente: prima per data, poi per ora di creazione. */
export function byNewest(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return (b.createdAt || 0) - (a.createdAt || 0);
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
 * Trova l'ultima esecuzione di un esercizio prima dell'allenamento corrente.
 * Restituisce { date, sets } oppure null.
 */
function lastPerformance(exerciseId, current) {
  for (const w of state.workouts) {
    if (current && w.id === current.id) continue;
    if (current && w.date > current.date) continue; // solo sessioni precedenti
    const entry = (w.exercises || []).find((e) => e.exerciseId === exerciseId);
    if (entry) {
      const sets = completedSets(entry);
      if (sets.length) return { date: w.date, sets };
    }
  }
  return null;
}

/* ==========================================================================
   Storico (scheda principale)
   ========================================================================== */

export async function initWorkouts() {
  await seedExercises();
  await load();
  renderList();
  $('#btn-library').addEventListener('click', openLibrary);

  // Delega degli eventi sulla lista: un solo listener per tutte le card
  $('#workouts-content').addEventListener('click', (e) => {
    if (e.target.closest('[data-action="start"]')) return startWorkout();
    const card = e.target.closest('[data-workout]');
    if (card) {
      const w = state.workouts.find((x) => x.id === card.dataset.workout);
      if (w) openEditor(structuredClone(w));
    }
  });
}

/** Ricarica i dati (es. dopo un'importazione) e ridisegna. */
export async function refreshWorkouts() {
  await load();
  renderList();
}

function renderList() {
  const root = $('#workouts-content');

  if (state.workouts.length === 0) {
    root.innerHTML = emptyState({
      iconName: 'dumbbell',
      title: 'Nessun allenamento ancora',
      text: 'Registra la tua prima sessione: esercizi, serie, ripetizioni e peso. Il resto lo calcolo io.',
      action: `<button class="btn btn-primary" data-action="start">${icon('plus')} Inizia allenamento</button>`,
    });
    return;
  }

  let html = `
    <button class="btn btn-primary btn-block hero-cta" data-action="start">
      ${icon('plus')} Inizia allenamento
    </button>`;

  // Raggruppa per mese
  let currentMonth = '';
  let group = '';
  const flush = () => { if (group) html += `<div class="fade-list">${group}</div>`; group = ''; };

  for (const w of state.workouts) {
    const month = w.date.slice(0, 7);
    if (month !== currentMonth) {
      flush();
      currentMonth = month;
      html += `<div class="month-label">${formatMonth(w.date)}</div>`;
    }
    group += workoutCard(w);
  }
  flush();
  root.innerHTML = html;
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
        <div class="wc-title">${esc(w.name || 'Allenamento')}</div>
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

/* ==========================================================================
   Editor allenamento
   ========================================================================== */

async function startWorkout() {
  haptic();
  const now = Date.now();
  const w = { id: db.uid(), date: todayISO(), name: '', exercises: [], createdAt: now, updatedAt: now };
  await db.put('workouts', w);
  state.workouts.unshift(w);
  state.workouts.sort(byNewest);
  openEditor(structuredClone(w), { isNew: true });
}

function openEditor(workout, { isNew = false } = {}) {
  state.current = workout;
  const ed = $('#workout-editor');

  ed.innerHTML = `
    <header class="topbar scrolled">
      <button class="back-btn" data-action="close">${icon('chevron-left')}<span>Storico</span></button>
      <span class="topbar-title" id="ed-topbar-title"></span>
      <div class="topbar-actions">
        <button class="icon-btn" data-action="delete-workout" aria-label="Elimina allenamento">${icon('trash-2')}</button>
        <button class="btn btn-ghost" data-action="close" style="font-weight:600">Fine</button>
      </div>
    </header>

    <input class="title-input" id="ed-name" placeholder="Allenamento" maxlength="60"
           value="${esc(workout.name)}" autocomplete="off" enterkeyhint="done">

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
    <p class="hint" id="ed-hint">Tocca ${'✓'} per salvare una serie · scorri a sinistra per eliminarla</p>
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

  // Nuovo allenamento: proponi subito di scegliere il primo esercizio
  if (isNew) setTimeout(openExercisePicker, 380);
}

function renderDate() {
  const w = state.current;
  $('#ed-date-label').textContent = formatDay(w.date);
  $('#ed-topbar-title').textContent = formatShortDate(w.date);
}

function updateSummary() {
  const st = workoutStats(state.current);
  const parts = [`${st.exercises} ${st.exercises === 1 ? 'esercizio' : 'esercizi'}`, `${st.sets} serie`];
  if (st.volume > 0) parts.push(`${fmtInt(st.volume)} kg`);
  $('#ed-summary').textContent = parts.join(' · ');
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
  const last = lastPerformance(entry.exerciseId, state.current);
  let ref;
  if (last) {
    const sets = last.sets.slice(0, 4).map((s) => `${fmtNum(s.weight || 0)}×${s.reps}`).join(' · ');
    const more = last.sets.length > 4 ? ' …' : '';
    ref = `${icon('history')}<span>${esc(formatShortDate(last.date))} · <b class="num">${sets}${more}</b></span>`;
  } else {
    ref = `${icon('sparkles')}<span>Prima volta: nessun riferimento</span>`;
  }

  return `
    <div class="card ex-card" data-ex="${i}" ${isNew ? '' : 'style="animation:none"'}>
      <div class="ex-head">
        <div style="min-width:0">
          <div class="ex-name">${esc(exerciseName(entry))}</div>
          <div class="ex-ref">${ref}</div>
        </div>
        <button class="ex-menu" data-action="ex-menu" aria-label="Opzioni esercizio">${icon('ellipsis')}</button>
      </div>
      <div class="sets-head"><span>Serie</span><span>Kg</span><span>Rep</span><span></span></div>
      <div class="sets">${entry.sets.map((s, j) => setRow(s, j)).join('')}</div>
      <button class="add-set" data-action="add-set">${icon('plus')} Aggiungi serie</button>
    </div>`;
}

function setRow(s, j) {
  return `
    <div class="set-wrap" data-set="${j}">
      <div class="set-delete">${icon('trash-2')} Elimina</div>
      <div class="set-row ${s.done ? 'done' : ''}">
        <div class="set-num num">${j + 1}</div>
        ${stepper('weight', s.weight, 'decimal')}
        ${stepper('reps', s.reps, 'numeric')}
        <button class="set-check" data-action="toggle-set" aria-label="Completa serie">${icon('check')}</button>
      </div>
    </div>`;
}

function stepper(field, value, mode) {
  const label = field === 'weight' ? 'peso' : 'ripetizioni';
  return `
    <div class="stepper" data-field="${field}">
      <button data-step="-1" aria-label="Diminuisci ${label}">${icon('minus')}</button>
      <input type="text" inputmode="${mode}" value="${fmtNum(value)}" placeholder="–"
             autocomplete="off" aria-label="${label}">
      <button data-step="1" aria-label="Aumenta ${label}">${icon('plus')}</button>
    </div>`;
}

/* --- Salvataggio automatico ---------------------------------------------- */

let saveTimer = null;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 350);
  updateSummary();
}

async function saveNow() {
  clearTimeout(saveTimer);
  const w = state.current;
  if (!w) return;
  w.updatedAt = Date.now();
  await db.put('workouts', structuredClone(w));

  // Aggiorna la copia nella lista
  const idx = state.workouts.findIndex((x) => x.id === w.id);
  if (idx >= 0) state.workouts[idx] = structuredClone(w);
  else state.workouts.push(structuredClone(w));
  state.workouts.sort(byNewest);

  const ind = $('#ed-save');
  if (ind) {
    ind.style.opacity = '1';
    clearTimeout(ind._t);
    ind._t = setTimeout(() => { ind.style.opacity = '0'; }, 1200);
  }
}

async function closeEditor() {
  const ed = $('#workout-editor');
  if (document.activeElement) document.activeElement.blur();
  await saveNow();

  // Un allenamento senza esercizi non viene conservato
  const w = state.current;
  if (w && w.exercises.length === 0) {
    await db.del('workouts', w.id);
    state.workouts = state.workouts.filter((x) => x.id !== w.id);
  }
  state.current = null;

  ed.classList.add('closing');
  ed.classList.remove('open');
  ed.setAttribute('aria-hidden', 'true');
  $('#tabbar').classList.remove('hidden');
  setTimeout(() => { ed.classList.remove('closing'); ed.innerHTML = ''; }, 400);
  renderList();
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
      const setIndex = Number(wrap.dataset.set);
      const s = state.current.exercises[exIndex].sets[setIndex];
      const step = (field === 'weight' ? WEIGHT_STEP : REPS_STEP) * Number(stepBtn.dataset.step);
      const next = Math.max(0, Math.round(((s[field] || 0) + step) * 100) / 100);
      s[field] = next;
      $(`.stepper[data-field="${field}"] input`, wrap).value = fmtNum(next);
      haptic(5);
      scheduleSave();
      return;
    }

    switch (action) {
      case 'close': return closeEditor();
      case 'add-exercise': return openExercisePicker();
      case 'delete-workout': return deleteCurrentWorkout();
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

  // Uscendo dal campo, il valore viene riscritto in formato pulito (es. "62.50" → "62,5")
  ed.addEventListener('focusout', (e) => {
    const stepperEl = e.target.closest('.stepper');
    if (!stepperEl) return;
    const card = e.target.closest('.ex-card');
    const wrap = e.target.closest('.set-wrap');
    if (!card || !wrap) return;
    const s = state.current?.exercises[Number(card.dataset.ex)]?.sets[Number(wrap.dataset.set)];
    if (s) e.target.value = fmtNum(s[stepperEl.dataset.field]);
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
      scheduleSave();
    }
  });

  bindSwipeToDelete(ed);
}

function addSet(exIndex) {
  const entry = state.current.exercises[exIndex];
  const prev = entry.sets[entry.sets.length - 1];
  // La nuova serie riprende peso e ripetizioni della precedente
  entry.sets.push({ weight: prev ? prev.weight : null, reps: prev ? prev.reps : null, done: false });
  haptic(5);
  const card = $(`.ex-card[data-ex="${exIndex}"]`);
  $('.sets', card).insertAdjacentHTML('beforeend', setRow(entry.sets[entry.sets.length - 1], entry.sets.length - 1));
  const added = $('.sets', card).lastElementChild;
  added.animate(
    [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }],
    { duration: 240, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
  );
  scheduleSave();
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
  }
  scheduleSave();
}

function removeSet(exIndex, setIndex) {
  const entry = state.current.exercises[exIndex];
  entry.sets.splice(setIndex, 1);
  rerenderCard(exIndex);
  scheduleSave();
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
      </div>`,
  });

  s.body.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    if (m === 'up' || m === 'down') {
      const to = m === 'up' ? exIndex - 1 : exIndex + 1;
      [entries[exIndex], entries[to]] = [entries[to], entries[exIndex]];
      renderExercises();
      scheduleSave();
    } else if (m === 'remove') {
      entries.splice(exIndex, 1);
      renderExercises();
      scheduleSave();
    }
    s.close();
  });
}

async function deleteCurrentWorkout() {
  const ok = await confirmSheet({
    title: 'Eliminare l\'allenamento?',
    message: 'L\'allenamento e tutte le sue serie verranno eliminati definitivamente.',
    confirmLabel: 'Elimina allenamento',
    danger: true,
  });
  if (!ok) return;
  const id = state.current.id;
  clearTimeout(saveTimer);
  await db.del('workouts', id);
  state.workouts = state.workouts.filter((w) => w.id !== id);
  state.current.exercises = []; // così closeEditor non lo risalva
  state.current = null;
  const ed = $('#workout-editor');
  ed.classList.add('closing');
  ed.classList.remove('open');
  $('#tabbar').classList.remove('hidden');
  setTimeout(() => { ed.classList.remove('closing'); ed.innerHTML = ''; }, 400);
  renderList();
  toast('Allenamento eliminato');
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

/** Foglio per scegliere l'esercizio da aggiungere all'allenamento aperto. */
function openExercisePicker() {
  if (!state.current) return;
  const s = openSheet({
    title: 'Aggiungi esercizio',
    tall: true,
    html: `${searchBox('Cerca o crea un esercizio')}<div data-results>${libraryRows('', { forPicker: true })}</div>`,
  });
  const input = $('[data-search]', s.body);
  const results = $('[data-results]', s.body);
  input.addEventListener('input', () => {
    results.innerHTML = libraryRows(input.value, { forPicker: true });
  });

  results.addEventListener('click', async (e) => {
    const createBtn = e.target.closest('[data-create]');
    const exBtn = e.target.closest('[data-ex-id]');
    let ex = null;
    if (createBtn) ex = await createExercise(createBtn.dataset.create);
    else if (exBtn) ex = state.exercises.find((x) => x.id === exBtn.dataset.exId);
    if (!ex) return;
    s.close();
    addExerciseToWorkout(ex);
  });
}

/** Aggiunge l'esercizio, precompilando le serie con i valori dell'ultima volta. */
function addExerciseToWorkout(ex) {
  const last = lastPerformance(ex.id, state.current);
  const sets = last
    ? last.sets.map((s) => ({ weight: s.weight, reps: s.reps, done: false }))
    : [{ weight: null, reps: null, done: false }];
  state.current.exercises.push({ exerciseId: ex.id, name: ex.name, sets });
  const i = state.current.exercises.length - 1;
  renderExercises(i);
  scheduleSave();
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
    // Aggiorna il nome anche negli allenamenti già registrati
    const touched = [];
    for (const w of state.workouts) {
      let changed = false;
      for (const entry of w.exercises || []) {
        if (entry.exerciseId === ex.id) { entry.name = name; changed = true; }
      }
      if (changed) touched.push(w);
    }
    if (touched.length) await db.putMany('workouts', touched);
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
      message: 'L\'esercizio sparirà dalla libreria. Gli allenamenti già registrati restano invariati.',
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
