// Acceso a la API pública de Lichess desde el navegador (permite CORS).
import { settings } from './store.js'

const API = 'https://lichess.org'

function headers(extra = {}, token = settings.lichessToken) {
  const h = { ...extra }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function ok(res, what) {
  if (res.ok) return res
  if (res.status === 404) throw new Error(`${what}: no existe en Lichess.`)
  if (res.status === 429) throw new Error('Lichess pide esperar un minuto antes de hacer más consultas.')
  if (res.status === 401) throw new Error('Lichess rechazó el token. Revísalo en Ajustes.')
  throw new Error(`${what}: Lichess respondió ${res.status}.`)
}

export async function fetchUser(username) {
  const res = await ok(await fetch(`${API}/api/user/${encodeURIComponent(username)}`, { headers: headers() }), `El usuario ${username}`)
  return res.json()
}

// Descarga partidas de un usuario como objetos compactos. onProgress(n) se llama mientras llegan.
export async function fetchUserGames(username, { max = 300, since = 0, perfType = '', color = '', rated = '', signal, onProgress } = {}) {
  const p = new URLSearchParams({ moves: 'true', opening: 'true', clocks: 'false', evals: 'false', pgnInJson: 'false' })
  if (max) p.set('max', String(max))
  if (since) p.set('since', String(since))
  if (perfType) p.set('perfType', perfType)
  if (color) p.set('color', color)
  if (rated) p.set('rated', rated)
  const res = await ok(await fetch(`${API}/api/games/user/${encodeURIComponent(username)}?${p}`, {
    headers: headers({ Accept: 'application/x-ndjson' }), signal,
  }), `El usuario ${username}`)
  return readNdjson(res, fromLichess, onProgress)
}

// Lee una respuesta NDJSON línea a línea.
async function readNdjson(res, map, onProgress) {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  const games = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (line) games.push(map(JSON.parse(line)))
    }
    onProgress?.(games.length)
  }
  if (buf.trim()) games.push(map(JSON.parse(buf)))
  return games
}

// Historial de rating por modalidad (público).
export async function fetchRatingHistory(username) {
  const res = await ok(await fetch(`${API}/api/user/${encodeURIComponent(username)}/rating-history`, { headers: headers() }), `El usuario ${username}`)
  return res.json()
}

// Puzzle Storm: mejor sesión de cada día y récords (público).
export async function fetchStorm(username, days = 365) {
  const res = await ok(await fetch(`${API}/api/storm/dashboard/${encodeURIComponent(username)}?days=${days}`, { headers: headers() }), `El usuario ${username}`)
  return res.json()
}

// Puzzles resueltos uno a uno. Privado: necesita el token del propio jugador con el permiso puzzle:read.
export async function fetchPuzzleActivity(token, { max = 3000, onProgress } = {}) {
  const res = await fetch(`${API}/api/puzzle/activity?max=${max}`, { headers: headers({ Accept: 'application/x-ndjson' }, token) })
  if (res.status === 401 || res.status === 403) throw new Error('El token de puzzles no es válido o no tiene el permiso "Leer la actividad de puzzles".')
  await ok(res, 'Los puzzles')
  return readNdjson(res, (x) => x, onProgress)
}

// Formato común de partida para toda la web (igual que las de la base local).
export function fromLichess(g) {
  const w = g.players?.white || {}
  const b = g.players?.black || {}
  const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : (g.status === 'draw' || g.status === 'stalemate') ? '½-½' : (g.status === 'started' ? '*' : '½-½')
  return {
    id: `lichess:${g.id}`,
    ts: g.createdAt,
    whiteDiff: w.ratingDiff ?? null,
    blackDiff: b.ratingDiff ?? null,
    rated: !!g.rated,
    source: 'lichess',
    url: `https://lichess.org/${g.id}`,
    white: w.user?.name || (w.aiLevel ? `Stockfish nivel ${w.aiLevel}` : 'Anónimo'),
    black: b.user?.name || (b.aiLevel ? `Stockfish nivel ${b.aiLevel}` : 'Anónimo'),
    whiteElo: w.rating || null,
    blackElo: b.rating || null,
    result,
    date: new Date(g.createdAt).toISOString().slice(0, 10),
    event: g.rated ? `Lichess ${g.speed} puntuable` : `Lichess ${g.speed}`,
    speed: g.speed,
    eco: g.opening?.eco || '',
    opening: g.opening?.name || '',
    moves: (g.moves || '').split(' ').filter(Boolean),
  }
}

// Explorador de aperturas de Lichess (maestros o partidas de Lichess). Puede pedir token.
export async function fetchExplorer(fen, db = 'masters', { speeds = 'blitz,rapid,classical', ratings = '2000,2200,2500' } = {}) {
  const p = new URLSearchParams({ fen, moves: '12', topGames: '0', recentGames: '0' })
  if (db === 'lichess') { p.set('speeds', speeds); p.set('ratings', ratings) }
  const res = await fetch(`https://explorer.lichess.ovh/${db}?${p}`, { headers: headers() })
  if (res.status === 401) throw new Error('El explorador de Lichess pide iniciar sesión: añade un token de Lichess en Ajustes.')
  await ok(res, 'El explorador')
  const j = await res.json()
  return {
    opening: j.opening,
    moves: (j.moves || []).map((m) => ({ san: m.san, n: m.white + m.draws + m.black, w: m.white, d: m.draws, l: m.black })),
  }
}
