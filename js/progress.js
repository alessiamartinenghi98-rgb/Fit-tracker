/* ==========================================================================
   progress.js — Sezione Progressi
   --------------------------------------------------------------------------
   - Allenamenti per settimana e per mese (indicatori + grafico a barre)
   - Progressi per esercizio: peso massimo e volume nel tempo (grafico a linee)
   - Backup: esportazione e importazione JSON, stato dell'archiviazione
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, toast, openSheet, confirmSheet, emptyState, initSeg,
  todayISO, addDays, startOfWeek, parseISO, formatShortDate, fmtInt, fmtNum,
} from './ui.js';
import { completedSets, entryVolume, byNewest } from './workouts.js';
import { hasTreadmill } from './treadmill.js';

/* Colori dei grafici, allineati ai token del CSS */
const C = {
  accent: '#c6f432',
  accentFill: 'rgba(198, 244, 50, 0.22)',
  bar: '#3a3a40',
  surface: '#141416',
  grid: 'rgba(255, 255, 255, 0.06)',
  text2: '#a1a1a8',
  text: '#f5f5f7',
  tooltip: '#2a2a2e',
};

const state = {
  workouts: [],
  exercises: [],
  freqMode: 'weeks',     // 'weeks' | 'months'
  metric: 'max',         // 'max' | 'reps' | 'volume'
  exerciseId: null,      // esercizio selezionato nel grafico
  charts: {},            // istanze Chart.js (da distruggere prima di ridisegnare)
  onImported: null,      // callback dopo un'importazione
};

/* --- Inizializzazione ---------------------------------------------------- */

export function initProgress({ onImported }) {
  state.onImported = onImported;
  const root = $('#progress-content');

  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'export') exportBackup();
    if (a === 'import') $('#import-file').click();
    if (a === 'pick-exercise') pickExercise();
  });

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // permette di reimportare lo stesso file
    if (file) importBackup(file);
  });

  applyChartDefaults();
}

/** Stile globale di Chart.js coerente con l'app. */
function applyChartDefaults() {
  if (!window.Chart) return;
  const d = window.Chart.defaults;
  d.color = C.text2;
  d.font.family = getComputedStyle(document.body).fontFamily;
  d.font.size = 12;
  d.borderColor = C.grid;
  d.animation.duration = 500;
  d.plugins.legend.display = false;
  Object.assign(d.plugins.tooltip, {
    backgroundColor: C.tooltip,
    titleColor: C.text2,
    bodyColor: C.text,
    titleFont: { weight: '500', size: 12 },
    bodyFont: { weight: '600', size: 15 },
    padding: 10,
    cornerRadius: 10,
    displayColors: false,
    caretSize: 0,
  });
}

/* --- Dati ---------------------------------------------------------------- */

async function load() {
  const [workouts, exercises] = await Promise.all([db.getAll('workouts'), db.getAll('exercises')]);
  // Contano solo gli allenamenti con i pesi terminati (cardio e allenamenti liberi esclusi)
  state.workouts = workouts
    .filter((w) => w.status !== 'active' && w.kind !== 'cardio' && w.kind !== 'activity' && (w.exercises || []).length > 0)
    .sort(byNewest);
  state.exercises = exercises;
  // Tapis roulant: da tutti gli allenamenti terminati (schede, libero, cardio)
  state.treadmills = workouts.filter((w) => w.status !== 'active' && hasTreadmill(w));
}

/** Minuti di tapis roulant tra due date (incluse). */
function treadmillMinutesBetween(from, to) {
  return (state.treadmills || [])
    .filter((w) => w.date >= from && w.date <= to)
    .reduce((sum, w) => sum + (w.treadmill.minutes || 0), 0);
}

function treadmillSection() {
  const today = todayISO();
  const week = treadmillMinutesBetween(startOfWeek(today), today);
  const month = treadmillMinutesBetween(monthStart(today), today);
  const sessions = (state.treadmills || []).filter((w) => w.date >= monthStart(today)).length;
  return `
    <div class="section-label"><span style="display:flex;align-items:center;gap:8px"><i class="tm-dot big"></i>Tapis roulant</span></div>
    <div class="kpi-grid">
      <div class="card kpi">
        <div class="kpi-label">Questa settimana</div>
        <div class="kpi-value num">${week}<span class="kpi-unit">min</span></div>
      </div>
      <div class="card kpi">
        <div class="kpi-label">Questo mese</div>
        <div class="kpi-value num">${month}<span class="kpi-unit">min</span></div>
        <div class="kpi-delta">${sessions} ${sessions === 1 ? 'sessione' : 'sessioni'}</div>
      </div>
    </div>`;
}

