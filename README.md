# Fit Tracker

Web app personale (PWA) per tracciare allenamenti e dieta, pensata per iPhone.
HTML, CSS e JavaScript puri: nessun build step, funziona direttamente su GitHub Pages.

## Funzioni

- **Home**: riepilogo (allenamenti 2/4 e del mese, giorni puliti e sgarri), contatore acqua (2 L),
  schede della settimana con allenamenti extra, calendario del mese con puntini acqua/dieta/allenamento
  e dettaglio della giornata.
- **Allenamenti**: schede preimpostate e modificabili (A, B, C, D, cardio), apertura già compilata
  con pesi dell'ultima volta e ripetizioni obiettivo, suggerimento "Aumenta il peso", timer di recupero,
  salvataggio a ogni serie (l'allenamento in corso si ritrova riaprendo l'app), "Termina allenamento"
  con chiusura come parziale (conta nell'obiettivo, mezza lettera nella Home, "Parziale 14/20"),
  allenamento libero (corsa, nuoto, camminata, bici, altro), libreria esercizi, storico modificabile.
- **Dieta**: piano settimanale modificabile, opzioni di colazione e spuntino (modificabili),
  categorie di pranzo e cena con contatori e avvisi,
  sgarri, promemoria del carbo, settimane precedenti con riepilogo, regole e porzioni.
- **Progressi**: allenamenti per settimana/mese, grafici di peso, ripetizioni e volume per esercizio,
  backup JSON (esporta / importa).
- Funziona offline; i dati restano sul telefono (IndexedDB, archiviazione persistente).

## Struttura

```
index.html        Struttura dell'app
manifest.json     Configurazione PWA
sw.js             Service worker (offline)
css/styles.css    Stile
js/app.js         Avvio e navigazione
js/db.js          Database locale e backup
js/ui.js          Componenti condivisi
js/home.js        Home
js/workouts.js    Allenamenti
js/templates.js   Schede di allenamento
js/timer.js       Timer di recupero
js/diet.js        Dieta
js/plan.js        Piano alimentare e calcoli della dieta
js/water.js       Contatore acqua
js/progress.js    Progressi e grafici
icons/            Icone dell'app
```

## Aggiornare l'app

Dopo aver modificato i file, aumenta `CACHE_VERSION` in `sw.js` (es. `v1` → `v2`):
il telefono scaricherà la nuova versione alla riapertura successiva (a volte serve chiuderla e riaprirla due volte).

## Prova in locale

```
npx http-server -c-1 .
```
poi apri l'indirizzo mostrato nel terminale.
