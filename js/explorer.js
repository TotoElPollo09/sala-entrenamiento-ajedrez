// Árbol de aperturas construido a partir de una lista de partidas.
import { Chess, fenKey } from './board.js'

// Resultado desde el punto de vista de un jugador: 1, ½ o 0 (null si no jugó la partida).
export function scoreFor(game, name) {
  const n = name.toLowerCase()
  const isW = game.white.toLowerCase() === n
  const isB = game.black.toLowerCase() === n
  if (!isW && !isB) return null
  if (game.result === '½-½') return 0.5
  if (game.result === '1-0') return isW ? 1 : 0
  if (game.result === '0-1') return isB ? 1 : 0
  return null
}

export function colorOf(game, name) {
  const n = name.toLowerCase()
  if (game.white.toLowerCase() === n) return 'w'
  if (game.black.toLowerCase() === n) return 'b'
  return null
}

// Devuelve {positions: Map(fenKey -> {n, moves: Map(san -> {n,w,d,l}), openings: Map(name -> n), games: [índices]})}
// w/d/l: victorias de blancas, tablas y victorias de negras, como en el explorador de Lichess.
export function buildTree(games, { maxPly = 24, onlyColor = null, player = '' } = {}) {
  const positions = new Map()
  const node = (k) => {
    let p = positions.get(k)
    if (!p) { p = { n: 0, moves: new Map(), openings: new Map(), games: [] }; positions.set(k, p) }
    return p
  }
  games.forEach((g, gi) => {
    if (onlyColor && player && colorOf(g, player) !== onlyColor) return
    let chess
    try { chess = new Chess(g.fen || undefined) } catch { return }
    const w = g.result === '1-0' ? 1 : 0
    const l = g.result === '0-1' ? 1 : 0
    const d = g.result === '½-½' ? 1 : 0
    const ps = player ? scoreFor(g, player) : null
    for (let i = 0; i <= Math.min(maxPly, g.moves.length); i++) {
      const p = node(fenKey(chess.fen()))
      p.n += 1
      if (p.games.length < 60) p.games.push(gi)
      if (g.opening) p.openings.set(g.opening, (p.openings.get(g.opening) || 0) + 1)
      if (i === Math.min(maxPly, g.moves.length)) break
      let m
      try { m = chess.move(g.moves[i]) } catch { break }
      const s = p.moves.get(m.san) || { san: m.san, n: 0, w: 0, d: 0, l: 0, pts: 0, pn: 0 }
      s.n += 1; s.w += w; s.d += d; s.l += l
      if (ps != null) { s.pts += ps; s.pn += 1 }
      p.moves.set(m.san, s)
    }
  })
  return { positions, games }
}

export function movesAt(tree, fen) {
  const p = tree.positions.get(fenKey(fen))
  if (!p) return { n: 0, moves: [], opening: '', games: [] }
  const opening = [...p.openings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
  return {
    n: p.n,
    moves: [...p.moves.values()].sort((a, b) => b.n - a.n),
    opening,
    games: p.games.map((i) => tree.games[i]),
  }
}

// Familias de apertura (nombre antes de los dos puntos) de un jugador, por color.
export function openingFamilies(games, player) {
  const acc = new Map()
  for (const g of games) {
    const c = colorOf(g, player)
    const s = scoreFor(g, player)
    if (!c || s == null) continue
    const fam = (g.opening || 'Sin nombre').split(':')[0].trim()
    const k = c + '|' + fam
    const e = acc.get(k) || { color: c, opening: fam, eco: g.eco, n: 0, pts: 0, sample: g }
    e.n += 1; e.pts += s
    acc.set(k, e)
  }
  return [...acc.values()].map((e) => ({ ...e, score: e.pts / e.n })).sort((a, b) => b.n - a.n)
}
