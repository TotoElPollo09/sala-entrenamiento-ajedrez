// Página Studio: mesa de análisis al estilo ChessBase.
// Cinta de comandos arriba (Inicio, Insertar, Tablero, Motor), tableros en pestañas, notación con variantes, comentarios y
// signos de valoración, referencia de "mi base" con Elo medio y rendimiento (la base grande de R2 si está configurada, si no la
// base local del navegador), libro de Lichess, Stockfish con varias líneas, perfil de evaluación y barra de estado.
// Los paneles se pueden mover como en ChessMonitor Studio (dock.js).
/* global d3 */
import { Chessboard, COLOR, INPUT_EVENT_TYPE, BORDER_TYPE } from '../vendor/cm-chessboard/src/Chessboard.js'
import { Markers, MARKER_TYPE } from '../vendor/cm-chessboard/src/extensions/markers/Markers.js'
import { Arrows, ARROW_TYPE } from '../vendor/cm-chessboard/src/extensions/arrows/Arrows.js'
import { PromotionDialog, PROMOTION_DIALOG_RESULT_TYPE } from '../vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js'
import { enableAnnotations, clear as clearAnnotations, setProgramArrows } from './annotations.js'
import { Chess, DEFAULT_POSITION } from '../vendor/chess.js'
import { uciToSan } from './board.js'
import { sharedEngine, formatScore, whitePov } from './engine.js'
import { ExplorerPanel } from './explorer-panel.js'
import { countGames, getGame } from './db.js'
import { GameTree, NAGS, POS_NAGS, parsePgn, splitPgn, treeFromGame } from './studio-tree.js'
import { loadIndex, resetIndex, queryLine, continuation } from './studio-index.js'
import { Dock } from './dock.js'
import * as bigbase from './bigbase.js'

const ASSETS = new URL('../vendor/cm-chessboard/assets/', import.meta.url).href
const KEY = 'ajedrez-web:studio'
const MAX_TABS = 12
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }
const fig = (san) => san.replace(/[KQRBN]/g, (c) => FIG[c])
const fmtN = d3.format(',')

const I = {
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  first: '<path d="M6 5v14M18 6l-8 6 8 6z"/>', prev: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>', last: '<path d="M18 5v14M6 6l8 6-8 6z"/>',
  flip: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', paste: '<path d="M8 4h8v4H8zM16 6h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/>',
  save: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>', plus: '<path d="M12 5v14M5 12h14"/>', play: '<path d="M7 4l13 8-13 8z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  tree: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>', cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>',
  info: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6M7 17h8"/>',
  main: '<path d="M6 3v18"/><path d="M18 6v4a4 4 0 0 1-4 4H6"/><path d="m15 9 3-3 3 3"/>',
  novars: '<path d="M6 3v18"/><path d="M18 6a9 9 0 0 1-9 9"/><path d="M14 4l8 8M22 4l-8 8"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/>',
  nocomment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="m9 8 6 6M15 8l-6 6"/>',
  arrow: '<path d="M5 19 19 5M9 5h10v10"/>', palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0 0 21 9.8C21 6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="14.5" cy="7" r="1"/>',
  insert: '<path d="M4 6h10M4 12h7M4 18h7"/><path d="M17 11v8M13 15h8"/>', profile: '<path d="M3 12h18"/><path d="M5 12V8M8 12V5M11 12v-3M14 12v5M17 12v3M20 12V9"/>',
  book: '<path d="M4 4h6a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H4z"/><path d="M20 4h-5a3 3 0 0 0-2 1"/><path d="M20 4v15h-6"/>',
}
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`
const tool = (act, icon, label) => `<button type="button" class="st-tb" data-act="${act}" title="${label}" aria-label="${label}">${svg(icon)}</button>`
// Botón grande de la cinta (icono encima del texto, como en ChessBase).
const rb = (act, icon, label, tip = label) => `<button type="button" class="cb-rb" data-act="${act}" title="${tip}">${svg(icon)}<span>${label}</span></button>`
const grp = (name, inner) => `<div class="cb-grp"><div class="cb-gi">${inner}</div><span class="cb-gl">${name}</span></div>`
const NAG_TIPS = { 1: 'Buena jugada', 2: 'Error', 3: 'Jugada brillante', 4: 'Error grave', 5: 'Jugada interesante', 6: 'Jugada dudosa', 7: 'Única jugada',
  10: 'Igualdad', 13: 'Posición poco clara', 14: 'Las blancas están algo mejor', 15: 'Las negras están algo mejor', 16: 'Las blancas están mejor',
  17: 'Las negras están mejor', 18: 'Las blancas ganan', 19: 'Las negras ganan' }
const nagBtn = (k, g) => `<button type="button" class="cb-gb" data-nag="${k}" title="${NAG_TIPS[k]} (${g})" aria-label="${NAG_TIPS[k]}">${g}</button>`
const BOARD_THEMES = { azul: 'Azul', madera: 'Madera', verde: 'Verde' }
const RESULTS = ['*', '1-0', '1/2-1/2', '0-1']

const HTML = `
<div class="cb-app">
<div class="cb-ribbon" id="cb-ribbon">
  <div class="cb-rtabs" role="tablist" aria-label="Cinta de comandos">
    <button type="button" role="tab" data-rt="inicio">Inicio</button><button type="button" role="tab" data-rt="insertar">Insertar</button><button type="button" role="tab" data-rt="tablero">Tablero</button><button type="button" role="tab" data-rt="motor">Motor</button>
    <span class="cb-rspace"></span>
    <span class="dk-closed" id="st-closed"></span>
    <button type="button" class="st-tb" id="st-reset" title="Restablecer el diseño de los paneles" aria-label="Restablecer el diseño de los paneles">${svg('reset')}</button>
  </div>
  <div class="cb-rpane" data-rp="inicio">
    ${grp('Partida', rb('new', 'file', 'Nueva', 'Nuevo tablero') + rb('paste', 'paste', 'Pegar', 'Pegar PGN o FEN') + rb('copy', 'copy', 'Copiar', 'Copiar PGN con variantes y comentarios') + rb('save', 'save', 'Guardar', 'Descargar .pgn') + rb('headers', 'info', 'Datos', 'Datos de la partida (jugadores, Elo, torneo, fecha, resultado)'))}
    ${grp('Variante', rb('promote', 'up', 'Subir', 'Subir la variante un nivel') + rb('main', 'main', 'Principal', 'Convertir la variante en línea principal') + rb('cut', 'cut', 'Borrar resto', 'Borrar desde esta jugada') + rb('novars', 'novars', 'Sin variantes', 'Borrar todas las variantes'))}
    ${grp('Navegar', tool('first', 'first', 'Inicio') + tool('prev', 'prev', 'Anterior') + tool('next', 'next', 'Siguiente') + tool('last', 'last', 'Final'))}
  </div>
  <div class="cb-rpane" data-rp="insertar" hidden>
    ${grp('Jugada', [1, 2, 3, 4, 5, 6, 7].map((k) => nagBtn(k, NAGS[k] || POS_NAGS[k])).join(''))}
    ${grp('Valoración', [10, 13, 14, 15, 16, 17, 18, 19].map((k) => nagBtn(k, POS_NAGS[k])).join(''))}
    ${grp('Texto', rb('comment', 'comment', 'Comentario', 'Escribir un comentario tras la jugada') + rb('nocomments', 'nocomment', 'Sin comentarios', 'Borrar todos los comentarios'))}
  </div>
  <div class="cb-rpane" data-rp="tablero" hidden>
    ${grp('Vista', rb('flip', 'flip', 'Girar', 'Girar el tablero') + rb('arrows', 'arrow', 'Flecha', 'Mostrar la mejor jugada del motor con una flecha'))}
    ${grp('Colores', Object.entries(BOARD_THEMES).map(([k, v]) => `<button type="button" class="cb-sw" data-theme-board="${k}" title="Tablero ${v}"><i></i><span>${v}</span></button>`).join(''))}
  </div>
  <div class="cb-rpane" data-rp="motor" hidden>
    ${grp('Análisis', rb('engine', 'cpu', 'Motor', 'Encender o apagar Stockfish') + rb('insertpv', 'insert', 'Insertar línea', 'Añadir la mejor línea del motor como variante') + rb('profile', 'profile', 'Perfil', 'Analizar toda la partida para dibujar el perfil de evaluación'))}
  </div>
