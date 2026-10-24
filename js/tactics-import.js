// Cómo nacen los problemas de táctica: de los errores graves de tus partidas o de archivos de libros.
import { Chess, DEFAULT_POSITION, uciToSan } from './board.js'
import { sanTokens } from './db.js'
import { whitePov } from './engine.js'

// Probabilidad de ganar (−1 a 1) a partir de la evaluación, como hace Lichess.
export const winChance = (pawns) => 2 / (1 + Math.exp(-0.368208 * Math.max(-15, Math.min(15, pawns)))) - 1

const uciOf = (m) => m.from + m.to + (m.promotion || '')

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(36) + s.length.toString(36)
}

// ---- Errores de tus partidas ----

// Posiciones de una partida: fens[n] = posición tras n medias jugadas.
function replay(game) {
  const chess = new Chess(game.fen || DEFAULT_POSITION)
  const fens = [chess.fen()], sans = []
  for (const mv of game.moves) {
    try { sans.push(chess.move(mv).san) } catch { break }
    fens.push(chess.fen())
  }
  return { fens, sans }
}

function userColor(game, username) {
  const u = username.toLowerCase()
  if (game.white.toLowerCase() === u) return 'w'
  if (game.black.toLowerCase() === u) return 'b'
  return null
}

function makePuzzle(game, username, { fens, sans }, i, best, bestEval, line, cls) {
  return {
    id: `mine:${game.id}:${i}`,
    kind: 'mine',
    set: username.toLowerCase(),
    fen: fens[i],
    solution: [best],
    line,
    bestEval, // evaluación (peones, blancas) jugando la mejor
    played: sans[i],
    cls,
    ply: i,
    added: Date.now(),
    game: { id: game.id, url: game.url, white: game.white, black: game.black, whiteElo: game.whiteElo, blackElo: game.blackElo,
      result: game.result, date: game.date, event: game.event, speed: game.speed, ts: game.ts, moves: sans },
  }
}

const lichessEval = (a) => (a?.mate != null ? (a.mate > 0 ? 100 : -100) : a?.eval != null ? a.eval / 100 : null)

// Partida ya analizada en Lichess: se usan sus juicios ("Blunder", "Mistake") y su mejor jugada.
export function puzzlesFromLichessAnalysis(game, username, { mistakes = false } = {}) {
  const color = userColor(game, username)
  if (!color || !game.analysis) return []
  const pos = replay(game)
  const out = []
  game.analysis.forEach((a, i) => {
    const name = a.judgment?.name
    if (!a.best || !(name === 'Blunder' || (mistakes && name === 'Mistake'))) return
    if (i >= pos.sans.length || pos.fens[i].split(' ')[1] !== color) return
    const before = i > 0 ? lichessEval(game.analysis[i - 1]) : 0.2
    const line = a.variation ? a.variation.split(' ').slice(0, 10) : uciToSan(pos.fens[i], [a.best], 1)
    out.push(makePuzzle(game, username, pos, i, a.best, before ?? 0, line, name === 'Blunder' ? 'blunder' : 'mistake'))
  })
  return out
}

// Partida sin análisis: Stockfish evalúa cada posición y se buscan las caídas grandes de tus jugadas.
export async function puzzlesWithEngine(game, username, engine, { mistakes = false, depth = 11, signal } = {}) {
  const color = userColor(game, username)
  if (!color) return []
  const pos = replay(game)
  const evals = [], pvs = []
  for (let i = 0; i < pos.fens.length; i++) {
    if (signal?.aborted) return []
    const chess = new Chess(pos.fens[i])
    if (chess.isCheckmate()) { evals.push(chess.turn() === 'w' ? -100 : 100); pvs.push([]); continue }
    if (chess.isGameOver()) { evals.push(0); pvs.push([]); continue }
    const r = await engine.analyze(pos.fens[i], { depth, multipv: 1 })
    evals.push(r.lines[0] ? whitePov(r.lines[0].score, pos.fens[i]) : 0)
    pvs.push(r.lines[0]?.pv || [])
  }
  const out = []
  const sign = color === 'w' ? 1 : -1
  for (let i = 0; i < pos.sans.length; i++) {
    if (pos.fens[i].split(' ')[1] !== color) continue
    const loss = sign * (winChance(evals[i]) - winChance(evals[i + 1]))
    const cls = loss >= 0.3 ? 'blunder' : mistakes && loss >= 0.2 ? 'mistake' : null
    const best = pvs[i][0]
    if (!cls || !best) continue
    const played = new Chess(pos.fens[i]).move(pos.sans[i])
    if (uciOf(played) === best) continue
    out.push(makePuzzle(game, username, pos, i, best, evals[i], uciToSan(pos.fens[i], pvs[i], 10), cls))
  }
  return out
}

