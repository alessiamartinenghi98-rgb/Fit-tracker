/* ==========================================================================
   templates.js — Schede di allenamento
   --------------------------------------------------------------------------
   - Schede preimpostate A, B, C, D e cardio del sabato (create una sola volta)
   - Testi di supporto: "4 × 6–8 per gamba"
   - Modifica dall'app: nome, esercizi, serie, ripetizioni, lato (gamba/braccio)
   Le schede sono salvate nell'archivio "templates" di IndexedDB.
   ========================================================================== */

import * as db from './db.js';
import { $, esc, icon, toast, haptic, openSheet, confirmSheet, initSeg, todayISO } from './ui.js';
import { pickExercise } from './workouts.js';
import { saveBlocks } from './blocks.js';

/* --- Schede preimpostate (Blocco 2) ---------------------------------------
   ex(nome, serie, rip. minime, rip. massime, opzioni)
   opzioni:
   - unit: '' = normale, 'g' = per gamba, 'b' = per braccio
   - rest: recupero in secondi (per il timer) · restLabel: testo, es. "2-3'"
   - start: carico di partenza consigliato (testo) · startKg: numero per precompilare
   - note: consiglio tecnico · bodyweight: corpo libero (kg facoltativi)
   - max: ripetizioni al massimo, es. "max (6–10)" · superset: id della coppia     */
const ex = (name, sets, repMin, repMax, o = {}) => ({
  name, sets, repMin, repMax, unit: o.unit || '', rest: o.rest || 75, restLabel: o.restLabel || '',
  start: o.start || '', startKg: o.startKg ?? null, note: o.note || '',
  bodyweight: Boolean(o.bodyweight), max: Boolean(o.max), superset: o.superset || '',
});

