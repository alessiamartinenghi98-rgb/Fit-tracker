/* ==========================================================================
   treadmill.js — Tapis roulant dopo l'allenamento
   --------------------------------------------------------------------------
   Card con interruttore "Fatto": da spenta è una riga compatta con i valori
   dell'ultima volta, da accesa mostra minuti, velocità e pendenza con +/-.
   I dati stanno nel campo "treadmill" dell'allenamento:
   { done, minutes, speed, incline }  (incline facoltativa)
   ========================================================================== */

import { esc, icon, haptic, fmtNum, parseNum } from './ui.js';

const FIRST_MINUTES = 20;

const FIELDS = [
  { key: 'minutes', label: 'Minuti', unit: 'min', step: 1, min: 1, max: 300, mode: 'numeric' },
  { key: 'speed', label: 'Velocità', unit: 'km/h', step: 0.1, min: 0, max: 25, mode: 'decimal' },
  { key: 'incline', label: 'Pendenza', unit: '%', step: 0.5, min: 0, max: 20, mode: 'decimal', optional: true },
];

/** Tapis roulant fatto (con almeno un minuto). */
export const hasTreadmill = (w) => Boolean(w && w.treadmill && w.treadmill.done && w.treadmill.minutes > 0);

/** Ultimo tapis roulant fatto, escludendo un allenamento (quello aperto). */
export function lastTreadmill(workouts, excludeId = null) {
  const list = workouts
    .filter((w) => w.id !== excludeId && w.status !== 'active' && hasTreadmill(w))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : (b.createdAt || 0) - (a.createdAt || 0)));
  return list[0] ? { ...list[0].treadmill, date: list[0].date } : null;
}

/** Valori iniziali: quelli dell'ultima volta (la prima volta 20 minuti). */
export function defaultTreadmill(last) {
  return {
    done: false,
    minutes: last?.minutes ?? FIRST_MINUTES,
    speed: last?.speed ?? null,
    incline: last?.incline ?? null,
  };
}

/** "25 min · 6 km/h · 2%" */
export function treadmillText(tm) {
  if (!tm) return '';
  const parts = [`${tm.minutes} min`];
  if (tm.speed) parts.push(`${fmtNum(tm.speed)} km/h`);
  if (tm.incline) parts.push(`${fmtNum(tm.incline)}%`);
  return parts.join(' · ');
}

/** Miglioramento rispetto all'ultima volta, es. "+5 minuti · +0,5 km/h". */
function deltaText(tm, last) {
  if (!last) return { text: 'Prima volta: sarà il tuo riferimento', up: false };
  const round = (n) => Math.round(n * 10) / 10;
  const parts = [];
  const sign = (n) => (n > 0 ? '+' : '−');
  const dMin = round((tm.minutes || 0) - (last.minutes || 0));
  const dSpeed = round((tm.speed || 0) - (last.speed || 0));
  const dInc = round((tm.incline || 0) - (last.incline || 0));
  if (dMin) parts.push(`${sign(dMin)}${fmtNum(Math.abs(dMin))} ${Math.abs(dMin) === 1 ? 'minuto' : 'minuti'}`);
  if (dSpeed && tm.speed) parts.push(`${sign(dSpeed)}${fmtNum(Math.abs(dSpeed))} km/h`);
  if (dInc && tm.incline !== null) parts.push(`${sign(dInc)}${fmtNum(Math.abs(dInc))}% pendenza`);
  if (!parts.length) return { text: 'Come l\'ultima volta', up: false };
  const up = dMin >= 0 && dSpeed >= 0 && dInc >= 0;
  return { text: `${parts.join(' · ')} rispetto all'ultima volta`, up };
}

