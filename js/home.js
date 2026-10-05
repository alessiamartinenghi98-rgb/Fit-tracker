/* ==========================================================================
   home.js — Pagina Home (riepilogo all'avvio)
   --------------------------------------------------------------------------
   - Obiettivo settimanale: 4 allenamenti (schede A, B, C, D), con anello
   - Schede fatte questa settimana (completate evidenziate, mancanti in grigio)
   - Allenamenti del mese corrente
   - Cardio del sabato, a parte: non conta nell'obiettivo
   - Pulsante grande "Inizia allenamento" (o "Riprendi" se ce n'è uno in corso)
   ========================================================================== */

import * as db from './db.js';
import {
  $, esc, icon, todayISO, startOfWeek, addDays, formatFullDate, formatShortDate, formatDay,
} from './ui.js';
import { strengthTemplates, cardioTemplate } from './templates.js';
import {
  openStartSheet, resumeActive, startTemplate, openCardioSheet, activeBanner, suggestedTemplate,
  isActive, isCardio,
} from './workouts.js';

const WEEKLY_GOAL = 4;

export function initHome() {
  $('#home-content').addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'start') return openStartSheet();
    if (action === 'resume') return resumeActive();
    if (action === 'cardio') {
      const t = cardioTemplate();
      if (t) openCardioSheet(t);
      return;
    }
    const tile = e.target.closest('[data-template]');
    if (tile) startTemplate(tile.dataset.template);
  });
}

export async function renderHome() {
  const workouts = await db.getAll('workouts');
  const today = todayISO();
  const weekFrom = startOfWeek(today);
  const weekTo = addDays(weekFrom, 6);
  const monthFrom = today.slice(0, 8) + '01';

  const finished = workouts.filter((w) => !isActive(w));
  const inWeek = (w) => w.date >= weekFrom && w.date <= weekTo;
  const strength = finished.filter((w) => !isCardio(w) && (w.exercises || []).length > 0);

  const weekCount = strength.filter(inWeek).length;
  const monthCount = strength.filter((w) => w.date >= monthFrom && w.date <= today).length;
  const monthCardio = finished.filter((w) => isCardio(w) && w.date >= monthFrom).length;
  const doneIds = new Set(strength.filter(inWeek).map((w) => w.templateId).filter(Boolean));
  const cardioWeek = finished.filter((w) => isCardio(w) && inWeek(w)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const active = workouts.find(isActive);
  const next = suggestedTemplate();

  // Titolo: data di oggi
  const sub = formatFullDate(today);
  $('#home-date').textContent = sub.charAt(0).toUpperCase() + sub.slice(1);

  const left = Math.max(0, WEEKLY_GOAL - weekCount);
  const goalText = left === 0
    ? 'Obiettivo raggiunto, ottimo lavoro!'
    : `${left === 1 ? 'Manca 1 allenamento' : `Mancano ${left} allenamenti`}`;

  const tiles = strengthTemplates().map((t) => {
    const done = doneIds.has(t.id);
    const running = active && active.templateId === t.id;
    return `
      <button class="week-tile ${done ? 'done' : ''} ${running ? 'running' : ''}" data-template="${t.id}"
              aria-label="Scheda ${esc(t.code)}: ${done ? 'fatta' : 'da fare'}">
        <span class="wt-badge">${done ? icon('check') : esc(t.code)}</span>
        <span class="wt-name">${esc(t.name)}</span>
      </button>`;
  }).join('');

  const cta = active
    ? `<button class="btn btn-primary btn-block btn-hero" data-action="resume">${icon('play')} Riprendi allenamento</button>`
    : `<button class="btn btn-primary btn-block btn-hero" data-action="start">${icon('play')} Inizia allenamento</button>
       ${next ? `<p class="hero-note">Consigliata: <b>${esc(next.code)} · ${esc(next.name)}</b></p>` : ''}`;

  $('#home-content').innerHTML = `
    ${active ? activeBanner(active) : ''}

    <div class="card goal-card">
      <div class="goal-top">
        ${ring(weekCount, WEEKLY_GOAL)}
        <div class="goal-text">
          <div class="kpi-label">Obiettivo settimanale</div>
          <div class="goal-big num">${weekCount} <span>di ${WEEKLY_GOAL} allenamenti</span></div>
          <div class="kcal-sub">${goalText}</div>
          <div class="goal-range">${esc(formatShortDate(weekFrom))} – ${esc(formatShortDate(weekTo))}</div>
        </div>
      </div>
      <div class="week-tiles">${tiles}</div>
    </div>

    <div class="home-cta">${cta}</div>

    <div class="kpi-grid" style="margin-top:var(--s-5)">
      <div class="card kpi">
        <div class="kpi-label">Questo mese</div>
        <div class="kpi-value num">${monthCount}</div>
        <div class="kpi-delta">${monthCount === 1 ? 'allenamento' : 'allenamenti'}${monthCardio ? ` · ${monthCardio} cardio` : ''}</div>
      </div>
      <button class="card card-tap kpi cardio-kpi ${cardioWeek ? 'done' : ''}" data-action="cardio">
        <div class="kpi-label">Cardio sabato</div>
        <div class="cardio-state">${icon(cardioWeek ? 'circle-check' : 'heart-pulse')}</div>
        <div class="kpi-delta">${cardioWeek ? `Fatto ${esc(formatDay(cardioWeek.date).toLowerCase())}` : 'Facoltativo'}</div>
        <div class="cardio-note">Non conta nell'obiettivo</div>
      </button>
    </div>
`;
}

/** Anello di avanzamento (SVG). */
function ring(value, goal) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, value / goal);
  return `
    <div class="ring" role="img" aria-label="${value} allenamenti su ${goal}">
      <svg viewBox="0 0 112 112" width="112" height="112">
        <circle cx="56" cy="56" r="${r}" class="ring-track"/>
        <circle cx="56" cy="56" r="${r}" class="ring-value"
                style="stroke-dasharray:${c.toFixed(1)};stroke-dashoffset:${(c * (1 - pct)).toFixed(1)};--c:${c.toFixed(1)}"/>
      </svg>
      <div class="ring-label num"><b>${value}</b><span>/${goal}</span></div>
    </div>`;
}
