# Fit Tracker

Web app personale (PWA) per tracciare allenamenti e dieta, pensata per iPhone.
HTML, CSS e JavaScript puri: nessun build step, funziona direttamente su GitHub Pages.

## Funzioni

- **Home**: obiettivo settimanale (4 allenamenti, schede A-D), schede fatte questa settimana,
  allenamenti del mese, cardio del sabato a parte, pulsante "Inizia allenamento".
- **Allenamenti**: schede preimpostate e modificabili (A, B, C, D, cardio), apertura già compilata
  con pesi dell'ultima volta e ripetizioni obiettivo, suggerimento "Aumenta il peso", timer di recupero,
  salvataggio a ogni serie (l'allenamento in corso si ritrova riaprendo l'app), "Termina allenamento",
  libreria esercizi, storico modificabile.
- **Dieta**: pasti per giorno (colazione, pranzo, cena, spuntini), calorie e macro facoltativi,
  riepilogo giornaliero e storico.
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
