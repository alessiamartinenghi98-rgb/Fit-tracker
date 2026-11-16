/* ==========================================================================
   report.js — Report PDF per il personal trainer
   --------------------------------------------------------------------------
   Crea sul telefono un PDF con tutto quello che hai fatto in un periodo:
   - riepilogo e costanza (allenamenti a settimana rispetto all'obiettivo)
   - settimana per settimana: schede fatte, parziali, extra
   - per ogni scheda: esercizi con primo/ultimo valore, variazione,
     andamento e stato (in crescita, stabile, in stallo, pronto ad aumentare)
   - tapis roulant, allenamenti extra, dieta e acqua (facoltativi)
   - dettaglio di ogni allenamento (facoltativo) e note per il trainer
   Il PDF si condivide dal foglio di condivisione (WhatsApp, Mail, File...).
   Le librerie jsPDF e AutoTable si caricano solo quando serve e restano
   salvate per l'uso offline.
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, toast, haptic, openSheet, initSeg, todayISO, addDays, startOfWeek, parseISO, fmtNum, fmtInt,
} from './ui.js';
import {
  completedSets, isStrength, isPartial, isCardio, isActivity, activityType, workoutStats,
} from './workouts.js';
import { strengthTemplates, targetText } from './templates.js';
import { dayStatus, categoryCounts, getPlan, CATEGORIES, counterLabel } from './plan.js';
import { WATER_GOAL } from './water.js';
import { hasTreadmill } from './treadmill.js';

export const PDF_LIBS = [
  'https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js',
];

const WEEKLY_GOAL = 4;

const PERIODS = [
  { id: '4w', label: '4 sett.', weeks: 4 },
  { id: '8w', label: '8 sett.', weeks: 8 },
  { id: '3m', label: '3 mesi', weeks: 13 },
  { id: 'all', label: 'Tutto', weeks: null },
];

/* ==========================================================================
   Foglio di scelta delle opzioni
   ========================================================================== */

export async function openReportSheet() {
  const savedName = await db.getMeta('reportName', '');
  const opts = { period: '8w', details: true, diet: true };

  const s = openSheet({
    title: 'Report per il trainer',
    tall: true,
    html: `
      <p class="confirm-text" style="margin-bottom:var(--s-4)">
        Un PDF con allenamenti, progressi di ogni esercizio e costanza, da condividere con il tuo personal trainer.
      </p>
      <div class="field">
        <span class="field-label">Periodo</span>
        <div class="seg" data-period>
          ${PERIODS.map((p) => `<button data-value="${p.id}" class="${p.id === opts.period ? 'active' : ''}">${p.label}</button>`).join('')}
        </div>
      </div>
      <div class="list switch-list" style="margin-bottom:var(--s-4)">
        <label class="switch-row">
          <span class="row-main"><span class="row-title">Dettaglio di ogni allenamento</span>
          <span class="row-sub">Tutte le serie con peso e ripetizioni</span></span>
          <input type="checkbox" class="switch" data-opt="details" checked>
        </label>
        <label class="switch-row">
          <span class="row-main"><span class="row-title">Dieta e acqua</span>
          <span class="row-sub">Giorni puliti, sgarri, categorie, acqua</span></span>
          <input type="checkbox" class="switch" data-opt="diet" checked>
        </label>
      </div>
      <label class="field">
        <span class="field-label">Il tuo nome <span class="opt">· facoltativo</span></span>
        <input class="input" data-name value="${esc(savedName)}" maxlength="60" autocomplete="name">
      </label>
      <label class="field">
        <span class="field-label">Note per il trainer <span class="opt">· facoltative</span></span>
        <textarea class="input" data-notes rows="4" maxlength="1200"
                  placeholder="Es. la scheda B mi sembra facile, fastidio alla spalla sinistra sulle alzate laterali…"></textarea>
      </label>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-create>${icon('file-text')} Crea PDF</button>
      </div>
      <p class="footnote">Il PDF si crea sul telefono: nessun dato viene inviato finché non scegli tu con chi condividerlo.</p>`,
  });

  initSeg($('[data-period]', s.body), (v) => { opts.period = v; });

  const btn = $('[data-create]', s.body);
  btn.addEventListener('click', async () => {
    opts.details = $('[data-opt="details"]', s.body).checked;
    opts.diet = $('[data-opt="diet"]', s.body).checked;
    opts.name = $('[data-name]', s.body).value.trim();
    opts.notes = $('[data-notes]', s.body).value.trim();
    await db.setMeta('reportName', opts.name);

    btn.disabled = true;
    btn.innerHTML = `${icon('loader')} Creo il PDF…`;
    try {
      const file = await createReport(opts);
      s.close();
      await shareFile(file);
    } catch (err) {
      console.error(err);
      toast(err.offline ? 'Serve internet la prima volta per creare il PDF' : 'Non sono riuscita a creare il PDF', { error: true });
      btn.disabled = false;
      btn.innerHTML = `${icon('file-text')} Crea PDF`;
    }
  });
}

