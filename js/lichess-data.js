// Datos de entrenamiento leídos directamente de Lichess, con caché en el navegador.
// Devuelve las mismas filas que antes daba la hoja de Google, para que el dashboard no cambie.
import { settings } from './store.js'
import { fetchUser, fetchUserGames, fetchRatingHistory, fetchStorm, fetchPuzzleActivity } from './lichess.js'

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

export const historyFrom = () => settings.historyFrom || '2026-01-01'

// Partidas de un usuario: la primera vez desde la fecha de Ajustes, después solo las nuevas.
// Sin refresh, si ya hay partidas guardadas se usan tal cual y no se pregunta a Lichess.
export async function getGames(username, onProgress, { refresh = false } = {}) {
  const key = `games:${username.toLowerCase()}`
  const cached = (await cacheGet(key)) || { games: [], from: null }
  const from = historyFrom()
  if (!refresh && cached.from === from && cached.games.length) return cached.games
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

async function getPuzzles(token, username, refresh) {
  const key = `puzzles:${username.toLowerCase()}`
  const cached = (await cacheGet(key)) || []
  if (!refresh && cached.length) return cached
  const fresh = await fetchPuzzleActivity(token, { max: 5000 })
  const keyOf = (p) => `${p.puzzle?.id}|${p.date}`
  const seen = new Set(cached.map(keyOf))
  const all = [...fresh.filter((p) => !seen.has(keyOf(p))), ...cached].sort((a, b) => b.date - a.date)
  await cacheSet(key, all)
  return all
}

// Sin refresh se usa lo guardado; con refresh se pide a Lichess y lo guardado solo sirve si no responde.
async function fresh(key, fn, refresh) {
  if (!refresh) {
    const v = await cacheGet(key)
    if (v !== undefined) return v
  }
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
// refresh: true pide a Lichess lo nuevo (botón Actualizar); si no, se muestra lo ya descargado.
export async function loadAll(onStatus = () => {}, { refresh = false } = {}) {
  const out = { ratings: [], partidas: [], puzzles: [], storm: [], notes: [], updated: null, profiles: {}, summary: [] }
  const from = historyFrom()
  const fromMs = Date.parse(from + 'T00:00:00Z')
  const stormDays = Math.min(365, Math.ceil((Date.now() - fromMs) / 86400000) + 1)
  const since = (rows) => rows.filter((r) => (r.Fecha || r['Fecha y hora'] || '') >= from)
  const players = settings.players.filter((p) => p.lichess)
  if (!players.length) throw new Error('Escribe vuestros usuarios de Lichess en Ajustes para ver el dashboard.')
  // Cada fuente va por separado: si una falla, el resto se muestra igual y se avisa de cuál falló.
  const step = async (label, fn) => {
    try { await fn() } catch (e) { out.notes.push(`${label}: ${e.message}`); out.failed += 1 }
  }
  out.failed = 0
  for (const p of players) {
    const u = p.lichess
    const n0 = { r: out.ratings.length, g: out.partidas.length, s: out.storm.length, p: out.puzzles.length }
    onStatus(`Leyendo el rating de ${u}…`)
    await step(`Rating de ${p.name}`, async () => out.ratings.push(...since(ratingRows(p.name, await fresh(`rating:${u.toLowerCase()}`, () => fetchRatingHistory(u), refresh)))))
    // El perfil da el rating actual exacto y los totales de puzzles y Storm de Lichess.
    await step(`Perfil de ${p.name}`, async () => {
      const prof = await fresh(`profile:${u.toLowerCase()}`, () => fetchUser(u), refresh)
      const perfs = prof.perfs || {}
      const day = isoDay(prof.seenAt || Date.now())
      for (const mod of ['bullet', 'blitz', 'rapid', 'classical', 'puzzle']) {
        const pf = perfs[mod]
        if (pf?.games && pf.rating) out.ratings.push({ Jugador: p.name, Fecha: day, Modalidad: mod, Rating: pf.rating })
      }
      out.profiles[p.name] = { puzzles: perfs.puzzle?.games ?? null, stormRuns: perfs.storm?.runs ?? null, stormRecord: perfs.storm?.score ?? null }
    })
    onStatus(`Leyendo Puzzle Storm de ${u}…`)
    await step(`Puzzle Storm de ${p.name}`, async () => out.storm.push(...since(stormRows(p.name, await fresh(`storm:${u.toLowerCase()}`, () => fetchStorm(u, stormDays), refresh)))))
    onStatus(`Descargando partidas de ${u}…`)
    await step(`Partidas de ${p.name}`, async () => {
      const games = await getGames(u, (n) => onStatus(`Descargando partidas nuevas de ${u}: ${n}…`), { refresh })
      out.partidas.push(...gameRows(p.name, u, games))
    })
    if (p.puzzleToken) {
      onStatus(`Leyendo los puzzles de ${u}…`)
      await step(`Puzzles de ${p.name}`, async () => out.puzzles.push(...since(puzzleRows(p.name, await getPuzzles(p.puzzleToken, u, refresh)))))
    } else {
      out.notes.push(`Para ver los puzzles de ${p.name} uno a uno, pega su token de puzzles en Ajustes.`)
    }
    const mine = out.storm.slice(n0.s)
    out.summary.push(`${p.name} (${u}): ${new Set(out.ratings.slice(n0.r).map((r) => r.Modalidad)).size} ratings, ${out.partidas.length - n0.g} partidas, `
      + `${mine.reduce((a, r) => a + (r['Sesiones del día'] || 0), 0)} sesiones de Storm en ${mine.length} días, ${out.puzzles.length - n0.p} puzzles.`)
  }
  // Fecha de la última actualización: se guarda solo si alguna consulta llegó a Lichess bien.
  const prev = await cacheGet('updated')
  out.updated = prev ?? null
  if ((refresh || prev == null) && out.failed < players.length * 3) { out.updated = Date.now(); await cacheSet('updated', out.updated) }
  if (out.failed && !out.ratings.length && !out.storm.length && !out.partidas.length) {
    throw new Error(`No se pudo leer nada de Lichess. ${out.notes.filter((n) => !n.startsWith('Para ver')).join(' ')}`)
  }
  return out
}
