// Página Studio: mesa de análisis al estilo ChessMonitor Studio.
// Varios tableros en pestañas, notación con variantes y comentarios, partidas de la base local que pasan por la posición,
// árbol de aperturas de la base local (filtrable por jugador y color), explorador de Lichess y Stockfish con varias líneas.
/* global d3 */
import { Chessboard, COLOR, INPUT_EVENT_TYPE, BORDER_TYPE } from '../vendor/cm-chessboard/src/Chessboard.js'
import { Markers, MARKER_TYPE } from '../vendor/cm-chessboard/src/extensions/markers/Markers.js'
import { Arrows, ARROW_TYPE } from '../vendor/cm-chessboard/src/extensions/arrows/Arrows.js'
import { PromotionDialog, PROMOTION_DIALOG_RESULT_TYPE } from '../vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js'
import { Chess, DEFAULT_POSITION } from '../vendor/chess.js'
import { uciToSan } from './board.js'
import { sharedEngine, formatScore, whitePov } from './engine.js'
import { ExplorerPanel } from './explorer-panel.js'
import { countGames, getGame } from './db.js'
import { GameTree, NAGS, parsePgn, splitPgn, treeFromGame } from './studio-tree.js'
import { loadIndex, resetIndex, queryLine, continuation } from './studio-index.js'
import { Dock } from './dock.js'

const ASSETS = new URL('../vendor/cm-chessboard/assets/', import.meta.url).href
const KEY = 'ajedrez-web:studio'
const MAX_TABS = 12
const FIG = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘' }
const fig = (san) => san.replace(/[KQRBN]/g, (c) => FIG[c])
const fmtN = d3.format(',')

const I = {
  first: '<path d="M6 5v14M18 6l-8 6 8 6z"/>', prev: '<path d="M15 6l-6 6 6 6"/>', next: '<path d="M9 6l6 6-6 6"/>', last: '<path d="M18 5v14M6 6l8 6-8 6z"/>',
  flip: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>', up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', paste: '<path d="M8 4h8v4H8zM16 6h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/>',
  save: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>', plus: '<path d="M12 5v14M5 12h14"/>', play: '<path d="M7 4l13 8-13 8z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>',
  board: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  db: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  tree: '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>', cpu: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
}
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`
const tool = (act, icon, label) => `<button type="button" class="st-tb" data-act="${act}" title="${label}" aria-label="${label}">${svg(icon)}</button>`

const HTML = `
<div class="dk-toolbar">
  <span class="dk-hint">Arrastra las pestañas para mover los paneles. Suéltalas sobre otra pestaña para agruparlas o en el borde de un panel para dividirlo.</span>
  <span class="dk-closed" id="st-closed"></span>
  <button class="btn small" id="st-reset" type="button">Restablecer diseño</button>
