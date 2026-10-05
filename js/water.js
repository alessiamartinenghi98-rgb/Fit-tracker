/* ==========================================================================
   water.js — Contatore dell'acqua
   --------------------------------------------------------------------------
   Un valore in millilitri per ogni giorno, nell'archivio "water".
   Obiettivo: 2 litri al giorno.
   ========================================================================== */

import * as db from './db.js';

export const WATER_GOAL = 2000; // ml al giorno
export const WATER_STEP = 250;  // ml per ogni tocco

export async function getWater(date) {
  const row = await db.get('water', date);
  return row ? row.ml : 0;
}

/**
 * Imposta il valore del giorno (0 elimina la voce).
 * notify = false quando chi chiama aggiorna già la pagina da solo.
 */
export async function setWater(date, ml, { notify = true } = {}) {
  const value = Math.max(0, Math.min(10000, Math.round(ml || 0)));
  if (value === 0) await db.del('water', date);
  else await db.put('water', { date, ml: value, updatedAt: Date.now() });
  if (notify) document.dispatchEvent(new CustomEvent('data-changed'));
  return value;
}

export async function addWater(date, delta, options) {
  return setWater(date, (await getWater(date)) + delta, options);
}

/** 1250 → "1,25" (litri) */
export function liters(ml) {
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(ml / 1000);
}
