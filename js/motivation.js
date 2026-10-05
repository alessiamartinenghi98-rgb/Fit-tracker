/* ==========================================================================
   motivation.js — Messaggi motivazionali e festeggiamenti
   --------------------------------------------------------------------------
   - Frase del giorno nella Home, scelta in base a come stai andando
   - Riepilogo positivo della settimana appena finita (il lunedì)
   - Festeggiamenti a comparsa subito dopo un traguardo, con coriandoli
     lime discreti e vibrazione leggera (dove supportata)
   - Dopo uno sgarro solo incoraggiamento, mai rimproveri
   Solo dentro l'app: nessuna notifica push.
   I traguardi già festeggiati sono ricordati in meta "celebrated",
   così ogni traguardo si festeggia una volta sola.
   ========================================================================== */

import * as db from './db.js';
import { esc, icon, todayISO, addDays, startOfWeek } from './ui.js';
import { dayStatus, categoryCounts, getPlan, CATEGORIES, isCheatMeal } from './plan.js';
import { WATER_GOAL } from './water.js';
import {
  completedSets, isStrength, isPartial, isExtra, isActive, suggestedTemplate, workoutStats,
} from './workouts.js';
import { hasTreadmill } from './treadmill.js';
import { getTemplate } from './templates.js';

const WEEKLY_GOAL = 4;
const MEALS_PER_DAY = 4;
const CLEAN_STREAKS = [3, 5, 7, 14, 30];
const TOTAL_MILESTONES = [1, 10, 25, 50, 100];

/* ==========================================================================
   Frasi (tante per ogni situazione, così non si ripetono spesso)
   Le funzioni ricevono i valori da inserire nel testo.
   ========================================================================== */

const pl = (n, one, many) => (n === 1 ? one : many);