</div>
<div class="st-dock" id="st-dock"></div>
<div class="cb-status" id="cb-status" aria-live="polite"><span id="cb-s-open"></span><span id="cb-s-move"></span><span id="cb-s-ref"></span><span id="cb-s-eng"></span></div>
</div>
<div id="st-panels">
  <div class="st-pn st-pn-board" data-pn="board">
    <div class="st-boardbar">
      <div class="st-tabs" role="tablist" aria-label="Tableros"></div>
    </div>
    <div class="cb-player cb-top" id="cb-top"></div>
    <div class="st-board-area"><div class="board" id="st-board"></div></div>
    <div class="cb-player cb-bot" id="cb-bot"></div>
    <div class="cb-nav">
      ${tool('first', 'first', 'Inicio')}${tool('prev', 'prev', 'Anterior')}${tool('next', 'next', 'Siguiente')}${tool('last', 'last', 'Final')}<span class="st-sep"></span>${tool('flip', 'flip', 'Girar el tablero')}
    </div>
  </div>
  <div class="st-pn" data-pn="notation">
    <div class="st-notation cb-notation" id="st-notation" aria-live="polite"></div>
    <div class="cb-prof" id="cb-prof" title="Perfil de evaluación: pulsa para ir a esa jugada"></div>
    <textarea class="st-comment" id="st-comment" rows="2" placeholder="Comentario de esta jugada…"></textarea>
    <p class="note st-msg" id="st-msg"></p>
  </div>
  <div class="st-pn" data-pn="games">
    <div class="pn-bar"><span class="sp-sub" id="st-games-sub"></span></div>
    <div class="st-scroll"><table class="table clickable st-gt"><thead><tr>
      <th data-sort="w">Blancas</th><th class="n" data-sort="we">Elo</th><th data-sort="b">Negras</th><th class="n" data-sort="be">Elo</th><th data-sort="r">Res.</th><th class="n hide-narrow" data-sort="ply">Jug.</th><th class="hide-narrow" data-sort="ev">Torneo</th><th data-sort="d">Fecha</th><th class="hide-narrow">Sigue</th>
    </tr></thead><tbody></tbody></table></div>
  </div>
  <div class="st-pn" data-pn="tree">
    <div class="st-tf">
      <input id="st-player" placeholder="Jugador (opcional)" list="st-players" aria-label="Filtrar por jugador">
      <div class="seg st-color" role="group" aria-label="Color del jugador">
        <button type="button" data-c="any" title="Con cualquier color">A</button><button type="button" data-c="w" title="Con blancas">B</button><button type="button" data-c="b" title="Con negras">N</button>
      </div>
      <span class="sp-sub" id="st-tree-sub"></span>
    </div>
    <datalist id="st-players"></datalist>
    <div class="st-scroll"><table class="table clickable st-tt"><thead><tr>
      <th>Jugada</th><th class="n">N</th><th class="n" title="Puntuación del bando que hace la jugada">%</th><th class="n" title="Elo medio de quien hace la jugada">Elo</th><th class="n hide-narrow" title="Rendimiento de quien hace la jugada">Perf.</th><th class="n hide-narrow" title="Última vez que se jugó">Último</th><th class="hide-narrow">B / T / N</th>
    </tr></thead><tbody></tbody></table></div>
  </div>
  <div class="st-pn" data-pn="lichess"><div class="st-ex" id="st-ex"></div></div>
  <div class="st-pn" data-pn="engine">
    <div class="pn-bar st-eh">
      <button type="button" class="st-tb st-run" id="st-run" title="Encender o apagar el motor" aria-label="Encender o apagar el motor"></button>
      <b class="cb-eval" id="cb-eval"></b>
      <span class="st-ed" id="st-depth"></span>
      <label class="st-sel">Prof. <select id="st-maxd"><option value="18">18</option><option value="22">22</option><option value="26">26</option><option value="30">30</option><option value="99">∞</option></select></label>
      <span class="st-lines">Líneas <button type="button" class="st-tb" data-lines="-1" aria-label="Menos líneas">−</button><b id="st-nlines">3</b><button type="button" class="st-tb" data-lines="1" aria-label="Más líneas">+</button></span>
    </div>
    <ol class="st-pv" id="st-pv"></ol>
  </div>
</div>
<dialog class="st-dlg" id="st-dlg">
  <form method="dialog">
    <h3>Pegar PGN o FEN</h3>
    <p class="note">Puedes pegar varias partidas a la vez: cada una se abre en su propia pestaña. Las variantes, los comentarios y los signos se conservan.</p>
    <textarea id="st-dlg-text" rows="10" placeholder='[Event "..."] 1. e4 e5 (1... c5 2. Nf3) 2. Nf3 …'></textarea>
    <p class="note" id="st-dlg-msg"></p>
    <div class="row gap"><button class="btn primary" value="open" id="st-dlg-open">Abrir</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>
  </form>
</dialog>
<dialog class="st-dlg" id="cb-hdlg">
  <form method="dialog" class="cb-hform">
    <h3>Datos de la partida</h3>
    <div class="cb-hgrid">
      <label>Blancas <input name="White"></label><label>Elo <input name="WhiteElo" inputmode="numeric"></label>
      <label>Negras <input name="Black"></label><label>Elo <input name="BlackElo" inputmode="numeric"></label>
      <label>Torneo <input name="Event"></label><label>Ronda <input name="Round"></label>
      <label>Lugar <input name="Site"></label><label>Fecha <input name="Date" placeholder="2026.11.15"></label>
      <label>ECO <input name="ECO"></label><label>Resultado <select name="Result">${RESULTS.map((r) => `<option>${r}</option>`).join('')}</select></label>
    </div>
    <div class="row gap"><button class="btn primary" value="ok">Guardar</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>
  </form>
