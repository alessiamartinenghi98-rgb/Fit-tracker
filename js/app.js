/* ==========================================================================
   app.js — Avvio dell'app
   --------------------------------------------------------------------------
   - Registra il service worker (uso offline)
   - Chiede l'archiviazione persistente
   - Avvia le sezioni (Home, Allenamenti, Dieta, Progressi) e la barra delle schede
   ========================================================================== */

import { openDB, requestPersistence } from './db.js';
import { $, $$, hydrateIcons, bindScrollHeader, haptic, toast } from './ui.js';
import { initWorkouts, refreshWorkouts } from './workouts.js';
import { initDiet, refreshDiet, showDietDate } from './diet.js';
import { initProgress, renderProgress } from './progress.js';
import { initHome, renderHome } from './home.js';

/* --- Comportamento da app nativa ---------------------------------------- */

// iOS ignora user-scalable=no in alcuni casi: blocchiamo anche il pinch-zoom
// (lo zoom col doppio tocco è già disattivato da "touch-action: manipulation" nel CSS,
// così i tocchi rapidi sui pulsanti +/- restano veloci)
document.addEventListener('gesturestart', (e) => e.preventDefault());

/* --- Navigazione tra le schede ------------------------------------------ */

let currentView = 'home';

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
  if (name === 'home') renderHome();
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

  initHome();
  await Promise.all([
    initWorkouts(),
    initDiet(),
  ]);
  await renderHome();
  initProgress({
    // Dopo un'importazione aggiorna tutte le sezioni
    onImported: async () => {
      await Promise.all([refreshWorkouts(), refreshDiet()]);
      await renderHome();
    },
  });

  // Quando un allenamento cambia (iniziato, terminato, eliminato) la Home si aggiorna
  document.addEventListener('data-changed', () => {
    if (currentView === 'home') renderHome();
  });

  // Dal calendario della Home: "Apri nella Dieta" porta al giorno scelto
  document.addEventListener('open-diet', async (e) => {
    await showDietDate(e.detail);
    showView('diet');
  });

  // Archiviazione persistente: il browser non cancellerà i dati se manca spazio
  requestPersistence();
}

/* --- Service worker ------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  // Quando arriva una nuova versione dell'app (dopo un aggiornamento su GitHub)
  // la pagina si ricarica una volta da sola. I dati sono già tutti salvati.
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.warn('Service worker non registrato:', err);
    });
  });
}

start();