const SEED = [
  {
    id: 'tpl-a', code: 'A', name: 'Glutei A', kind: 'strength',
    exercises: [
      ex('Hip thrust', 4, 6, 8, { rest: 150, restLabel: "2-3'", start: '82,5–85 kg', startKg: 82.5, note: '1 secondo di stretta in alto' }),
      ex('Stacchi rumeni manubri', 3, 8, 10, { rest: 120, restLabel: "2'", start: '18 kg', startKg: 18, note: 'Ginocchia morbide, sedere indietro, schiena dritta' }),
      ex('Affondi bulgari', 3, 8, 8, { unit: 'g', rest: 90, restLabel: '90"', start: '12 kg', startKg: 12, note: 'Piede davanti lontano dalla panca, busto inclinato, spingi dal tallone' }),
      ex('Kickback cavo', 3, 10, 12, { unit: 'g', rest: 60, restLabel: '60"', start: '7,5–9 kg', startKg: 7.5, note: 'Ultima serie + ripetizioni extra a carico dimezzato' }),
      ex('Abductor busto avanti', 3, 12, 12, { rest: 60, restLabel: '60"', start: '27,5 kg', startKg: 27.5, note: 'Tieni aperto 1 secondo' }),
      ex('Calf in piedi', 2, 12, 12, { rest: 60, restLabel: '60"', start: 'Manubrio in mano' }),
    ],
  },
  {
    id: 'tpl-b', code: 'B', name: 'Schiena + braccia', kind: 'strength',
    exercises: [
      ex('Lat prona larga', 4, 8, 10, { rest: 120, restLabel: "2'", start: '27 kg', startKg: 27, note: 'Sbarra al petto, gomiti verso i fianchi' }),
      ex('Rematore manubrio', 3, 8, 10, { unit: 'b', rest: 90, restLabel: '90"', start: '12 kg', startKg: 12, note: "Gomito verso l'anca" }),
      ex('Pulley triangolo', 3, 10, 10, { rest: 90, restLabel: '90"', start: '25 kg', startKg: 25, note: 'Petto in fuori, 1 secondo di stretta' }),
      ex('Lat singola maniglia', 3, 10, 10, { unit: 'b', rest: 75, restLabel: '60-90"', start: '10 kg', startKg: 10, note: 'Seduta di lato' }),
      ex('Curl bilanciere EZ', 3, 8, 10, { rest: 90, restLabel: '90"', note: 'Gomiti fermi', superset: 'ss-b' }),
      ex('Dip su panca', 3, 8, 12, { rest: 90, restLabel: '90"', start: 'Corpo libero', bodyweight: true, note: 'Mani sulla panca dietro, gambe piegate', superset: 'ss-b' }),
      ex('Curl cavo basso', 2, 12, 12, { rest: 60, restLabel: '60"', start: '6,5 kg', startKg: 6.5 }),
    ],
  },
  {
    id: 'tpl-c', code: 'C', name: 'Glutei B + femorali', kind: 'strength',
    exercises: [
      ex('Stacco rumeno con bilanciere', 3, 6, 8, { rest: 150, restLabel: "2-3'", start: '30–35 kg', startKg: 30, note: 'Bilanciere vicino alle gambe, sedere indietro' }),
      ex('Pressa monopodalica', 3, 10, 10, { unit: 'g', rest: 90, restLabel: '90"', note: "Piede alto e un po' largo sulla pedana, spingi dal tallone" }),
      ex('Stacco rumeno monopodalico con manubrio', 3, 8, 8, { unit: 'g', rest: 90, restLabel: '90"', start: '10–12 kg', startKg: 10, note: "Una mano su una panca per l'equilibrio, bacino dritto" }),
      ex('Iperestensioni 45°', 3, 10, 12, { rest: 90, restLabel: '90"', start: '10–14 kg', startKg: 10, note: 'Piedi ruotati in fuori, schiena leggermente curva' }),
      ex('Leg curl seduto', 3, 10, 10, { rest: 90, restLabel: '90"', start: '22 kg', startKg: 22, note: 'Discesa lenta' }),
      ex('Slanci laterali cavo', 3, 12, 12, { unit: 'g', rest: 60, restLabel: '60"', start: '7,5 kg', startKg: 7.5, note: 'Movimento lento, busto fermo' }),
    ],
  },
  {
    id: 'tpl-d', code: 'D', name: 'Spalle + braccia', kind: 'strength',
    exercises: [
      ex('Shoulder press 75°', 3, 8, 10, { rest: 120, restLabel: "2'", start: '7 kg', startKg: 7, note: 'Resta su 7 kg finché fai 10 in tutte le serie' }),
      ex('Alzate laterali', 4, 10, 12, { rest: 75, restLabel: '60-90"', start: '3 kg', startKg: 3, note: 'Resta su 3 kg finché fai 12 in tutte le serie' }),
      ex('Face pull corda', 3, 12, 12, { rest: 60, restLabel: '60"', start: '13–14 kg', startKg: 13, note: 'Corda verso la fronte, gomiti aperti' }),
      ex('Pushdown corda', 3, 10, 12, { rest: 90, restLabel: '90"', start: '13 kg', startKg: 13, note: 'Gomiti incollati ai fianchi', superset: 'ss-d' }),
      ex('Hammer curl', 3, 10, 10, { rest: 90, restLabel: '90"', note: 'Presa a martello', superset: 'ss-d' }),
      ex('French press cavo', 3, 10, 10, { rest: 60, restLabel: '60"', start: '9 kg', startKg: 9, note: 'Di spalle al cavo, braccia sopra la testa' }),
      ex('Flessioni presa stretta', 3, 6, 10, { rest: 75, restLabel: '60-90"', start: 'Corpo libero', bodyweight: true, max: true, note: 'Gomiti stretti; se troppo dure mani su panca o ginocchia a terra' }),
    ],
  },
  {
    id: 'tpl-cardio', code: 'Cardio', name: 'Cardio del sabato', kind: 'cardio',
    // Righe con "- " = elenco puntato; le altre sono titoli
    notes: [
      'Cammina-corri',
      '- Settimane 1-2: 6 × 2\' corsa + 2\' cammino',
      '- Settimane 3-4: 6 × 3\' corsa + 1\'30" cammino',
      '- Settimana 5: 4 × 5\' corsa + 1\'30" cammino',
      '- Settimana 6: 5 × 2\' corsa + 2\' cammino, niente circuito',
      '',
      'Circuito · 3 giri, 40" lavoro / 20" pausa',
      '- Kettlebell swing',
      '- Battle rope',
      '- Farmer walk',
      '- Plank tocco spalla',
    ].join('\n'),
  },
];

/* --- Nuovo blocco --------------------------------------------------------- */

/** Inizio del Blocco 2 (modificabile poi dall'app). */
export const BLOCK2_START = '2026-11-17';
export const BLOCK2_WEEKS = 6;