/** Numero di allenamenti tra due date (incluse). */
function countBetween(from, to) {
  return state.workouts.filter((w) => w.date >= from && w.date <= to).length;
}

function monthStart(iso) {
  return iso.slice(0, 8) + '01';
}

function prevMonthStart(iso) {
  const d = parseISO(monthStart(iso));
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Esercizi con almeno una serie completata, dal più usato di recente. */
function exercisesWithData() {
  const map = new Map();
  for (const w of state.workouts) {
    for (const e of w.exercises) {
      if (!completedSets(e).length) continue;
      if (!map.has(e.exerciseId)) {
        const lib = state.exercises.find((x) => x.id === e.exerciseId);
        map.set(e.exerciseId, { id: e.exerciseId, name: lib ? lib.name : e.name, sessions: 0, last: w.date });
      }
      map.get(e.exerciseId).sessions++;
    }
  }
  return [...map.values()];
}

/** Serie storica di un esercizio: una voce per allenamento, dal più vecchio. */
function exerciseSeries(exerciseId) {
  const points = [];
  for (const w of [...state.workouts].reverse()) {
    for (const e of w.exercises) {
      if (e.exerciseId !== exerciseId) continue;
      const sets = completedSets(e);
      if (!sets.length) continue;
      // Serie più pesante della sessione (a parità di peso, quella con più ripetizioni)
      const top = sets.reduce((best, s) => (
        (s.weight || 0) > (best.weight || 0) || ((s.weight || 0) === (best.weight || 0) && s.reps > best.reps) ? s : best
      ));
      points.push({
        date: w.date,
        max: top.weight || 0,
        reps: top.reps,
        volume: entryVolume(e),
        sets: sets.length,
      });
    }
  }
  return points;
}

/* --- Rendering ----------------------------------------------------------- */

export async function renderProgress() {
  await load();
  destroyCharts();
  const root = $('#progress-content');

  let html = '';
  if (state.workouts.length === 0) {
    html += `<div class="card">${emptyState({
      iconName: 'chart-line',
      title: 'Ancora nessun dato',
      text: 'Completa il primo allenamento: qui vedrai frequenza, record e andamento di ogni esercizio.',
      compact: true,
    })}</div>`;
  } else {
    html += activitySection() + exerciseSection();
  }
  html += treadmillSection();
  html += await backupSection();
  root.innerHTML = html;

  if (state.workouts.length) {
    initSeg($('#seg-freq'), (v) => { state.freqMode = v; drawFrequency(); });
    initSeg($('#seg-metric'), (v) => { state.metric = v; drawExercise(); });
    drawFrequency();
    drawExercise();
  }
}

function activitySection() {
  const today = todayISO();
  const wk = startOfWeek(today);
  const thisWeek = countBetween(wk, today);
  const lastWeek = countBetween(addDays(wk, -7), addDays(wk, -1));
  const ms = monthStart(today);
  const thisMonth = countBetween(ms, today);
  const lastMonth = countBetween(prevMonthStart(today), addDays(ms, -1));

  const delta = (now, before, label) => {
    const d = now - before;
    if (d > 0) return `<div class="kpi-delta up">${icon('trending-up')}+${d} rispetto ${label}</div>`;
    if (d < 0) return `<div class="kpi-delta">${icon('trending-down')}${d} rispetto ${label}</div>`;
    return `<div class="kpi-delta">${icon('minus')}uguale ${label}</div>`;
  };

  return `
    <div class="section-label">Attività</div>
    <div class="kpi-grid">
      <div class="card kpi">
        <div class="kpi-label">Questa settimana</div>
        <div class="kpi-value num">${thisWeek}</div>
        ${delta(thisWeek, lastWeek, 'alla scorsa')}
      </div>
      <div class="card kpi">
        <div class="kpi-label">Questo mese</div>
        <div class="kpi-value num">${thisMonth}</div>
        ${delta(thisMonth, lastMonth, 'al mese scorso')}
      </div>
    </div>
    <div class="card chart-card" style="margin-top:var(--s-3)">
      <div class="chart-head">
        <div class="chart-title">Allenamenti</div>
        <div class="seg" id="seg-freq" style="width:180px">
          <button data-value="weeks" class="${state.freqMode === 'weeks' ? 'active' : ''}">Settimane</button>
          <button data-value="months" class="${state.freqMode === 'months' ? 'active' : ''}">Mesi</button>
        </div>
      </div>
      <div class="chart-box"><canvas id="chart-freq" aria-label="Grafico degli allenamenti per periodo" role="img"></canvas></div>
    </div>`;
}

function exerciseSection() {
  const list = exercisesWithData();
  if (!list.length) {
    return `
      <div class="section-label">Esercizi</div>
      <div class="card">${emptyState({
        iconName: 'trending-up', compact: true,
        title: 'Nessuna serie completata',
        text: 'Segna le serie con la spunta durante l\'allenamento per vedere i tuoi progressi.',
      })}</div>`;
  }
  // Se non è stato scelto nulla, parte dall'ultimo esercizio eseguito
  if (!list.some((x) => x.id === state.exerciseId)) {
    state.exerciseId = [...list].sort((a, b) => (a.last < b.last ? 1 : -1))[0].id;
  }
  const current = list.find((x) => x.id === state.exerciseId);

  return `
    <div class="section-label">Esercizi</div>
    <div class="card chart-card">
      <button class="exercise-select" data-action="pick-exercise">
        <span>${esc(current.name)}</span>${icon('chevron-down')}
      </button>
      <div class="seg" id="seg-metric" style="margin-bottom:var(--s-4)">
        <button data-value="max" class="${state.metric === 'max' ? 'active' : ''}">Peso</button>
        <button data-value="reps" class="${state.metric === 'reps' ? 'active' : ''}">Ripetizioni</button>
        <button data-value="volume" class="${state.metric === 'volume' ? 'active' : ''}">Volume</button>
      </div>
      <div class="chart-box" id="ex-chart-box"><canvas id="chart-ex" aria-label="Grafico dei progressi dell'esercizio" role="img"></canvas></div>
      <div class="ex-stats" id="ex-stats"></div>
    </div>
    <p class="footnote">Peso e ripetizioni si riferiscono alla serie più pesante di ogni allenamento. Volume = serie × ripetizioni × peso. Contano solo le serie completate.</p>`;
}

async function backupSection() {
  const persisted = await db.isPersisted();
  const last = await db.getMeta('lastBackup');
  return `
    <div class="section-label">Backup dei dati</div>
    <div class="list">
      <button class="list-row" data-action="export">
        <span class="row-icon accent">${icon('download')}</span>
        <span class="row-main"><span class="row-title">Esporta backup</span>
        <span class="row-sub">Salva un file JSON con tutti i dati</span></span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>
      <button class="list-row" data-action="import">
        <span class="row-icon">${icon('upload')}</span>
        <span class="row-main"><span class="row-title">Importa backup</span>
        <span class="row-sub">Ripristina da un file JSON</span></span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>
      <div class="list-row">
        <span class="row-icon ${persisted ? 'accent' : ''}">${icon(persisted ? 'shield-check' : 'shield-alert')}</span>
        <span class="row-main"><span class="row-title">Archiviazione ${persisted ? 'persistente' : 'non garantita'}</span>
        <span class="row-sub">${persisted
          ? 'Il telefono non cancellerà i dati per liberare spazio'
          : 'Aggiungi l\'app alla Home e fai backup regolari'}</span></span>
      </div>
    </div>
    <p class="footnote">${last
      ? `Ultimo backup: ${esc(formatShortDate(last.slice(0, 10)))}.`
      : 'Non hai ancora fatto un backup.'} I dati restano solo su questo telefono: esporta un backup ogni tanto e conservalo su iCloud Drive o Google Drive.</p>`;
}

/* --- Grafici ------------------------------------------------------------- */

function destroyCharts() {
  Object.values(state.charts).forEach((c) => c.destroy());
  state.charts = {};
}

function chartsUnavailable(box) {
  box.innerHTML = `<div class="chart-empty">${icon('wifi-off')}Grafici non disponibili offline al primo avvio. Riapri l'app con la connessione attiva.</div>`;
}

/** Barre: allenamenti per settimana (ultime 12) o per mese (ultimi 12). */
function drawFrequency() {
  const canvas = $('#chart-freq');
  if (!canvas) return;
  if (!window.Chart) return chartsUnavailable(canvas.parentElement);
  state.charts.freq?.destroy();

  const today = todayISO();
  const labels = [];
  const titles = [];
  const values = [];

  if (state.freqMode === 'weeks') {
    let start = addDays(startOfWeek(today), -7 * 11);
    for (let i = 0; i < 12; i++) {
      const end = addDays(start, 6);
      labels.push(formatShortDate(start));
      titles.push(`Settimana dal ${formatShortDate(start)}`);
      values.push(countBetween(start, end));
      start = addDays(start, 7);
    }
  } else {
    const fmtM = new Intl.DateTimeFormat('it-IT', { month: 'short' });
    const fmtMY = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });
    const d = parseISO(monthStart(today));
    d.setMonth(d.getMonth() - 11);
    for (let i = 0; i < 12; i++) {
      const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
      const endD = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const to = `${endD.getFullYear()}-${String(endD.getMonth() + 1).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;
      labels.push(fmtM.format(d).replace('.', ''));
      const t = fmtMY.format(d);
      titles.push(t.charAt(0).toUpperCase() + t.slice(1));
      values.push(countBetween(from, to));
      d.setMonth(d.getMonth() + 1);
    }
  }

  // L'accento evidenzia solo il periodo corrente; gli altri restano neutri
  const colors = values.map((_, i) => (i === values.length - 1 ? C.accent : C.bar));

  state.charts.freq = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        hoverBackgroundColor: colors,
        borderRadius: 4,
        borderSkipped: 'start',
        maxBarThickness: 18,
        categoryPercentage: 0.7,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 6 },
        },
        y: {
          beginAtZero: true,
          grid: { color: C.grid },
          border: { display: false },
          ticks: { precision: 0, maxTicksLimit: 4 },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => titles[items[0].dataIndex],
            label: (item) => `${item.raw} ${item.raw === 1 ? 'allenamento' : 'allenamenti'}`,
          },
        },
      },
    },
  });
}

/** Linea: peso massimo o volume dell'esercizio selezionato nel tempo. */
function drawExercise() {
  const box = $('#ex-chart-box');
  if (!box) return;
  state.charts.ex?.destroy();
  delete state.charts.ex;

  const points = exerciseSeries(state.exerciseId);
  renderExerciseStats(points);

  if (!window.Chart) return chartsUnavailable(box);
  box.innerHTML = '<canvas id="chart-ex" role="img" aria-label="Grafico dei progressi dell\'esercizio"></canvas>';
  const canvas = $('#chart-ex');

  const key = state.metric;
  const values = points.map((p) => Math.round(p[key] * 100) / 100);
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 200);

  // Asse Y con un po' di margine sopra e sotto, ma mai sotto lo zero
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
  const yMin = Math.max(0, lo - pad);
  const yMax = hi + pad;
  gradient.addColorStop(0, C.accentFill);
  gradient.addColorStop(1, 'rgba(198, 244, 50, 0)');

  state.charts.ex = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: points.map((p) => formatShortDate(p.date)),
      datasets: [{
        data: values,
        borderColor: C.accent,
        borderWidth: 2,
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        cubicInterpolationMode: 'monotone', // curva morbida senza "picchi" inventati
        pointRadius: points.length > 24 ? 0 : 4,
        pointHoverRadius: 6,
        pointBackgroundColor: C.accent,
        pointBorderColor: C.surface,
        pointBorderWidth: 2,
        pointHitRadius: 16,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5 },
        },
        y: {
          suggestedMin: yMin,
          suggestedMax: yMax,
          grid: { color: C.grid },
          border: { display: false },
          ticks: { maxTicksLimit: 4, precision: key === 'reps' ? 0 : undefined, callback: (v) => (key === 'max' ? fmtNum(v) : fmtInt(v)) },
        },
      },
      plugins: {
        tooltip: {
          callbacks: {
            title: (items) => formatShortDate(points[items[0].dataIndex].date),
            label: (item) => {
              const p = points[item.dataIndex];
              if (key === 'max') return `${fmtNum(p.max)} kg × ${p.reps}`;
              if (key === 'reps') return `${p.reps} ripetizioni · ${fmtNum(p.max)} kg`;
              return `${fmtInt(p.volume)} kg · ${p.sets} serie`;
            },
          },
        },
      },
    },
  });
}

function renderExerciseStats(points) {
  const el = $('#ex-stats');
  if (!el) return;
  const best = points.length ? Math.max(...points.map((p) => p.max)) : 0;
  const bestVol = points.length ? Math.max(...points.map((p) => p.volume)) : 0;
  el.innerHTML = `
    <div class="stat-mini"><div class="v num">${fmtNum(best)}<small>kg</small></div><div class="l">Record</div></div>
    <div class="stat-mini"><div class="v num">${fmtInt(bestVol)}<small>kg</small></div><div class="l">Volume max</div></div>
    <div class="stat-mini"><div class="v num">${points.length}</div><div class="l">Sessioni</div></div>`;
}

function pickExercise() {
  const list = exercisesWithData().sort((a, b) => a.name.localeCompare(b.name, 'it'));
  const s = openSheet({
    title: 'Scegli esercizio',
    tall: list.length > 6,
    html: `<div class="list">${list.map((x) => `
      <button class="list-row" data-id="${x.id}">
        <span class="row-icon ${x.id === state.exerciseId ? 'accent' : ''}">${icon(x.id === state.exerciseId ? 'check' : 'dumbbell')}</span>
        <span class="row-main"><span class="row-title">${esc(x.name)}</span>
        <span class="row-sub">${x.sessions} ${x.sessions === 1 ? 'sessione' : 'sessioni'} · ultima ${esc(formatShortDate(x.last))}</span></span>
      </button>`).join('')}</div>`,
  });
  s.body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    state.exerciseId = row.dataset.id;
    s.close();
    const current = list.find((x) => x.id === state.exerciseId);
    $('[data-action="pick-exercise"] span').textContent = current.name;
    drawExercise();
  });
}

/* --- Backup -------------------------------------------------------------- */

async function exportBackup() {
  try {
    const data = await db.exportData();
    const json = JSON.stringify(data, null, 2);
    const filename = `fit-tracker-backup-${todayISO()}.json`;
    const file = new File([json], filename, { type: 'application/json' });

    // Su iPhone il foglio di condivisione permette "Salva su File" / iCloud Drive
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Backup Fit Tracker' });
      } catch (err) {
        if (err.name === 'AbortError') return; // condivisione annullata
        throw err;
      }
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
    await db.setMeta('lastBackup', new Date().toISOString());
    toast('Backup esportato');
    renderProgress();
  } catch (err) {
    console.error(err);
    toast('Esportazione non riuscita', { error: true });
  }
}

async function importBackup(file) {
  let backup;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    return toast('Il file non è un JSON valido', { error: true });
  }
  const d = backup?.data || {};
  const n = (arr) => (Array.isArray(arr) ? arr.length : 0);
  const when = backup?.exportedAt ? ` del ${formatShortDate(backup.exportedAt.slice(0, 10))}` : '';

  const ok = await confirmSheet({
    title: 'Ripristinare il backup?',
    message: `Il backup${when} contiene ${n(d.workouts)} allenamenti, ${n(d.meals)} pasti e ${n(d.exercises)} esercizi. ` +
      'Tutti i dati attuali su questo telefono verranno sostituiti.',
    confirmLabel: 'Sostituisci i dati',
    danger: true,
  });
  if (!ok) return;

  try {
    await db.importData(backup);
    if (state.onImported) await state.onImported();
    await renderProgress();
    toast('Backup ripristinato');
  } catch (err) {
    toast(err.message || 'Importazione non riuscita', { error: true });
  }
}
