/* ==========================================================================
   blocks.js — Blocchi di allenamento (es. "Blocco 1", "Blocco 2")
   --------------------------------------------------------------------------
   Un blocco è un periodo con le sue schede. Ogni blocco inizia in una data e
   finisce il giorno prima dell'inizio del blocco successivo.
   Salvati in meta "blocks": [{ id, name, start, weeks }]
   - weeks: durata in settimane (null = senza durata fissa)
   - l'ultima settimana di un blocco con durata è di scarico (una serie in meno)
   Le schede del blocco precedente sono archiviate in meta "blockTemplates"
   ({ [blockId]: [schede] }), così il report sa cosa prevedeva ogni blocco.
   ========================================================================== */

import * as db from './db.js';
import { todayISO, addDays, startOfWeek, parseISO, formatShortDate } from './ui.js';

let blocks = [];
let archived = {};

export async function loadBlocks() {
  blocks = ((await db.getMeta('blocks', [])) || []).slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  archived = (await db.getMeta('blockTemplates', {})) || {};
  return blocks;
}

export const getBlocks = () => blocks;
export const archivedTemplates = (blockId) => archived[blockId] || null;

/** Blocco in cui cade una data (null se prima del primo blocco o senza blocchi). */
export function blockForDate(iso) {
  let found = null;
  for (const b of blocks) if (b.start <= iso) found = b;
  return found;
}

export const currentBlock = () => blockForDate(todayISO());

/** Ultimo giorno del blocco (null se è il blocco in corso, senza fine). */
export function blockEnd(b) {
  const i = blocks.findIndex((x) => x.id === b.id);
  const next = blocks[i + 1];
  return next ? addDays(next.start, -1) : null;
}

/** Numero della settimana del blocco (1 = la settimana in cui inizia). */
export function blockWeek(b, iso = todayISO()) {
  if (!b) return null;
  const days = Math.round((parseISO(startOfWeek(iso)) - parseISO(startOfWeek(b.start))) / 86400000);
  return Math.floor(days / 7) + 1;
}

/** Settimana di scarico: l'ultima del blocco. */
export const isDeloadWeek = (b, week) => Boolean(b && b.weeks && week === b.weeks);

/** "Blocco 1 · 5 ott – 16 nov" */
export function blockLabel(b) {
  const end = blockEnd(b);
  return `${b.name} · ${formatShortDate(b.start)}${end ? ` – ${formatShortDate(end)}` : ''}`;
}

/** Cambia la data di inizio di un blocco (non prima del blocco precedente). */
export async function setBlockStart(id, start) {
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 0) return false;
  const prev = blocks[i - 1];
  const next = blocks[i + 1];
  if (prev && start <= prev.start) return false;
  if (next && start >= next.start) return false;
  blocks[i] = { ...blocks[i], start };
  await db.setMeta('blocks', blocks);
  document.dispatchEvent(new CustomEvent('blocks-changed'));
  return true;
}

/** Salva blocchi e schede archiviate (usato dall'aggiornamento al nuovo blocco). */
export async function saveBlocks(list, templatesByBlock = archived) {
  blocks = list.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  archived = templatesByBlock;
  await db.setMeta('blocks', blocks);
  await db.setMeta('blockTemplates', archived);
}
