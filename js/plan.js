/* ==========================================================================
   plan.js — Piano alimentare e regole di calcolo della dieta
   --------------------------------------------------------------------------
   - Piano preimpostato (lunedì → domenica) modificabile dall'app
   - Categorie di pranzo e cena con i limiti settimanali
   - Stato della giornata: pulita / sgarro / non registrata
   Il piano modificato è salvato in meta "dietPlan"; il diario dei pasti
   nell'archivio "dietDays" (una voce per giorno).
   ========================================================================== */

import * as db from './db.js';
import { parseISO, addDays } from './ui.js';

/* Categorie nell'ordine dei contatori settimanali */
export const CATEGORIES = [
  { id: 'carne', label: 'Carne', counter: 'Carne' },
  { id: 'uova', label: 'Uova', counter: 'Uova' },
  { id: 'pesce', label: 'Pesce', counter: 'Pesce' },
  { id: 'legumi', label: 'Legumi', counter: 'Legumi' },
  { id: 'latticino', label: 'Latticino', counter: 'Latticini' },
  { id: 'libero', label: 'Pasto libero', counter: 'Pasto libero' },
];
export const categoryLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || '';
export const counterLabel = (id) => CATEGORIES.find((c) => c.id === id)?.counter || '';

/* I quattro pasti della giornata: pranzo e cena hanno la categoria */
export const SLOTS = [
  { id: 'colazione', label: 'Colazione', icon: 'coffee' },
  { id: 'spuntino', label: 'Spuntino', icon: 'apple' },
  { id: 'pranzo', label: 'Pranzo', icon: 'sun', main: true },
  { id: 'cena', label: 'Cena', icon: 'moon', main: true },
];

export const WEEKDAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];

/* --- Opzioni di colazione e spuntino --------------------------------------
   "Altro" è sempre disponibile in fondo alla lista e non si può togliere. */

export const OTHER_OPTION = { id: 'altro', label: 'Altro' };

const DEFAULT_OPTIONS = {
  colazione: [
    { id: 'caffe-bresaola', label: 'Caffè + 2 gallette + bresaola' },
    { id: 'caffe-uova', label: 'Caffè + 2 gallette + uova' },
    { id: 'yogurt-greco', label: 'Yogurt greco + eritritolo + frutti rossi' },
    { id: 'ricotta', label: 'Ricotta + 2 gallette + frutti rossi' },
  ],
  spuntino: [
    { id: 'yogurt-verdura', label: 'Yogurt bianco + verdura (carote o finocchi)' },
    { id: 'frutta-verdura', label: '100 g frutta + verdura (carote o finocchi)' },
    { id: 'verdura', label: 'Solo verdura (finocchi e carote)' },
  ],
};

/* Opzione prevista dal piano per ogni giorno (lunedì → domenica) */
const DEFAULT_DAY_OPTIONS = [
  { colazione: 'caffe-bresaola', spuntino: 'yogurt-verdura' },
  { colazione: 'yogurt-greco', spuntino: 'frutta-verdura' },
  { colazione: 'yogurt-greco', spuntino: 'frutta-verdura' },
  { colazione: 'caffe-bresaola', spuntino: 'yogurt-verdura' },
  { colazione: 'ricotta', spuntino: 'verdura' },
  { colazione: 'ricotta', spuntino: 'frutta-verdura' },
  { colazione: 'caffe-uova', spuntino: 'yogurt-verdura' },
];

/* --- Piano preimpostato -------------------------------------------------- */

const main = (category, carbo, text) => ({ category, carbo, text });

export const DEFAULT_PLAN = {
  version: 1,
  days: [
    { // Lunedì
      colazione: 'Caffè senza zucchero o dolcificato + 2 gallette + bresaola',
      spuntino: 'Yogurt bianco + carote',
      pranzo: main('carne', true, 'Carne + verdura + carbo (es. riso, pollo, finocchi)'),
      cena: main('uova', false, 'Uova + verdura (es. frittata con spinaci e zucchine, pane di lino)'),
    },
    { // Martedì
      colazione: 'Yogurt greco + eritritolo + 50 g frutti rossi',
      spuntino: '100 g frutta + finocchi',
      pranzo: main('latticino', true, 'Latticino + verdura + carbo (es. pane, primo sale, carote, zucchine)'),
      cena: main('pesce', false, 'Pesce + verdura (es. branzino, carote, pomodorini, pane di lino)'),
    },
    { // Mercoledì
      colazione: 'Yogurt greco + eritritolo + 50 g frutti rossi',
      spuntino: '100 g frutta + carote',
      pranzo: main('legumi', true, 'Legumi + verdura + carbo (es. pane, hamburger di ceci, verdure)'),
      cena: main('uova', false, 'Uova + verdura (es. uova strapazzate, fagiolini, pomodori)'),
    },
    { // Giovedì
      colazione: 'Caffè + 2 gallette + bresaola',
      spuntino: 'Yogurt bianco + finocchi',
      pranzo: main('carne', true, 'Carne + verdura + carbo (es. riso, pollo, finocchi)'),
      cena: main('uova', false, 'Uova + verdura (es. insalata con uova sode, cracker di semi)'),
    },
    { // Venerdì
      colazione: 'Ricotta + 2 gallette + 100 g frutti rossi',
      spuntino: 'Finocchi + carote',
      pranzo: main('latticino', true, 'Latticino + verdura + carbo (es. patate o pane, mozzarella)'),
      cena: main('carne', false, 'Carne + verdura (es. carpaccio, spinaci, zucchine)'),
    },
    { // Sabato
      colazione: 'Ricotta + 2 gallette + 50 g frutti rossi',
      spuntino: '100 g frutta + finocchi',
      pranzo: main('pesce', false, 'Pesce + verdura (es. insalatona con tonno, cracker di semi)'),
      cena: main('libero', false, 'Pasto libero'),
    },
    { // Domenica
      colazione: 'Caffè + 2 gallette + uova',
      spuntino: 'Yogurt bianco + finocchi',
      pranzo: main('legumi', false, 'Legumi + verdura (es. piselli con verdure, cracker di semi)'),
      cena: main('pesce', true, 'Pesce + verdura + carbo (es. pasta con salmone e zucchine)'),
    },
  ],
  options: DEFAULT_OPTIONS,
  targets: { carne: 3, uova: 3, pesce: 3, legumi: 2, latticino: 2, libero: 1 },
  carbPortions: [
    'Pane 50 g',
    'Pasta o riso 70 g',
    'Primo fresco 120 g',
    'Gallette o cracker 30 g',
    'Patate 250 g',
  ].join('\n'),
  rules: [
    '1 cucchiaio di olio EVO a crudo a pranzo e a cena',
    'No soffritti',
    'No bibite e alcolici (massimo 1 bicchiere a settimana, con il pasto libero)',
    'No salse',
    'No parmigiano sulla pasta',
    'No dolci (sì stevia o eritritolo)',
    'Frutta secca da evitare',
    'Verdure libere a ogni pasto',
  ].join('\n'),
};

