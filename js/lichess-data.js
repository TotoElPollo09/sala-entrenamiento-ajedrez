// Datos de entrenamiento leídos directamente de Lichess, con caché en el navegador.
// Devuelve las mismas filas que antes daba la hoja de Google, para que el dashboard no cambie.
import { settings } from './store.js'
import { fetchUserGames, fetchRatingHistory, fetchStorm, fetchPuzzleActivity } from './lichess.js'

// ---- caché (IndexedDB, clave → valor) ----
let dbp = null
function kv() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open('ajedrez-cache', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('kv')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbp
}
async function cacheGet(key) {
  try {
    const db = await kv()
    return await new Promise((resolve) => {
      const r = db.transaction('kv').objectStore('kv').get(key)
      r.onsuccess = () => resolve(r.result)
      r.onerror = () => resolve(undefined)
    })
  } catch { return undefined }
}
async function cacheSet(key, value) {
  try {
    const db = await kv()
    await new Promise((resolve) => {
      const t = db.transaction('kv', 'readwrite')
      t.objectStore('kv').put(value, key)
      t.oncomplete = resolve
      t.onerror = resolve
    })
  } catch { /* sin almacenamiento: se vuelve a descargar la próxima vez */ }
}
export async function clearCache() {
  try {
    const db = await kv()
    await new Promise((resolve) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = resolve })
  } catch { /* nada que borrar */ }
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)
const isoMinute = (ms) => new Date(ms).toISOString().slice(0, 16)

// Partidas de un usuario: la primera vez desde la fecha de Ajustes, después solo las nuevas.
export async function getGames(username, onProgress) {
  const key = `games:${username.toLowerCase()}`
  const cached = (await cacheGet(key)) || { games: [], from: null }
  const from = settings.historyFrom || '2026-01-01'
  let games = cached.games
  let since
  if (cached.from !== from) {
    games = []
    since = Date.parse(from + 'T00:00:00Z')
  } else {
    since = games.reduce((m, g) => Math.max(m, g.ts || 0), 0) + 1
  }
  const fresh = await fetchUserGames(username, { max: 0, since, onProgress: (n) => onProgress?.(n) })
  if (fresh.length || cached.from !== from) {
    const seen = new Set(games.map((g) => g.id))
    games = [...fresh.filter((g) => !seen.has(g.id)), ...games].sort((a, b) => b.ts - a.ts)
    await cacheSet(key, { games, from })
  }
  return games
}

async function getPuzzles(token, username) {
  const key = `puzzles:${username.toLowerCase()}`
  const cached = (await cacheGet(key)) || []
  const fresh = await fetchPuzzleActivity(token, { max: cached.length ? 500 : 5000 })
  const keyOf = (p) => `${p.puzzle?.id}|${p.date}`
  const seen = new Set(cached.map(keyOf))
  const all = [...fresh.filter((p) => !seen.has(keyOf(p))), ...cached].sort((a, b) => b.date - a.date)
  await cacheSet(key, all)
  return all
}

// Algunas consultas son pequeñas: se piden siempre y la caché solo sirve si Lichess no responde.
async function fresh(key, fn) {
  try {
    const v = await fn()
    await cacheSet(key, v)
    return v
  } catch (e) {
    const v = await cacheGet(key)
    if (v !== undefined) return v
    throw e
  }
}

const PERF = { Bullet: 'bullet', Blitz: 'blitz', Rapid: 'rapid', Classical: 'classical', Correspondence: 'correspondence', Puzzles: 'puzzle', UltraBullet: 'ultraBullet' }

function ratingRows(name, history) {
  const rows = []
  for (const h of history) {
    const mod = PERF[h.name]
    if (!mod) continue
    for (const [y, m, d, r] of h.points) {
      rows.push({ Jugador: name, Fecha: `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`, Modalidad: mod, Rating: r })
    }
  }
  return rows
}

