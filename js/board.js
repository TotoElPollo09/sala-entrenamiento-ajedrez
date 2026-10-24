// Tablero de estudio: cm-chessboard para dibujar, chess.js para las reglas.
import { Chessboard, COLOR, INPUT_EVENT_TYPE, BORDER_TYPE } from '../vendor/cm-chessboard/src/Chessboard.js'
import { Markers, MARKER_TYPE } from '../vendor/cm-chessboard/src/extensions/markers/Markers.js'
import { Arrows, ARROW_TYPE } from '../vendor/cm-chessboard/src/extensions/arrows/Arrows.js'
import { PromotionDialog, PROMOTION_DIALOG_RESULT_TYPE } from '../vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js'
import { Chess, DEFAULT_POSITION } from '../vendor/chess.js'
import { enableAnnotations, clear as clearAnnotations, setProgramArrows } from './annotations.js'

const ASSETS = new URL('../vendor/cm-chessboard/assets/', import.meta.url).href

export { Chess, DEFAULT_POSITION, ARROW_TYPE }

// Clave de posición para el árbol de aperturas: sin los contadores de jugadas.
export const fenKey = (fen) => fen.split(' ').slice(0, 4).join(' ')

export class StudyBoard {
  constructor(el, { orientation = 'w', onChange } = {}) {
    this.onChange = onChange
    this.startFen = DEFAULT_POSITION
    this.positions = [DEFAULT_POSITION] // positions[n] = posición tras n medias jugadas
    this.moves = [] // {san, from, to, color, fen}
    this.ply = 0
    this.board = new Chessboard(el, {
      position: DEFAULT_POSITION,
      orientation: orientation === 'b' ? COLOR.black : COLOR.white,
      assetsUrl: ASSETS,
      style: { cssClass: 'default', borderType: BORDER_TYPE.none, showCoordinates: true, animationDuration: 180 },
      extensions: [{ class: Markers, props: { autoMarkers: MARKER_TYPE.frame } }, { class: Arrows }, { class: PromotionDialog }],
    })
    this.board.enableMoveInput((e) => this.#input(e))
    enableAnnotations(this.board)
  }

  get fen() { return this.positions[this.ply] }
  get orientation() { return this.board.getOrientation() === COLOR.black ? 'b' : 'w' }
  get turn() { return this.fen.split(' ')[1] }

  #input(event) {
    const chess = new Chess(this.fen)
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) {
      const moves = chess.moves({ square: event.squareFrom, verbose: true })
      event.chessboard.removeLegalMovesMarkers?.()
      event.chessboard.addLegalMovesMarkers?.(moves)
      return moves.length > 0
    }
    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      event.chessboard.removeLegalMovesMarkers?.()
      const legal = chess.moves({ square: event.squareFrom, verbose: true }).filter((m) => m.to === event.squareTo)
      if (!legal.length) return false
      if (legal[0].promotion) {
        const color = chess.turn() === 'w' ? COLOR.white : COLOR.black
        event.chessboard.showPromotionDialog(event.squareTo, color, (result) => {
          if (result.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) {
            this.play({ from: event.squareFrom, to: event.squareTo, promotion: result.piece.charAt(1) })
          } else {
            this.board.setPosition(this.fen)
          }
        })
        return true
      }
      // Esperar a que termine el arrastre antes de redibujar (enroques, al paso).
      event.chessboard.state.moveInputProcess.then(() => this.play({ from: event.squareFrom, to: event.squareTo }))
      return true
    }
    if (event.type === INPUT_EVENT_TYPE.moveInputCanceled) event.chessboard.removeLegalMovesMarkers?.()
    return undefined
  }

  // Juega una jugada (SAN o {from,to,promotion}) desde la posición actual.
  // Si coincide con la siguiente de la línea, solo avanza; si no, sustituye el resto de la línea.
  play(move) {
    const chess = new Chess(this.fen)
    let m
    try { m = chess.move(move) } catch { this.board.setPosition(this.fen); return null }
    const next = this.moves[this.ply]
    if (next && next.san === m.san) {
      this.goto(this.ply + 1)
      return m
    }
    this.moves = this.moves.slice(0, this.ply)
    this.positions = this.positions.slice(0, this.ply + 1)
    this.moves.push({ san: m.san, from: m.from, to: m.to, color: m.color, fen: chess.fen() })
    this.positions.push(chess.fen())
    this.goto(this.ply + 1)
    return m
  }

  // Carga una lista de jugadas SAN. Devuelve cuántas se pudieron jugar.
  loadMoves(sans, startFen = DEFAULT_POSITION, { goto = 'start' } = {}) {
    const chess = new Chess(startFen)
    this.startFen = startFen
    this.positions = [chess.fen()]
    this.moves = []
    for (const san of sans) {
      let m
      try { m = chess.move(san) } catch { break }
      this.moves.push({ san: m.san, from: m.from, to: m.to, color: m.color, fen: chess.fen() })
      this.positions.push(chess.fen())
    }
    this.goto(goto === 'end' ? this.moves.length : 0)
    return this.moves.length
  }

  loadPgn(pgn) {
    const chess = new Chess()
    chess.loadPgn(pgn) // lanza un error si el PGN no es válido
    const headers = chess.getHeaders ? chess.getHeaders() : chess.header()
    const sans = chess.history()
    const start = headers.FEN || DEFAULT_POSITION
    this.loadMoves(sans, start)
    return { headers, count: sans.length }
  }

  reset() { this.loadMoves([]) }

  goto(ply) {
    const before = this.fen
    this.ply = Math.max(0, Math.min(ply, this.moves.length))
    if (this.fen !== before) clearAnnotations(this.board)
    this.board.setPosition(this.fen, true)
    this.board.removeMarkers?.(MARKER_TYPE.square)
    const last = this.moves[this.ply - 1]
    if (last) {
      this.board.addMarker?.(MARKER_TYPE.square, last.from)
      this.board.addMarker?.(MARKER_TYPE.square, last.to)
    }
    this.onChange?.(this)
  }

  first() { this.goto(0) }
  prev() { this.goto(this.ply - 1) }
  next() { this.goto(this.ply + 1) }
  last() { this.goto(this.moves.length) }

  flip() {
    this.board.setOrientation(this.orientation === 'w' ? COLOR.black : COLOR.white)
    this.onChange?.(this)
  }
  setOrientation(color) { this.board.setOrientation(color === 'b' ? COLOR.black : COLOR.white) }

  setArrows(list) {
    setProgramArrows(this.board, list, ARROW_TYPE.default)
  }

  sanLine() { return this.moves.slice(0, this.ply).map((m) => m.san) }
}