</dialog>`

// Paneles y diseño inicial al estilo ChessBase: tablero a la izquierda con el motor debajo; a la derecha la notación
// (con la referencia y el libro en pestañas) y la lista de partidas debajo.
const PANELS = {
  board: { title: 'Tablero', icon: 'board', closable: false },
  notation: { title: 'Notación', icon: 'list' },
  tree: { title: 'Referencia', icon: 'tree' },
  lichess: { title: 'Libro · Lichess', icon: 'book' },
  games: { title: 'Partidas', icon: 'db' },
  engine: { title: 'Motor · Stockfish 18', icon: 'cpu' },
}
const stack = (id) => ({ t: 'stack', p: [id], a: id })
const LAYOUT_V = 2 // al cambiar el diseño inicial se sube, para que los diseños guardados antiguos no lo tapen
const DEFAULT_LAYOUT = {
  t: 'row', s: [54, 46], c: [
    { t: 'col', s: [72, 28], c: [stack('board'), stack('engine')] },
    { t: 'col', s: [58, 42], c: [{ t: 'stack', p: ['notation', 'tree', 'lichess'], a: 'notation' }, stack('games')] },
  ],
}

// ---- Tablero ----

class StudioBoard {
  constructor(el, onMove) {
    this.onMove = onMove
    this.fen = DEFAULT_POSITION
    this.board = new Chessboard(el, {
      position: DEFAULT_POSITION, assetsUrl: ASSETS,
      style: { cssClass: 'default', borderType: BORDER_TYPE.none, showCoordinates: true, animationDuration: 160 },
      extensions: [{ class: Markers, props: { autoMarkers: MARKER_TYPE.frame } }, { class: Arrows }, { class: PromotionDialog }],
    })
    this.board.enableMoveInput((e) => this.#input(e))
    enableAnnotations(this.board)
  }

  #input(event) {
    const chess = new Chess(this.fen)
    if (event.type === INPUT_EVENT_TYPE.moveInputStarted) return chess.moves({ square: event.squareFrom }).length > 0
    if (event.type === INPUT_EVENT_TYPE.validateMoveInput) {
      const legal = chess.moves({ square: event.squareFrom, verbose: true }).filter((m) => m.to === event.squareTo)
      if (!legal.length) return false
      if (legal[0].promotion) {
        event.chessboard.showPromotionDialog(event.squareTo, chess.turn() === 'w' ? COLOR.white : COLOR.black, (r) => {
          if (r.type === PROMOTION_DIALOG_RESULT_TYPE.pieceSelected) this.onMove({ from: event.squareFrom, to: event.squareTo, promotion: r.piece.charAt(1) })
          else this.board.setPosition(this.fen)
        })
        return true
      }
      event.chessboard.state.moveInputProcess.then(() => this.onMove({ from: event.squareFrom, to: event.squareTo }))
      return true
    }
    return undefined
  }

  show(node) {
    if (node.fen !== this.fen) clearAnnotations(this.board)
    this.fen = node.fen
    this.board.setPosition(node.fen, true)
    this.board.removeMarkers?.(MARKER_TYPE.square)
    if (node.from) { this.board.addMarker?.(MARKER_TYPE.square, node.from); this.board.addMarker?.(MARKER_TYPE.square, node.to) }
  }

  get orientation() { return this.board.getOrientation() === COLOR.black ? 'b' : 'w' }
  setOrientation(c) { this.board.setOrientation(c === 'b' ? COLOR.black : COLOR.white) }
  setArrows(list) {
    setProgramArrows(this.board, list, ARROW_TYPE.info)
  }
}

// ---- Estado ----

let root, board, engine, explorer, dock
let layout = null
let tabs = [] // {tree, cur, o}
let active = 0
let prefs = { engineOn: true, lines: 3, depth: 22, player: '', color: 'any', arrows: true, boardTheme: 'azul', ribbon: 'inicio' }
const evals = new Map() // posición (FEN sin contadores) -> {v: peones desde las blancas, d: profundidad}, para el perfil
let lastPv = null // mejor línea del motor en la posición actual: {fen, sans, score, depth}
let profiling = null // análisis de toda la partida en curso: {stop}
let opening = null // {fen, text}: nombre de la apertura según el libro de Lichess
let items = null // índice de la base local
let big = null // datos de la base grande (R2) si está configurada: entonces el árbol y las partidas salen de ella
let bigReq = 0
const playerCache = new Map() // jugador -> todas sus partidas de la base grande, en el formato del índice local
let indexCount = -1
let lastQuery = null
let refTotal = null // partidas de la referencia en la posición actual (para la barra de estado)
let gameSort = null // {col, dir}: 1 = primer clic, -1 = segundo; null = normal (más recientes primero)

// Orden de cada columna de "Partidas de mi base" en el primer clic (el segundo lo invierte).
// Los datos que faltan (Elo, fecha, torneo) van siempre al final.
const RES_ORDER = { '1-0': 0, '½-½': 1, '0-1': 2 }
const SORTS = {
  r: { get: (g) => RES_ORDER[g.r] ?? null, cmp: (a, b) => a - b, title: '1-0 primero' },
  w: { get: (g) => g.w || null, cmp: (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }), title: 'de la A a la Z' },
  b: { get: (g) => g.b || null, cmp: (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }), title: 'de la A a la Z' },
  we: { get: (g) => g.we || null, cmp: (a, b) => b - a, desc: true, title: 'mayor Elo primero' },
  be: { get: (g) => g.be || null, cmp: (a, b) => b - a, desc: true, title: 'mayor Elo primero' },
  ev: { get: (g) => g.ev || null, cmp: (a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }), title: 'de la A a la Z' },
  d: { get: (g) => g.d || null, cmp: (a, b) => (a < b ? -1 : a > b ? 1 : 0), title: 'más antiguas primero' },
  ply: { get: (g) => g.ply || null, cmp: (a, b) => a - b, title: 'menos jugadas primero' },
}

function sortGames(games) {
  if (!gameSort) return games
  const { get, cmp } = SORTS[gameSort.col]
  const dir = gameSort.dir
  return games.map((g) => [get(g), g]).sort(([a], [b]) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : dir * cmp(a, b))).map(([, g]) => g)
}

function paintSort() {
  root.querySelectorAll('.st-gt th[data-sort]').forEach((th) => {
    const on = gameSort?.col === th.dataset.sort
    const up = on && (gameSort.dir === 1) !== Boolean(SORTS[th.dataset.sort].desc)
    th.dataset.dir = on ? (up ? 'a' : 'b') : ''
    th.setAttribute('aria-sort', on ? (up ? 'ascending' : 'descending') : 'none')
    th.title = on && gameSort.dir === 1 ? 'Pulsa para invertir el orden' : on ? 'Pulsa para volver al orden normal' : `Ordenar: ${SORTS[th.dataset.sort].title}`
  })
}

const tab = () => tabs[active]
const $ = (s) => root.querySelector(s)

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}')
    prefs = { ...prefs, ...(s.prefs || {}) }
    layout = s.layoutV === LAYOUT_V ? s.layout || null : null
    for (const t of s.tabs || []) {
      try {
        const tree = parsePgn(t.pgn)
        tabs.push({ tree, cur: tree.fromAddress(t.addr), o: t.o || 'w' })
      } catch { /* pestaña dañada: se descarta */ }
    }
    active = Math.min(s.active || 0, Math.max(0, tabs.length - 1))
  } catch { /* sin almacenamiento */ }
  if (!tabs.length) tabs.push(newTab())
}

let saveTimer = null
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ prefs, layout, layoutV: LAYOUT_V, active, tabs: tabs.map((t) => ({ pgn: t.tree.toPgn(), addr: t.tree.address(t.cur), o: t.o })) }))
    } catch { /* sin almacenamiento o lleno */ }
  }, 300)
}

function newTab(tree = new GameTree(), cur = null) {
  return { tree, cur: cur || tree.root, o: 'w' }
}

function title(t) {
  const h = t.tree.headers
  if (h.White && h.White !== '?' && h.Black && h.Black !== '?') return `${h.White.split(',')[0]} – ${h.Black.split(',')[0]}`
  return 'Tablero'
}

// ---- Página ----

export function init(el) {
  root = el
  root.innerHTML = HTML
  load()
  const panels = {}
  for (const [id, p] of Object.entries(PANELS)) panels[id] = { ...p, icon: svg(p.icon), el: root.querySelector(`[data-pn="${id}"]`) }
  dock = new Dock($('#st-dock'), { panels, layout, defaultLayout: DEFAULT_LAYOUT, onChange: (l) => { layout = l; save(); panelsChanged() } })
  $('#st-panels').remove()
  $('#st-reset').addEventListener('click', () => dock.reset())
  $('#st-closed').addEventListener('click', (e) => { const b = e.target.closest('[data-open]'); if (b) dock.open(b.dataset.open) })
  paintClosed()
  openKey = dock.ids().sort().join()
  board = new StudioBoard($('#st-board'), (mv) => playMove(mv))
  engine = sharedEngine()

  $('.st-tabs').addEventListener('click', (e) => {
    const x = e.target.closest('[data-close]')
    if (x) { closeTab(Number(x.dataset.close)); return }
    const t = e.target.closest('[data-tab]')
    if (t) { active = Number(t.dataset.tab); showTab(); return }
    if (e.target.closest('[data-new]')) openTab(newTab())
  })
  // Cinta de comandos (pestañas Inicio, Insertar, Tablero, Motor) y barra de navegación bajo el tablero.
  $('.cb-rtabs').addEventListener('click', (e) => { const b = e.target.closest('[data-rt]'); if (b) { prefs.ribbon = b.dataset.rt; save(); paintRibbon() } })
  root.querySelectorAll('.cb-rpane, .cb-nav').forEach((el) => el.addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.nag) {
      if (!tab().cur.parent) { msg('Los signos se ponen a una jugada: avanza al menos una.'); return }
      tab().tree.toggleNag(tab().cur, Number(b.dataset.nag)); renderNotation({ keepScroll: true }); paintNags(); save(); return
    }
    if (b.dataset.themeBoard) { prefs.boardTheme = b.dataset.themeBoard; save(); paintRibbon(); return }
    command(b.dataset.act)
  }))
  paintRibbon()
  $('#cb-prof').addEventListener('click', (e) => {
    const bar = e.target.closest('[data-id]')
    if (bar) go(tab().tree.byId.get(Number(bar.dataset.id)))
  })
  $('#st-notation').addEventListener('dblclick', (e) => { if (e.target.closest('.cb-head')) openHeaders() })
  $('#cb-hdlg').addEventListener('close', () => { if ($('#cb-hdlg').returnValue === 'ok') saveHeaders() })
  $('#st-notation').addEventListener('click', (e) => {
    if (e.target.closest('.cb-head-edit')) { openHeaders(); return }
    const m = e.target.closest('[data-id]')
    if (m) go(tab().tree.byId.get(Number(m.dataset.id)))
  })
  $('#st-comment').addEventListener('input', (e) => {
    tab().cur.comment = e.target.value
    renderNotation({ keepScroll: true })
    save()
  })

  // Motor
  $('#st-run').addEventListener('click', () => command('engine'))
  $('#st-maxd').value = String(prefs.depth)
  $('#st-maxd').addEventListener('change', (e) => { prefs.depth = Number(e.target.value); save(); analyze() })
  root.querySelectorAll('[data-lines]').forEach((b) => b.addEventListener('click', () => {
    prefs.lines = Math.max(1, Math.min(5, prefs.lines + Number(b.dataset.lines))); save(); paintEngineControls(); analyze()
  }))
  $('#st-pv').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-pv]')
    if (!li) return
    const sans = JSON.parse(li.dataset.pv)
    const k = e.target.closest('[data-k]') ? Number(e.target.closest('[data-k]').dataset.k) + 1 : 1
    go(tab().tree.playLine(tab().cur, sans.slice(0, k)))
  })
  paintEngineControls()

  // Árbol de la base local
  $('#st-player').value = prefs.player
  $('#st-player').addEventListener('change', (e) => { prefs.player = e.target.value.trim(); save(); queryLocal() })
  // Con la base grande, sugerencias de nombres mientras se escribe (mínimo 3 letras).
  let suggestTimer = null
  $('#st-player').addEventListener('input', (e) => {
    clearTimeout(suggestTimer)
    const q = e.target.value.trim()
    if (!big || q.length < 3) return
    suggestTimer = setTimeout(async () => {
      const found = await bigbase.findPlayers(q).catch(() => [])
      $('#st-players').replaceChildren(...found.slice(0, 30).map((p) => { const o = document.createElement('option'); o.value = p.name; o.label = `${fmtN(p.ids.length)} partidas`; return o }))
    }, 300)
  })
  root.querySelectorAll('.st-color button').forEach((b) => b.addEventListener('click', () => { prefs.color = b.dataset.c; save(); paintColor(); queryLocal() }))
  paintColor()
  $('.st-tt tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-san]'); if (tr) playMove(tr.dataset.san) })
  $('.st-gt thead').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]')
    if (!th) return
    const col = th.dataset.sort
    // Primer clic: orden de la columna; segundo: al revés; tercero: orden normal.
    gameSort = gameSort?.col !== col ? { col, dir: 1 } : gameSort.dir === 1 ? { col, dir: -1 } : null
    paintSort()
    lastQuery = null
    queryLocal()
  })
  paintSort()
  $('.st-gt tbody').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openFromBase(tr.dataset.id) })

  explorer = new ExplorerPanel($('#st-ex'), {
    onMove: (san) => playMove(san),
    onGame: (pgn) => openPgnTab(pgn, { keepPosition: true }),
    onResult: (r, fen) => {
      // Como en ChessBase, se sigue mostrando la última apertura con nombre mientras la partida avanza.
      if (r.opening) opening = { fen, text: `${r.opening.eco} ${r.opening.name}` }
      else if (!tab().cur.parent) opening = null
      paintStatus()
    },
  })

  // Diálogo de PGN
  $('#st-dlg').addEventListener('close', () => { if ($('#st-dlg').returnValue === 'open') importText($('#st-dlg-text').value) })

  showTab()
}

// Órdenes de la cinta y de la barra de navegación.
function command(act) {
  const t = tab()
  const changed = () => { renderNotation({ keepScroll: true }); save() }
  if (act === 'first') go(t.tree.root)
  else if (act === 'prev') go(t.cur.parent || t.cur)
  else if (act === 'next') go(t.cur.children[0] || t.cur)
  else if (act === 'last') go(t.tree.mainEnd(t.cur))
  else if (act === 'flip') { t.o = t.o === 'w' ? 'b' : 'w'; board.setOrientation(t.o); paintPlayers(); save() }
  else if (act === 'new') openTab(newTab())
  else if (act === 'paste') openDialog()
  else if (act === 'copy') copyPgn()
  else if (act === 'save') downloadPgn()
  else if (act === 'headers') openHeaders()
  else if (act === 'promote') { if (t.tree.promote(t.cur)) changed() }
  else if (act === 'main') { if (t.tree.promoteToMain(t.cur)) { changed(); drawProfile() } }
  else if (act === 'cut') { if (t.cur.parent) go(t.tree.remove(t.cur)) }
  else if (act === 'novars') {
    if (!confirmIf(t.tree.byId.size > t.tree.path(t.tree.mainEnd()).length + 1, 'Se borrarán todas las variantes de esta partida. ¿Seguir?')) return
    // Si se estaba en una variante, se vuelve a la línea principal en la misma jugada (o la más cercana).
    let n = t.cur
    while (n.parent && n.parent.children[0] !== n) n = n.parent
    t.tree.removeVariations()
    go(t.tree.byId.has(n.id) ? n : t.tree.root)
  }
  else if (act === 'comment') { const c = $('#st-comment'); c.scrollIntoView({ block: 'nearest' }); c.focus() }
  else if (act === 'nocomments') {
    if (!confirmIf([...t.tree.byId.values()].some((n) => n.comment), 'Se borrarán todos los comentarios de esta partida. ¿Seguir?')) return
    t.tree.removeComments(); update()
  }
  else if (act === 'arrows') { prefs.arrows = !prefs.arrows; save(); paintRibbon(); analyze() }
  else if (act === 'engine') { prefs.engineOn = !prefs.engineOn; save(); paintEngineControls(); paintRibbon(); analyze() }
  else if (act === 'insertpv') insertPv()
  else if (act === 'profile') runProfile()
}

function confirmIf(cond, text) { return !cond || window.confirm(text) }

function paintRibbon() {
  const cur = prefs.ribbon || 'inicio'
  root.querySelectorAll('[data-rt]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.rt === cur)))
  root.querySelectorAll('[data-rp]').forEach((p) => { p.hidden = p.dataset.rp !== cur })
  root.querySelector('[data-act="arrows"]').setAttribute('aria-pressed', String(prefs.arrows))
  root.querySelector('.cb-rpane [data-act="engine"]').setAttribute('aria-pressed', String(prefs.engineOn))
  root.querySelector('[data-act="profile"]').setAttribute('aria-pressed', String(Boolean(profiling)))
  root.querySelector('[data-act="profile"] span').textContent = profiling ? 'Parar perfil' : 'Perfil'
  root.querySelectorAll('[data-theme-board]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBoard === prefs.boardTheme)))
  root.dataset.cbBoard = prefs.boardTheme
}

function paintNags() {
  const n = tab().cur
  root.querySelectorAll('.cb-gb[data-nag]').forEach((b) => b.setAttribute('aria-pressed', String(Boolean(n.parent) && n.nags.includes(Number(b.dataset.nag)))))
}

// Jugadores encima y debajo del tablero, como en la ventana de tablero de ChessBase.
function paintPlayers() {
  const h = tab().tree.headers
  const turn = tab().cur.fen.split(' ')[1]
  const top = tab().o === 'w' ? 'b' : 'w'
  for (const [id, c] of [['#cb-top', top], ['#cb-bot', top === 'w' ? 'b' : 'w']]) {
    const name = c === 'w' ? h.White : h.Black
    const elo = c === 'w' ? h.WhiteElo : h.BlackElo
    const dot = document.createElement('i'); dot.className = `cb-dot ${c}`
    const b = document.createElement('b'); b.textContent = name && name !== '?' ? name : c === 'w' ? 'Blancas' : 'Negras'
    const parts = [dot, b]
    if (elo && /\d/.test(elo)) { const e = document.createElement('span'); e.className = 'cb-elo'; e.textContent = elo; parts.push(e) }
    if (turn === c) { const m = document.createElement('span'); m.className = 'cb-turn'; m.title = 'Le toca mover'; m.textContent = 'mueve'; parts.push(m) }
    $(id).replaceChildren(...parts)
  }
}

// ---- Datos de la partida ----

function openHeaders() {
  const d = $('#cb-hdlg')
  const h = tab().tree.headers
  for (const f of d.querySelectorAll('input, select')) {
    const v = h[f.name]
    f.value = f.name === 'Result' ? (RESULTS.includes(v) ? v : '*') : v && !/^[?.\s-]+$/.test(v) ? v : ''
  }
  d.returnValue = ''
  d.showModal()
}

function saveHeaders() {
  const h = tab().tree.headers
  for (const f of $('#cb-hdlg').querySelectorAll('input, select')) {
    const v = f.value.trim()
    if (v) h[f.name] = v
    else if (['WhiteElo', 'BlackElo', 'ECO'].includes(f.name)) delete h[f.name]
    else h[f.name] = f.name === 'Date' ? '????.??.??' : f.name === 'Round' ? '-' : '?'
  }
  update()
  save()
}

export function shown() {
  board.setOrientation(tab().o)
  update()
  refreshIndex()
}

// Para los atajos de teclado (← → ↑ ↓) de la web.
export function getBoard() {
  const t = tab()
  return {
    prev: () => go(t.cur.parent || t.cur),
    next: () => go(t.cur.children[0] || t.cur),
    first: () => go(t.tree.root),
    last: () => go(t.tree.mainEnd(t.cur)),
  }
}

function visible() { return !root.closest('[hidden]') }

// Paneles cerrados: botones para volver a abrirlos.
function paintClosed() {
  const box = $('#st-closed')
  box.replaceChildren(...dock.closed().map((id) => {
    const b = document.createElement('button')
    b.type = 'button'; b.className = 'btn small'; b.dataset.open = id
    b.innerHTML = `${svg('plus')}<span></span>`
    b.querySelector('span').textContent = PANELS[id].title
    b.title = 'Volver a abrir este panel'
    return b
  }))
}

let openKey = ''
function panelsChanged() {
  paintClosed()
  const key = dock.ids().sort().join()
  if (key === openKey) return
  openKey = key
  if (!visible()) return
  if (dock.isOpen('lichess')) explorer.update(tab().cur.fen, { now: true })
  analyze()
}

function playMove(mv) {
  const t = tab()
  const node = t.tree.play(t.cur, mv)
  if (!node) { board.show(t.cur); return }
  go(node)
  save()
}

function go(node) {
  if (!node) return
  tab().cur = node
  update()
  save()
}

function update() {
  const t = tab()
  board.show(t.cur)
  board.setArrows([])
  renderTabs()
  renderNotation()
  const c = $('#st-comment')
  c.disabled = false
  if (document.activeElement !== c) c.value = t.cur.comment || ''
  c.placeholder = t.cur.parent ? `Comentario tras ${fig(t.cur.san)}…` : 'Comentario inicial de la partida…'
  paintNags()
  paintPlayers()
  drawProfile()
  paintStatus()
  if (!visible()) return
  if (dock.isOpen('lichess')) explorer.update(t.cur.fen)
  queryLocal()
  analyze()
}

function showTab() {
  opening = null
  board.setOrientation(tab().o)
  update()
  save()
}

function openTab(t) {
  if (tabs.length >= MAX_TABS) {
    // Se reutiliza la pestaña más antigua que no sea la actual.
    tabs.splice(active === 0 ? 1 : 0, 1)
    if (active > 0) active -= 1
  }
  tabs.push(t)
  active = tabs.length - 1
  showTab()
}

function closeTab(i) {
  tabs.splice(i, 1)
  if (!tabs.length) tabs.push(newTab())
  if (active >= i && active > 0) active -= 1
  active = Math.min(active, tabs.length - 1)
  showTab()
}

function renderTabs() {
  const bar = $('.st-tabs')
  bar.replaceChildren(...tabs.map((t, i) => {
    const b = document.createElement('div')
    b.className = 'st-tab'
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', String(i === active))
    b.dataset.tab = i
    b.title = title(t)
    b.innerHTML = `${svg('board')}<span></span><button type="button" class="st-x" data-close="${i}" aria-label="Cerrar pestaña">×</button>`
    b.querySelector('span').textContent = title(t)
    return b
  }))
  const add = document.createElement('button')
  add.type = 'button'; add.className = 'st-tb st-add'; add.dataset.new = '1'; add.title = 'Nuevo tablero'; add.setAttribute('aria-label', 'Nuevo tablero')
  add.innerHTML = svg('plus')
  bar.appendChild(add)
  bar.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// ---- Notación con variantes ----

function renderNotation({ keepScroll = false } = {}) {
  const box = $('#st-notation')
  const top = box.scrollTop
  const t = tab()
  const cur = t.cur
  box.replaceChildren()
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e }
  const num = (n) => Number(n.parent.fen.split(' ')[5]) || 1
  const mv = (n, force) => {
    const b = el('button', 'st-mv' + (n === cur ? ' on' : ''))
    b.type = 'button'
    b.dataset.id = n.id
    const label = (n.color === 'w' ? `${num(n)}.` : force ? `${num(n)}…` : '')
    if (label) b.appendChild(el('span', 'st-n', label))
    b.append(fig(n.san) + n.nags.map((x) => NAGS[x] || '').join(''))
    const pos = n.nags.filter((x) => POS_NAGS[x]).map((x) => POS_NAGS[x]).join(' ')
    if (pos) b.appendChild(el('span', 'cb-pn', ` ${pos}`))
    if (n.nags.some((x) => x === 2 || x === 4)) b.classList.add('bad')
    else if (n.nags.some((x) => x === 1 || x === 3)) b.classList.add('good')
    return b
  }
  const line = (start, force, into, depth) => {
    let c = start
    let f = force
    while (c.children.length) {
      const [main, ...alts] = c.children
      into.appendChild(mv(main, f))
      if (main.comment) into.appendChild(el('span', 'st-c', main.comment))
      for (const v of alts) {
        const box2 = el('span', depth === 0 ? 'st-var st-var0' : 'st-var')
        box2.appendChild(mv(v, true))
        if (v.comment) box2.appendChild(el('span', 'st-c', v.comment))
        line(v, Boolean(v.comment), box2, depth + 1)
        into.appendChild(box2)
      }
      f = alts.length > 0 || Boolean(main.comment)
      c = main
    }
  }
  box.appendChild(gameHead(t.tree.headers))
  if (t.tree.root.comment) box.appendChild(el('span', 'st-c', t.tree.root.comment))
  const body = el('div', 'cb-moves')
  line(t.tree.root, true, body, 0)
  const res = t.tree.headers.Result
  if (t.tree.root.children.length && res && res !== '*') body.appendChild(el('b', 'cb-result', res.replace('1/2-1/2', '½–½').replace('-', '–')))
  box.appendChild(body)
  if (!t.tree.root.children.length) box.appendChild(el('p', 'note', 'Mueve las piezas para empezar. Si juegas otra jugada en una posición ya analizada, se crea una variante.'))
  if (keepScroll) box.scrollTop = top
  else box.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
}

// Cabecera de la partida como en ChessBase: jugadores con Elo en negrita y debajo torneo, lugar, ronda, fecha y ECO.
function gameHead(h) {
  const ok = (x) => x && !/^[?.\s-]+$/.test(x)
  const box = document.createElement('div')
  box.className = 'cb-head'
  const l1 = document.createElement('div'); l1.className = 'cb-h1'
  const who = (n, e, def) => `${ok(n) ? n : def}${ok(e) ? ` (${e})` : ''}`
  l1.textContent = `${who(h.White, h.WhiteElo, 'Blancas')} – ${who(h.Black, h.BlackElo, 'Negras')}`
  const res = ok(h.Result) && h.Result !== '*' ? h.Result.replace('1/2-1/2', '½–½') : ''
  if (res) { const r = document.createElement('b'); r.className = 'cb-hres'; r.textContent = res; l1.append(' ', r) }
  const l2 = document.createElement('div'); l2.className = 'cb-h2'
  const date = ok(h.Date) ? h.Date.replace(/\.\?\?/g, '') : ''
  l2.textContent = [ok(h.ECO) ? h.ECO : '', [h.Event, h.Site].filter(ok).join(', '), ok(h.Round) ? `ronda ${h.Round}` : '', date].filter(Boolean).join(' · ') || 'Sin datos de torneo'
  const edit = document.createElement('button')
  edit.type = 'button'; edit.className = 'cb-head-edit st-tb'; edit.title = 'Editar los datos de la partida'; edit.setAttribute('aria-label', 'Editar los datos de la partida')
  edit.innerHTML = svg('info')
  box.append(edit, l1, l2)
  return box
}

// ---- PGN ----

function msg(text) {
  const m = $('#st-msg')
  m.textContent = text
  clearTimeout(msg.t)
  msg.t = setTimeout(() => { m.textContent = '' }, 5000)
}

async function copyPgn() {
  const pgn = tab().tree.toPgn()
  try { await navigator.clipboard.writeText(pgn); msg('PGN copiado, con variantes y comentarios.') }
  catch { downloadPgn() }
}

function downloadPgn() {
  const t = tab()
  const blob = new Blob([t.tree.toPgn()], { type: 'application/x-chess-pgn' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${title(t).replace(/[^\p{L}\p{N} –-]+/gu, '').trim() || 'partida'}.pgn`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