/** Esercizi rinominati: lo storico del vecchio nome passa al nuovo. */
const LINKS = [
  ['Dip', 'Dip su panca'],
  ['Curl con bilanciere EZ', 'Curl bilanciere EZ'],
];

/** Nome confrontabile: minuscolo, senza accenti e spazi doppi. */
const norm = (str) => String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

/** Esercizio della scheda a partire dalla definizione (con l'id della libreria). */
const fromSeed = (e, exercise) => ({ ...e, exerciseId: exercise.id, name: exercise.name });

export const UNIT_LABEL = { '': '', g: 'per gamba', b: 'per braccio' };
export const UNIT_SHORT = { '': '', g: 'gamba', b: 'braccio' };

let templates = [];

/* --- Lettura ------------------------------------------------------------- */

export async function loadTemplates() {
  templates = (await db.getAll('templates')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return templates;
}

export const getTemplates = () => templates;
export const getTemplate = (id) => templates.find((t) => t.id === id);
export const strengthTemplates = () => templates.filter((t) => t.kind !== 'cardio');
export const cardioTemplate = () => templates.find((t) => t.kind === 'cardio');

/** "6–8" oppure "10" se minimo e massimo coincidono. */
export function repRange(min, max) {
  if (!min && !max) return '–';
  if (!max || min === max) return `${min || max}`;
  return `${min}–${max}`;
}

/** "4 × 6–8 per gamba" */
export function targetText(t) {
  const unit = UNIT_LABEL[t.unit || ''];
  const reps = t.max ? `max (${repRange(t.repMin, t.repMax)})` : repRange(t.repMin, t.repMax);
  return `${t.sets} × ${reps}${unit ? ` ${unit}` : ''}`;
}

/** Recupero leggibile: "2-3'", "90\"" (dal testo della scheda o dai secondi). */
export function restText(e) {
  if (!e) return '';
  if (e.restLabel) return e.restLabel;
  if (!e.rest) return '';
  return e.rest % 60 === 0 ? `${e.rest / 60}'` : e.rest > 60 ? `${Math.floor(e.rest / 60)}'${e.rest % 60}"` : `${e.rest}"`;
}

/** Note del cardio in HTML: titoli e liste puntate. */
export function notesHTML(notes = '') {
  let html = '';
  let inList = false;
  for (const raw of notes.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('- ')) {
      if (!inList) { html += '<ul class="notes-list">'; inList = true; }
      html += `<li>${esc(line.slice(2))}</li>`;
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (line) html += `<div class="notes-title">${esc(line)}</div>`;
  }
  if (inList) html += '</ul>';
  return html;
}

/* --- Creazione delle schede preimpostate --------------------------------- */

/**
 * Crea le schede alla prima apertura dopo l'aggiornamento.
 * Riutilizza gli esercizi già presenti in libreria (stesso nome) e aggiunge
 * solo quelli mancanti: allenamenti e pasti esistenti non vengono toccati.
 */
export async function seedTemplates() {
  if (await db.getMeta('templatesSeeded')) return;
  const existing = await db.getAll('templates');
  if (existing.length === 0) {
    const lib = await db.getAll('exercises');
    const byName = new Map(lib.map((e) => [e.name.toLowerCase(), e]));
    const created = [];
    const ensure = (name) => {
      let e = byName.get(name.toLowerCase());
      if (!e) {
        e = { id: db.uid(), name, createdAt: Date.now() + created.length };
        byName.set(name.toLowerCase(), e);
        created.push(e);
      }
      return e;
    };

    const list = SEED.map((s, i) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      kind: s.kind,
      order: i,
      notes: s.notes || '',
      createdAt: Date.now(),
      exercises: (s.exercises || []).map((e) => fromSeed(e, ensure(e.name))),
    }));

    if (created.length) await db.putMany('exercises', created);
    await db.putMany('templates', list);
    // Prima installazione: si parte direttamente dal blocco attuale
    if (!(await db.getMeta('block2Migrated'))) {
      await saveBlocks([{ id: 'b2', name: 'Blocco 2', start: todayISO(), weeks: BLOCK2_WEEKS }], {});
      await db.setMeta('block2Migrated', true);
    }
  }
  await db.setMeta('templatesSeeded', true);
}