// ---- Problemas de libros ----

const FEN_RE = /^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s+[wb]\s+(-|[KQkq]+)\s+(-|[a-h][36])/

// Lee un archivo de problemas: PGN (con [FEN] y la solución como jugadas), EPD (con "bm") o FEN sueltas.
// Devuelve { puzzles, skipped }.
export function parseBookFile(text, set) {
  const lines = text.replace(/\r/g, '').split('\n')
  const looksPgn = lines.some((l) => /^\s*\[\w+\s+"/.test(l))
  return looksPgn ? parsePgnPuzzles(lines, set) : parseEpd(lines, set)
}

function parseEpd(lines, set) {
  const puzzles = []
  let skipped = 0
  for (const raw of lines) {
    const l = raw.trim()
    if (!l || !FEN_RE.test(l)) { if (l) skipped++; continue }
    const t = l.split(/\s+/)
    const full = /^\d+$/.test(t[4] || '') && /^\d+$/.test(t[5] || '')
    const fen = full ? t.slice(0, 6).join(' ') : `${t.slice(0, 4).join(' ')} 0 1`
    const ops = t.slice(full ? 6 : 4).join(' ')
    let chess
    try { chess = new Chess(fen) } catch { skipped++; continue }
    const bm = (ops.match(/\bbm\s+([^;]+)/)?.[1] || '').trim().split(/\s+/).filter(Boolean)
    const ucis = bm.map((s) => { try { return uciOf(new Chess(fen).move(s.replace(/[!?]+$/, ''))) } catch { return null } }).filter(Boolean)
    const name = ops.match(/\bid\s+"([^"]*)"/)?.[1] || ops.match(/\bc0\s+"([^"]*)"/)?.[1] || ''
    puzzles.push(bookPuzzle(set, chess.fen(), ucis.slice(0, 1), name, puzzles.length + 1, ucis.slice(1)))
  }
  return { puzzles, skipped }
}

function parsePgnPuzzles(lines, set) {
  // Una partida empieza en una línea de etiqueta que sigue a texto de jugadas (o al principio).
  const games = []
  let cur = null, inTags = false
  for (const l of lines) {
    const tag = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/.exec(l)
    if (tag) {
      if (!inTags) { cur = { headers: {}, body: '' }; games.push(cur); inTags = true }
      cur.headers[tag[1]] = tag[2]
    } else if (cur) {
      if (l.trim()) inTags = false
      cur.body += `${l}\n`
    }
  }
  const puzzles = []
  let skipped = 0
  for (const { headers, body } of games) {
    if (!headers.FEN) { skipped++; continue } // sin posición inicial es una partida, no un problema
    let chess
    try { chess = new Chess(headers.FEN) } catch { skipped++; continue }
    const fen = chess.fen()
    const solution = []
    for (const san of sanTokens(body)) {
      try { solution.push(uciOf(chess.move(san))) } catch { break }
    }
    const name = [headers.White, headers.Black].filter((x) => x && x !== '?').join(' – ') || (headers.Event && headers.Event !== '?' ? headers.Event : '')
    const comment = body.match(/\{([^}]*)\}/)?.[1]?.trim() || ''
    puzzles.push(bookPuzzle(set, fen, solution, name, puzzles.length + 1, [], comment))
  }
  return { puzzles, skipped }
}

function bookPuzzle(set, fen, solution, name, n, alts = [], comment = '') {
  return {
    id: `book:${hash(`${set}|${fen}|${solution.join(' ')}`)}`,
    kind: 'book', set, n, fen, solution, alts, name, comment, added: Date.now(),
  }
}