</div>
<div class="st-dock" id="st-dock"></div>
<div id="st-panels">
  <div class="st-pn st-pn-board" data-pn="board">
    <div class="st-tabs" role="tablist" aria-label="Tableros"></div>
    <div class="st-board-area"><div class="board" id="st-board"></div></div>
  </div>
  <div class="st-pn" data-pn="notation">
    <div class="pn-bar"><span class="st-game" id="st-game"></span></div>
    <div class="st-tools">
      ${tool('first', 'first', 'Inicio')}${tool('prev', 'prev', 'Anterior')}${tool('next', 'next', 'Siguiente')}${tool('last', 'last', 'Final')}
      <span class="st-sep"></span>${tool('flip', 'flip', 'Girar el tablero')}
      <span class="st-sep"></span>${Object.values(NAGS).map((g) => `<button type="button" class="st-tb st-nag" data-nag="${g}" title="Marcar la jugada con ${g}">${g}</button>`).join('')}
      <span class="st-sep"></span>${tool('promote', 'up', 'Subir la variante')}${tool('cut', 'cut', 'Borrar desde esta jugada')}
      <span class="st-sep"></span>${tool('copy', 'copy', 'Copiar PGN')}${tool('save', 'save', 'Descargar .pgn')}${tool('paste', 'paste', 'Pegar PGN o FEN')}
    </div>
    <div class="st-notation" id="st-notation" aria-live="polite"></div>
    <textarea class="st-comment" id="st-comment" rows="2" placeholder="Comentario de esta jugada…"></textarea>
    <p class="note st-msg" id="st-msg"></p>
  </div>
  <div class="st-pn" data-pn="games">
    <div class="pn-bar"><span class="sp-sub" id="st-games-sub"></span></div>
    <div class="st-scroll"><table class="table clickable st-gt"><thead><tr>
      <th data-sort="r">Res.</th><th data-sort="w">Blancas</th><th class="n" data-sort="we">Elo</th><th data-sort="b">Negras</th><th class="n" data-sort="be">Elo</th><th class="hide-narrow" data-sort="ev">Torneo</th><th data-sort="d">Fecha</th><th class="hide-narrow" data-sort="ply">Jugadas</th>
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
    <div class="st-scroll"><table class="table clickable st-tt"><thead><tr><th>Jugada</th><th class="n">Partidas</th><th>B / T / N</th></tr></thead><tbody></tbody></table></div>
  </div>
  <div class="st-pn" data-pn="lichess"><div class="st-ex" id="st-ex"></div></div>
  <div class="st-pn" data-pn="engine">
    <div class="pn-bar st-eh">
      <button type="button" class="st-tb st-run" id="st-run" title="Encender o apagar el motor" aria-label="Encender o apagar el motor"></button>
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
    <p class="note">Puedes pegar varias partidas a la vez: cada una se abre en su propia pestaña. Las variantes y los comentarios se conservan.</p>
    <textarea id="st-dlg-text" rows="10" placeholder='[Event "..."] 1. e4 e5 (1... c5 2. Nf3) 2. Nf3 …'></textarea>
    <p class="note" id="st-dlg-msg"></p>
    <div class="row gap"><button class="btn primary" value="open" id="st-dlg-open">Abrir</button><button class="btn" value="cancel" formnovalidate>Cancelar</button></div>
  </form>
