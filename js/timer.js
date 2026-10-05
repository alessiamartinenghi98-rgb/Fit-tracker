/* ==========================================================================
   timer.js — Timer di recupero tra le serie
   --------------------------------------------------------------------------
   Parte quando si completa una serie (se attivo). Barra in basso con conto
   alla rovescia, ±15 secondi e "Salta". Il tempo è calcolato dall'orario di
   fine, quindi resta preciso anche se il telefono mette l'app in pausa.
   A fine recupero: breve segnale acustico e vibrazione (dove supportata).
   ========================================================================== */

import * as db from './db.js';
import { icon } from './ui.js';

let enabled = true;
let endAt = 0;
let total = 0;
let intervalId = null;
let bar = null;
let audioCtx = null;
let hideTimer = null;

export async function loadTimerSetting() {
  enabled = await db.getMeta('restTimer', true);
}

export const isTimerEnabled = () => enabled;

export function setTimerEnabled(value) {
  enabled = value;
  db.setMeta('restTimer', value);
  if (!value) stopRest();
}

/** "1:30" */
function mmss(ms) {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'rest-bar';
  bar.setAttribute('role', 'timer');
  bar.innerHTML = `
    <div class="rest-fill"></div>
    <div class="rest-main">
      <span class="rest-label">${icon('timer')}<span data-label>Recupero</span></span>
      <span class="rest-time num" data-time>0:00</span>
    </div>
    <button class="rest-btn num" data-rest="-15" aria-label="Meno 15 secondi">−15</button>
    <button class="rest-btn num" data-rest="15" aria-label="Più 15 secondi">+15</button>
    <button class="rest-btn rest-skip" data-rest="skip">Salta</button>`;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rest]');
    if (!b) return;
    if (b.dataset.rest === 'skip') return stopRest();
    const delta = Number(b.dataset.rest) * 1000;
    endAt = Math.max(Date.now() + 1000, endAt + delta);
    total = Math.max(total, endAt - Date.now());
    tick();
  });
  document.body.append(bar);
  return bar;
}

/** Avvia (o riavvia) il recupero per il numero di secondi indicato. */
export function startRest(seconds) {
  if (!enabled) return;
  unlockAudio();
  ensureBar();
  clearTimeout(hideTimer);
  total = seconds * 1000;
  endAt = Date.now() + total;
  bar.classList.remove('ended');
  bar.querySelector('[data-label]').textContent = 'Recupero';
  bar.classList.add('show');
  clearInterval(intervalId);
  intervalId = setInterval(tick, 250);
  tick();
}

export function stopRest() {
  clearInterval(intervalId);
  intervalId = null;
  clearTimeout(hideTimer);
  if (bar) bar.classList.remove('show', 'ended');
}

function tick() {
  if (!bar) return;
  const left = Math.max(0, endAt - Date.now());
  bar.querySelector('[data-time]').textContent = mmss(left);
  bar.querySelector('.rest-fill').style.transform = `scaleX(${total ? left / total : 0})`;
  if (left <= 0 && intervalId) finish();
}

function finish() {
  clearInterval(intervalId);
  intervalId = null;
  bar.classList.add('ended');
  bar.querySelector('[data-label]').textContent = 'Recupero finito';
  beep();
  if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
  hideTimer = setTimeout(() => bar.classList.remove('show', 'ended'), 4000);
}

/* --- Segnale acustico ---------------------------------------------------- */

// iOS permette l'audio solo dopo un tocco: l'audio viene "sbloccato" quando si
// completa una serie (che è appunto un tocco).
function unlockAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* audio non disponibile */ }
}

function beep() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [0, 0.22].forEach((offset) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.18);
    });
  } catch { /* ignora */ }
}