/**
 * Passaggio al Blocco 2 (una sola volta).
 * - copia di sicurezza di schede e libreria in meta "backupBeforeBlock2"
 * - le schede A–D attuali vengono archiviate come "Blocco 1"
 * - "Dip" → "Dip su panca" e "Curl con bilanciere EZ" → "Curl bilanciere EZ":
 *   stesso esercizio, quindi storico, ultima volta e massimo restano collegati
 * - le schede A–D prendono i nuovi esercizi, mantenendo la stessa identità:
 *   gli allenamenti già fatti questa settimana continuano a contare
 * - gli esercizi già presenti in libreria (stesso nome) mantengono il loro
 *   storico; gli allenamenti registrati non vengono modificati
 */
export async function migrateToBlock2() {
  if (await db.getMeta('block2Migrated')) return false;
  const [current, lib, workouts] = await Promise.all([
    db.getAll('templates'), db.getAll('exercises'), db.getAll('workouts'),
  ]);
  if (!current.length) return false; // ci pensa seedTemplates

  await db.setMeta('backupBeforeBlock2', {
    at: new Date().toISOString(), templates: current, exercises: lib,
  });

  const byName = new Map(lib.map((e) => [norm(e.name), e]));
  const changedWorkouts = new Map();
  const renameInWorkouts = (fromId, to) => {
    for (const w of workouts) {
      for (const entry of w.exercises || []) {
        if (entry.exerciseId === fromId) {
          entry.exerciseId = to.id;
          entry.name = to.name;
          changedWorkouts.set(w.id, w);
        }
      }
    }
  };

  // Esercizi collegati (rinominati)
  for (const [oldName, newName] of LINKS) {
    const old = byName.get(norm(oldName));
    if (!old) continue;
    const existing = byName.get(norm(newName));
    if (existing && existing.id !== old.id) {
      // Esistono entrambi: lo storico del vecchio passa al nuovo
      renameInWorkouts(old.id, existing);
      await db.del('exercises', old.id);
    } else {
      old.name = newName;
      await db.put('exercises', old);
      byName.set(norm(newName), old);
      renameInWorkouts(old.id, old);
    }
    byName.delete(norm(oldName));
  }
  if (changedWorkouts.size) await db.putMany('workouts', [...changedWorkouts.values()]);

  // Esercizi delle nuove schede: quelli già in libreria tengono il loro id
  const created = [];
  const ensure = (name) => {
    let e = byName.get(norm(name));
    if (!e) {
      e = { id: db.uid(), name, createdAt: Date.now() + created.length };
      byName.set(norm(name), e);
      created.push(e);
    }
    return e;
  };

  const strengthOld = current.filter((t) => t.kind !== 'cardio');
  const updated = SEED.filter((s) => s.kind !== 'cardio').map((s, i) => {
    const prev = current.find((t) => t.id === s.id) || current.find((t) => t.code === s.code);
    return {
      ...(prev || {}),
      id: prev?.id || s.id,
      code: s.code,
      name: s.name,
      kind: 'strength',
      order: prev?.order ?? i,
      notes: prev?.notes || '',
      createdAt: prev?.createdAt || Date.now(),
      updatedAt: Date.now(),
      exercises: s.exercises.map((e) => fromSeed(e, ensure(e.name))),
    };
  });
  if (created.length) await db.putMany('exercises', created);
  await db.putMany('templates', updated);

  // Cardio: aggiunge la settimana 6 al programma se manca (il resto non cambia)
  const cardio = current.find((t) => t.kind === 'cardio');
  if (cardio && !/settimana 6/i.test(cardio.notes || '')) {
    cardio.notes = (cardio.notes || '').replace(
      /(Settimana 5:[^\n]*)/i,
      "$1\n- Settimana 6: 5 × 2' corsa + 2' cammino, niente circuito",
    );
    await db.put('templates', cardio);
  }

  // Blocchi: il primo allenamento segna l'inizio del Blocco 1
  const first = workouts.filter((w) => w.status !== 'active').map((w) => w.date).sort()[0];
  const list = [];
  const archive = {};
  if (first && first < BLOCK2_START) {
    list.push({ id: 'b1', name: 'Blocco 1', start: first, weeks: null });
    archive.b1 = strengthOld;
  }
  list.push({ id: 'b2', name: 'Blocco 2', start: BLOCK2_START, weeks: BLOCK2_WEEKS });
  await saveBlocks(list, archive);
  await db.setMeta('block2Migrated', true);
  return true;
}

