/* ==========================================================================
   weekimage.js — La settimana della dieta come immagine
   --------------------------------------------------------------------------
   Disegna su un canvas solo il calendario (lunedì → domenica, colazione,
   pranzo e cena) con i blocchi colorati, il carbo e i testi scritti, per
   intero. L'immagine si condivide (su iPhone "Salva immagine" → Foto) o si
   scarica. Non modifica nulla della settimana salvata.
   ========================================================================== */

import { toast, addDays, parseISO, todayISO } from './ui.js';
import { WEEKDAYS } from './plan.js';
import { GRID_SLOTS, isMainSlot, blockLabel } from './weekplan.js';

const W = 1080;              // larghezza dell'immagine (px)
const PAD = 40;
const DAY_W = 112;
const GAP = 12;
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif';

const C = {
  bg: '#000000', surface: '#141416', line: 'rgba(255,255,255,0.10)',
  text: '#f5f5f7', text2: '#a1a1a8', text3: '#6e6e75', accent: '#c6f432', ink: '#0b0d02',
  carne: '#b8b8c0', uova: '#ffd84d', pesce: '#ff86bd', legumi: '#ff9f6b', latticino: '#74c8ff',
  libero: '#f5f5f7', col: '#c9b8ff',
};
const SLOT_LABEL = { colazione: 'COLAZIONE', pranzo: 'PRANZO', cena: 'CENA' };

const colorOf = (slot, block) => (isMainSlot(slot) ? C[block] || C.carne : C.col);

/** Colore con trasparenza a partire da "#rrggbb". */
function alpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Va a capo in base alla larghezza (anche le parole troppo lunghe). */
function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxW) { line = test; continue; }
      if (line) lines.push(line);
      line = word;
      while (ctx.measureText(line).width > maxW && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && ctx.measureText(line.slice(0, cut)).width > maxW) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

const fmt = (iso, opts) => new Intl.DateTimeFormat('it-IT', opts).format(parseISO(iso));

/* Misure del contenuto di una casella */
const CHIP_H = 52;
const CARB_H = 40;
const NOTE_LH = 34;
const CELL_PAD = 14;

function cellLayout(ctx, slot, cell, colW) {
  if (!cell?.block) return { h: CHIP_H + CELL_PAD * 2, chipLines: [], notes: [] };
  ctx.font = `700 26px ${FONT}`;
  const chipLines = wrap(ctx, blockLabel(slot, cell.block), colW - CELL_PAD * 2 - 44);
  const chipH = Math.max(CHIP_H, 18 + chipLines.length * 30);
  ctx.font = `400 26px ${FONT}`;
  const notes = cell.note ? wrap(ctx, cell.note, colW - CELL_PAD * 2) : [];
  const carb = isMainSlot(slot) && cell.carbo;
  const h = CELL_PAD * 2 + chipH + (carb ? CARB_H + 6 : 0) + (notes.length ? 10 + notes.length * NOTE_LH : 0);
  return { h, chipH, chipLines, notes, carb };
}