/** Condivide il PDF (iPhone: WhatsApp, Mail, Salva su File…) o lo scarica. */
async function shareFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Report allenamenti' });
      toast('Report pronto');
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Report scaricato');
}

/* ==========================================================================
   Caricamento delle librerie PDF
   ========================================================================== */

let libsPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.crossOrigin = 'anonymous';
    el.onload = resolve;
    el.onerror = () => { const e = new Error(`Libreria non disponibile: ${src}`); e.offline = !navigator.onLine; reject(e); };
    document.head.append(el);
  });
}

async function loadLibs() {
  if (!libsPromise) {
    libsPromise = (async () => {
      if (!window.jspdf) await loadScript(PDF_LIBS[0]);
      await loadScript(PDF_LIBS[1]);
      return window.jspdf.jsPDF;
    })().catch((err) => { libsPromise = null; throw err; });
  }
  return libsPromise;
}

/** Tabella con AutoTable (funziona sia come metodo sia come funzione globale). */
function table(doc, options) {
  if (typeof doc.autoTable === 'function') return doc.autoTable(options);
  const fn = window.jspdf_autotable?.autoTable || window.jspdf_autotable?.default || window.autoTable;
  return fn(doc, options);
}

/* ==========================================================================
   Calcoli
   ========================================================================== */

const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) =>
  new Intl.DateTimeFormat('it-IT', opts).format(parseISO(iso));
const fmtLong = (iso) => fmtDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDay = (iso) => {
  const s = fmtDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const kg = (n) => fmtNum(Math.round(n * 100) / 100);
const parziali = (n) => `${n} ${n === 1 ? 'parziale' : 'parziali'}`;

/** Testo compatibile con i caratteri dei font standard del PDF. */
function clean(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/−/g, '-')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—•…€]/g, '');
}

/** Serie "pesante" di una sessione: peso massimo e ripetizioni con quel peso. */
function sessionTop(entry) {
  const sets = completedSets(entry);
  if (!sets.length) return null;
  const top = Math.max(...sets.map((s) => s.weight || 0));
  const reps = Math.max(...sets.filter((s) => (s.weight || 0) === top).map((s) => s.reps));
  const volume = sets.reduce((v, s) => v + s.reps * (s.weight || 0), 0);
  return { top, reps, volume, sets };
}

/**
 * Stato dell'esercizio per il trainer:
 * - Pronto ad aumentare: nell'ultima sessione tutte le serie al massimo delle ripetizioni
 * - In stallo: ultime 3 sessioni senza aumenti di peso né di ripetizioni
 * - In crescita / Stabile / In calo rispetto all'inizio del periodo
 */
function exerciseStatus(points, target) {
  if (!points.length) return 'Non eseguito';
  const last = points[points.length - 1];
  if (target?.repMax && last.sets.length && last.sets.every((s) => s.reps >= target.repMax)) return 'Pronto ad aumentare';
  if (points.length >= 3) {
    const [a, b, c] = points.slice(-3);
    const better = (x, y) => y.top > x.top || (y.top === x.top && y.reps > x.reps);
    if (!better(a, b) && !better(b, c)) return 'In stallo';
  }
  const first = points[0];
  if (last.top > first.top || (last.top === first.top && last.reps > first.reps)) return 'In crescita';
  if (last.top < first.top) return 'In calo';
  return 'Stabile';
}

