// Acceso a la API pública de Lichess desde el navegador (permite CORS).
import { settings } from './store.js'

const API = 'https://lichess.org'

function headers(extra = {}) {
  const h = { ...extra }
  if (settings.lichessToken) h.Authorization = `Bearer ${settings.lichessToken}`
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
export async function fetchUserGames(username, { max = 300, perfType = '', color = '', rated = '', signal, onProgress } = {}) {
  const p = new URLSearchParams({ max: String(max), moves: 'true', opening: 'true', clocks: 'false', evals: 'false', pgnInJson: 'false' })
  if (perfType) p.set('perfType', perfType)
  if (color) p.set('color', color)
  if (rated) p.set('rated', rated)
  const res = await ok(await fetch(`${API}/api/games/user/${encodeURIComponent(username)}?${p}`, {
    headers: headers({ Accept: 'application/x-ndjson' }), signal,
  }), `El usuario ${username}`)
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
      if (line) games.push(fromLichess(JSON.parse(line)))
    }
    onProgress?.(games.length)
  }
  if (buf.trim()) games.push(fromLichess(JSON.parse(buf)))
  return games
}

// Formato común de partida para toda la web (igual que las de la base local).
export function fromLichess(g) {
  const w = g.players?.white || {}
  const b = g.players?.black || {}
  const result = g.winner === 'white' ? '1-0' : g.winner === 'black' ? '0-1' : (g.status === 'draw' || g.status === 'stalemate') ? '½-½' : (g.status === 'started' ? '*' : '½-½')
  return {
    id: `lichess:${g.id}`,
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