const PHRASES = {
  /* --- Frase del giorno --------------------------------------------------- */
  general: [
    'Un passo alla volta, ogni giorno.',
    'La costanza batte l\'intensità.',
    'Oggi conta quello che fai oggi.',
    'Piccole scelte ripetute fanno la differenza.',
    'Ogni serie segnata è un mattone in più.',
    'Non serve la perfezione, serve continuità.',
    'Inizia da una cosa sola: un bicchiere d\'acqua, una serie, un pasto.',
    'Le abitudini si costruiscono nei giorni normali.',
    'Il progresso è lento finché non lo vedi tutto insieme.',
    'Fai la tua parte oggi, il resto si accumula da sé.',
    'Ascolta il corpo e dagli quello che serve.',
    'Bevi, mangia secondo il piano, muoviti: è già tanto.',
    'Non devi fare tutto oggi, solo la prossima cosa giusta.',
    'Quello che ripeti diventa quello che sei.',
  ],
  restart: [
    'Una giornata non cancella i progressi. Si riparte dal prossimo pasto.',
    'Capita. Il prossimo pasto è già un nuovo inizio.',
    'Un pasto fuori piano non decide la settimana.',
    'Conta la direzione, non il singolo giorno.',
    'Si riparte con calma, senza fretta e senza colpe.',
    'Ieri è ieri. Oggi si torna al piano.',
    'Il percorso è fatto di tante giornate: questa è solo una.',
    'Nessun problema: riprendi dal prossimo pasto.',
    'La costanza si misura sul lungo periodo, non su un pasto.',
    'Un passo di lato, poi di nuovo avanti.',
  ],
  missing: [
    ({ left, code }) => (left === 1
      ? `Manca un solo allenamento: la scheda ${code} chiude la settimana.`
      : `Mancano ${left} allenamenti, la scheda ${code} ti aspetta.`),
    ({ left, code }) => `Ancora ${left} ${pl(left, 'allenamento', 'allenamenti')} per chiudere la settimana. Prossima: scheda ${code}.`,
    ({ code }) => `La scheda ${code} è pronta quando lo sei tu.`,
    ({ left }) => `${left} ${pl(left, 'allenamento', 'allenamenti')} al traguardo della settimana. Un passo alla volta.`,
    ({ code }) => `Oggi potrebbe essere il giorno della scheda ${code}.`,
    ({ left, code }) => `Ne ${pl(left, 'manca uno', `mancano ${left}`)}: si comincia dalla scheda ${code}.`,
    ({ code }) => `Scheda ${code} in programma. Anche una sessione breve conta.`,
  ],
  weekDone: [
    '4 su 4 questa settimana. Costanza vera.',
    'Settimana già completa: quello che arriva ora è un extra.',
    'Obiettivo settimanale raggiunto, puoi recuperare con calma.',
    'Quattro allenamenti fatti. Goditi il risultato.',
    'Settimana chiusa sull\'obiettivo. Ora riposo e acqua.',
    'Il piano della settimana è compiuto.',
  ],
  cleanStreak: [
    ({ n }) => `${n} giorni puliti di fila, stai costruendo un'abitudine.`,
    ({ n }) => `Serie pulita in corso: ${n} giorni.`,
    ({ n }) => `${n} giorni di fila secondo il piano. Si sente la differenza.`,
    ({ n }) => `${n} giorni senza sgarri. Continua così.`,
    ({ n }) => `${n} giorni puliti consecutivi: è diventato normale.`,
  ],
  waterStreak: [
    ({ n }) => `${n} giorni di fila con 2 litri d'acqua. Ottima abitudine.`,
    ({ n }) => `Acqua: ${n} giorni consecutivi sull'obiettivo.`,
    ({ n }) => `${n} giorni di fila a 2 litri. Il corpo ringrazia.`,
    ({ n }) => `Idratazione costante da ${n} giorni.`,
  ],
  ringsDone: [
    'Tutti gli anelli chiusi oggi. Bella giornata.',
    'Acqua, pasti e allenamento: tutto fatto.',
    'Oggi non manca niente.',
    'Giornata piena, anelli chiusi.',
    'Tre anelli completi. Così si costruisce.',
  ],

  /* --- Festeggiamenti (titoli) ------------------------------------------- */
  goal4: [
    '4 su 4 questa settimana. Costanza vera',
    'Obiettivo settimanale centrato',
    'Quattro allenamenti, settimana completa',
    'Settimana chiusa: 4 su 4',
    'Quarto allenamento fatto: obiettivo raggiunto',
    'Il piano della settimana è compiuto',
  ],
  weeksStreak: [
    ({ n }) => `${n} settimane di fila con 4 allenamenti`,
    ({ n }) => `${n} settimane consecutive a 4 su 4`,
    ({ n }) => `Serie aperta: ${n} settimane sull'obiettivo`,
    ({ n }) => `${n} settimane piene di fila. Questo è metodo`,
    ({ n }) => `Costanza che si accumula: ${n} settimane di fila`,
  ],
  weeksStreakTail: [
    'È diventata un\'abitudine.',
    'La costanza sta pagando.',
    'Settimana dopo settimana.',
    'Continua con lo stesso ritmo.',
  ],
  templateDone: [
    ({ code }) => `Scheda ${code} completata`,
    ({ name }) => `${name}: tutte le serie fatte`,
    ({ code }) => `Scheda ${code} chiusa fino all'ultima serie`,
    ({ code }) => `Scheda ${code} portata a termine`,
    ({ code }) => `Tutto fatto, scheda ${code} completa`,
  ],
  recordsTitle: [
    'Nuovo record',
    'Progressi misurabili',
    'Hai alzato l\'asticella',
    'Record superato',
    'Oggi sei andata oltre',
  ],
  recordTail: [
    'Si vede il lavoro.',
    'La forza sta crescendo.',
    'Bel passo avanti.',
    'Ottimo segnale.',
    'I progressi sono reali.',
    'Avanti così.',
  ],
  increaseTail: [
    'Hai seguito il consiglio e ha funzionato.',
    'Aumento fatto, come suggerito.',
    'Consiglio messo in pratica.',
    'Peso aumentato al momento giusto.',
  ],
  rings: [
    'Tutti gli anelli chiusi',
    'Giornata completa',
    'Acqua, pasti e allenamento: fatto',
    'Anelli chiusi oggi',
    'Niente da aggiungere: giornata piena',
  ],
  ringsTail: [
    'Così si costruisce, un giorno alla volta.',
    'Una giornata fatta bene.',
    'Te la sei guadagnata.',
    'Domani si riparte da qui.',
  ],
  cleanStreakTitle: [
    ({ n }) => `${n} giorni puliti di fila`,
    ({ n }) => `Serie pulita: ${n} giorni`,
    ({ n }) => `${n} giorni di fila secondo il piano`,
    ({ n }) => `${n} giorni senza sgarri`,
  ],
  cleanStreakTail: [
    'Stai costruendo un\'abitudine.',
    'Si sente la differenza.',
    'Continua così, un pasto alla volta.',
    'Il piano sta diventando naturale.',
  ],
  cleanWeek: [
    'Frequenze rispettate',
    'Settimana in equilibrio',
    'Piano rispettato in ogni categoria',
    'Tutte le categorie come da piano',
  ],
  cleanWeekTail: [
    'Carne, pesce, uova, legumi, latticini: tutto nei numeri giusti.',
    'Esattamente come previsto dal piano.',
    'Varietà ed equilibrio, settimana perfetta.',
  ],
  water: [
    '2 litri raggiunti',
    'Obiettivo acqua centrato',
    'Idratazione completa',
    'Acqua: obiettivo raggiunto',
    '2 litri fatti',
  ],
  waterTail: [
    'Il corpo ringrazia.',
    'Ottima abitudine.',
    'Un obiettivo semplice, fatto bene.',
    'Continua a bere con regolarità.',
  ],
  waterStreakTitle: [
    ({ n }) => `${n} giorni di fila con 2 litri`,
    ({ n }) => `Acqua: ${n} giorni consecutivi`,
    ({ n }) => `${n} giorni di fila sull'obiettivo acqua`,
  ],
  treadmill: [
    'Record di tapis roulant',
    'Nuovo record sul tapis roulant',
    'Tapis roulant: hai superato il tuo massimo',
  ],
  restartTitle: [
    'Si riparte',
    'Nessun problema',
    'Va bene così',
    'Un pasto non è la settimana',
  ],
  totals: {
    1: ['Primo allenamento registrato. Si comincia', 'Il primo è fatto: è quello che conta di più'],
    10: ['10 allenamenti', 'Dieci allenamenti registrati'],
    25: ['25 allenamenti', 'Venticinque allenamenti: la costanza si vede'],
    50: ['50 allenamenti', 'Cinquanta allenamenti registrati'],
    100: ['100 allenamenti', 'Cento allenamenti. Un traguardo vero'],
  },
  totalsTail: {
    1: ['Da qui si costruisce tutto il resto.', 'Il passo più difficile è alle spalle.'],
    10: ['Le basi ci sono.', 'È l\'inizio di un\'abitudine.'],
    25: ['La costanza si vede.', 'Ormai fa parte della tua settimana.'],
    50: ['Cinquanta volte hai scelto di esserci.', 'Un percorso vero.'],
    100: ['Cento volte hai scelto di esserci.', 'Costanza rara. Complimenti.'],
  },

  /* --- Riepilogo del lunedì ---------------------------------------------- */
  recapGreat: [
    'Settimana piena. Si riparte con la stessa energia.',
    'Ottima settimana: si riparte da qui.',
    'Una settimana di cui essere soddisfatta.',
    'La settimana scorsa è stata solida. Avanti così.',
  ],
  recapGood: [
    'Ogni allenamento fatto conta. Nuova settimana, nuove occasioni.',
    'Una buona base da cui ripartire.',
    'Hai messo dei mattoni: questa settimana se ne aggiungono altri.',
    'Passi avanti fatti. Si continua con calma.',
  ],
  recapFresh: [
    'Settimana nuova, foglio bianco. Si comincia dal primo passo.',
    'Nuova settimana: basta iniziare.',
    'Si riparte, con calma e con costanza.',
    'Ogni lunedì è una buona occasione per ricominciare.',
  ],
};