function cardHTML(tm, last) {
  const lastLine = last ? `Ultima volta: ${treadmillText(last)}` : 'Prima volta: 20 minuti';
  let body = '';
  if (tm.done) {
    const d = deltaText(tm, last);
    body = `
      <div class="tm-grid">
        ${FIELDS.map((f) => `
          <div class="tm-box">
            <span class="tm-label">${f.label}${f.optional ? ' <span class="opt">· facolt.</span>' : ''}</span>
            <span class="tm-value">
              <input class="tm-input num" data-tm-field="${f.key}" type="text" inputmode="${f.mode}"
                     value="${tm[f.key] === null || tm[f.key] === undefined ? '' : fmtNum(tm[f.key])}" placeholder="–" autocomplete="off">
              <small>${f.unit}</small>
            </span>
            <span class="tm-btns">
              <button data-tm-step="${f.key}" data-dir="-1" aria-label="Diminuisci ${f.label.toLowerCase()}">${icon('minus')}</button>
              <button data-tm-step="${f.key}" data-dir="1" aria-label="Aumenta ${f.label.toLowerCase()}">${icon('plus')}</button>
            </span>
          </div>`).join('')}
      </div>
      <div class="tm-delta ${d.up ? 'up' : ''}">${icon(d.up ? 'trending-up' : 'history')}<span data-tm-delta>${esc(d.text)}</span></div>`;
  }
  return `
    <div class="tm-head">
      <span class="tm-icon">${icon('footprints')}</span>
      <span class="row-main">
        <span class="tm-title">Tapis roulant</span>
        <span class="tm-sub">${esc(lastLine)}</span>
      </span>
      <label class="tm-switch">
        <span>Fatto</span>
        <input type="checkbox" class="switch tm" data-tm-done ${tm.done ? 'checked' : ''} aria-label="Tapis roulant fatto">
      </label>
    </div>
    ${body}`;
}

/**
 * Inserisce la card nel contenitore e gestisce interruttore, +/- e digitazione.
 * value viene modificato direttamente; onChange(value) avvisa chi deve salvare.
 */
export function mountTreadmill(container, { value, last, onChange = () => {} }) {
  container.classList.add('card', 'tm-card');
  const render = () => {
    container.classList.toggle('on', Boolean(value.done));
    container.innerHTML = cardHTML(value, last);
  };
  const refreshDelta = () => {
    const row = container.querySelector('.tm-delta');
    if (!row) return;
    const d = deltaText(value, last);
    row.classList.toggle('up', d.up);
    row.innerHTML = `${icon(d.up ? 'trending-up' : 'history')}<span data-tm-delta>${esc(d.text)}</span>`;
  };
  render();

  container.addEventListener('change', (e) => {
    if (!e.target.matches('[data-tm-done]')) return;
    value.done = e.target.checked;
    if (value.done && !value.minutes) value.minutes = last?.minutes ?? FIRST_MINUTES;
    haptic(value.done ? 15 : 5);
    render();
    onChange(value);
  });

  container.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tm-step]');
    if (!b) return;
    e.preventDefault();
    const f = FIELDS.find((x) => x.key === b.dataset.tmStep);
    const current = value[f.key] ?? (f.key === 'speed' ? 5 : 0);
    const next = Math.round((current + f.step * Number(b.dataset.dir)) * 10) / 10;
    value[f.key] = Math.min(f.max, Math.max(f.min, next));
    container.querySelector(`[data-tm-field="${f.key}"]`).value = fmtNum(value[f.key]);
    haptic(5);
    refreshDelta();
    onChange(value);
  });

  container.addEventListener('input', (e) => {
    const key = e.target.dataset?.tmField;
    if (!key) return;
    const f = FIELDS.find((x) => x.key === key);
    const n = parseNum(e.target.value);
    value[key] = n === null ? (f.optional || key === 'speed' ? null : value[key]) : Math.min(f.max, Math.max(f.min, n));
    if (key === 'minutes' && n !== null) value.minutes = Math.round(value.minutes);
    refreshDelta();
    onChange(value);
  });

  container.addEventListener('focusin', (e) => {
    if (e.target.matches('.tm-input')) {
      const el = e.target;
      setTimeout(() => el.setSelectionRange(0, el.value.length), 0);
    }
  });
}

/** Copia pulita da salvare nell'allenamento (null se non fatto). */
export function treadmillToSave(value) {
  if (!value || !value.done || !(value.minutes > 0)) return null;
  return { done: true, minutes: value.minutes, speed: value.speed ?? null, incline: value.incline ?? null };
}