function drawCell(ctx, x, y, w, h, slot, cell, lay) {
  ctx.fillStyle = C.surface;
  roundRect(ctx, x, y, w, h, 18);
  ctx.fill();
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  let cy = y + CELL_PAD;
  const cx = x + CELL_PAD;
  if (!cell?.block) {
    ctx.fillStyle = C.text3;
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText('—', cx, cy + 34);
    return;
  }
  // Blocco colorato
  const color = colorOf(slot, cell.block);
  ctx.font = `700 26px ${FONT}`;
  const textW = Math.max(...lay.chipLines.map((l) => ctx.measureText(l).width));
  const chipW = Math.min(w - CELL_PAD * 2, textW + 56);
  ctx.fillStyle = alpha(color, 0.18);
  roundRect(ctx, cx, cy, chipW, lay.chipH, 14);
  ctx.fill();
  ctx.strokeStyle = alpha(color, 0.5);
  ctx.lineWidth = 2;
  if (slot !== 'colazione' && cell.block === 'libero') ctx.setLineDash([7, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  roundRect(ctx, cx + 16, cy + lay.chipH / 2 - 6, 12, 12, 4);
  ctx.fill();
  ctx.fillStyle = C.text;
  const top = cy + (lay.chipH - lay.chipLines.length * 30) / 2 + 24; // testo centrato nel blocco
  lay.chipLines.forEach((l, i) => ctx.fillText(l, cx + 38, top + i * 30));
  cy += lay.chipH;

  // Carbo (solo se previsto)
  if (lay.carb) {
    cy += 6;
    ctx.fillStyle = C.accent;
    roundRect(ctx, cx, cy + 6, 28, 28, 7);
    ctx.fill();
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx + 7, cy + 20);
    ctx.lineTo(cx + 12, cy + 26);
    ctx.lineTo(cx + 21, cy + 14);
    ctx.stroke();
    ctx.fillStyle = C.accent;
    ctx.font = `600 25px ${FONT}`;
    ctx.fillText('Carbo', cx + 40, cy + 29);
    cy += CARB_H;
  }

  // Cosa mangerai (per intero)
  if (lay.notes.length) {
    cy += 10;
    ctx.fillStyle = C.text2;
    ctx.font = `400 26px ${FONT}`;
    lay.notes.forEach((l, i) => ctx.fillText(l, cx, cy + 26 + i * NOTE_LH));
  }
}

/** Crea il PNG della settimana e lo condivide (o lo scarica). */
export async function exportWeekImage(weekStart, days) {
  const colW = Math.floor((W - PAD * 2 - DAY_W - GAP * 3) / 3);
  const measure = document.createElement('canvas').getContext('2d');
  const rows = days.map((d) => {
    const lays = GRID_SLOTS.map((s) => cellLayout(measure, s, d[s], colW));
    return { lays, h: Math.max(150, ...lays.map((l) => l.h)) };
  });
  const HEAD = 176;
  const COLS = 54;
  const FOOT = 70;
  const H = HEAD + COLS + rows.reduce((s, r) => s + r.h + GAP, 0) + FOOT;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Intestazione
  const end = addDays(weekStart, 6);
  ctx.fillStyle = C.text;
  ctx.font = `800 52px ${FONT}`;
  ctx.fillText('La mia settimana', PAD, PAD + 50);
  ctx.fillStyle = C.text2;
  ctx.font = `500 30px ${FONT}`;
  ctx.fillText(`${fmt(weekStart, { day: 'numeric', month: 'long' })} – ${fmt(end, { day: 'numeric', month: 'long', year: 'numeric' })}`, PAD, PAD + 96);
  ctx.fillStyle = C.accent;
  ctx.fillRect(PAD, PAD + 118, 64, 5);

  // Titoli delle colonne
  let y = HEAD + 34;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillStyle = C.text3;
  GRID_SLOTS.forEach((s, i) => ctx.fillText(SLOT_LABEL[s], PAD + DAY_W + GAP + i * (colW + GAP) + 4, y));
  y = HEAD + COLS;

  // Giorni
  const today = todayISO();
  days.forEach((d, i) => {
    const date = addDays(weekStart, i);
    const { lays, h } = rows[i];
    const isToday = date === today;
    ctx.fillStyle = isToday ? C.accent : C.surface;
    roundRect(ctx, PAD, y, DAY_W, h, 18);
    ctx.fill();
    ctx.fillStyle = isToday ? C.ink : C.text;
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${FONT}`;
    ctx.fillText(WEEKDAYS[i].slice(0, 3), PAD + DAY_W / 2, y + h / 2 - 6);
    ctx.font = `700 36px ${FONT}`;
    ctx.fillText(String(Number(date.slice(8))), PAD + DAY_W / 2, y + h / 2 + 34);
    ctx.textAlign = 'left';
    GRID_SLOTS.forEach((s, j) => drawCell(ctx, PAD + DAY_W + GAP + j * (colW + GAP), y, colW, h, s, d[s], lays[j]));
    y += h + GAP;
  });

  // Piè di pagina
  ctx.fillStyle = C.text3;
  ctx.font = `500 22px ${FONT}`;
  ctx.fillText('Fit Tracker', PAD, H - 28);

  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Immagine non creata');
  const file = new File([blob], `settimana-dieta-${weekStart}.png`, { type: 'image/png' });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] }); // su iPhone: "Salva immagine" la mette nelle Foto
    } catch (err) {
      if (err.name !== 'AbortError') throw err;
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Immagine scaricata');
}