/** Quando un esercizio viene rinominato in libreria, aggiorna anche le schede. */
export async function renameExerciseInTemplates(exerciseId, name) {
  const touched = templates.filter((t) => t.exercises.some((e) => e.exerciseId === exerciseId));
  touched.forEach((t) => t.exercises.forEach((e) => { if (e.exerciseId === exerciseId) e.name = name; }));
  if (touched.length) await db.putMany('templates', touched);
}

async function saveTemplate(t) {
  await db.put('templates', t);
  document.dispatchEvent(new CustomEvent('templates-changed'));
}

/* ==========================================================================
   Modifica delle schede
   ========================================================================== */

/** Elenco delle schede da modificare. */
export function openTemplatesManager() {
  const rows = () => templates.map((t) => `
    <button class="list-row" data-id="${t.id}">
      <span class="tpl-badge ${t.kind === 'cardio' ? 'cardio' : ''}">${t.kind === 'cardio' ? icon('heart-pulse') : esc(t.code)}</span>
      <span class="row-main">
        <span class="row-title">${esc(t.name)}</span>
        <span class="row-sub">${t.kind === 'cardio' ? 'Facoltativo · basta segnarlo come fatto' : `${t.exercises.length} esercizi`}</span>
      </span>
      <span class="row-trail">${icon('chevron-right')}</span>
    </button>`).join('');

  const s = openSheet({
    title: 'Modifica schede',
    tall: true,
    html: `<div class="list" data-list>${rows()}</div>
      <p class="footnote">Le modifiche valgono per i prossimi allenamenti. Quelli già registrati restano invariati.</p>`,
  });
  const refresh = () => { $('[data-list]', s.body).innerHTML = rows(); };
  s.body.addEventListener('click', (e) => {
    const row = e.target.closest('[data-id]');
    if (!row) return;
    const t = getTemplate(row.dataset.id);
    if (t) editTemplate(t, refresh);
  });
}

/** Foglio di modifica di una scheda. */
function editTemplate(t, onChange) {
  const isCardio = t.kind === 'cardio';

  const exerciseRows = () => {
    if (!t.exercises.length) {
      return '<div class="list-row"><span class="row-main"><span class="row-sub">Nessun esercizio: aggiungine uno.</span></span></div>';
    }
    return t.exercises.map((e, i) => `
      <button class="list-row" data-i="${i}">
        <span class="row-icon num">${i + 1}</span>
        <span class="row-main">
          <span class="row-title">${esc(e.name)}</span>
          <span class="row-sub num">${esc(targetText(e))}${restText(e) ? ` · rec. ${esc(restText(e))}` : ''}${e.superset ? ' · superserie' : ''}</span>
        </span>
        <span class="row-trail">${icon('chevron-right')}</span>
      </button>`).join('');
  };

  const s = openSheet({
    title: isCardio ? t.name : `Scheda ${t.code}`,
    tall: true,
    html: `
      <label class="field">
        <span class="field-label">Nome</span>
        <input class="input" data-name value="${esc(t.name)}" maxlength="40" autocomplete="off" enterkeyhint="done">
      </label>
      ${isCardio ? `
        <label class="field">
          <span class="field-label">Programma <span class="opt">· una riga per voce, "- " per gli elenchi</span></span>
          <textarea class="input" data-notes rows="12" style="min-height:260px">${esc(t.notes)}</textarea>
        </label>
        <div class="sheet-actions"><button class="btn btn-primary btn-block" data-save-notes>${icon('check')} Salva</button></div>
      ` : `
        <div class="field-label">Esercizi</div>
        <div class="list">
          <div data-rows>${exerciseRows()}</div>
          <button class="meal-add" data-add>${icon('plus')} Aggiungi esercizio</button>
        </div>
        <p class="footnote">Tocca un esercizio per cambiare serie e ripetizioni, spostarlo o toglierlo.</p>
      `}`,
    onClose: onChange,
  });

  const refreshRows = () => {
    const el = $('[data-rows]', s.body);
    if (el) el.innerHTML = exerciseRows();
    onChange?.();
  };

  // Nome: salvato quando si esce dal campo
  $('[data-name]', s.body).addEventListener('change', async (e) => {
    const name = e.target.value.trim();
    if (!name) { e.target.value = t.name; return; }
    t.name = name;
    await saveTemplate(t);
    onChange?.();
  });

  if (isCardio) {
    $('[data-save-notes]', s.body).addEventListener('click', async () => {
      t.notes = $('[data-notes]', s.body).value;
      const name = $('[data-name]', s.body).value.trim();
      if (name) t.name = name;
      await saveTemplate(t);
      s.close();
      toast('Scheda salvata');
    });
    return;
  }

  s.body.addEventListener('click', async (e) => {
    if (e.target.closest('[data-add]')) {
      const ex = await pickExercise({ title: `Aggiungi a scheda ${t.code}` });
      if (!ex) return;
      t.exercises.push({ exerciseId: ex.id, name: ex.name, sets: 3, repMin: 8, repMax: 10, unit: '' });
      await saveTemplate(t);
      refreshRows();
      editTemplateExercise(t, t.exercises.length - 1, refreshRows);
      return;
    }
    const row = e.target.closest('[data-i]');
    if (row) editTemplateExercise(t, Number(row.dataset.i), refreshRows);
  });
}

