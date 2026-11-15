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
  const whiteMoves = sans.length % 2 === 0
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
    const s = moves.get(san) || { san, n: 0, w: 0, d: 0, l: 0, eloSum: 0, eloN: 0, oppSum: 0, oppN: 0, ptsR: 0, last: '' }
    s.n += 1
    if (it.r === '1-0') s.w += 1
    else if (it.r === '0-1') s.l += 1
    else if (it.r === '½-½') s.d += 1
    // Datos del jugador que hace la jugada (como las columnas Elo y Perf. de la referencia de ChessBase).
    const me = Number(whiteMoves ? it.we : it.be) || 0
    const opp = Number(whiteMoves ? it.be : it.we) || 0
    if (me) { s.eloSum += me; s.eloN += 1 }
    if (opp && (it.r === '1-0' || it.r === '0-1' || it.r === '½-½')) { s.oppSum += opp; s.oppN += 1; s.ptsR += it.r === '½-½' ? 0.5 : (it.r === '1-0') === whiteMoves ? 1 : 0 }
    if (it.d > s.last) s.last = it.d
    moves.set(san, s)
  }
  games.sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0))
  const list = [...moves.values()].sort((a, b) => b.n - a.n).map(({ eloSum, eloN, oppSum, oppN, ptsR, ...m }) => ({
    ...m, avg: eloN ? Math.round(eloSum / eloN) : null, perf: oppN ? performance(oppSum / oppN, ptsR / oppN) : null,
  }))
  return { total: games.length, moves: list, games, deep: false }
}

// Rendimiento: Elo medio de los rivales + diferencia según la puntuación (fórmula logística, limitada a ±800).
export function performance(oppAvg, score) {
  const p = Math.min(0.99, Math.max(0.01, score))
  return Math.round(oppAvg + Math.max(-800, Math.min(800, -400 * Math.log10(1 / p - 1))))
}

// Las jugadas siguientes de una partida desde la línea dada, para la columna "Jugadas".
export function continuation(it, sans, max = 8) {
  return it.line.split(' ').slice(sans.length, sans.length + max)
}