/* --- Scelta delle frasi -------------------------------------------------- */

/** Hash semplice di una stringa (per scegliere la frase del giorno). */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const render = (item, vars = {}) => (typeof item === 'function' ? item(vars) : item);
/** Frase casuale (festeggiamenti: ogni volta diversa). */
const pick = (list, vars) => render(list[Math.floor(Math.random() * list.length)], vars);
/** Frase stabile per tutta la giornata (frase del giorno). */
const pickDaily = (list, seed, vars) => render(list[hash(seed) % list.length], vars);

/* ==========================================================================
   Dati e calcoli
   ========================================================================== */

async function loadAll() {
  const [workouts, water, diet] = await Promise.all([
    db.getAll('workouts'), db.getAll('water'), db.getAll('dietDays'),
  ]);
  return {
    workouts: workouts.filter((w) => !isActive(w)),
    water: new Map(water.map((w) => [w.date, w.ml])),
    diet: new Map(diet.map((d) => [d.date, d])),
  };
}

const isClean = (d, date) => dayStatus(d.diet.get(date)) === 'clean';
const waterOk = (d, date) => (d.water.get(date) || 0) >= WATER_GOAL;

/** Giorni consecutivi (fino a "date" compreso) che soddisfano la condizione. */
function streak(test, date, max = 400) {
  let n = 0;
  let day = date;
  while (n < max && test(day)) { n++; day = addDays(day, -1); }
  return n;
}

