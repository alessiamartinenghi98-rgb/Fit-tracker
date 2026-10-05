/* ==========================================================================
   db.js — Archiviazione locale con IndexedDB
   --------------------------------------------------------------------------
   Archivi (object store):
   - exercises : libreria esercizi        { id, name, createdAt }
   - workouts  : allenamenti              { id, date, name, exercises: [...], createdAt, updatedAt }
                 exercises[i] = { exerciseId, name, sets: [{ weight, reps, done }] }
   - meals     : pasti                    { id, date, type, description, kcal, protein, carbs, fat, createdAt }
   - meta      : impostazioni varie       { key, value }
   Le date sono stringhe locali "AAAA-MM-GG": si ordinano e confrontano come testo.
   ========================================================================== */

const DB_NAME = 'fit-tracker';
const DB_VERSION = 1;
const STORES = ['exercises', 'workouts', 'meals', 'meta'];

let dbPromise = null;

/** Apre (o crea) il database. La connessione viene riutilizzata. */
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    // Eseguito solo alla prima apertura o quando cambia DB_VERSION
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('exercises')) {
        db.createObjectStore('exercises', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('workouts')) {
        const s = db.createObjectStore('workouts', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meals')) {
        const s = db.createObjectStore('meals', { keyPath: 'id' });
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Trasforma una richiesta IndexedDB in una Promise. */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Esegue una funzione dentro una transazione e attende che sia completata. */
async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* --- Operazioni di base -------------------------------------------------- */

export async function getAll(store) {
  return tx(store, 'readonly', (t) => promisify(t.objectStore(store).getAll()));
}

export async function get(store, key) {
  return tx(store, 'readonly', (t) => promisify(t.objectStore(store).get(key)));
}

export async function put(store, value) {
  return tx(store, 'readwrite', (t) => promisify(t.objectStore(store).put(value)));
}

export async function del(store, key) {
  return tx(store, 'readwrite', (t) => promisify(t.objectStore(store).delete(key)));
}

/** Tutti gli elementi con una data precisa (usa l'indice "date"). */
export async function getByDate(store, date) {
  return tx(store, 'readonly', (t) =>
    promisify(t.objectStore(store).index('date').getAll(IDBKeyRange.only(date)))
  );
}

/** Scrive più elementi nello stesso archivio in un'unica transazione. */
export async function putMany(store, values) {
  return tx(store, 'readwrite', (t) => {
    const s = t.objectStore(store);
    values.forEach((v) => s.put(v));
  });
}

/* --- Impostazioni (archivio meta) --------------------------------------- */

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

/* --- Identificativi ------------------------------------------------------ */

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/* --- Archiviazione persistente ------------------------------------------ */

/**
 * Chiede al browser di non cancellare i dati anche se lo spazio scarseggia.
 * Restituisce true se l'archiviazione è (o diventa) persistente.
 */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function isPersisted() {
  if (!navigator.storage || !navigator.storage.persisted) return false;
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

/* --- Backup: esportazione e importazione JSON --------------------------- */

const BACKUP_APP = 'fit-tracker';
const BACKUP_VERSION = 1;

/** Crea l'oggetto di backup con tutti i dati. */
export async function exportData() {
  const [exercises, workouts, meals] = await Promise.all([
    getAll('exercises'),
    getAll('workouts'),
    getAll('meals'),
  ]);
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: { exercises, workouts, meals },
  };
}

/**
 * Sostituisce tutti i dati con quelli del backup.
 * Lancia un errore con messaggio in italiano se il file non è valido.
 */
export async function importData(backup) {
  if (!backup || backup.app !== BACKUP_APP || typeof backup.data !== 'object') {
    throw new Error('Il file non è un backup di Fit Tracker.');
  }
  const { exercises = [], workouts = [], meals = [] } = backup.data;
  if (![exercises, workouts, meals].every(Array.isArray)) {
    throw new Error('Il backup è danneggiato.');
  }
  const valid = (arr) => arr.every((x) => x && typeof x.id === 'string');
  if (!valid(exercises) || !valid(workouts) || !valid(meals)) {
    throw new Error('Il backup contiene elementi non validi.');
  }

  // Un'unica transazione: o si importa tutto, o non cambia nulla
  await tx(['exercises', 'workouts', 'meals'], 'readwrite', (t) => {
    const lists = { exercises, workouts, meals };
    for (const name of Object.keys(lists)) {
      const s = t.objectStore(name);
      s.clear();
      lists[name].forEach((item) => s.put(item));
    }
  });
  return { exercises: exercises.length, workouts: workouts.length, meals: meals.length };
}

export { STORES };
