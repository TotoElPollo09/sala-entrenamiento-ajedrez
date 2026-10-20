// Base de datos local de partidas (IndexedDB) e importación de PGN.
const DB_NAME = 'ajedrez-web'
const STORE = 'games'

let dbPromise = null
function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const s = req.result.createObjectStore(STORE, { keyPath: 'id' })
        s.createIndex('white', 'whiteLower')
        s.createIndex('black', 'blackLower')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

function tx(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const out = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(out?.result ?? out)
    t.onerror = () => reject(t.error)
  }))
}

export async function addGames(games) {
  await tx('readwrite', (s) => {
    for (const g of games) s.put({ ...g, whiteLower: g.white.toLowerCase(), blackLower: g.black.toLowerCase() })
  })
  return games.length
}

export const countGames = () => tx('readonly', (s) => s.count())
export const clearGames = () => tx('readwrite', (s) => s.clear())
export const getGame = (id) => tx('readonly', (s) => s.get(id))

// Recorre todas las partidas y devuelve las que cumplen el filtro (hasta limit).
export async function findGames(filter, limit = 5000) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const out = []
    const req = db.transaction(STORE).objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const c = req.result
      if (!c || out.length >= limit) return resolve(out)
      if (filter(c.value)) out.push(c.value)
      c.continue()
    }
    req.onerror = () => reject(req.error)
  })
}

export function gamesOfPlayer(name, limit = 5000) {
  const q = name.trim().toLowerCase()
  if (!q) return Promise.resolve([])
  return findGames((g) => g.whiteLower.includes(q) || g.blackLower.includes(q), limit)
}

// ---- PGN ----

// Divide un archivo PGN con muchas partidas y las convierte al formato común.
// No valida las jugadas aquí (los archivos de FIDE/TWIC tienen miles de partidas); se validan al abrirlas.
// keep(headers) decide antes de leer las jugadas si la partida se guarda (para filtrar bases enormes).
export function parsePgnFile(text, sourceName = 'PGN', keep = null) {
  const games = []
  const chunks = text.replace(/\r/g, '').split(/\n(?=\[Event\s)/)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const headers = {}
    for (const m of chunk.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2]
    if (keep && !keep(headers)) continue
    const body = chunk.replace(/^\[.*\]\s*$/gm, '')
    const moves = sanTokens(body)
    if (!headers.White && !moves.length) continue
    const white = headers.White || '?'
    const black = headers.Black || '?'
    const date = (headers.Date || '').replace(/\./g, '-').replace(/-\?\?/g, '')
    const key = [white, black, headers.Event, headers.Round, date, moves.slice(0, 12).join('')].join('|')
    games.push({
      id: `pgn:${hash(key)}`,
      source: sourceName,
      white, black,
      whiteElo: Number(headers.WhiteElo) || null,
      blackElo: Number(headers.BlackElo) || null,
      result: (headers.Result || '*').replace('1/2-1/2', '½-½'),
      date,
      event: headers.Event || '',
      site: headers.Site || '',
      round: headers.Round || '',
      eco: headers.ECO || '',
      opening: [headers.Opening, headers.Variation].filter(Boolean).join(': '),
      fen: headers.FEN || '',
      moves,
    })
  }
  return games
}

// Saca las jugadas SAN de un texto de partida: quita comentarios, variantes, números y NAGs.
export function sanTokens(movetext) {
  let t = movetext.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ')
  // quitar variantes anidadas
  let prev
  do { prev = t; t = t.replace(/\([^()]*\)/g, ' ') } while (t !== prev)
  return t
    .replace(/\$\d+/g, ' ')
    .replace(/\d+\.(\.\.)?/g, ' ')
    .split(/\s+/)
    .map((s) => s.replace(/[!?]+$/, ''))
    .filter((s) => s && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(s))
}

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36) + s.length.toString(36)
}