function openDialog() {
  const d = $('#st-dlg')
  $('#st-dlg-text').value = ''
  $('#st-dlg-msg').textContent = ''
  d.returnValue = ''
  d.showModal()
  $('#st-dlg-text').focus()
}

function importText(text) {
  const t = text.trim()
  if (!t) return
  if (/^[rnbqkpRNBQKP1-8/]+ [wb] /.test(t)) {
    try { new Chess(t) } catch { msg('Esa posición FEN no es válida.'); return }
    openTab(newTab(new GameTree(t)))
    return
  }
  let ok = 0, bad = 0
  for (const g of splitPgn(t).slice(0, MAX_TABS)) {
    try { const tree = parsePgn(g); openTab(newTab(tree, tree.root)); ok += 1 } catch { bad += 1 }
  }
  msg(ok ? `${ok} ${ok === 1 ? 'partida abierta' : 'partidas abiertas'}${bad ? ` (${bad} no se pudieron leer)` : ''}.` : 'No se pudo leer: revisa que sea un PGN o FEN válido.')
}

// Abre una partida en una pestaña nueva, en la misma posición que se estaba mirando si pasa por ella.
function openPgnTab(pgn, { keepPosition = false } = {}) {
  const here = tab().cur.fen.split(' ').slice(0, 4).join(' ')
  const tree = parsePgn(pgn)
  let at = tree.root
  if (keepPosition) {
    for (let n = tree.root; n; n = n.children[0]) if (n.fen.split(' ').slice(0, 4).join(' ') === here) { at = n; break }
  }
  openTab(newTab(tree, at))
}