// Convierte una línea UCI (e2e4 e7e5 …) en SAN desde una posición.
export function uciToSan(fen, uciMoves, max = 10) {
  const chess = new Chess(fen)
  const out = []
  for (const u of uciMoves.slice(0, max)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })
      out.push(m.san)
    } catch { break }
  }
  return out
}

// Numera una línea SAN para mostrarla: "12. Cf3 Cc6 13. …"
export function numberLine(fen, sans) {
  const [, turn, , , , full] = fen.split(' ')
  let n = Number(full) || 1
  let white = turn === 'w'
  const parts = []
  sans.forEach((s, i) => {
    if (white) parts.push(`${n}.`)
    else if (i === 0) parts.push(`${n}…`)
    parts.push(s)
    if (!white) n += 1
    white = !white
  })
  return parts.join(' ')
}

// Atajos de teclado ← → ↑ ↓ para recorrer las jugadas del tablero visible.
export function bindKeys(getBoard) {
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return
    const b = getBoard()
    if (!b) return
    if (e.key === 'ArrowLeft') { b.prev(); e.preventDefault() }
    if (e.key === 'ArrowRight') { b.next(); e.preventDefault() }
    if (e.key === 'ArrowUp') { b.first(); e.preventDefault() }
    if (e.key === 'ArrowDown') { b.last(); e.preventDefault() }
  })
}
