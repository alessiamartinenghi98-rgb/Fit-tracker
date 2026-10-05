# Fit Tracker

Web app personale (PWA) per tracciare allenamenti e dieta, pensata per iPhone.
HTML, CSS e JavaScript puri: nessun build step, funziona direttamente su GitHub Pages.

## Funzioni

- **Allenamenti**: sessioni con data, esercizi e serie (kg × ripetizioni), stepper +/-,
  libreria esercizi, valori dell'ultima volta come riferimento, storico modificabile.
- **Dieta**: pasti per giorno (colazione, pranzo, cena, spuntini), calorie e macro facoltativi,
  riepilogo giornaliero e storico.
- **Progressi**: allenamenti per settimana/mese, grafici di peso massimo e volume per esercizio,
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
js/workouts.js    Allenamenti
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
