/* ==========================================================================
   weekplan.js — Settimana organizzata della dieta
   --------------------------------------------------------------------------
   Ogni settimana (dal lunedì) ha 7 giorni con 3 caselle:
     colazione: { block: id opzione colazione, note }
     pranzo/cena: { block: categoria, carbo, note }
   Salvate in meta "weekPlans": { "AAAA-MM-GG" (lunedì): { days: [...] } }.
   Una settimana non ancora organizzata parte dallo schema base della dieta.
   ========================================================================== */

import * as db from './db.js';
import { CATEGORIES, getPlan, slotOptions } from './plan.js';

const KEY = 'weekPlans';
let plans = {};

export const MAIN_SLOTS = ['pranzo', 'cena'];
export const GRID_SLOTS = ['colazione', 'pranzo', 'cena'];
export const isMainSlot = (slot) => MAIN_SLOTS.includes(slot);

/** Nomi brevi dei blocchi della colazione (per le caselle piccole). */
const BREAKFAST_SHORT = {
  'caffe-bresaola': 'Bresaola',
  'caffe-uova': 'Uova',
  'yogurt-greco': 'Yogurt greco',
  ricotta: 'Ricotta',
};

export async function loadWeekPlans() {
  plans = (await db.getMeta(KEY, {})) || {};
  return plans;
}

/** Opzioni della colazione (senza "Altro"). */
export const breakfastOptions = () => slotOptions('colazione').filter((o) => o.id !== 'altro');

/** Nome breve di un blocco: "Pesce", "Bresaola"… */
export function blockLabel(slot, block) {
  if (!block) return '';
  if (isMainSlot(slot)) return CATEGORIES.find((c) => c.id === block)?.label || block;
  if (BREAKFAST_SHORT[block]) return BREAKFAST_SHORT[block];
  const opt = breakfastOptions().find((o) => o.id === block);
  return opt ? opt.label.split('+')[0].trim() : 'Colazione';
}

/** Descrizione completa della colazione, es. "Caffè + 2 gallette + bresaola". */
export const breakfastText = (block) => breakfastOptions().find((o) => o.id === block)?.label || '';

/** Settimana dallo schema base della dieta (giorno per giorno). */
export function baseWeek() {
  return getPlan().days.map((d) => ({
    colazione: { block: d.options?.colazione || null, note: '' },
    pranzo: { block: d.pranzo.category || null, carbo: Boolean(d.pranzo.carbo), note: '' },
    cena: { block: d.cena.category || null, carbo: Boolean(d.cena.carbo), note: '' },
  }));
}

export const hasWeek = (weekStart) => Boolean(plans[weekStart]);

/** Copia della settimana (salvata oppure dallo schema base). */
export function getWeek(weekStart) {
  const saved = plans[weekStart];
  return structuredClone(saved ? saved.days : baseWeek());
}

export async function saveWeek(weekStart, days) {
  plans[weekStart] = { days: structuredClone(days), updatedAt: Date.now() };
  await db.setMeta(KEY, plans);
}

/** Obiettivi della settimana: categorie del piano e colazioni dello schema base. */
export function targets(group) {
  if (group === 'main') return { ...getPlan().targets };
  const counts = {};
  getPlan().days.forEach((d) => {
    const id = d.options?.colazione;
    if (id) counts[id] = (counts[id] || 0) + 1;
  });
  breakfastOptions().forEach((o) => { if (!(o.id in counts)) counts[o.id] = 0; });
  return counts;
}

/** Quante volte ogni blocco è già nel calendario. */
export function used(days, group) {
  const counts = {};
  const slots = group === 'main' ? MAIN_SLOTS : ['colazione'];
  days.forEach((d) => slots.forEach((s) => {
    const b = d[s]?.block;
    if (b) counts[b] = (counts[b] || 0) + 1;
  }));
  return counts;
}

/** Carbo segnati in un giorno della settimana. */
export const carbsOfDay = (day) => MAIN_SLOTS.filter((s) => day[s]?.carbo).length;

/**
 * Pasto invertito: oggi era previsto `planned`, hai mangiato `ate`.
 * Cerca un'altra casella della settimana con `ate` (prima i giorni successivi,
 * poi gli altri non ancora segnati) per scambiarla. Restituisce { day, slot } o null.
 */
export function findSwap(days, dayIdx, slot, ate, isLogged = () => false) {
  const slots = isMainSlot(slot) ? MAIN_SLOTS : ['colazione'];
  const candidates = [];
  days.forEach((d, i) => slots.forEach((s) => {
    if (i === dayIdx && s === slot) return;
    if (d[s]?.block !== ate || isLogged(i, s)) return;
    candidates.push({ day: i, slot: s });
  }));
  candidates.sort((a, b) => {
    const fa = a.day > dayIdx ? 0 : 1;
    const fb = b.day > dayIdx ? 0 : 1;
    return fa - fb || a.day - b.day || MAIN_SLOTS.indexOf(a.slot) - MAIN_SLOTS.indexOf(b.slot);
  });
  return candidates[0] || null;
}

/**
 * Scambia il contenuto (blocco e testo) di due caselle; il carbo resta
 * legato al pasto, come deciso nel calendario.
 */
export function swapCells(days, a, b) {
  const ca = days[a.day][a.slot];
  const cb = days[b.day][b.slot];
  [ca.block, cb.block] = [cb.block, ca.block];
  [ca.note, cb.note] = [cb.note || '', ca.note || ''];
}

/** Tutte le settimane organizzate (per il backup). */
export const allWeekPlans = () => plans;