async function openFromBase(id) {
  let g
  try { g = id.startsWith('base:') ? await bigbase.fullGame(id) : await getGame(id) } catch (e) { msg(e.message); return }
  if (!g) return
  const here = tab().cur.fen.split(' ').slice(0, 4).join(' ')
  const tree = treeFromGame(g)
  // Se abre en la posición que se estaba mirando (aunque la partida llegara a ella con otro orden de jugadas).
  let at = tree.root
  for (let n = tree.root; n; n = n.children[0]) if (n.fen.split(' ').slice(0, 4).join(' ') === here) { at = n; break }
  openTab(newTab(tree, at))
}

// ---- Base local: partidas y árbol de la posición ----

async function refreshIndex() {
  big = await bigbase.manifest()
  if (big) { lastQuery = null; queryLocal(); return }
  const n = await countGames().catch(() => 0)
  if (n === indexCount && items) return
  indexCount = n
  resetIndex()
  items = null
  if (!n) { lastQuery = null; queryLocal(); return }
  $('#st-tree-sub').textContent = 'leyendo la base…'
  $('#st-games-sub').textContent = 'leyendo la base…'
  items = await loadIndex((k) => { $('#st-games-sub').textContent = `leyendo la base… ${fmtN(k)}` })
  const names = new Map()
  for (const it of items) for (const nm of [it.w, it.b]) names.set(nm, (names.get(nm) || 0) + 1)
  $('#st-players').innerHTML = ''
  $('#st-players').append(...[...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 300).map(([nm]) => { const o = document.createElement('option'); o.value = nm; return o }))
  lastQuery = null
  queryLocal()
}