/** Foglio per serie, ripetizioni e lato di un esercizio della scheda. */
function editTemplateExercise(t, i, onChange) {
  const ex = t.exercises[i];
  const draft = {
    sets: ex.sets, repMin: ex.repMin, repMax: ex.repMax, unit: ex.unit || '',
    rest: ex.rest || 75, bodyweight: Boolean(ex.bodyweight), max: Boolean(ex.max),
  };
  const next = t.exercises[i + 1];
  const inSuperset = Boolean(ex.superset && next && next.superset === ex.superset);
  const switchRow = (key, label, sub, on) => `
    <label class="switch-row">
      <span class="row-main"><span class="row-title">${label}</span><span class="row-sub">${sub}</span></span>
      <input type="checkbox" class="switch" data-sw="${key}" ${on ? 'checked' : ''}>
    </label>`;

  const stepperField = (key, label) => `
    <label class="field">
      <span class="field-label">${label}</span>
      <div class="stepper" data-k="${key}" style="height:48px">
        <button data-d="-1" aria-label="Diminuisci">${icon('minus')}</button>
        <input type="text" inputmode="numeric" value="${draft[key]}" autocomplete="off">
        <button data-d="1" aria-label="Aumenta">${icon('plus')}</button>
      </div>
    </label>`;

  const s = openSheet({
    title: ex.name,
    html: `
      ${stepperField('sets', 'Serie')}
      <div class="grid-2">
        ${stepperField('repMin', 'Ripetizioni minime')}
        ${stepperField('repMax', 'Ripetizioni massime')}
      </div>
      <div class="field">
        <span class="field-label">Ripetizioni</span>
        <div class="seg" data-unit>
          <button data-value="" class="${draft.unit === '' ? 'active' : ''}">Normali</button>
          <button data-value="g" class="${draft.unit === 'g' ? 'active' : ''}">Per gamba</button>
          <button data-value="b" class="${draft.unit === 'b' ? 'active' : ''}">Per braccio</button>
        </div>
      </div>
      <label class="field">
        <span class="field-label">Recupero (secondi)</span>
        <div class="stepper" data-k="rest" style="height:48px">
          <button data-d="-15" aria-label="Diminuisci">${icon('minus')}</button>
          <input type="text" inputmode="numeric" value="${draft.rest}" autocomplete="off">
          <button data-d="15" aria-label="Aumenta">${icon('plus')}</button>
        </div>
      </label>
      <label class="field">
        <span class="field-label">Carico di partenza <span class="opt">· facoltativo</span></span>
        <input class="input" data-start value="${esc(ex.start || '')}" maxlength="40" placeholder="Es. 12 kg" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">Nota <span class="opt">· facoltativa</span></span>
        <textarea class="input" data-note rows="2" maxlength="200" placeholder="Es. discesa lenta">${esc(ex.note || '')}</textarea>
      </label>
      <div class="list switch-list" style="margin-bottom:var(--s-3)">
        ${switchRow('bodyweight', 'Corpo libero', 'Kg facoltativi: vuoto = corpo libero', draft.bodyweight)}
        ${switchRow('max', 'Ripetizioni al massimo', 'Obiettivo "max", es. max (6–10)', draft.max)}
        ${next ? switchRow('superset', 'Superserie con il successivo', `Alterna le serie con ${esc(next.name)}; recupero dopo la coppia`, inSuperset) : ''}
      </div>
      <p class="footnote" data-preview style="margin-top:0"></p>
      <div class="sheet-actions">
        <button class="btn btn-primary btn-block" data-save>${icon('check')} Salva</button>
        <div class="grid-2">
          <button class="btn btn-secondary" data-move="-1" ${i === 0 ? 'disabled' : ''}>${icon('arrow-up')} Su</button>
          <button class="btn btn-secondary" data-move="1" ${i === t.exercises.length - 1 ? 'disabled' : ''}>${icon('arrow-down')} Giù</button>
        </div>
        <button class="btn btn-danger btn-block" data-remove>${icon('trash-2')} Togli dalla scheda</button>
      </div>`,
  });

  const body = s.body;
  const input = (k) => $(`[data-k="${k}"] input`, body);
  const preview = () => { $('[data-preview]', body).textContent = `Anteprima: ${targetText(draft)}`; };
  const clamp = () => {
    draft.sets = Math.min(10, Math.max(1, draft.sets || 1));
    draft.repMin = Math.min(100, Math.max(1, draft.repMin || 1));
    draft.repMax = Math.min(100, Math.max(1, draft.repMax || 1));
    draft.rest = Math.min(600, Math.max(15, draft.rest || 15));
  };
  const sync = (changed) => {
    clamp();
    // Il massimo non può essere più basso del minimo (e viceversa)
    if (draft.repMax < draft.repMin) {
      if (changed === 'repMax') draft.repMin = draft.repMax; else draft.repMax = draft.repMin;
    }
    ['sets', 'repMin', 'repMax', 'rest'].forEach((k) => { if (k !== changed || document.activeElement !== input(k)) input(k).value = draft[k]; });
    preview();
  };

  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const k = b.closest('[data-k]').dataset.k;
    draft[k] = (draft[k] || 0) + Number(b.dataset.d);
    haptic(5);
    sync(k);
  });
  body.addEventListener('input', (e) => {
    const st = e.target.closest('[data-k]');
    if (!st) return;
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n)) { draft[st.dataset.k] = n; preview(); }
  });
  body.addEventListener('focusout', (e) => {
    const st = e.target.closest('[data-k]');
    if (st) sync(st.dataset.k === 'repMax' ? 'repMax' : 'repMin');
  });
  initSeg($('[data-unit]', body), (v) => { draft.unit = v; preview(); });
  preview();

  body.addEventListener('change', (e) => {
    const sw = e.target.dataset?.sw;
    if (sw === 'bodyweight' || sw === 'max') { draft[sw] = e.target.checked; preview(); }
  });

  $('[data-save]', body).addEventListener('click', async () => {
    sync();
    // Il recupero scritto a mano sostituisce il testo della scheda (es. "2-3'")
    if (draft.rest !== (ex.rest || 75)) ex.restLabel = '';
    Object.assign(ex, draft);
    ex.start = $('[data-start]', body).value.trim();
    const kg = parseFloat(ex.start.replace(',', '.'));
    ex.startKg = Number.isFinite(kg) ? kg : null;
    ex.note = $('[data-note]', body).value.trim();
    const ss = $('[data-sw="superset"]', body);
    if (ss) {
      if (ss.checked) {
        const id = ex.superset || next.superset || `ss-${Date.now().toString(36)}`;
        ex.superset = id;
        next.superset = id;
      } else if (inSuperset) {
        ex.superset = '';
        next.superset = '';
      }
    }
    await saveTemplate(t);
    s.close();
    onChange();
    toast('Esercizio aggiornato');
  });

  body.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', async () => {
    const to = i + Number(b.dataset.move);
    if (to < 0 || to >= t.exercises.length) return;
    [t.exercises[i], t.exercises[to]] = [t.exercises[to], t.exercises[i]];
    await saveTemplate(t);
    s.close();
    onChange();
  }));

  $('[data-remove]', body).addEventListener('click', async () => {
    s.close();
    const ok = await confirmSheet({
      title: `Togliere «${ex.name}»?`,
      message: `L'esercizio non comparirà più nella scheda ${t.code}. Lo storico resta invariato.`,
      confirmLabel: 'Togli',
      danger: true,
    });
    if (!ok) return;
    t.exercises.splice(i, 1);
    await saveTemplate(t);
    onChange();
  });
}