</dialog>`

// Paneles y diseño inicial, parecido al de los vídeos de ChessMonitor Studio.
const PANELS = {
  board: { title: 'Tableros', icon: 'board', closable: false },
  notation: { title: 'Notación', icon: 'list' },
  games: { title: 'Partidas de mi base', icon: 'db' },
  tree: { title: 'Árbol · mi base', icon: 'tree' },
  lichess: { title: 'Lichess', icon: 'globe' },
  engine: { title: 'Stockfish 18', icon: 'cpu' },
}
const stack = (id) => ({ t: 'stack', p: [id], a: id })
const DEFAULT_LAYOUT = {
  t: 'row', s: [44, 56], c: [
    { t: 'col', s: [66, 34], c: [stack('board'), stack('notation')] },
    { t: 'col', s: [32, 40, 28], c: [stack('games'), { t: 'row', s: [50, 50], c: [stack('tree'), stack('lichess')] }, stack('engine')] },
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
    this.fen = node.fen
    this.board.setPosition(node.fen, true)
    this.board.removeMarkers?.(MARKER_TYPE.square)
    if (node.from) { this.board.addMarker?.(MARKER_TYPE.square, node.from); this.board.addMarker?.(MARKER_TYPE.square, node.to) }
  }

  get orientation() { return this.board.getOrientation() === COLOR.black ? 'b' : 'w' }
  setOrientation(c) { this.board.setOrientation(c === 'b' ? COLOR.black : COLOR.white) }
  setArrows(list) {
    this.board.removeArrows?.()
    for (const a of list) this.board.addArrow?.(a.type || ARROW_TYPE.info, a.from, a.to)
  }
}

// ---- Estado ----

let root, board, engine, explorer, dock
let layout = null
let tabs = [] // {tree, cur, o}
let active = 0
let prefs = { engineOn: true, lines: 3, depth: 22, player: '', color: 'any' }
let items = null // índice de la base local
let indexCount = -1
let lastQuery = null
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
    layout = s.layout || null
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
      localStorage.setItem(KEY, JSON.stringify({ prefs, layout, active, tabs: tabs.map((t) => ({ pgn: t.tree.toPgn(), addr: t.tree.address(t.cur), o: t.o })) }))
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
  $('.st-tools').addEventListener('click', (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.dataset.nag) { if (tab().cur.parent) { tab().tree.toggleNag(tab().cur, b.dataset.nag); renderNotation(); save() } return }
    const act = b.dataset.act
    const t = tab()
    if (act === 'first') go(t.tree.root)
    else if (act === 'prev') go(t.cur.parent || t.cur)
    else if (act === 'next') go(t.cur.children[0] || t.cur)
    else if (act === 'last') go(t.tree.mainEnd(t.cur))
    else if (act === 'flip') { t.o = t.o === 'w' ? 'b' : 'w'; board.setOrientation(t.o); save() }
    else if (act === 'promote') { if (t.tree.promote(t.cur)) { renderNotation(); save() } }
    else if (act === 'cut') { if (t.cur.parent) go(t.tree.remove(t.cur)) }
    else if (act === 'copy') copyPgn()
    else if (act === 'save') downloadPgn()
    else if (act === 'paste') openDialog()
  })
  $('#st-notation').addEventListener('click', (e) => {
    const m = e.target.closest('[data-id]')
    if (m) go(tab().tree.byId.get(Number(m.dataset.id)))
  })
  $('#st-comment').addEventListener('input', (e) => {
    tab().cur.comment = e.target.value
    renderNotation({ keepScroll: true })
    save()
  })

  // Motor
  $('#st-run').addEventListener('click', () => { prefs.engineOn = !prefs.engineOn; save(); paintEngineControls(); analyze() })
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
  })

  // Diálogo de PGN
  $('#st-dlg').addEventListener('close', () => { if ($('#st-dlg').returnValue === 'open') importText($('#st-dlg-text').value) })

  showTab()
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
  root.querySelectorAll('.st-nag').forEach((b) => b.setAttribute('aria-pressed', String(Boolean(t.cur.parent) && t.cur.nags.includes(Number(Object.keys(NAGS).find((k) => NAGS[k] === b.dataset.nag))))))
  if (!visible()) return
  if (dock.isOpen('lichess')) explorer.update(t.cur.fen)
  queryLocal()
  analyze()
}

function showTab() {
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

  const h = tab().tree.headers
  const who = (n, e) => (n && n !== '?' ? `${n}${e ? ` ${e}` : ''}` : '')
  const players = [who(h.White, h.WhiteElo), who(h.Black, h.BlackElo)].filter(Boolean).join(' vs ')
  const extra = [h.Event, h.Date].filter((x) => x && !/^[?.\s-]+$/.test(x)).join(' · ')
  $('#st-game').textContent = [players, extra, h.Result && h.Result !== '*' ? h.Result : ''].filter(Boolean).join(' · ')
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
  if (t.tree.root.comment) box.appendChild(el('span', 'st-c', t.tree.root.comment))
  line(t.tree.root, true, box, 0)
  if (!t.tree.root.children.length) box.appendChild(el('p', 'note', 'Mueve las piezas para empezar. Si juegas otra jugada en una posición ya analizada, se crea una variante.'))
  if (keepScroll) box.scrollTop = top
  else box.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
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
  const g = await getGame(id)
  if (!g) return
  const sans = tab().tree.sanLine(tab().cur)
  const tree = treeFromGame(g)
  let at = tree.root
  for (let i = 0; i < sans.length && at.children[0]; i++) at = at.children[0]
  openTab(newTab(tree, at))
}

// ---- Base local: partidas y árbol de la posición ----

async function refreshIndex() {
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
  if (indexCount === 0) {
    const txt = 'Tu base está vacía. Importa partidas en <a href="#database">Base de datos</a> (TWIC, ChessBase, tus torneos) y aparecerán aquí.'
    empty(tt, 3, txt); empty(gt, 8, txt)
    $('#st-tree-sub').textContent = ''; $('#st-games-sub').textContent = ''
    return
  }
  if (!items) return
  if (!t.tree.standardStart) {
    const txt = 'Esta pestaña empieza desde una posición propia; la base se busca desde la posición inicial.'
    empty(tt, 3, txt); empty(gt, 8, txt)
    return
  }
  const sans = t.tree.sanLine(t.cur)
  const key = JSON.stringify([sans, prefs.player, prefs.color, items.length, gameSort])
  if (key === lastQuery) return
  lastQuery = key
  const r = queryLine(items, sans, { player: prefs.player, color: prefs.color })
  const filt = prefs.player ? ` · ${prefs.player}${prefs.color === 'w' ? ' (blancas)' : prefs.color === 'b' ? ' (negras)' : ''}` : ''
  $('#st-tree-sub').textContent = `${fmtN(r.total)} partidas${filt}`
  const NAMES = { r: 'resultado', w: 'blancas', b: 'negras', we: 'Elo de blancas', be: 'Elo de negras', ev: 'torneo', d: 'fecha', ply: 'número de jugadas' }
  $('#st-games-sub').textContent = `${fmtN(r.total)} en esta posición${filt} · ${gameSort ? `por ${NAMES[gameSort.col]}` : 'más recientes primero'}`

  tt.replaceChildren(...r.moves.slice(0, 40).map((m) => {
    const tr = document.createElement('tr'); tr.dataset.san = m.san
    const c1 = document.createElement('td'); c1.className = 'san'; c1.textContent = fig(m.san)
    const c2 = document.createElement('td'); c2.className = 'n'; c2.textContent = fmtN(m.n)
    const c3 = document.createElement('td')
    const wrap = document.createElement('div'); wrap.className = 'st-wdl'
    const bar = document.createElement('div'); bar.className = 'wdl'
    ;[[m.w, 'wh'], [m.d, 'd'], [m.l, 'bl']].forEach(([k, c]) => { const s = document.createElement('div'); s.className = c; s.style.flex = k; bar.appendChild(s) })
    const nums = document.createElement('span'); nums.className = 'st-nums'
    nums.innerHTML = `<b class="w">${m.w}</b> / <b class="d">${m.d}</b> / <b class="l">${m.l}</b>`
    wrap.append(bar, nums)
    c3.appendChild(wrap)
    tr.append(c1, c2, c3)
    return tr
  }))
  if (!r.moves.length) empty(tt, 3, r.deep ? 'Línea demasiado larga para el árbol (más de 60 medias jugadas).' : 'Ninguna partida de tu base sigue desde aquí.')

  gt.replaceChildren(...sortGames(r.games).slice(0, 200).map((g) => {
    const tr = document.createElement('tr'); tr.dataset.id = g.id
    const cells = [
      [g.r === '½-½' ? '½-½' : g.r, 'st-res ' + (g.r === '1-0' ? 'w' : g.r === '0-1' ? 'l' : 'd')],
      [g.w, 'st-name'], [g.we || '', 'n'], [g.b, 'st-name'], [g.be || '', 'n'], [g.ev, 'st-ev hide-narrow'], [g.d, 'st-date'],
      [numbered(sans, continuation(g, sans)), 'st-cont hide-narrow'],
    ]
    for (const [txt, cls] of cells) { const td = document.createElement('td'); td.className = cls; td.textContent = txt; tr.appendChild(td) }
    return tr
  }))
  if (!r.games.length) empty(gt, 8, 'Ninguna partida de tu base llega a esta posición (con este orden de jugadas).')
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
  if (!prefs.engineOn || !dock.isOpen('engine')) { engine.stop(); list.replaceChildren(); depthEl.textContent = 'apagado'; board.setArrows([]); return }
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
      if (best) board.setArrows([{ from: best.slice(0, 2), to: best.slice(2, 4) }])
    },
  })
}