export function gameToPgn(g) {
  const tags = { Event: g.event || '?', Site: g.url || g.site || '?', Date: (g.date || '????.??.??').replace(/-/g, '.'), Round: g.round || '-',
    White: g.white, Black: g.black, Result: (g.result || '*').replace('½-½', '1/2-1/2') }
  if (g.whiteElo) tags.WhiteElo = g.whiteElo
  if (g.blackElo) tags.BlackElo = g.blackElo
  if (g.eco) tags.ECO = g.eco
  if (g.opening) tags.Opening = g.opening
  if (g.fen) { tags.SetUp = '1'; tags.FEN = g.fen }
  const head = Object.entries(tags).map(([k, v]) => `[${k} "${String(v).replace(/"/g, '\\"')}"]`).join('\n')
  const body = g.moves.map((m, i) => (i % 2 === 0 ? `${i / 2 + 1}. ` : '') + m).join(' ')
  return `${head}\n\n${body} ${tags.Result}\n`
}

// Lee un archivo PGN por trozos, sin cargarlo entero en memoria (sirve para bases de millones de partidas).
// onBatch(games) recibe las partidas que pasan el filtro; onProgress({ bytes, total, scanned }) informa del avance.
// Devuelve false si se canceló con signal.
export async function streamPgnFile(file, { keep, onBatch, onProgress, signal, chunkSize = 4 << 20 } = {}) {
  const dec = new TextDecoder()
  let buf = '', bytes = 0, scanned = 0
  const flush = async (text) => {
    scanned += (text.match(/^\[Event\s/gm) || []).length
    const games = parsePgnFile(text, file.name, keep)
    if (games.length) await onBatch(games)
  }
  for (let pos = 0; pos < file.size; pos += chunkSize) {
    if (signal?.aborted) return false
    const piece = new Uint8Array(await file.slice(pos, pos + chunkSize).arrayBuffer())
    bytes = Math.min(file.size, pos + chunkSize)
    buf += dec.decode(piece, { stream: bytes < file.size })
    // Se procesa hasta el último comienzo de partida; el resto espera al siguiente trozo.
    const cut = buf.lastIndexOf('\n[Event ')
    if (cut > 0) { await flush(buf.slice(0, cut)); buf = buf.slice(cut + 1) }
    onProgress?.({ bytes, total: file.size, scanned })
    await new Promise((r) => setTimeout(r, 0)) // deja respirar a la página
  }
  if (buf.trim()) await flush(buf)
  onProgress?.({ bytes: file.size, total: file.size, scanned })
  return true
}

// Construye el filtro de importación a partir de lo que se escribe en la página.
// eco admite códigos sueltos o prefijos (B9, C42) y rangos (B90-B99), separados por comas.
export function importFilter({ player = '', minElo = 0, eloBoth = true, fromYear = 0, toYear = 0, eco = '' } = {}) {
  const names = player.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  const ecos = eco.toUpperCase().split(/[,\s]+/).filter(Boolean).map((t) => {
    const [a, b] = t.split('-')
    return b ? (c) => c >= a && c <= b : (c) => c.startsWith(a)
  })
  if (!names.length && !minElo && !fromYear && !toYear && !ecos.length) return null
  return (h) => {
    if (names.length) {
      const w = (h.White || '').toLowerCase(), bl = (h.Black || '').toLowerCase()
      if (!names.some((n) => w.includes(n) || bl.includes(n))) return false
    }
    if (minElo) {
      const we = Number(h.WhiteElo) || 0, be = Number(h.BlackElo) || 0
      if (eloBoth ? Math.min(we, be) < minElo : Math.max(we, be) < minElo) return false
    }
    if (fromYear || toYear) {
      const y = Number((h.Date || '').slice(0, 4))
      if (!y || (fromYear && y < fromYear) || (toYear && y > toYear)) return false
    }
    if (ecos.length) {
      const c = (h.ECO || '').toUpperCase()
      if (!c || !ecos.some((f) => f(c))) return false
    }
    return true
  }
}