const strengthIn = (d, from, to) => d.workouts.filter((w) => isStrength(w) && w.date >= from && w.date <= to);

/** Settimane di fila (questa compresa) con almeno 4 allenamenti. */
function weeksInARow(d) {
  let n = 0;
  let from = startOfWeek(todayISO());
  while (strengthIn(d, from, addDays(from, 6)).length >= WEEKLY_GOAL) { n++; from = addDays(from, -7); }
  return n;
}

/** Tutti e tre gli anelli completi in un giorno. */
function ringsComplete(d, date) {
  const day = d.diet.get(date);
  const meals = Object.values(day?.meals || {}).filter(Boolean).length;
  const ws = d.workouts.filter((w) => w.date === date);
  const gymFull = ws.some((w) => (isStrength(w) && !isPartial(w)) || isExtra(w));
  return waterOk(d, date) && meals >= MEALS_PER_DAY && dayStatus(day) === 'clean' && gymFull;
}

/* --- Traguardi già festeggiati ------------------------------------------ */

let celebratedCache = null;

async function celebrated() {
  if (!celebratedCache) celebratedCache = new Set(await db.getMeta('celebrated', []));
  return celebratedCache;
}

/** true se il traguardo è nuovo (e lo segna come festeggiato). */
async function firstTime(key) {
  const set = await celebrated();
  if (set.has(key)) return false;
  set.add(key);
  await db.setMeta('celebrated', [...set].slice(-600));
  return true;
}

/* ==========================================================================
   Frase del giorno e riepilogo del lunedì (Home)
   ========================================================================== */

/** Frase del giorno: cambia ogni giorno e in base a come stai andando. */
export async function dailyMessage() {
  const d = await loadAll();
  const today = todayISO();
  const yesterday = addDays(today, -1);

  // Dopo uno sgarro: solo incoraggiamento a ripartire
  const statusToday = dayStatus(d.diet.get(today));
  const statusYesterday = dayStatus(d.diet.get(yesterday));
  if (statusToday === 'cheat' || (statusYesterday === 'cheat' && statusToday !== 'clean')) {
    return { kind: 'restart', text: pickDaily(PHRASES.restart, `${today}restart`) };
  }

  const options = [];
  const weekFrom = startOfWeek(today);
  const weekCount = strengthIn(d, weekFrom, addDays(weekFrom, 6)).length;
  if (ringsComplete(d, today)) options.push(['ringsDone', {}]);
  if (weekCount >= WEEKLY_GOAL) options.push(['weekDone', {}]);
  else {
    const next = suggestedTemplate();
    if (next) options.push(['missing', { left: WEEKLY_GOAL - weekCount, code: next.code }]);
  }
  const cleanRun = streak((day) => isClean(d, day), isClean(d, today) ? today : yesterday);
  if (cleanRun >= 2) options.push(['cleanStreak', { n: cleanRun }]);
  const waterRun = streak((day) => waterOk(d, day), waterOk(d, today) ? today : yesterday);
  if (waterRun >= 2) options.push(['waterStreak', { n: waterRun }]);
  options.push(['general', {}]);

  const [kind, vars] = options[hash(`${today}kind`) % options.length];
  return { kind, text: pickDaily(PHRASES[kind], `${today}${kind}`, vars) };
}

