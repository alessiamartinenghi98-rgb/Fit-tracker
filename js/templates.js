/* ==========================================================================
   templates.js — Schede di allenamento
   --------------------------------------------------------------------------
   - Schede preimpostate A, B, C, D e cardio del sabato (create una sola volta)
   - Testi di supporto: "4 × 6–8 per gamba"
   - Modifica dall'app: nome, esercizi, serie, ripetizioni, lato (gamba/braccio)
   Le schede sono salvate nell'archivio "templates" di IndexedDB.
   ========================================================================== */

import * as db from './db.js';
import { $, esc, icon, toast, haptic, openSheet, confirmSheet, initSeg } from './ui.js';
import { pickExercise } from './workouts.js';

/* --- Schede preimpostate --------------------------------------------------
   Ogni esercizio: [nome, serie, rip. minime, rip. massime, lato]
   lato: '' = normale, 'g' = per gamba, 'b' = per braccio                    */
const SEED = [
  {
    id: 'tpl-a', code: 'A', name: 'Glutei A', kind: 'strength',
    exercises: [
      ['Hip thrust', 4, 6, 8, ''],
      ['Stacchi rumeni manubri', 3, 8, 10, ''],
      ['Affondi bulgari', 3, 8, 8, 'g'],
      ['Kickback cavo', 3, 10, 12, 'g'],
      ['Abductor busto avanti', 3, 12, 12, ''],
      ['Calf in piedi', 2, 12, 12, ''],
    ],
  },
  {
    id: 'tpl-b', code: 'B', name: 'Schiena + bicipiti', kind: 'strength',
    exercises: [
      ['Lat prona larga', 4, 8, 10, ''],
      ['Rematore manubrio', 3, 8, 10, 'b'],
      ['Pulley triangolo', 3, 10, 10, ''],
      ['Lat singola maniglia', 3, 10, 10, 'b'],
      ['Reverse fly', 3, 12, 12, ''],
      ['Curl panca inclinata', 3, 10, 10, ''],
      ['Curl cavo basso', 2, 12, 12, ''],
    ],
  },
  {
    id: 'tpl-c', code: 'C', name: 'Glutei B + femorali', kind: 'strength',
    exercises: [
      ['Stacchi rumeni multipower', 4, 6, 8, ''],
      ['Step up busto avanti', 3, 8, 8, 'g'],
      ['Iperestensioni 45°', 3, 10, 12, ''],
      ['Leg curl seduto', 3, 10, 10, ''],
      ['Slanci laterali cavo', 3, 12, 12, 'g'],
      ['Calf in piedi', 2, 12, 12, ''],
    ],
  },
  {
    id: 'tpl-d', code: 'D', name: 'Spalle + braccia', kind: 'strength',
    exercises: [
      ['Shoulder press 75°', 3, 8, 10, ''],
      ['Alzate laterali', 4, 10, 12, ''],
      ['Laterali su fianco 45°', 2, 12, 12, 'b'],
      ['Chest press', 3, 8, 10, ''],
      ['Face pull corda', 3, 12, 12, ''],
      ['Pushdown corda', 3, 10, 12, ''],
      ['French press cavo', 3, 10, 10, ''],
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
      '',
      'Circuito · 3 giri, 40" lavoro / 20" pausa',
      '- Kettlebell swing',
      '- Battle rope',
      '- Farmer walk',
      '- Plank tocco spalla',
    ].join('\n'),
  },
];

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
  return `${t.sets} × ${repRange(t.repMin, t.repMax)}${unit ? ` ${unit}` : ''}`;
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
      exercises: (s.exercises || []).map(([name, sets, repMin, repMax, unit]) => {
        const e = ensure(name);
        return { exerciseId: e.id, name: e.name, sets, repMin, repMax, unit };
      }),
    }));

    if (created.length) await db.putMany('exercises', created);
    await db.putMany('templates', list);
  }
  await db.setMeta('templatesSeeded', true);
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
          <span class="row-sub num">${esc(targetText(e))}</span>
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
  const draft = { sets: ex.sets, repMin: ex.repMin, repMax: ex.repMax, unit: ex.unit || '' };

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
  };
  const sync = (changed) => {
    clamp();
    // Il massimo non può essere più basso del minimo (e viceversa)
    if (draft.repMax < draft.repMin) {
      if (changed === 'repMax') draft.repMin = draft.repMax; else draft.repMax = draft.repMin;
    }
    ['sets', 'repMin', 'repMax'].forEach((k) => { if (k !== changed || document.activeElement !== input(k)) input(k).value = draft[k]; });
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

  $('[data-save]', body).addEventListener('click', async () => {
    sync();
    Object.assign(ex, draft);
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
