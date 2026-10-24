// Problemas de táctica guardados en este navegador (IndexedDB, base aparte de la de partidas).
// Problema: { id, kind: 'mine' | 'book', set, fen, solution: [uci…], line, bestEval, game, played,
//             tries, fails, box, due, last }
const DB_NAME = 'ajedrez-web-tactica'
const PUZZLES = 'puzzles'
const SCANNED = 'scanned' // partidas de Lichess ya revisadas en busca de errores

let dbPromise = null
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        req.result.createObjectStore(PUZZLES, { keyPath: 'id' })
        req.result.createObjectStore(SCANNED, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const out = fn(t.objectStore(store))
    t.oncomplete = () => resolve(out?.result ?? out)
    t.onerror = () => reject(t.error)
  }))
}

export const allPuzzles = () => tx(PUZZLES, 'readonly', (s) => s.getAll())
export const savePuzzle = (p) => tx(PUZZLES, 'readwrite', (s) => s.put(p))

// Añade problemas nuevos sin tocar el progreso de los que ya existen. Devuelve cuántos eran nuevos.
export async function addPuzzles(list) {
  const have = new Set((await tx(PUZZLES, 'readonly', (s) => s.getAllKeys())))
  const fresh = list.filter((p) => !have.has(p.id))
  await tx(PUZZLES, 'readwrite', (s) => {
    for (const p of fresh) s.put({ tries: 0, fails: 0, box: 0, due: 0, last: null, ...p })
  })
  return fresh.length
}

export async function deleteSet(kind, set) {
  const ids = (await allPuzzles()).filter((p) => p.kind === kind && (set == null || p.set === set)).map((p) => p.id)
  await tx(PUZZLES, 'readwrite', (s) => { for (const id of ids) s.delete(id) })
  if (kind === 'mine') await tx(SCANNED, 'readwrite', (s) => s.clear())
  return ids.length
}

export async function scannedIds() {
  return new Set(await tx(SCANNED, 'readonly', (s) => s.getAllKeys()))
}
export const markScanned = (ids) => tx(SCANNED, 'readwrite', (s) => { for (const id of ids) s.put({ id }) })

// Repaso espaciado sencillo (cajas de Leitner): acertar a la primera sube de caja y aleja el próximo repaso.
const DAYS = [0, 1, 3, 7, 14, 30, 60]
export function graded(p, ok) {
  const box = ok ? Math.min(DAYS.length - 1, (p.box || 0) + 1) : 0
  const now = Date.now()
  return { ...p, tries: (p.tries || 0) + 1, fails: (p.fails || 0) + (ok ? 0 : 1), box, last: ok ? 'ok' : 'fail',
    due: ok ? now + DAYS[box] * 864e5 : now + 10 * 60e3 }
}