/** Riepilogo positivo della settimana appena finita (solo il lunedì). */
export async function mondayRecap() {
  const today = todayISO();
  if (new Date().getDay() !== 1) return null;
  const from = addDays(startOfWeek(today), -7);
  if ((await db.getMeta('recapDismissed')) === from) return null;
  const to = addDays(from, 6);
  const d = await loadAll();

  const workouts = strengthIn(d, from, to).length;
  const extras = d.workouts.filter((w) => isExtra(w) && w.date >= from && w.date <= to).length;
  let clean = 0;
  let waterDays = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isClean(d, day)) clean++;
    if (waterOk(d, day)) waterDays++;
  }
  const tmMin = d.workouts.filter((w) => w.date >= from && w.date <= to && hasTreadmill(w))
    .reduce((s, w) => s + w.treadmill.minutes, 0);

  // Solo i dati positivi: niente elenco di cose mancanti
  const lines = [];
  if (workouts) lines.push(`${workouts} ${pl(workouts, 'allenamento', 'allenamenti')}${workouts >= WEEKLY_GOAL ? ' · obiettivo raggiunto' : ''}`);
  if (extras) lines.push(`${extras} ${pl(extras, 'allenamento extra', 'allenamenti extra')} (cardio o libero)`);
  if (clean) lines.push(`${clean} ${pl(clean, 'giorno pulito', 'giorni puliti')}`);
  if (waterDays) lines.push(`${waterDays} ${pl(waterDays, 'giorno', 'giorni')} con 2 litri d'acqua`);
  if (tmMin) lines.push(`${tmMin} minuti di tapis roulant`);

  const tone = workouts >= WEEKLY_GOAL ? 'recapGreat' : lines.length ? 'recapGood' : 'recapFresh';
  return { weekFrom: from, lines, text: pickDaily(PHRASES[tone], `${from}recap`) };
}

export async function dismissRecap(weekFrom) {
  await db.setMeta('recapDismissed', weekFrom);
}

/* ==========================================================================
   Festeggiamenti
   ========================================================================== */

const queue = [];
let showing = false;

/**
 * Mostra un festeggiamento a comparsa.
 * c = { icon, title, lines: [], soft } — soft: senza coriandoli (es. dopo uno sgarro)
 */
export function celebrate(c) {
  queue.push(c);
  if (!showing) showNext();
}

function showNext() {
  const c = queue.shift();
  if (!c) { showing = false; return; }
  showing = true;

  const el = document.createElement('div');
  el.className = `celebrate ${c.soft ? 'soft' : ''}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="cel-card">
      <div class="cel-icon">${icon(c.icon || 'trophy')}</div>
      <div class="cel-text">
        <div class="cel-title">${esc(c.title)}</div>
        ${(c.lines || []).map((l) => `<div class="cel-line">${esc(l)}</div>`).join('')}
      </div>
    </div>`;
  document.body.append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));

  if (!c.soft) {
    confetti();
    if (navigator.vibrate) navigator.vibrate([18, 40, 18]);
  }

  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    el.classList.remove('show');
    setTimeout(() => { el.remove(); showNext(); }, 400);
  };
  el.addEventListener('click', close);
  setTimeout(close, 3600 + (c.lines || []).length * 900);
}

/** Coriandoli lime discreti (disattivati con "Riduci movimento"). */
function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div');
  box.className = 'confetti';
  const shades = ['#c6f432', '#d8ff5c', '#a8d420', '#eaff9e'];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement('i');
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = shades[i % shades.length];
    p.style.animationDelay = `${Math.random() * 0.35}s`;
    p.style.animationDuration = `${1.6 + Math.random() * 1.2}s`;
    p.style.setProperty('--x', `${(Math.random() - 0.5) * 160}px`);
    p.style.setProperty('--r', `${(Math.random() - 0.5) * 720}deg`);
    if (i % 3 === 0) p.style.borderRadius = '50%';
    box.append(p);
  }
  document.body.append(box);
  setTimeout(() => box.remove(), 3400);
}