// Ogni giorno del piano preimpostato ha l'opzione prevista per colazione e spuntino
DEFAULT_PLAN.days.forEach((d, i) => { d.options = { ...DEFAULT_DAY_OPTIONS[i] }; });

/* --- Lettura e salvataggio del piano ------------------------------------- */

let plan = structuredClone(DEFAULT_PLAN);

export async function loadPlan() {
  const saved = await db.getMeta('dietPlan');
  plan = saved && Array.isArray(saved.days) && saved.days.length === 7 ? saved : structuredClone(DEFAULT_PLAN);
  plan.targets = { ...DEFAULT_PLAN.targets, ...(plan.targets || {}) };
  // Piani salvati prima delle opzioni di colazione e spuntino: si completano da soli
  if (!plan.options) plan.options = structuredClone(DEFAULT_OPTIONS);
  for (const slot of ['colazione', 'spuntino']) {
    if (!Array.isArray(plan.options[slot])) plan.options[slot] = structuredClone(DEFAULT_OPTIONS[slot]);
  }
  plan.days.forEach((d, i) => {
    if (!d.options) d.options = { ...DEFAULT_DAY_OPTIONS[i] };
  });
  return plan;
}

export const getPlan = () => plan;

export async function savePlan(next = plan) {
  plan = next;
  await db.setMeta('dietPlan', plan);
}

/** 0 = lunedì … 6 = domenica */
export function weekdayIndex(iso) {
  return (parseISO(iso).getDay() + 6) % 7;
}

export const planForDate = (iso) => plan.days[weekdayIndex(iso)];

/** Opzioni di colazione o spuntino, con "Altro" in fondo. */
export function slotOptions(slotId) {
  return [...(plan.options?.[slotId] || []), OTHER_OPTION];
}

/** Opzione prevista dal piano per quel giorno (se esiste ancora). */
export function plannedOption(iso, slotId) {
  const id = planForDate(iso).options?.[slotId];
  return slotOptions(slotId).find((o) => o.id === id) || null;
}

/** Testo breve di un pasto segnato, es. "Uova + carbo" o "Ricotta + 2 gallette…". */
export function mealLabel(meal) {
  if (!meal) return '';
  if (isCheatMeal(meal) && !meal.category && !meal.option) return 'Sgarro';
  if (meal.category) return `${categoryLabel(meal.category)}${meal.carbo ? ' + carbo' : ''}`;
  if (meal.option) return meal.optionLabel || OTHER_OPTION.label;
  return 'Come da piano';
}

/* --- Calcoli ------------------------------------------------------------- */

/** Il pasto libero non conta mai come sgarro. */
export function isCheatMeal(meal) {
  return Boolean(meal && meal.cheat && meal.category !== 'libero');
}

/** 'clean' (pulita), 'cheat' (sgarro) oppure 'empty' (nessun pasto segnato). */
export function dayStatus(day) {
  const meals = Object.values(day?.meals || {}).filter(Boolean);
  if (meals.length === 0) return 'empty';
  return meals.some(isCheatMeal) ? 'cheat' : 'clean';
}

/** Quante volte è stato segnato il carbo nella giornata. */
export function carbCount(day) {
  return Object.values(day?.meals || {}).filter((m) => m && m.carbo).length;
}

/** Conteggio delle categorie di pranzo e cena in un insieme di giorni. */
export function categoryCounts(days) {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  for (const d of days) {
    for (const slot of ['pranzo', 'cena']) {
      const meal = d?.meals?.[slot];
      // Un pasto segnato come sgarro non conta nelle categorie
      if (!meal || isCheatMeal(meal)) continue;
      if (meal.category && meal.category in counts) counts[meal.category]++;
    }
  }
  return counts;
}

/** Le 7 date (lunedì → domenica) della settimana che inizia da weekStart. */
export function weekDates(weekStart) {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}