function paintColor() {
  root.querySelectorAll('.st-color button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.c === prefs.color)))
}

function queryLocal() {
  const tt = $('.st-tt tbody')
  const gt = $('.st-gt tbody')
  const empty = (tb, cols, text) => { tb.innerHTML = ''; const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = cols; td.className = 'muted'; td.innerHTML = text; tr.appendChild(td); tb.appendChild(tr) }
  const t = tab()
  if (big) { queryBig(); return }
  if (indexCount === 0) {
    const txt = 'Tu base está vacía. Importa partidas en <a href="#database">Base de datos</a> (TWIC, ChessBase, tus torneos) y aparecerán aquí.'
    empty(tt, 7, txt); empty(gt, 9, txt)
    $('#st-tree-sub').textContent = ''; $('#st-games-sub').textContent = ''
    return
  }
  if (!items) return
  if (!t.tree.standardStart) {
    const txt = 'Esta pestaña empieza desde una posición propia; la base se busca desde la posición inicial.'
    empty(tt, 7, txt); empty(gt, 9, txt)
    return
  }
  const sans = t.tree.sanLine(t.cur)
  const key = JSON.stringify([sans, prefs.player, prefs.color, items.length, gameSort])
  if (key === lastQuery) return
  lastQuery = key
  const r = queryLine(items, sans, { player: prefs.player, color: prefs.color })
  const filt = prefs.player ? ` · ${prefs.player}${prefs.color === 'w' ? ' (blancas)' : prefs.color === 'b' ? ' (negras)' : ''}` : ''
  $('#st-tree-sub').textContent = `${fmtN(r.total)} partidas${filt}`
  $('#st-games-sub').textContent = `${fmtN(r.total)} en esta posición${filt} · ${sortLabel('más recientes primero')}`
  paintResults(r, sans)
}

const SORT_NAMES = { r: 'resultado', w: 'blancas', b: 'negras', we: 'Elo de blancas', be: 'Elo de negras', ev: 'torneo', d: 'fecha', ply: 'número de jugadas' }
const sortLabel = (normal) => (gameSort ? `por ${SORT_NAMES[gameSort.col]}` : normal)

function emptyRow(tb, cols, text) {
  tb.innerHTML = ''
  const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = cols; td.className = 'muted'; td.innerHTML = text; tr.appendChild(td); tb.appendChild(tr)
}

// Pinta el árbol ({moves:[{san,n,w,d,l}]}) y la lista de partidas ({games:[item]}) de la posición.
function paintResults(r, sans) {
  const tt = $('.st-tt tbody')
  const gt = $('.st-gt tbody')
  const empty = emptyRow

  const whiteMoves = tab().cur.fen.split(' ')[1] === 'w'
  tt.replaceChildren(...r.moves.slice(0, 40).map((m) => {
    const tr = document.createElement('tr'); tr.dataset.san = m.san
    const td = (cls, text) => { const c = document.createElement('td'); c.className = cls; c.textContent = text; return c }
    const c1 = td('san', fig(m.san))
    const c2 = td('n', fmtN(m.n))
    const decided = m.w + m.d + m.l
    const pct = decided ? Math.round((100 * ((whiteMoves ? m.w : m.l) + m.d / 2)) / decided) : null
    const cp = td('n cb-pct', pct == null ? '–' : `${pct}%`)
    if (pct != null) cp.classList.add(pct >= 55 ? 'good' : pct <= 45 ? 'bad' : 'eq')
    const ce = td('n cb-num', m.avg || m.averageRating || '–')
    const cf = td('n cb-num hide-narrow', m.perf || '–')
    const cl = td('n cb-num hide-narrow', m.last ? m.last.slice(0, 4) : '–')
    const c3 = document.createElement('td'); c3.className = 'hide-narrow'
    const wrap = document.createElement('div'); wrap.className = 'st-wdl'
    const bar = document.createElement('div'); bar.className = 'wdl'
    ;[[m.w, 'wh'], [m.d, 'd'], [m.l, 'bl']].forEach(([k, c]) => { const s = document.createElement('div'); s.className = c; s.style.flex = k; bar.appendChild(s) })
    const nums = document.createElement('span'); nums.className = 'st-nums'
    nums.innerHTML = `<b class="w">${fmtN(m.w)}</b> / <b class="d">${fmtN(m.d)}</b> / <b class="l">${fmtN(m.l)}</b>`
    wrap.append(bar, nums)
    c3.appendChild(wrap)
    tr.append(c1, c2, cp, ce, cf, cl, c3)
    return tr
  }))
  refTotal = r.total
  paintStatus()
  if (!r.moves.length) empty(tt, 7, r.deep ? 'Línea demasiado larga para el árbol (más de 60 medias jugadas).' : 'Ninguna partida de tu base sigue desde aquí.')

  gt.replaceChildren(...sortGames(r.games).slice(0, 1000).map((g) => {
    const tr = document.createElement('tr'); tr.dataset.id = g.id
    const cells = [
      [g.w, 'st-name' + (g.r === '1-0' ? ' win' : '')], [g.we || '', 'n'], [g.b, 'st-name' + (g.r === '0-1' ? ' win' : '')], [g.be || '', 'n'],
      [g.r === '½-½' ? '½-½' : g.r, 'st-res ' + (g.r === '1-0' ? 'w' : g.r === '0-1' ? 'l' : 'd')],
      [g.ply ? Math.ceil(g.ply / 2) : '', 'n hide-narrow'], [g.ev, 'st-ev hide-narrow'], [g.d, 'st-date'],
      [numbered(sans, g.cont || continuation(g, sans)), 'st-cont hide-narrow'],
    ]
    for (const [txt, cls] of cells) { const td = document.createElement('td'); td.className = cls; td.textContent = txt; tr.appendChild(td) }
    return tr
  }))
  if (!r.games.length) empty(gt, 9, r.noGames || 'Ninguna partida de tu base llega a esta posición (con este orden de jugadas).')
}

// ---- Base grande (R2): árbol por posición (con transposiciones) y partidas destacadas ----

const bigItem = (g, extra) => ({
  id: g.id, w: g.white, b: g.black, wl: g.white.toLowerCase(), bl: g.black.toLowerCase(), we: g.whiteElo, be: g.blackElo,
  r: g.result, d: g.date, ev: g.event, ply: g.moves?.length || 0, ...extra,
})

// Jugadas que siguen en la partida desde la posición fen (aunque llegara a ella con otro orden).
function contFrom(g, fen, max = 8) {
  const here = fen.split(' ').slice(0, 4).join(' ')
  const c = new Chess()
  for (let i = 0; i <= g.moves.length; i++) {
    if (c.fen().split(' ').slice(0, 4).join(' ') === here) return g.moves.slice(i, i + max)
    try { c.move(g.moves[i]) } catch { break }
  }
  return []
}

// Todas las partidas del jugador en la base grande, con jugadas, para construir su árbol.
// Se descargan por bloques y el panel se va actualizando mientras llegan.
let playerLoad = null // {key, name, total, items, done, stopped}
function playerItems(name) {
  const k = name.toLowerCase()
  if (playerLoad?.key === k) return playerLoad
  if (playerLoad && !playerLoad.done) playerLoad.stopped = true
  const cached = playerCache.get(k)
  if (cached) return (playerLoad = cached)
  const pl = { key: k, name, total: 0, items: [], done: false, stopped: false, found: true }
  playerLoad = pl
  ;(async () => {
    const found = await bigbase.findPlayers(name)
    const pick = found.find((x) => x.name.toLowerCase() === k) || found[0]
    if (!pick) { pl.found = false; pl.done = true; refreshPlayer(pl); return }
    pl.name = pick.name; pl.total = pick.ids.length
    let last = 0
    await bigbase.gamesOf(pick.ids, {
      stop: () => pl.stopped,
      onBatch: (games) => {
        pl.items.push(...games.map((g) => bigItem(g, { line: g.moves.slice(0, 60).join(' ') })))
        if (Date.now() - last > 1200) { last = Date.now(); refreshPlayer(pl) }
      },
    })
    if (pl.stopped) return
    pl.done = true
    playerCache.set(k, pl)
    refreshPlayer(pl)
  })().catch((e) => { pl.error = e.message; pl.done = true; refreshPlayer(pl) })
  return pl
}

function refreshPlayer(pl) {
  if (pl !== playerLoad || !big || !visible()) return
  lastQuery = null
  queryBig()
}

async function queryBig() {
  const t = tab()
  const sans = t.tree.sanLine(t.cur)
  const fen = t.cur.fen
  const key = JSON.stringify(['big', fen, sans, prefs.player, prefs.color, gameSort])
  if (key === lastQuery) return
  lastQuery = key
  const id = ++bigReq
  const name = big.nombre
  try {
    if (prefs.player) {
      if (!t.tree.standardStart) { emptyRow($('.st-tt tbody'), 7, 'El filtro de jugador busca desde la posición inicial.'); emptyRow($('.st-gt tbody'), 9, ''); return }
      const pl = playerItems(prefs.player)
      if (pl.error) throw new Error(pl.error)
      const r = queryLine(pl.items, sans, { player: pl.name, color: prefs.color })
      const col = prefs.color === 'w' ? ' (blancas)' : prefs.color === 'b' ? ' (negras)' : ''
      const loading = pl.done ? '' : ` · cargando ${fmtN(pl.items.length)} de ${fmtN(pl.total)}…`
      $('#st-tree-sub').textContent = !pl.found ? `${name}: ningún jugador empieza por "${prefs.player}"`
        : pl.total ? `${fmtN(r.total)} partidas de ${pl.name}${col}${loading}` : 'buscando el jugador…'
      $('#st-games-sub').textContent = `${fmtN(r.total)} en esta posición · ${pl.name}${col} · ${sortLabel('más recientes primero')}${loading}`
      paintResults(r, sans)
      return
    }
    $('#st-tree-sub').textContent = `${name} · cargando…`
    const ex = await bigbase.explore(fen)
    if (id !== bigReq) return
    const total = ex.white + ex.draws + ex.black
    const moves = ex.moves.map((m) => ({ san: m.san, n: m.white + m.draws + m.black, w: m.white, d: m.draws, l: m.black, avg: m.averageRating || null }))
    $('#st-tree-sub').textContent = `${name} · ${fmtN(total)} partidas`
    // Partidas destacadas (las de mayor Elo medio) con sus jugadas desde aquí.
    const full = await Promise.all(ex.topGames.map((g) => bigbase.fullGame(g.id).catch(() => null)))
    if (id !== bigReq) return
    const games = full.filter(Boolean).map((g) => bigItem(g, { cont: contFrom(g, fen) }))
    $('#st-games-sub').textContent = `${name} · ${fmtN(games.length)} partidas destacadas de ${fmtN(total)} (mayor Elo) · ${sortLabel('mayor Elo primero')}`
    paintResults({
      moves, games, total,
      noGames: total ? '' : `Esta posición no está en ${name} (el árbol llega hasta la jugada ${Math.floor(big.maxJugadas / 2)} y a posiciones con al menos ${big.minPartidas} partidas).`,
    }, sans)
    if (!moves.length) emptyRow($('.st-tt tbody'), 7, total ? 'Ninguna partida sigue desde aquí.' : `Esta posición no está en ${name}.`)
  } catch (e) {
    if (id !== bigReq) return
    lastQuery = null
    $('#st-tree-sub').textContent = ''; $('#st-games-sub').textContent = ''
    emptyRow($('.st-tt tbody'), 7, e.message); emptyRow($('.st-gt tbody'), 9, e.message)
  }
}

function numbered(before, sans) {
  let ply = before.length
  return sans.map((s, i) => {
    const w = ply % 2 === 0
    const pre = w ? `${ply / 2 + 1}. ` : i === 0 ? `${(ply + 1) / 2}… ` : ''
    ply += 1
    return pre + fig(s)
  }).join(' ')
}

// ---- Motor ----

function paintEngineControls() {
  const run = $('#st-run')
  run.innerHTML = svg(prefs.engineOn ? 'stop' : 'play')
  run.setAttribute('aria-pressed', String(prefs.engineOn))
  $('#st-nlines').textContent = prefs.lines
}

let pending = 0
async function analyze() {
  const list = $('#st-pv')
  const depthEl = $('#st-depth')
  if (!visible()) return
  const fen = tab().cur.fen
  const id = ++pending
  if (profiling) return
  lastPv = null
  $('#cb-eval').textContent = ''
  if (!prefs.engineOn || !dock.isOpen('engine')) { engine.stop(); list.replaceChildren(); depthEl.textContent = 'apagado'; board.setArrows([]); paintStatus(); return }
  const chess = new Chess(fen)
  if (chess.isGameOver()) {
    engine.stop(); list.replaceChildren()
    depthEl.textContent = chess.isCheckmate() ? 'jaque mate' : 'tablas'
    return
  }
  depthEl.textContent = 'cargando…'
  await engine.ready
  if (id !== pending) return
  const maxD = prefs.depth >= 99 ? 99 : prefs.depth
  await engine.analyze(fen, {
    depth: maxD, multipv: prefs.lines,
    onInfo: ({ depth, lines }) => {
      if (id !== pending) return
      if (!visible()) { engine.stop(); return }
      depthEl.textContent = `Profundidad ${depth} / ${maxD >= 99 ? '∞' : maxD}`
      if (lines[0]) {
        $('#cb-eval').textContent = formatScore(lines[0].score, fen)
        lastPv = { fen, sans: uciToSan(fen, lines[0].pv, 14), score: formatScore(lines[0].score, fen), depth }
        if (depth >= 10) setEval(fen, whitePov(lines[0].score, fen), depth)
        paintStatus()
      }
      list.replaceChildren(...lines.map((l) => {
        const san = uciToSan(fen, l.pv, 14)
        const li = document.createElement('li')
        li.dataset.pv = JSON.stringify(san)
        const sc = document.createElement('span')
        const pov = whitePov(l.score, fen)
        sc.className = 'st-score ' + (pov > 0.3 ? 'wh' : pov < -0.3 ? 'bl' : 'eq')
        sc.textContent = formatScore(l.score, fen)
        const pv = document.createElement('span'); pv.className = 'st-line'
        let [, turn, , , , full] = fen.split(' ')
        let n = Number(full) || 1
        san.forEach((s, k) => {
          if (turn === 'w' || k === 0) pv.append(`${n}${turn === 'w' ? '.' : '…'}`)
          const b = document.createElement('span'); b.className = 'st-pm'; b.dataset.k = k; b.textContent = fig(s)
          pv.append(b, ' ')
          if (turn === 'b') n += 1
          turn = turn === 'w' ? 'b' : 'w'
        })
        li.append(sc, pv)
        return li
      }))
      const best = lines[0]?.pv[0]
      board.setArrows(best && prefs.arrows ? [{ from: best.slice(0, 2), to: best.slice(2, 4) }] : [])
    },
  })
}

// ---- Perfil de evaluación (como el de ChessBase) ----

const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ')
let profTimer = null
function setEval(fen, v, d) {
  const k = posKey(fen)
  const old = evals.get(k)
  if (old && old.d > d) return
  evals.set(k, { v, d })
  clearTimeout(profTimer)
  profTimer = setTimeout(drawProfile, 400)
}

// Barras por jugada de la línea principal: hacia arriba ventaja blanca, hacia abajo negra (±5 peones como máximo).
function drawProfile() {
  const box = $('#cb-prof')
  const t = tab()
  const nodes = t.tree.path(t.tree.mainEnd())
  if (nodes.length < 2) { box.replaceChildren(); box.hidden = true; return }
  box.hidden = false
  const known = nodes.filter((n) => evals.has(posKey(n.fen))).length
  const W = 600, H = 64, mid = H / 2
  const bw = W / nodes.length
  // Jugada de la línea principal más cercana a la actual (si se está en una variante, la de la bifurcación).
  const main = new Set(nodes)
  let curMain = null
  for (const m of t.tree.path(t.cur)) if (main.has(m)) curMain = m
  let bars = ''
  nodes.forEach((n, i) => {
    const e = evals.get(posKey(n.fen))
    const x = (i * bw).toFixed(2)
    if (n === curMain) bars += `<rect class="cb-pcur" x="${x}" y="0" width="${Math.max(bw, 2).toFixed(2)}" height="${H}"/>`
    if (e) {
      const v = Math.max(-5, Math.min(5, e.v))
      const h = Math.max(1, (Math.abs(v) / 5) * (mid - 2))
      const blunder = n.nags.includes(4) || n.nags.includes(2)
      bars += `<rect class="${v >= 0 ? 'cb-pw' : 'cb-pb'}${blunder ? ' cb-px' : ''}" x="${x}" y="${(v >= 0 ? mid - h : mid).toFixed(2)}" width="${Math.max(bw - 0.6, 0.8).toFixed(2)}" height="${h.toFixed(2)}"/>`
    }
    bars += `<rect class="cb-phit" data-id="${n.id}" x="${x}" y="0" width="${bw.toFixed(2)}" height="${H}"><title>${n.color === 'w' ? `${Number(n.parent.fen.split(' ')[5])}.` : `${Number(n.parent.fen.split(' ')[5])}…`} ${fig(n.san)}${e ? ` · ${e.v >= 100 ? '#' : e.v <= -100 ? '#-' : (e.v > 0 ? '+' : '') + e.v.toFixed(2)}` : ''}</title></rect>`
  })
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Perfil de evaluación de la partida"><rect class="cb-pbg" x="0" y="0" width="${W}" height="${H}"/>${bars}<line class="cb-pmid" x1="0" x2="${W}" y1="${mid}" y2="${mid}"/></svg>`
    + (known < nodes.length / 2 && !profiling ? '<span class="cb-phint">Motor → Perfil analiza toda la partida</span>' : '')
}

// Analiza cada posición de la línea principal a profundidad 12 para completar el perfil. Pulsar otra vez lo para.
async function runProfile() {
  if (profiling) { profiling.stop = true; return }
  const t = tab()
  const nodes = [t.tree.root, ...t.tree.path(t.tree.mainEnd())]
  if (nodes.length < 2) { msg('No hay jugadas que analizar en esta partida.'); return }
  const job = { stop: false }
  profiling = job
  paintRibbon()
  await engine.stop()
  await engine.ready
  let done = 0
  for (const n of nodes) {
    if (job.stop || tab() !== t) break
    done += 1
    const k = posKey(n.fen)
    if ((evals.get(k)?.d || 0) >= 12) continue
    const c = new Chess(n.fen)
    if (c.isCheckmate()) { setEval(n.fen, c.turn() === 'w' ? -100 : 100, 99); continue }
    if (c.isGameOver()) { setEval(n.fen, 0, 99); continue }
    $('#cb-s-eng').textContent = `Perfil: analizando ${done} de ${nodes.length}…`
    const r = await engine.analyze(n.fen, { depth: 12, multipv: 1 })
    if (r.superseded) break
    const l = r.lines[0]
    if (l) setEval(n.fen, whitePov(l.score, n.fen), Math.max(12, l.depth || 0))
  }
  profiling = null
  paintRibbon()
  drawProfile()
  msg(job.stop ? 'Perfil detenido.' : 'Perfil de evaluación listo: pulsa una barra para ir a esa jugada.')
  analyze()
}

// Añade la mejor línea del motor como variante desde la jugada actual (con su valoración como comentario).
function insertPv() {
  const t = tab()
  if (!lastPv || lastPv.fen !== t.cur.fen || !lastPv.sans.length) { msg('Enciende el motor y espera a que muestre una línea.'); return }
  const sans = lastPv.sans.slice(0, 10)
  const end = t.tree.playLine(t.cur, sans)
  if (end !== t.cur && !end.comment) end.comment = `${lastPv.score} (prof. ${lastPv.depth})`
  renderNotation({ keepScroll: true })
  drawProfile()
  save()
  msg('Línea del motor añadida a la notación.')
}

// Barra de estado inferior: apertura, jugada, partidas en la referencia y valoración del motor.
function paintStatus() {
  const t = tab()
  const n = t.cur
  const ply = t.tree.path(n).length
  const total = t.tree.path(t.tree.mainEnd(n)).length
  const op = opening && t.tree.standardStart ? opening.text : t.tree.headers.Opening || ''
  $('#cb-s-open').textContent = op || (ply ? '' : 'Posición inicial')
  $('#cb-s-move').textContent = ply ? `Jugada ${Math.ceil(ply / 2)}${n.color === 'w' ? '.' : '…'} ${fig(n.san)} · ${ply}/${total}` : `0/${total}`
  $('#cb-s-ref').textContent = refTotal == null ? '' : `Referencia: ${fmtN(refTotal)} partidas`
  if (!profiling) $('#cb-s-eng').textContent = !prefs.engineOn ? 'Motor apagado' : lastPv && lastPv.fen === n.fen ? `Stockfish 18: ${lastPv.score} · prof. ${lastPv.depth}` : 'Stockfish 18'
}