async function collect(opts) {
  const [workouts, water, diet] = await Promise.all([db.getAll('workouts'), db.getAll('water'), db.getAll('dietDays')]);
  const done = workouts.filter((w) => w.status !== 'active');
  const today = todayISO();

  // Periodo: dal lunedì di N settimane fa (o dal primo allenamento) a oggi
  const period = PERIODS.find((p) => p.id === opts.period) || PERIODS[1];
  let from;
  if (period.weeks) from = addDays(startOfWeek(today), -7 * (period.weeks - 1));
  else {
    const first = [...done.map((w) => w.date), ...diet.map((d) => d.date), ...water.map((w) => w.date)].sort()[0];
    from = startOfWeek(first || today);
  }
  const inRange = (d) => d >= from && d <= today;
  const list = done.filter((w) => inRange(w.date)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
  const strength = list.filter(isStrength);

  // Settimane
  const weeks = [];
  for (let ws = from; ws <= today; ws = addDays(ws, 7)) {
    const we = addDays(ws, 6);
    const ww = list.filter((w) => w.date >= ws && w.date <= we);
    const st = ww.filter(isStrength);
    const byTpl = {};
    st.forEach((w) => {
      if (!w.templateId) return;
      if (!isPartial(w)) byTpl[w.templateId] = 'done';
      else if (byTpl[w.templateId] !== 'done') byTpl[w.templateId] = 'partial';
    });
    weeks.push({
      from: ws, to: we, strength: st.length, partial: st.filter(isPartial).length,
      extra: ww.filter((w) => isCardio(w) || isActivity(w)).length,
      free: st.filter((w) => !w.templateId).length,
      byTpl,
      tm: ww.filter(hasTreadmill).reduce((s, w) => s + w.treadmill.minutes, 0),
    });
  }

  // Esercizi per scheda
  const templates = strengthTemplates().map((t) => {
    const sessions = strength.filter((w) => w.templateId === t.id);
    const exercises = t.exercises.map((te) => {
      const points = [];
      strength.forEach((w) => {
        const entry = (w.exercises || []).find((e) => e.exerciseId === te.exerciseId);
        const top = entry && sessionTop(entry);
        if (top) points.push({ date: w.date, ...top });
      });
      return { name: te.name, target: te, points, status: exerciseStatus(points, te) };
    });
    const planned = sessions.reduce((s, w) => s + (w.plannedSets || workoutStats(w).sets), 0);
    const doneSets = sessions.reduce((s, w) => s + workoutStats(w).sets, 0);
    return {
      t, sessions: sessions.length, partial: sessions.filter(isPartial).length,
      completion: planned ? Math.round((doneSets / planned) * 100) : null,
      last: sessions.length ? sessions[sessions.length - 1].date : null,
      exercises,
    };
  });

  // Dieta e acqua
  const dietDays = diet.filter((d) => inRange(d.date));
  const statuses = dietDays.map(dayStatus);
  const waterDays = water.filter((w) => inRange(w.date));
  const nWeeks = weeks.length;
  const counts = categoryCounts(dietDays);
  const targets = getPlan().targets;

  return {
    from, to: today, weeks, list, strength, templates,
    extras: list.filter((w) => isCardio(w) || isActivity(w)),
    treadmill: list.filter(hasTreadmill),
    diet: {
      logged: dietDays.length,
      // Giornata pulita: tutti e 4 i pasti segnati e nessuno sgarro (come l'anello della Home)
      clean: dietDays.filter((d, i) => statuses[i] === 'clean' && Object.values(d.meals || {}).filter(Boolean).length >= 4).length,
      cheat: statuses.filter((s) => s === 'cheat').length,
      categories: CATEGORIES.map((c) => ({ label: counterLabel(c.id), done: counts[c.id], planned: (targets[c.id] ?? 0) * nWeeks })),
    },
    water: {
      days: waterDays.length,
      goalDays: waterDays.filter((w) => w.ml >= WATER_GOAL).length,
      avg: waterDays.length ? Math.round(waterDays.reduce((s, w) => s + w.ml, 0) / waterDays.length) : 0,
    },
  };
}

/* ==========================================================================
   Creazione del PDF
   ========================================================================== */

const INK = [20, 20, 22];
const MUTED = [110, 110, 118];
const LINE = [225, 225, 230];
const ACCENT = [90, 125, 0];        // lime scuro, leggibile su carta
const ACCENT_SOFT = [236, 248, 200];
const PARTIAL_SOFT = [246, 250, 228];
const DANGER = [196, 43, 28];

async function createReport(opts) {
  const [JsPDF, data] = await Promise.all([loadLibs(), collect(opts)]);
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14; // margine
  let y = M;

  const ensure = (h) => { if (y + h > 282) { doc.addPage(); y = M + 4; } };
  const h1 = (text, keep = 40) => {
    ensure(keep); // il titolo non resta da solo in fondo alla pagina
    y += 4;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...INK);
    doc.text(clean(text), M, y);
    doc.setDrawColor(...ACCENT); doc.setLineWidth(0.6); doc.line(M, y + 2, M + 14, y + 2);
    y += 7;
  };
  const para = (text, { size = 9.5, color = MUTED, bold = false } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(clean(text), W - 2 * M);
    ensure(lines.length * size * 0.45 + 2);
    doc.text(lines, M, y);
    y += lines.length * size * 0.42 + 2;
  };
  const tableDefaults = {
    margin: { left: M, right: M },
    rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 8.6, textColor: INK, cellPadding: 1.8, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: [30, 30, 33], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
    alternateRowStyles: { fillColor: [249, 249, 250] },
  };
  const tbl = (options) => {
    table(doc, {
      ...tableDefaults, startY: y, ...options,
      styles: { ...tableDefaults.styles, ...(options.styles || {}) },
      headStyles: { ...tableDefaults.headStyles, ...(options.headStyles || {}) },
    });
    y = doc.lastAutoTable.finalY + 5;
  };

  /* --- Intestazione ------------------------------------------------------ */
  doc.setFillColor(20, 20, 22);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(198, 244, 50);
  doc.rect(0, 30, W, 1.2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(255, 255, 255);
  doc.text('Report allenamenti', M, 14);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(200, 200, 205);
  doc.text(clean(`${opts.name ? `${opts.name} · ` : ''}dal ${fmtLong(data.from)} al ${fmtLong(data.to)} · ${data.weeks.length} settimane`), M, 22);
  y = 40;

  /* --- Riepilogo --------------------------------------------------------- */
  const nStrength = data.strength.length;
  const nPartial = data.strength.filter(isPartial).length;
  const avgWeek = data.weeks.length ? nStrength / data.weeks.length : 0;
  const fullWeeks = data.weeks.filter((w) => w.strength >= WEEKLY_GOAL).length;
  const tmMin = data.treadmill.reduce((s, w) => s + w.treadmill.minutes, 0);

  const kpis = [
    ['Allenamenti con scheda', `${nStrength}`, nPartial ? `di cui ${parziali(nPartial)}` : 'tutti completi'],
    ['Media a settimana', fmtNum(Math.round(avgWeek * 10) / 10), `obiettivo ${WEEKLY_GOAL}`],
    ['Settimane a 4 su 4', `${fullWeeks}/${data.weeks.length}`, `${data.weeks.length ? Math.round((fullWeeks / data.weeks.length) * 100) : 0}% delle settimane`],
    ['Extra e tapis roulant', `${data.extras.length}`, `${tmMin} min di tapis roulant`],
  ];
  const boxW = (W - 2 * M - 9) / 4;
  kpis.forEach(([label, value, sub], i) => {
    const x = M + i * (boxW + 3);
    doc.setFillColor(246, 246, 248); doc.setDrawColor(...LINE);
    doc.roundedRect(x, y, boxW, 22, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(clean(label), x + 3, y + 5.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(...INK);
    doc.text(clean(value), x + 3, y + 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(clean(sub), x + 3, y + 19);
  });
  y += 29;

  // Punti chiave per il trainer
  const ready = [];
  const stalled = [];
  data.templates.forEach((tp) => tp.exercises.forEach((e) => {
    if (e.status === 'Pronto ad aumentare') ready.push(`${e.name} (${tp.t.code})`);
    if (e.status === 'In stallo') stalled.push(`${e.name} (${tp.t.code})`);
  }));
  const keyPoints = [];
  keyPoints.push(`Costanza: ${fmtNum(Math.round(avgWeek * 10) / 10)} allenamenti a settimana su ${WEEKLY_GOAL} previsti${nPartial ? `, ${nPartial} ${nPartial === 1 ? 'chiuso' : 'chiusi'} come ${nPartial === 1 ? 'parziale' : 'parziali'}` : ''}.`);
  data.templates.forEach((tp) => {
    if (tp.sessions) keyPoints.push(`Scheda ${tp.t.code} (${tp.t.name}): ${tp.sessions} ${tp.sessions === 1 ? 'volta' : 'volte'}, serie completate ${tp.completion ?? 0}%.`);
    else keyPoints.push(`Scheda ${tp.t.code} (${tp.t.name}): non eseguita nel periodo.`);
  });
  if (ready.length) keyPoints.push(`Pronti ad aumentare il carico: ${ready.join(', ')}.`);
  if (stalled.length) keyPoints.push(`In stallo da almeno 3 sessioni: ${stalled.join(', ')}.`);

  h1('Punti chiave');
  keyPoints.forEach((p) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(clean(p), W - 2 * M - 5);
    ensure(lines.length * 4.2 + 1);
    doc.setFillColor(...ACCENT); doc.circle(M + 1, y - 1.2, 0.8, 'F');
    doc.text(lines, M + 4, y);
    y += lines.length * 4.2 + 1;
  });
  y += 2;

  /* --- Le note per il trainer, subito in vista ----------------------------- */
  if (opts.notes) {
    h1('Le mie note', 20);
    para(opts.notes, { color: INK, size: 10 });
  }

  /* --- Settimana per settimana -------------------------------------------- */
  h1('Settimana per settimana');
  const codes = strengthTemplates();
  tbl({
    head: [['Settimana', ...codes.map((t) => t.code), 'Totale', 'Parziali', 'Extra', 'Tapis (min)']],
    body: data.weeks.map((w) => [
      clean(`${fmtDate(w.from)} - ${fmtDate(w.to)}`),
      ...codes.map((t) => (w.byTpl[t.id] === 'done' ? 'Sì' : w.byTpl[t.id] === 'partial' ? 'Parz.' : '-')),
      `${w.strength}/${WEEKLY_GOAL}`,
      w.partial ? `${w.partial}` : '-',
      w.extra ? `${w.extra}` : '-',
      w.tm ? `${w.tm}` : '-',
    ]),
    columnStyles: { 0: { cellWidth: 34 }, ...Object.fromEntries(codes.map((_, i) => [i + 1, { cellWidth: 17 }])) },
    styles: { halign: 'center' },
    didParseCell: (h) => {
      if (h.section !== 'body') return;
      if (h.column.index === 0) h.cell.styles.halign = 'left';
      const v = h.cell.raw;
      if (v === 'Sì') { h.cell.styles.fillColor = ACCENT_SOFT; h.cell.styles.textColor = ACCENT; h.cell.styles.fontStyle = 'bold'; }
      if (v === 'Parz.') { h.cell.styles.fillColor = PARTIAL_SOFT; h.cell.styles.textColor = ACCENT; }
      if (h.column.index === codes.length + 1 && parseInt(v, 10) >= WEEKLY_GOAL) h.cell.styles.fontStyle = 'bold';
    },
  });

  /* --- Progressi per scheda ----------------------------------------------- */
  data.templates.forEach((tp) => {
    h1(`Scheda ${tp.t.code} · ${tp.t.name}`);
    para(tp.sessions
      ? `${tp.sessions} ${tp.sessions === 1 ? 'sessione' : 'sessioni'} nel periodo${tp.partial ? ` (${parziali(tp.partial)})` : ''} · serie completate ${tp.completion ?? 0}% · ultima volta ${fmtDay(tp.last)}.`
      : 'Nessuna sessione nel periodo.');
    const rows = tp.exercises.map((e) => {
      const first = e.points[0];
      const last = e.points[e.points.length - 1];
      const max = e.points.length ? Math.max(...e.points.map((p) => p.top)) : null;
      const diff = first && last ? last.top - first.top : null;
      return {
        e,
        cells: [
          clean(e.name),
          clean(targetText(e.target)),
          first ? clean(`${kg(first.top)} kg × ${first.reps}\n${fmtDate(first.date)}`) : '-',
          last ? clean(`${kg(last.top)} kg × ${last.reps}\n${fmtDate(last.date)}`) : '-',
          max !== null ? `${kg(max)} kg` : '-',
          diff === null ? '-' : diff > 0 ? `+${kg(diff)} kg` : diff < 0 ? `-${kg(-diff)} kg` : '=',
          `${e.points.length}`,
          '',
          e.status,
        ],
      };
    });
    tbl({
      head: [['Esercizio', 'Obiettivo', 'Inizio periodo', 'Ultima volta', 'Max', 'Var.', 'Volte', 'Andamento', 'Stato']],
      body: rows.map((r) => r.cells),
      columnStyles: {
        0: { cellWidth: 36, fontStyle: 'bold' }, 1: { cellWidth: 24 }, 2: { cellWidth: 21 }, 3: { cellWidth: 21 },
        4: { cellWidth: 14 }, 5: { cellWidth: 14 }, 6: { cellWidth: 12, halign: 'center' }, 7: { cellWidth: 21 }, 8: { cellWidth: 19 },
      },
      styles: { fontSize: 7.8 },
      didParseCell: (h) => {
        if (h.section !== 'body') return;
        if (h.column.index === 5 && String(h.cell.raw).startsWith('+')) { h.cell.styles.textColor = ACCENT; h.cell.styles.fontStyle = 'bold'; }
        if (h.column.index === 5 && String(h.cell.raw).startsWith('-') && h.cell.raw !== '-') h.cell.styles.textColor = DANGER;
        if (h.column.index === 8) {
          const st = h.cell.raw;
          h.cell.styles.fontStyle = 'bold';
          if (st === 'Pronto ad aumentare' || st === 'In crescita') h.cell.styles.textColor = ACCENT;
          else if (st === 'In stallo' || st === 'In calo') h.cell.styles.textColor = DANGER;
          else h.cell.styles.textColor = MUTED;
        }
      },
      // Andamento: piccola linea del peso massimo di ogni sessione
      didDrawCell: (h) => {
        if (h.section !== 'body' || h.column.index !== 7) return;
        const pts = rows[h.row.index]?.e.points || [];
        if (pts.length < 2) return;
        const vals = pts.map((p) => p.top + p.reps / 100); // a parità di peso, contano le ripetizioni
        const lo = Math.min(...vals);
        const hi = Math.max(...vals);
        const x0 = h.cell.x + 2; const x1 = h.cell.x + h.cell.width - 2;
        const y0 = h.cell.y + h.cell.height - 2.5; const y1 = h.cell.y + 2.5;
        const px = (i) => x0 + ((x1 - x0) * i) / (vals.length - 1);
        const py = (v) => (hi === lo ? (y0 + y1) / 2 : y0 - ((v - lo) / (hi - lo)) * (y0 - y1));
        doc.setDrawColor(...ACCENT); doc.setLineWidth(0.45);
        for (let i = 1; i < vals.length; i++) doc.line(px(i - 1), py(vals[i - 1]), px(i), py(vals[i]));
        doc.setFillColor(...ACCENT); doc.circle(px(vals.length - 1), py(vals[vals.length - 1]), 0.6, 'F');
      },
    });
  });
  para('Legenda stato: "Pronto ad aumentare" = nell\'ultima sessione tutte le serie al massimo delle ripetizioni; "In stallo" = nessun aumento di peso o ripetizioni nelle ultime 3 sessioni; "In crescita" / "Stabile" / "In calo" = confronto tra inizio periodo e ultima volta (serie più pesante).', { size: 7.8 });

  /* --- Tapis roulant ed extra --------------------------------------------- */
  if (data.treadmill.length) {
    h1('Tapis roulant');
    const tms = data.treadmill.map((w) => w.treadmill);
    const avgSpeed = tms.filter((t) => t.speed).reduce((s, t, _, a) => s + t.speed / a.length, 0);
    para(`${tms.length} sessioni · ${tmMin} minuti in totale · media ${Math.round(tmMin / tms.length)} min${avgSpeed ? ` a ${kg(avgSpeed)} km/h` : ''}.`);
    tbl({
      head: [['Data', 'Dopo', 'Minuti', 'Velocità (km/h)', 'Pendenza (%)']],
      body: data.treadmill.map((w) => [
        clean(fmtDay(w.date)),
        clean(w.templateCode ? `Scheda ${w.templateCode}` : isCardio(w) ? 'Cardio' : isActivity(w) ? activityType(w.activity).label : 'Allenamento'),
        `${w.treadmill.minutes}`, w.treadmill.speed ? kg(w.treadmill.speed) : '-', w.treadmill.incline ? kg(w.treadmill.incline) : '-',
      ]),
    });
  }
  if (data.extras.length) {
    h1('Allenamenti extra');
    tbl({
      head: [['Data', 'Tipo', 'Durata', 'Nota']],
      body: data.extras.map((w) => [
        clean(fmtDay(w.date)),
        clean(isCardio(w) ? 'Cardio del sabato' : activityType(w.activity).label),
        w.duration ? `${w.duration} min` : '-',
        clean(w.note || ''),
      ]),
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 36 }, 2: { cellWidth: 20 } },
    });
  }

  /* --- Dieta e acqua ------------------------------------------------------ */
  if (opts.diet) {
    h1('Dieta e acqua');
    const d = data.diet;
    para(`Giorni registrati: ${d.logged} · puliti (4 pasti senza sgarri): ${d.clean} · con sgarro: ${d.cheat}. Acqua: ${data.water.goalDays} giorni con almeno 2 litri su ${data.water.days} registrati, media ${kg(data.water.avg / 1000)} L al giorno.`, { color: INK });
    tbl({
      head: [['Categoria (pranzo e cena)', 'Fatti', 'Previsti dal piano', 'Differenza']],
      body: d.categories.map((c) => [clean(c.label), `${c.done}`, `${c.planned}`, c.done === c.planned ? '=' : c.done > c.planned ? `+${c.done - c.planned}` : `${c.done - c.planned}`]),
      columnStyles: { 0: { cellWidth: 70 } },
    });
  }

  /* --- Dettaglio di ogni allenamento --------------------------------------- */
  if (opts.details && data.strength.length) {
    h1('Dettaglio degli allenamenti');
    data.strength.forEach((w) => {
      const st = workoutStats(w);
      ensure(34);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
      const title = `${fmtDay(w.date)} · ${w.templateCode ? `Scheda ${w.templateCode} - ` : ''}${w.name || 'Allenamento'}`;
      doc.text(clean(title), M, y);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
      doc.text(clean(`${isPartial(w) ? `Parziale: ${st.sets}/${w.plannedSets} serie` : `${st.sets} serie`} · volume ${fmtInt(st.volume)} kg`), W - M, y, { align: 'right' });
      y += 2;
      tbl({
        head: [['Esercizio', 'Serie (kg × ripetizioni)', 'Volume']],
        body: (w.exercises || []).map((e) => {
          const sets = completedSets(e);
          const unit = e.target?.unit === 'g' ? ' (per gamba)' : e.target?.unit === 'b' ? ' (per braccio)' : '';
          return [
            clean(`${e.name}${unit}`),
            clean(sets.map((s) => `${kg(s.weight || 0)}×${s.reps}`).join('   ')),
            `${fmtInt(sets.reduce((v, s) => v + s.reps * (s.weight || 0), 0))} kg`,
          ];
        }),
        columnStyles: { 0: { cellWidth: 52 }, 2: { cellWidth: 20, halign: 'right' } },
        styles: { fontSize: 7.8 },
        headStyles: { fillColor: [70, 70, 76] },
      });
      if (hasTreadmill(w)) {
        para(`Tapis roulant: ${w.treadmill.minutes} min${w.treadmill.speed ? ` a ${kg(w.treadmill.speed)} km/h` : ''}${w.treadmill.incline ? `, pendenza ${kg(w.treadmill.incline)}%` : ''}.`, { size: 8 });
      }
    });
  }

  /* --- Piè di pagina ------------------------------------------------------- */
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
    doc.text(clean(`Fit Tracker · creato il ${fmtLong(todayISO())}`), M, 291);
    doc.text(`Pagina ${i} di ${pages}`, W - M, 291, { align: 'right' });
  }

  haptic(15);
  const blob = doc.output('blob');
  return new File([blob], `report-allenamenti-${todayISO()}.pdf`, { type: 'application/pdf' });
}

// Per i test automatici: crea il report senza condividerlo
export { createReport as _createReport };
