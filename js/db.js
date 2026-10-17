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
export function parsePgnFile(text, sourceName = 'PGN') {
  const games = []
  const chunks = text.replace(/\r/g, '').split(/\n(?=\[Event\s)/)
  for (const chunk of chunks) {
    if (!chunk.trim()) continue
    const headers = {}
    for (const m of chunk.matchAll(/^\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm)) headers[m[1]] = m[2]
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