function gameRows(name, username, games) {
  const u = username.toLowerCase()
  return games.filter((g) => g.white.toLowerCase() === u || g.black.toLowerCase() === u).map((g) => {
    const white = g.white.toLowerCase() === u
    const my = white ? g.whiteElo : g.blackElo
    const diff = white ? g.whiteDiff : g.blackDiff
    const res = g.result === '½-½' ? 'Empate' : (g.result === '1-0') === white ? 'Victoria' : 'Derrota'
    return {
      Jugador: name, 'ID partida': g.id.replace('lichess:', ''), Fecha: isoMinute(g.ts), Modalidad: g.speed,
      Color: white ? 'Blancas' : 'Negras', Rival: white ? g.black : g.white, Resultado: g.result === '*' ? '' : res,
      'Rating rival': white ? g.blackElo : g.whiteElo, 'Mi rating': my, Variación: diff,
      'Rating después': my != null && diff != null ? my + diff : null, Puntuable: g.rated ? 'Sí' : 'No',
      Apertura: g.opening, ECO: g.eco, Movimientos: Math.ceil(g.moves.length / 2), Enlace: g.url,
    }
  }).filter((r) => r.Resultado)
}

function stormRows(name, storm) {
  const now = isoMinute(Date.now())
  return (storm.days || []).map((d) => ({
    Jugador: name, Fecha: String(d._id).replace(/\//g, '-'), 'Mejor puntuación del día': d.score, 'Sesiones del día': d.runs,
    Errores: d.errors, Jugadas: d.moves, Combo: d.combo, 'Duración (s)': d.time, 'Rating más alto': d.highest,
    'Récord histórico': storm.high?.allTime ?? null, Sincronizado: now,
  }))
}

function puzzleRows(name, acts) {
  return acts.map((a) => ({
    Jugador: name, 'ID puzzle': a.puzzle?.id, 'Fecha y hora': isoMinute(a.date), 'Rating puzzle': a.puzzle?.rating ?? null,
    'Tema principal': a.puzzle?.themes?.[0] || '', Resultado: a.win ? 'Acertado' : 'Fallado', Temas: (a.puzzle?.themes || []).join(', '),
  }))
}

// Carga todo para todos los jugadores de Ajustes. onStatus(texto) informa del avance.
// notes recoge avisos que no impiden mostrar el resto (p. ej. falta el token de puzzles).
export async function loadAll(onStatus = () => {}) {
  const out = { ratings: [], partidas: [], puzzles: [], storm: [], notes: [] }
  const players = settings.players.filter((p) => p.lichess)
  if (!players.length) throw new Error('Escribe vuestros usuarios de Lichess en Ajustes para ver el dashboard.')
  for (const p of players) {
    const u = p.lichess
    onStatus(`Leyendo el rating de ${u}…`)
    out.ratings.push(...ratingRows(p.name, await fresh(`rating:${u.toLowerCase()}`, () => fetchRatingHistory(u))))
    onStatus(`Leyendo Puzzle Storm de ${u}…`)
    out.storm.push(...stormRows(p.name, await fresh(`storm:${u.toLowerCase()}`, () => fetchStorm(u))))
    onStatus(`Descargando partidas de ${u}…`)
    const games = await getGames(u, (n) => onStatus(`Descargando partidas nuevas de ${u}: ${n}…`))
    out.partidas.push(...gameRows(p.name, u, games))
    if (p.puzzleToken) {
      onStatus(`Leyendo los puzzles de ${u}…`)
      try {
        out.puzzles.push(...puzzleRows(p.name, await getPuzzles(p.puzzleToken, u)))
      } catch (e) {
        out.notes.push(`Puzzles de ${p.name}: ${e.message}`)
      }
    } else {
      out.notes.push(`Para ver los puzzles de ${p.name} uno a uno, pega su token de puzzles en Ajustes.`)
    }
  }
  return out
}