/* ==========================================================================
   Controlli dopo ogni azione
   ========================================================================== */

const kg = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(n);

/** Record e consigli seguiti in un allenamento con i pesi. */
function exerciseRecords(w, others) {
  const lines = [];
  for (const entry of w.exercises || []) {
    const sets = completedSets(entry);
    if (!sets.length) continue;
    const top = Math.max(...sets.map((s) => s.weight || 0));
    const topReps = Math.max(...sets.filter((s) => (s.weight || 0) === top).map((s) => s.reps));

    // Sessioni precedenti dello stesso esercizio
    const prev = others
      .filter((o) => o.date <= w.date)
      .map((o) => ({ o, e: (o.exercises || []).find((e) => e.exerciseId === entry.exerciseId) }))
      .filter((x) => x.e && completedSets(x.e).length)
      .sort((a, b) => (a.o.date !== b.o.date ? (a.o.date < b.o.date ? 1 : -1) : (b.o.createdAt || 0) - (a.o.createdAt || 0)));
    if (!prev.length) continue;

    const prevSets = prev.flatMap((x) => completedSets(x.e));
    const prevMax = Math.max(...prevSets.map((s) => s.weight || 0));
    const lastTop = Math.max(...completedSets(prev[0].e).map((s) => s.weight || 0));
    const name = entry.name;

    if (top > prevMax) {
      const diff = top - lastTop;
      lines.push(`${name}: ${kg(top)} kg, nuovo record${diff > 0 ? `. +${kg(diff)} kg rispetto all'ultima volta` : ''}. ${pick(PHRASES.recordTail)}`);
    } else if (top === prevMax && top > 0) {
      const prevReps = Math.max(...prevSets.filter((s) => (s.weight || 0) === prevMax).map((s) => s.reps));
      if (topReps > prevReps) {
        const d = topReps - prevReps;
        lines.push(`${name}: ${topReps} ripetizioni con ${kg(top)} kg, ${d} in più della volta prima. ${pick(PHRASES.recordTail)}`);
      }
    }
    // "Aumenta il peso" seguito davvero
    if (entry.increaseHint && top > lastTop) {
      lines.push(`${name}: da ${kg(lastTop)} a ${kg(top)} kg. ${pick(PHRASES.increaseTail)}`);
    }
  }
  return lines;
}

/** Record di minuti o di pendenza sul tapis roulant. */
function treadmillRecord(w, others) {
  if (!hasTreadmill(w)) return null;
  const prev = others.filter(hasTreadmill).map((o) => o.treadmill);
  if (!prev.length) return null;
  const maxMin = Math.max(...prev.map((t) => t.minutes || 0));
  const maxInc = Math.max(...prev.map((t) => t.incline || 0));
  const lines = [];
  if (w.treadmill.minutes > maxMin) lines.push(`${w.treadmill.minutes} minuti, +${w.treadmill.minutes - maxMin} rispetto al tuo massimo.`);
  if ((w.treadmill.incline || 0) > maxInc) lines.push(`Pendenza ${kg(w.treadmill.incline)}%, +${kg(w.treadmill.incline - maxInc)}% rispetto al massimo.`);
  return lines.length ? lines : null;
}

/** Dopo un allenamento registrato (con i pesi, libero o cardio). */
export async function afterWorkout(w) {
  try {
    const d = await loadAll();
    const others = d.workouts.filter((o) => o.id !== w.id);
    const today = todayISO();

    if (isStrength(w)) {
      // Traguardi principali: un unico festeggiamento con le righe in più
      const main = [];
      const total = d.workouts.filter(isStrength).length;
      if (TOTAL_MILESTONES.includes(total) && await firstTime(`total:${total}`)) {
        main.push({ title: pick(PHRASES.totals[total]), line: pick(PHRASES.totalsTail[total]), icon: 'medal' });
      }
      const weekFrom = startOfWeek(w.date);
      const weekCount = strengthIn(d, weekFrom, addDays(weekFrom, 6)).length;
      if (weekFrom === startOfWeek(today) && weekCount >= WEEKLY_GOAL && await firstTime(`goal4:${weekFrom}`)) {
        const run = weeksInARow(d);
        if (run >= 2) main.push({ title: pick(PHRASES.weeksStreak, { n: run }), line: pick(PHRASES.weeksStreakTail), icon: 'flame' });
        else main.push({ title: pick(PHRASES.goal4), line: '', icon: 'trophy' });
      }
      if (w.templateId && !isPartial(w) && await firstTime(`tpl:${w.id}`)) {
        const t = getTemplate(w.templateId);
        main.push({ title: pick(PHRASES.templateDone, { code: w.templateCode, name: t?.name || w.name }), line: `${workoutStats(w).sets} serie registrate.`, icon: 'circle-check' });
      }
      if (main.length) {
        const [first, ...rest] = main;
        celebrate({
          icon: first.icon,
          title: first.title,
          lines: [first.line, ...rest.map((m) => m.title)].filter(Boolean),
        });
      }

      const records = exerciseRecords(w, others);
      if (records.length && await firstTime(`rec:${w.id}`)) {
        celebrate({ icon: 'trending-up', title: pick(PHRASES.recordsTitle), lines: records.slice(0, 4) });
      }
    }

    const tm = treadmillRecord(w, others);
    if (tm && await firstTime(`tm:${w.id}`)) {
      celebrate({ icon: 'footprints', title: pick(PHRASES.treadmill), lines: tm });
    }

    if (w.date === today) await checkRings(d);
  } catch (err) {
    console.warn('Festeggiamenti non disponibili', err);
  }
}

/** Dopo aver cambiato l'acqua di oggi. */
export async function afterWater(date) {
  if (date !== todayISO()) return;
  try {
    const d = await loadAll();
    if (waterOk(d, date) && await firstTime(`water:${date}`)) {
      const run = streak((day) => waterOk(d, day), date);
      celebrate(run >= 2
        ? { icon: 'droplets', title: pick(PHRASES.waterStreakTitle, { n: run }), lines: [pick(PHRASES.waterTail)] }
        : { icon: 'droplet', title: pick(PHRASES.water), lines: [pick(PHRASES.waterTail)] });
    }
    await checkRings(d);
  } catch (err) {
    console.warn('Festeggiamenti non disponibili', err);
  }
}

/** Dopo aver segnato un pasto. */
export async function afterMeal(date, meal) {
  try {
    // Sgarro: solo incoraggiamento, una volta al giorno, senza coriandoli
    if (isCheatMeal(meal)) {
      if (await firstTime(`restart:${date}`)) {
        celebrate({ soft: true, icon: 'heart', title: pick(PHRASES.restartTitle), lines: [pick(PHRASES.restart)] });
      }
      return;
    }
    const d = await loadAll();
    if (isClean(d, date) && date === todayISO()) {
      const run = streak((day) => isClean(d, day), date);
      if (CLEAN_STREAKS.includes(run) && await firstTime(`clean:${run}:${date}`)) {
        celebrate({ icon: 'flame', title: pick(PHRASES.cleanStreakTitle, { n: run }), lines: [pick(PHRASES.cleanStreakTail)] });
      }
    }
    // Settimana con tutte le frequenze rispettate (esattamente come da piano)
    const weekFrom = startOfWeek(date);
    const days = Array.from({ length: 7 }, (_, i) => d.diet.get(addDays(weekFrom, i)));
    const counts = categoryCounts(days);
    const targets = getPlan().targets;
    const allMet = CATEGORIES.every((c) => counts[c.id] === (targets[c.id] ?? 0));
    if (allMet && await firstTime(`cleanweek:${weekFrom}`)) {
      celebrate({ icon: 'scale', title: pick(PHRASES.cleanWeek), lines: [pick(PHRASES.cleanWeekTail)] });
    }
    if (date === todayISO()) await checkRings(d);
  } catch (err) {
    console.warn('Festeggiamenti non disponibili', err);
  }
}

/** Tutti gli anelli di oggi completati. */
async function checkRings(d) {
  const today = todayISO();
  if (ringsComplete(d, today) && await firstTime(`rings:${today}`)) {
    celebrate({ icon: 'circle-check', title: pick(PHRASES.rings), lines: [pick(PHRASES.ringsTail)] });
  }
}
