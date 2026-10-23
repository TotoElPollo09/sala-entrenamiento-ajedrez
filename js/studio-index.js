// Índice en memoria de la base local para buscar por posición (orden de jugadas desde el inicio).
// Se guarda solo lo necesario de cada partida para que quepan cientos de miles.
import { findGames } from './db.js'

const MAX_PLY = 60
let index = null
let loading = null

export function resetIndex() { index = null; loading = null }

export function loadIndex(onProgress) {
  if (index) return Promise.resolve(index)
  if (!loading) {
    const items = []
    loading = findGames((g) => {
      if (!g.fen && g.moves?.length) {
        items.push({
          id: g.id, line: g.moves.slice(0, MAX_PLY).join(' '), ply: g.moves.length,
          w: g.white, b: g.black, wl: g.whiteLower || g.white.toLowerCase(), bl: g.blackLower || g.black.toLowerCase(),
          we: g.whiteElo, be: g.blackElo, r: g.result, d: g.date || '', ev: g.event || '',
        })
        if (items.length % 20000 === 0) onProgress?.(items.length)
      }
      return false
    }, Infinity).then(() => { index = items; return items })
  }
  return loading
}

// Partidas que pasan por la línea dada (lista SAN desde el inicio), con un filtro opcional de jugador y color.
// Devuelve {total, moves:[{san, n, w, d, l}], games:[item…] (más recientes primero), deep}
export function queryLine(items, sans, { player = '', color = 'any' } = {}) {
  if (sans.length >= MAX_PLY) return { total: 0, moves: [], games: [], deep: true }
  const prefix = sans.join(' ')
  const q = player.trim().toLowerCase()
  const moves = new Map()
  const games = []
  for (const it of items) {
    if (prefix && !(it.line === prefix || it.line.startsWith(prefix + ' '))) continue
    if (q) {
      const inW = it.wl.includes(q), inB = it.bl.includes(q)
      if (color === 'w' ? !inW : color === 'b' ? !inB : !inW && !inB) continue
    }
    games.push(it)
    const rest = prefix ? it.line.slice(prefix.length + 1) : it.line
    if (!rest) continue
    const sp = rest.indexOf(' ')
    const san = sp < 0 ? rest : rest.slice(0, sp)
    const s = moves.get(san) || { san, n: 0, w: 0, d: 0, l: 0 }
    s.n += 1
    if (it.r === '1-0') s.w += 1
    else if (it.r === '0-1') s.l += 1
    else if (it.r === '½-½') s.d += 1
    moves.set(san, s)
  }
  games.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
  return { total: games.length, moves: [...moves.values()].sort((a, b) => b.n - a.n), games, deep: false }
}

// Las jugadas siguientes de una partida desde la línea dada, para la columna "Jugadas".
export function continuation(it, sans, max = 8) {
  return it.line.split(' ').slice(sans.length, sans.length + max)
}
