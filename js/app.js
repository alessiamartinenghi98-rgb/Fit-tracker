/* ==========================================================================
   app.js — Avvio dell'app
   --------------------------------------------------------------------------
   - Registra il service worker (uso offline)
   - Chiede l'archiviazione persistente
   - Avvia le tre sezioni e gestisce la barra delle schede
   ========================================================================== */

import { openDB, requestPersistence } from './db.js';
import { $, $$, hydrateIcons, bindScrollHeader, haptic, toast } from './ui.js';
import { initWorkouts, refreshWorkouts } from './workouts.js';
import { initDiet, refreshDiet } from './diet.js';
import { initProgress, renderProgress } from './progress.js';

/* --- Comportamento da app nativa ---------------------------------------- */

// iOS ignora user-scalable=no in alcuni casi: blocchiamo anche il pinch-zoom
// (lo zoom col doppio tocco è già disattivato da "touch-action: manipulation" nel CSS,
// così i tocchi rapidi sui pulsanti +/- restano veloci)
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* --- Navigazione tra le schede ------------------------------------------ */

let currentView = 'workouts';

function showView(name) {
  if (name === currentView) {
    // Toccare di nuovo la scheda attiva riporta in cima, come su iOS
    $(`#view-${name}`).scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  currentView = name;
  haptic(5);
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => {
    const active = t.dataset.view === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-current', active ? 'page' : 'false');
  });
  // I grafici vanno disegnati quando la scheda è visibile (servono le dimensioni)
  if (name === 'progress') renderProgress();
}

/* --- Avvio --------------------------------------------------------------- */

async function start() {
  hydrateIcons();

  $$('.tab').forEach((t) => t.addEventListener('click', () => showView(t.dataset.view)));
  $$('.view').forEach(bindScrollHeader);

  try {
    await openDB();
  } catch (err) {
    console.error(err);
    toast('Impossibile aprire il database locale', { error: true });
    return;
  }

  await Promise.all([
    initWorkouts(),
    initDiet(),
  ]);
  initProgress({
    // Dopo un'importazione aggiorna tutte le sezioni
    onImported: () => Promise.all([refreshWorkouts(), refreshDiet()]),
  });

  // Archiviazione persistente: il browser non cancellerà i dati se manca spazio
  requestPersistence();
}

/* --- Service worker ------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker non registrato:', err);
    });
  });
}

start();
